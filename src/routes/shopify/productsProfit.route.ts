// src/routes/shopify/productsProfit.route.ts
import { FastifyInstance } from "fastify";
import type { ShopifyCtx } from "./ctx";
import { round2 } from "../../utils/money";
import { buildProductsProfit } from "../../domain/profit";
import { parseDays } from "./helpers";

// ✅ SSOT Cost Model Engine
import { resolveCostProfile, costOverridesFromAny } from "../../domain/costModel/resolve";

export function registerProductsProfitRoute(app: FastifyInstance, ctx: ShopifyCtx) {
  app.get("/api/orders/products/profit", async (req, reply) => {
    try {
      const q = req.query as any;
      const daysNum = parseDays(q, 30);
      const adSpendNum = round2(Number(q?.adSpend ?? 0) || 0);

      // ✅ Resolve cost profile per request (config + optional overrides)
      const costProfile = resolveCostProfile({
        config: (app as any).config ?? {},
        overrides: costOverridesFromAny(q),
      });

      const orders = await ctx.fetchOrders(daysNum);

      const result = await buildProductsProfit({
        shop: ctx.shop,
        days: daysNum,
        orders,
        costProfile,
        cogsService: ctx.cogsService,
        shopifyGET: ctx.shopify.get,
        adSpend: adSpendNum > 0 ? adSpendNum : undefined,
      });

      return reply.send({
        ...result,
        costModel: {
          fingerprint: costProfile.meta.fingerprint,
        },
      });
    } catch (err: any) {
      const status = err?.status && Number.isFinite(err.status) ? err.status : 500;
      return reply.status(status).send({ error: "Unexpected error", details: String(err?.message ?? err) });
    }
  });
}