// src/routes/shopify/ordersSummary.route.ts
import { FastifyInstance } from "fastify";
import type { ShopifyCtx } from "./ctx.js";
import { round2 } from "../../utils/money.js";
import { buildOrdersSummary } from "../../domain/profit.js";
import { computeProfitHealthFromSummary } from "../../domain/health/profitHealth.js";
import { parseDays, effectiveCostOverrides } from "./helpers.js";

// ✅ SSOT Cost Model Engine
import { resolveCostProfile } from "../../domain/costModel/resolve.js";

export function registerOrdersSummaryRoute(app: FastifyInstance, ctx: ShopifyCtx) {
  app.get("/api/orders/summary", async (req, reply) => {
    try {
      const q = req.query as any;
      const daysNum = parseDays(q, 30);
      const adSpendNum = round2(Number(q?.adSpend ?? 0) || 0);

      // ✅ persisted overrides + request overrides (request wins) — SSOT helper
      await ctx.costModelOverridesStore.ensureLoaded();
      const persisted = ctx.costModelOverridesStore.getOverridesSync();
      const mergedOverrides = effectiveCostOverrides({ persisted, input: q });

      // ✅ Resolve cost profile per request (config + merged overrides)
      const costProfile = resolveCostProfile({
        config: (app as any).config ?? {},
        overrides: mergedOverrides,
      });

      const orders = await ctx.fetchOrders(daysNum);

      const summary = await buildOrdersSummary({
        shop: ctx.shop,
        days: daysNum,
        adSpend: adSpendNum,
        orders,
        costProfile,
        cogsService: ctx.cogsService,
        shopifyGET: ctx.shopify.get,
        isIgnoredVariant: (variantId: number) => ctx.cogsOverridesStore.isIgnoredSync(variantId),
      });

      const health = computeProfitHealthFromSummary({
        grossSales: summary.grossSales,
        refunds: summary.refunds,
        netAfterRefunds: summary.netAfterRefunds,
        cogs: summary.cogs,
        paymentFees: summary.paymentFees,
        contributionMarginPct: summary.contributionMarginPct,

        ordersCount: orders.length,

        breakEvenRoas: summary.breakEvenRoas,
        adSpend: summary.adSpend,

        shippingRevenue: summary.shippingRevenue,
        shippingCost: summary.shippingCost,

        missingCogsCount: summary.missingCogsCount,

        // ✅ FIXED COSTS signal (was missing)
        fixedCostsAllocatedInPeriod: summary.fixedCostsAllocatedInPeriod,
      });

      return reply.send({
        ...summary,
        health,
        costModel: {
          fingerprint: costProfile.meta.fingerprint,
          persistedUpdatedAt: ctx.costModelOverridesStore.getUpdatedAtSync() ?? null,
        },
      });
    } catch (err: any) {
      const status = err?.status && Number.isFinite(err.status) ? err.status : 500;
      return reply.status(status).send({ error: "Unexpected error", details: String(err?.message ?? err) });
    }
  });
}
