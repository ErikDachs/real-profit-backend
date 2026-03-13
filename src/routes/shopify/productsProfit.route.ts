import { FastifyInstance } from "fastify";
import type { ShopifyCtx } from "./ctx.js";
import { round2 } from "../../utils/money.js";
import { buildProductsProfit } from "../../domain/profit.js";
import {
  parseDays,
  effectiveCostOverrides,
} from "./helpers.js";
import { resolveCostProfile } from "../../domain/costModel/resolve.js";
import { requireEmbeddedAuthAndMatchShop } from "./auth.js";

export function registerProductsProfitRoute(app: FastifyInstance, ctx: ShopifyCtx) {
  app.get("/api/orders/products/profit", async (req, reply) => {
    try {
      const q = req.query as any;
      const daysNum = parseDays(q, 30);
      const adSpendNum = round2(Number(q?.adSpend ?? 0) || 0);

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

      await costModelOverridesStore.ensureLoaded();
      const persisted = costModelOverridesStore.getOverridesSync();
      const mergedOverrides = effectiveCostOverrides({ persisted, input: q });

      const costProfile = resolveCostProfile({
        config: (app as any).config ?? {},
        overrides: mergedOverrides,
      });

      const result = await buildProductsProfit({
        shop,
        days: daysNum,
        orders,
        costProfile,
        cogsService,
        shopifyGET: shopifyClient.get,
        adSpend: adSpendNum > 0 ? adSpendNum : undefined,
      });

      return reply.send({
        ...result,
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