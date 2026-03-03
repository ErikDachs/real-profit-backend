// src/routes/shopify/actionsPlan.route.ts
import { FastifyInstance } from "fastify";
import type { ShopifyCtx } from "./ctx";

import { calculateOrderProfit, buildProductsProfit, allocateFixedCostsForOrders } from "../../domain/profit";
import { buildDailyProfit } from "../../domain/profitDaily";

import { parseDays, parseLimit, parseAdInputs, precomputeUnitCostsForOrders, effectiveCostOverrides } from "./helpers";

import { enrichOrdersWithAds, enrichProductsWithAds } from "../../domain/insights/adsAllocation";
import { buildProfitKillersInsights } from "../../domain/insights";

import { buildOpportunityDeepDive } from "../../domain/opportunities/deepDive";
import type { OpportunityType } from "../../domain/opportunities/types";

import { buildActionPlan } from "../../domain/actions";

// SSOT Cost Model Engine
import { resolveCostProfile } from "../../domain/costModel/resolve";
import { round2 } from "../../utils/money";

// Scenario sims (SSOT re-run)
import { runOpportunityScenarioSimulations } from "../../domain/simulations/runScenarioPresets";

// ---------
// Deterministic Action ID (SSOT for status mapping)
// ---------
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
  // include a readable prefix for debugging
  return `act_${simpleHash(key)}`;
}

export function registerActionsPlanRoute(app: FastifyInstance, ctx: ShopifyCtx) {
  app.get("/api/actions/plan", async (req, reply) => {
    try {
      const q = req.query as any;

      const daysNum = parseDays(q, 30);
      const limitNum = parseLimit(q, 10);
      const { adSpend, currentRoas } = parseAdInputs(q);

      // persisted overrides + request overrides (request wins)
      await ctx.costModelOverridesStore.ensureLoaded();
      const persisted = ctx.costModelOverridesStore.getOverridesSync();
      const baseOverrides = effectiveCostOverrides({ persisted, input: q });

      const costProfile = resolveCostProfile({
        config: (app as any).config ?? {},
        overrides: baseOverrides,
      });

      const orders = await ctx.fetchOrders(daysNum);

      const unitCostByVariant = await precomputeUnitCostsForOrders({
        orders,
        cogsService: ctx.cogsService,
        shopifyGET: ctx.shopify.get,
      });

      // 1) Build per-order profits (SSOT)
      const orderProfits: any[] = [];
      for (const o of orders) {
        const p = await calculateOrderProfit({
          order: o,
          costProfile,
          cogsService: ctx.cogsService,
          shopifyGET: ctx.shopify.get,
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

      // 2) Daily totals (for shipping totals etc.)
      const dailyBase = buildDailyProfit({
        shop: ctx.shop,
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

      // 3) Products (SSOT)
      const productResult = await buildProductsProfit({
        shop: ctx.shop,
        days: daysNum,
        orders,
        costProfile,
        cogsService: ctx.cogsService,
        shopifyGET: ctx.shopify.get,
      });

      const productsRaw = (productResult?.products ?? []) as any[];
      const missingCogsCount = Number(productResult?.highlights?.missingCogsCount ?? 0);

      // 4) Ads allocation (deterministic)
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

      // 4.5) Fixed Costs allocation (SSOT)
      const daysInMonth = Math.max(1, Number(costProfile.fixedCosts?.daysInMonth ?? 30));
      const monthlyTotal = round2(Number(costProfile.derived?.fixedCostsMonthlyTotal ?? 0));
      const fixedCostsAllocatedInPeriod = round2(monthlyTotal * (Math.max(1, Number(daysNum || 0)) / daysInMonth));

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

      // 5) Profit killers engine
      const insights = buildProfitKillersInsights({
        shop: ctx.shop,
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

      // 6) Scenario sims
      const adSpendNum = Number.isFinite(spend) ? spend : 0;
      const scenarioPack =
        unifiedTop.length > 0
          ? await runOpportunityScenarioSimulations({
              shop: ctx.shop,
              days: daysNum,
              adSpend: adSpendNum,
              orders,

              baseCostProfile: costProfile,
              config: (app as any).config ?? {},
              baseOverrides,

              cogsService: ctx.cogsService,
              shopifyGET: ctx.shopify.get,
              unitCostByVariant,

              opportunities: unifiedTop,
            })
          : { baselineSummary: null, simulationsByOpportunity: [] as any[] };

      const scenarioByType = new Map<OpportunityType, any>();
      for (const s of scenarioPack.simulationsByOpportunity ?? []) {
        const t = String(s.type) as OpportunityType;
        scenarioByType.set(t, s);
      }

      // 7) Deep dives
      const simulationByType = new Map<OpportunityType, any>();
      for (const [t, s] of scenarioByType.entries()) simulationByType.set(t, s);

      const deepDivePack = buildOpportunityDeepDive({
        shop: ctx.shop,
        days: daysNum,
        currency,
        opportunities: unifiedAll,
        orders: ordersEnriched,
        products: productsEnriched,
        simulationByType,
        limit: Math.min(10, limitNum),
      });

      // 8) Build Action Plan
      const plan = buildActionPlan({
        shop: ctx.shop,
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

      // ✅ 9) Merge persisted action states (status/notes)
      await ctx.actionPlanStateStore.ensureLoaded();

      const actionsWithState = (plan.actions ?? []).map((a: any) => {
        const actionId = buildActionId({
          shop: ctx.shop,
          days: daysNum,
          costModelFingerprint: String(costProfile.meta.fingerprint || ""),
          actionCode: String(a.code || ""),
          opportunityType: String(a.opportunityType || "") as OpportunityType,
        });

        const state = ctx.actionPlanStateStore.getStateSync(actionId);

        return {
          ...a,
          actionId,
          state: state ?? { actionId, status: "OPEN", note: null, dueDate: null, dismissedReason: null, updatedAt: null },
        };
      });

      return reply.send({
        ...plan,
        actions: actionsWithState,
        meta: {
          ...(plan.meta ?? {}),
          costModel: {
            fingerprint: costProfile.meta.fingerprint,
            persistedUpdatedAt: ctx.costModelOverridesStore.getUpdatedAtSync() ?? null,
          },
          fixedCosts: {
            monthlyTotal,
            allocatedInPeriod: fixedCostsAllocatedInPeriod,
            allocationMode: fixedAllocMode,
            daysInMonth,
          },
          actionState: {
            persistedUpdatedAt: ctx.actionPlanStateStore.getUpdatedAtSync() ?? null,
          },
        },

        // ADD THIS for testing / UI hookup
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