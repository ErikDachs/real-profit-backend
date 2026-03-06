import { FastifyInstance } from "fastify";
import type { ShopifyCtx } from "./ctx.js";
import { round2 } from "../../utils/money.js";
import { buildOrdersSummary } from "../../domain/profit.js";
import { computeProfitHealthFromSummary } from "../../domain/health/profitHealth.js";
import {
  parseDays,
  parseShop,
  effectiveCostOverrides,
} from "./helpers.js";

// ✅ SSOT Cost Model Engine
import { resolveCostProfile } from "../../domain/costModel/resolve.js";

export function registerOrdersSummaryRoute(app: FastifyInstance, ctx: ShopifyCtx) {
  app.get("/api/orders/summary", async (req, reply) => {
    try {
      const q = req.query as any;
      const daysNum = parseDays(q, 30);
      const adSpendNum = round2(Number(q?.adSpend ?? 0) || 0);

      const shop = parseShop(q, ctx.shop);
      if (!shop) {
        return reply.status(400).send({ error: "shop is required (valid *.myshopify.com)" });
      }

      const shopifyClient = shop === ctx.shop ? ctx.shopify : await ctx.createShopifyForShop(shop);

      const orders = shop === ctx.shop ? await ctx.fetchOrders(daysNum) : await ctx.fetchOrdersForShop(shop, daysNum);

      const cogsOverridesStore = shop === ctx.shop
        ? ctx.cogsOverridesStore
        : await ctx.getCogsOverridesStoreForShop(shop);

      const cogsService = shop === ctx.shop
        ? ctx.cogsService
        : await ctx.getCogsServiceForShop(shop);

      const costModelOverridesStore = shop === ctx.shop
        ? ctx.costModelOverridesStore
        : await ctx.getCostModelOverridesStoreForShop(shop);

      await costModelOverridesStore.ensureLoaded();
      const persisted = costModelOverridesStore.getOverridesSync();
      const mergedOverrides = effectiveCostOverrides({ persisted, input: q });

      const costProfile = resolveCostProfile({
        config: (app as any).config ?? {},
        overrides: mergedOverrides,
      });

      const summary = await buildOrdersSummary({
        shop,
        days: daysNum,
        adSpend: adSpendNum,
        orders,
        costProfile,
        cogsService,
        shopifyGET: shopifyClient.get,
        isIgnoredVariant: (variantId: number) => cogsOverridesStore.isIgnoredSync(variantId),
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
        fixedCostsAllocatedInPeriod: summary.fixedCostsAllocatedInPeriod,
      });

      return reply.send({
        ...summary,
        health,
        costModel: {
          fingerprint: costProfile.meta.fingerprint,
          persistedUpdatedAt: costModelOverridesStore.getUpdatedAtSync() ?? null,
        },
      });
    } catch (err: any) {
      const status = err?.status && Number.isFinite(err.status) ? err.status : 500;
      return reply.status(status).send({
        error: "Unexpected error",
        details: String(err?.message ?? err),
      });
    }
  });
}