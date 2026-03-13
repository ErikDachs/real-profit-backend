import { FastifyInstance } from "fastify";
import type { ShopifyCtx } from "./ctx.js";

import { calculateOrderProfit, buildProductsProfit, allocateFixedCostsForOrders } from "../../domain/profit.js";
import { buildDailyProfit } from "../../domain/profitDaily.js";

import {
  parseDays,
  parseLimit,
  parseAdInputs,
  precomputeUnitCostsForOrders,
  effectiveCostOverrides,
} from "./helpers.js";

import { enrichOrdersWithAds, enrichProductsWithAds } from "../../domain/insights/adsAllocation.js";
import { buildProfitKillersInsights } from "../../domain/insights.js";

import { buildOpportunityDeepDive } from "../../domain/opportunities/deepDive.js";
import type { OpportunityType } from "../../domain/opportunities/types.js";

import { buildActionPlan } from "../../domain/actions.js";
import { resolveCostProfile } from "../../domain/costModel/resolve.js";
import { round2 } from "../../utils/money.js";
import { runOpportunityScenarioSimulations } from "../../domain/simulations/runScenarioPresets.js";
import { requireEmbeddedAuthAndMatchShop } from "./auth.js";

function simpleHash(str: string): string {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function buildActionId(params: {
  shop: string;
  days: number;
  costModelFingerprint: string;
  actionCode: string;
  opportunityType: OpportunityType;
}) {
  const key = `${params.shop}|${params.days}|${params.costModelFingerprint}|${params.opportunityType}|${params.actionCode}`;
  return `act_${simpleHash(key)}`;
}

export function registerActionsPlanRoute(app: FastifyInstance, ctx: ShopifyCtx) {
  app.get("/api/actions/plan", async (req, reply) => {
    try {
      const q = req.query as any;

      const daysNum = parseDays(q, 30);
      const limitNum = parseLimit(q, 10);
      const { adSpend, currentRoas } = parseAdInputs(q);

      const auth = await requireEmbeddedAuthAndMatchShop(app, req, reply, q?.shop);
      if (!auth) return;

      const shop = auth.shop;

      const shopifyClient =
        shop === ctx.shop ? ctx.shopify : await ctx.createShopifyForShop(shop);

      const orders =
        shop === ctx.shop
          ? await ctx.fetchOrders(daysNum)
          : await ctx.fetchOrdersForShop(shop, daysNum);

      const cogsService =
        shop === ctx.shop
          ? ctx.cogsService
          : await ctx.getCogsServiceForShop(shop);

      const costModelOverridesStore =
        shop === ctx.shop
          ? ctx.costModelOverridesStore
          : await ctx.getCostModelOverridesStoreForShop(shop);

      const actionPlanStateStore =
        shop === ctx.shop
          ? ctx.actionPlanStateStore
          : await ctx.getActionPlanStateStoreForShop(shop);

      await costModelOverridesStore.ensureLoaded();
      const persisted = costModelOverridesStore.getOverridesSync();
      const baseOverrides = effectiveCostOverrides({ persisted, input: q });

      const costProfile = resolveCostProfile({
        config: (app as any).config ?? {},
        overrides: baseOverrides,
      });

      const unitCostByVariant = await precomputeUnitCostsForOrders({
        orders,
        cogsService,
        shopifyGET: shopifyClient.get,
      });

      const orderProfits: any[] = [];
      for (const o of orders) {
        const p = await calculateOrderProfit({
          order: o,
          costProfile,
          cogsService,
          shopifyGET: shopifyClient.get,
          unitCostByVariant,
        });

        orderProfits.push({
          id: o.id,
          name: o.name ?? null,
          createdAt: o.created_at ?? null,
          currency: o.currency ?? null,

          grossSales: p.grossSales,
          refunds: p.refunds,
          netAfterRefunds: p.netAfterRefunds,
          cogs: p.cogs,
          paymentFees: p.paymentFees,

          contributionMargin: p.contributionMargin,
          contributionMarginPct: p.contributionMarginPct,

          shippingRevenue: p.shippingRevenue,
          shippingCost: p.shippingCost,
          shippingImpact: p.shippingImpact,
          profitAfterShipping: p.profitAfterShipping,

          adSpendBreakEven: p.adSpendBreakEven,
          breakEvenRoas: p.breakEvenRoas,
        });
      }

      const dailyBase = buildDailyProfit({
        shop,
        days: daysNum,
        orderProfits: orderProfits.map((x) => ({
          createdAt: x.createdAt,
          grossSales: x.grossSales,
          refunds: x.refunds,
          netAfterRefunds: x.netAfterRefunds,
          cogs: x.cogs,
          paymentFees: x.paymentFees,

          profitAfterFees: x.contributionMargin,
          contributionMargin: x.contributionMargin,

          shippingRevenue: x.shippingRevenue,
          shippingCost: x.shippingCost,
          profitAfterShipping: x.profitAfterShipping,
        })),
      });

      const productResult = await buildProductsProfit({
        shop,
        days: daysNum,
        orders,
        costProfile,
        cogsService,
        shopifyGET: shopifyClient.get,
      });

      const productsRaw = (productResult?.products ?? []) as any[];
      const missingCogsCount = Number(productResult?.highlights?.missingCogsCount ?? 0);

      const spend = Number(adSpend ?? 0);

      const ordersEnrichedAds = enrichOrdersWithAds({
        orders: orderProfits,
        totalAdSpend: Number.isFinite(spend) ? spend : 0,
        weight: (o) => Number(o.netAfterRefunds || 0),
        baseProfit: (o) => Number(o.contributionMargin || 0),
        profitAfterShipping: (o) => Number((o as any).profitAfterShipping ?? 0),
      });

      const productsEnriched = enrichProductsWithAds({
        products: productsRaw,
        totalAdSpend: Number.isFinite(spend) ? spend : 0,
        weight: (p) => Number((p as any).netSales ?? 0),
        baseProfit: (p) => Number((p as any).profitAfterFees ?? 0),
      });

      const daysInMonth = Math.max(1, Number(costProfile.fixedCosts?.daysInMonth ?? 30));
      const monthlyTotal = round2(Number(costProfile.derived?.fixedCostsMonthlyTotal ?? 0));
      const fixedCostsAllocatedInPeriod = round2(
        monthlyTotal * (Math.max(1, Number(daysNum || 0)) / daysInMonth)
      );

      const fixedAllocMode = (costProfile.fixedCosts?.allocationMode ?? "PER_ORDER") as "PER_ORDER" | "BY_NET_SALES";

      const ordersEnriched = allocateFixedCostsForOrders({
        rows: ordersEnrichedAds,
        fixedCostsTotal: fixedCostsAllocatedInPeriod,
        mode: fixedAllocMode,
      }).map((o: any) => {
        const profitAfterAdsAndShipping = Number(o.profitAfterAdsAndShipping ?? 0);
        const fixedCostAllocated = round2(Number(o.fixedCostAllocated ?? 0));
        const profitAfterFixedCosts = round2(profitAfterAdsAndShipping - fixedCostAllocated);

        return {
          ...o,
          fixedCostAllocated,
          profitAfterFixedCosts,
        };
      });

      const insights = buildProfitKillersInsights({
        shop,
        days: daysNum,
        orders: ordersEnriched,
        products: productsEnriched,
        missingCogsCount,
        limit: limitNum,
        adSpend,
        currentRoas,
        shippingTotals: {
          orders: dailyBase.totals.orders,
          shippingRevenue: dailyBase.totals.shippingRevenue,
          shippingCost: dailyBase.totals.shippingCost,
          shippingImpact: dailyBase.totals.shippingImpact,
        },
        fixedCosts: {
          allocatedInPeriod: fixedCostsAllocatedInPeriod,
          daysInMonth,
          monthlyTotal,
          allocationMode: fixedAllocMode,
        },
      }) as any;

      const currency = insights?.meta?.currency ?? ordersEnriched[0]?.currency ?? "USD";

      const unifiedAll = (insights?.unifiedOpportunitiesAll ?? []) as any[];
      const unifiedTop = (insights?.unifiedOpportunitiesTop5 ?? []) as any[];

      const adSpendNum = Number.isFinite(spend) ? spend : 0;
      const scenarioPack =
        unifiedTop.length > 0
          ? await runOpportunityScenarioSimulations({
              shop,
              days: daysNum,
              adSpend: adSpendNum,
              orders,

              baseCostProfile: costProfile,
              config: (app as any).config ?? {},
              baseOverrides,

              cogsService,
              shopifyGET: shopifyClient.get,
              unitCostByVariant,

              opportunities: unifiedTop,
            })
          : { baselineSummary: null, simulationsByOpportunity: [] as any[] };

      const scenarioByType = new Map<OpportunityType, any>();
      for (const s of scenarioPack.simulationsByOpportunity ?? []) {
        const t = String(s.type) as OpportunityType;
        scenarioByType.set(t, s);
      }

      const simulationByType = new Map<OpportunityType, any>();
      for (const [t, s] of scenarioByType.entries()) simulationByType.set(t, s);

      const deepDivePack = buildOpportunityDeepDive({
        shop,
        days: daysNum,
        currency,
        opportunities: unifiedAll,
        orders: ordersEnriched,
        products: productsEnriched,
        simulationByType,
        limit: Math.min(10, limitNum),
      });

      const plan = buildActionPlan({
        shop,
        days: daysNum,
        currency,
        unifiedOpportunities: unifiedAll,
        deepDives: deepDivePack.deepDives,
        scenarioSimulationsByOpportunityType: scenarioByType,
        costModelFingerprint: costProfile.meta.fingerprint,
        inputs: {
          adSpend: Number.isFinite(spend) ? spend : null,
          currentRoas: currentRoas ?? null,
          overridesFingerprint: costProfile.meta.fingerprint,
        },
        limit: limitNum,
      });

      await actionPlanStateStore.ensureLoaded();

      const actionsWithState = (plan.actions ?? []).map((a: any) => {
        const actionId = buildActionId({
          shop,
          days: daysNum,
          costModelFingerprint: String(costProfile.meta.fingerprint || ""),
          actionCode: String(a.code || ""),
          opportunityType: String(a.opportunityType || "") as OpportunityType,
        });

        const state = actionPlanStateStore.getStateSync(actionId);

        return {
          ...a,
          actionId,
          state: state ?? {
            actionId,
            status: "OPEN",
            note: null,
            dueDate: null,
            dismissedReason: null,
            updatedAt: null,
          },
        };
      });

      return reply.send({
        ...plan,
        actions: actionsWithState,
        meta: {
          ...(plan.meta ?? {}),
          costModel: {
            fingerprint: costProfile.meta.fingerprint,
            persistedUpdatedAt: costModelOverridesStore.getUpdatedAtSync() ?? null,
          },
          fixedCosts: {
            monthlyTotal,
            allocatedInPeriod: fixedCostsAllocatedInPeriod,
            allocationMode: fixedAllocMode,
            daysInMonth,
          },
          actionState: {
            persistedUpdatedAt: actionPlanStateStore.getUpdatedAtSync() ?? null,
          },
        },
        opportunities: (insights as any)?.opportunities ?? null,
        insights: (insights as any)?.insights ?? null,
        scenarioSimulations: {
          baselineSummary: scenarioPack.baselineSummary,
          byOpportunity: scenarioPack.simulationsByOpportunity,
        },
      });
    } catch (err: any) {
      const status = err?.status && Number.isFinite(err.status) ? err.status : 500;
      return reply.status(status).send({ error: "Unexpected error", details: String(err?.message ?? err) });
    }
  });
}