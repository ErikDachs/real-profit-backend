import { FastifyInstance } from "fastify";
import type { ShopifyCtx } from "./ctx.js";

import { calculateOrderProfit, buildProductsProfit } from "../../domain/profit.js";
import { buildDailyProfit } from "../../domain/profitDaily.js";

import {
  parseDays,
  parseLimit,
  parseAdInputs,
  parseShop,
  precomputeUnitCostsForOrders,
  effectiveCostOverrides,
} from "./helpers.js";

import { buildShippingSubsidyInsight } from "../../domain/insights/shippingSubsidy.js";
import { buildUnifiedOpportunityRanking } from "../../domain/opportunities/unifiedOpportunityRanking.js";
import { buildImpactSimulation } from "../../domain/simulations/impactSimulation.js";

import { enrichOrdersWithAds, enrichProductsWithAds } from "../../domain/insights/adsAllocation.js";

import { buildOpportunityDeepDive } from "../../domain/opportunities/deepDive.js";
import type { OpportunityType } from "../../domain/opportunities/types.js";

// ✅ SSOT Cost Model Engine
import { resolveCostProfile } from "../../domain/costModel/resolve.js";

export function registerOpportunityDeepDiveRoute(app: FastifyInstance, ctx: ShopifyCtx) {
  app.get("/api/opportunities/deep-dive", async (req, reply) => {
    try {
      const q = req.query as any;

      const daysNum = parseDays(q, 30);
      const limitNum = parseLimit(q, 10);
      const { adSpend, currentRoas } = parseAdInputs(q);

      const shop = parseShop(q, ctx.shop);
      if (!shop) {
        return reply.status(400).send({ error: "shop is required (valid *.myshopify.com)" });
      }

      const shopifyClient = shop === ctx.shop ? ctx.shopify : await ctx.createShopifyForShop(shop);

      const orders = shop === ctx.shop
        ? await ctx.fetchOrders(daysNum)
        : await ctx.fetchOrdersForShop(shop, daysNum);

      const cogsService = shop === ctx.shop
        ? ctx.cogsService
        : await ctx.getCogsServiceForShop(shop);

      const costModelOverridesStore = shop === ctx.shop
        ? ctx.costModelOverridesStore
        : await ctx.getCostModelOverridesStoreForShop(shop);

      // ✅ Persisted overrides + request overrides (request wins)
      await costModelOverridesStore.ensureLoaded();
      const persisted = costModelOverridesStore.getOverridesSync();
      const mergedOverrides = effectiveCostOverrides({ persisted, input: q });

      // ✅ Resolve cost profile per request (config + merged overrides)
      const costProfile = resolveCostProfile({
        config: (app as any).config ?? {},
        overrides: mergedOverrides,
      });

      const type = (q?.type ? String(q.type) : undefined) as OpportunityType | undefined;

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
      const missingCogsCount = Number(productResult?.highlights?.missingCogsCount ?? 0);

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

      const currency = ordersEnriched[0]?.currency ?? "USD";

      const shippingSubsidy = buildShippingSubsidyInsight({
        currency,
        days: daysNum,
        shippingTotals: {
          orders: daily.totals.orders,
          shippingRevenue: daily.totals.shippingRevenue,
          shippingCost: daily.totals.shippingCost,
          shippingImpact: daily.totals.shippingImpact,
        },
      });

      const unified = buildUnifiedOpportunityRanking({
        days: daysNum,
        currency,
        refunds: {
          lossInPeriod: ordersEnriched.reduce((s, o) => s + Number(o.refunds || 0), 0),
          refundRatePct: (() => {
            const gross = ordersEnriched.reduce((s, o) => s + Number(o.grossSales || 0), 0);
            const refunds = ordersEnriched.reduce((s, o) => s + Number(o.refunds || 0), 0);
            return gross > 0 ? (refunds / gross) * 100 : 0;
          })(),
        },
        fees: {
          lossInPeriod: ordersEnriched.reduce((s, o) => s + Number(o.paymentFees || 0), 0),
          feePctOfNet: (() => {
            const net = ordersEnriched.reduce((s, o) => s + Number(o.netAfterRefunds || 0), 0);
            const fees = ordersEnriched.reduce((s, o) => s + Number(o.paymentFees || 0), 0);
            return net > 0 ? (fees / net) * 100 : 0;
          })(),
        },
        missingCogsCount,
        missingCogsLossInPeriod: 0,
        shippingSubsidy: shippingSubsidy
          ? {
              lossInPeriod: Number((shippingSubsidy as any).lossInPeriod || (shippingSubsidy as any).estimatedLossInPeriod || 0),
              subsidyRatePct: (shippingSubsidy as any).subsidyRatePct ?? null,
            }
          : undefined,
        limit: 5,
      });

      const sim = buildImpactSimulation({
        opportunities: unified.all,
        limit: Math.min(5, unified.all.length),
      });

      const simulationByType = new Map<OpportunityType, any>();
      for (const s of sim.top ?? []) simulationByType.set(s.type as OpportunityType, s);

      const deepDive = buildOpportunityDeepDive({
        shop,
        days: daysNum,
        currency,
        opportunities: unified.all,
        orders: ordersEnriched,
        products: productsEnriched,
        simulationByType,
        type,
        limit: limitNum,
      });

      return reply.send({
        ...deepDive,
        meta: {
          adSpend: Number.isFinite(spend) ? spend : 0,
          currentRoas: currentRoas ?? null,
          costModel: {
            fingerprint: costProfile.meta.fingerprint,
            persistedUpdatedAt: costModelOverridesStore.getUpdatedAtSync() ?? null,
          },
        },
      });
    } catch (err: any) {
      const status = err?.status && Number.isFinite(err.status) ? err.status : 500;
      return reply.status(status).send({ error: "Unexpected error", details: String(err?.message ?? err) });
    }
  });
}