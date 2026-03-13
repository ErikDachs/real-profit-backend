import { FastifyInstance } from "fastify";
import type { ShopifyCtx } from "./ctx.js";
import { calculateOrderProfit, buildProductsProfit } from "../../domain/profit.js";
import { buildOrdersSummary } from "../../domain/profit/ordersSummary.js";
import { buildDailyProfit } from "../../domain/profitDaily.js";
import { buildProfitKillersInsights } from "../../domain/insights.js";
import {
  parseDays,
  parseLimit,
  parseAdInputs,
  precomputeUnitCostsForOrders,
  effectiveCostOverrides,
} from "./helpers.js";
import { enrichOrdersWithAds, enrichProductsWithAds } from "../../domain/insights/adsAllocation.js";
import { resolveCostProfile } from "../../domain/costModel/resolve.js";
import { runOpportunityScenarioSimulations } from "../../domain/simulations/runScenarioPresets.js";
import { requireEmbeddedAuthAndMatchShop } from "./auth.js";

export function registerProfitKillersRoute(app: FastifyInstance, ctx: ShopifyCtx) {
  app.get("/api/insights/profit-killers", async (req, reply) => {
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

      const cogsOverridesStore =
        shop === ctx.shop
          ? ctx.cogsOverridesStore
          : await ctx.getCogsOverridesStoreForShop(shop);

      const cogsService =
        shop === ctx.shop
          ? ctx.cogsService
          : await ctx.getCogsServiceForShop(shop);

      const costModelOverridesStore =
        shop === ctx.shop
          ? ctx.costModelOverridesStore
          : await ctx.getCostModelOverridesStoreForShop(shop);

      await costModelOverridesStore.ensureLoaded();
      const persisted = costModelOverridesStore.getOverridesSync();
      const mergedOverrides = effectiveCostOverrides({ persisted, input: q });

      const costProfile = resolveCostProfile({
        config: (app as any).config ?? {},
        overrides: mergedOverrides,
      });

      const unitCostByVariant = await precomputeUnitCostsForOrders({
        orders,
        cogsService,
        shopifyGET: shopifyClient.get,
      });

      const summary = await buildOrdersSummary({
        shop,
        days: daysNum,
        adSpend: Number(adSpend ?? 0) || 0,
        orders,
        costProfile,
        cogsService,
        shopifyGET: shopifyClient.get,
        unitCostByVariant,
        isIgnoredVariant: (variantId: number) => cogsOverridesStore.isIgnoredSync(variantId),
      });

      const orderProfits: any[] = [];
      for (const o of orders) {
        const p = await calculateOrderProfit({
          order: o,
          costProfile,
          cogsService,
          shopifyGET: shopifyClient.get,
          unitCostByVariant,
          isIgnoredVariant: (variantId: number) => cogsOverridesStore.isIgnoredSync(variantId),
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

          isGiftCardOnlyOrder: p.isGiftCardOnlyOrder,
          giftCardNetSalesExcluded: p.giftCardNetSalesExcluded,

          shippingRevenue: p.shippingRevenue,
          shippingCost: p.shippingCost,
          shippingImpact: p.shippingImpact,
          profitAfterShipping: p.profitAfterShipping,

          adSpendBreakEven: p.adSpendBreakEven,
          breakEvenRoas: p.breakEvenRoas,
        });
      }

      const daily = buildDailyProfit({
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
      const missingCogsCount = Number(summary?.missingCogsCount ?? 0);
      const spend = Number(adSpend ?? 0);

      const ordersEnriched = enrichOrdersWithAds({
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
          orders: daily.totals.orders,
          shippingRevenue: daily.totals.shippingRevenue,
          shippingCost: daily.totals.shippingCost,
          shippingImpact: daily.totals.shippingImpact,
        },
      });

      const topOpps = (insights as any)?.opportunities?.top ?? (insights as any)?.unifiedOpportunitiesTop5 ?? [];
      const adSpendNum = Number.isFinite(spend) ? spend : 0;

      const scenarioPack =
        topOpps.length > 0
          ? await runOpportunityScenarioSimulations({
              shop,
              days: daysNum,
              adSpend: adSpendNum,
              orders,

              baseCostProfile: costProfile,
              config: (app as any).config ?? {},
              baseOverrides: mergedOverrides,

              cogsService,
              shopifyGET: shopifyClient.get,
              unitCostByVariant,

              opportunities: topOpps,
            })
          : { baselineSummary: null, simulationsByOpportunity: [] };

      return reply.send({
        ...insights,
        scenarioSimulations: {
          baselineSummary: scenarioPack.baselineSummary,
          byOpportunity: scenarioPack.simulationsByOpportunity,
        },
        costModel: {
          fingerprint: costProfile.meta.fingerprint,
          persistedUpdatedAt: costModelOverridesStore.getUpdatedAtSync() ?? null,
        },
      });
    } catch (err: any) {
      const status = err?.status && Number.isFinite(err.status) ? err.status : 500;
      return reply.status(status).send({ error: "Unexpected error", details: String(err?.message ?? err) });
    }
  });
}