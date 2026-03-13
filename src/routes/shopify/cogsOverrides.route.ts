import { FastifyInstance } from "fastify";
import type { ShopifyCtx } from "./ctx.js";
import { buildProductsProfit } from "../../domain/profit.js";
import { parseDays, parseOverrideBody } from "./helpers.js";
import { requireEmbeddedAuthAndMatchShop } from "./auth.js";

export function registerCogsOverridesRoutes(app: FastifyInstance, ctx: ShopifyCtx) {
  app.get("/api/cogs/overrides", async (req, reply) => {
    try {
      const q = req.query as any;
      const auth = await requireEmbeddedAuthAndMatchShop(app, req, reply, q?.shop);
      if (!auth) return;

      const shop = auth.shop;

      const store = shop === ctx.shop ? ctx.cogsOverridesStore : await ctx.getCogsOverridesStoreForShop(shop);
      const overrides = await store.list();

      return reply.send({ shop, overrides });
    } catch (err: any) {
      return reply.status(500).send({ error: "Unexpected error", details: String(err?.message ?? err) });
    }
  });

  app.put("/api/cogs/overrides", async (req, reply) => {
    try {
      const q = req.query as any;
      const auth = await requireEmbeddedAuthAndMatchShop(app, req, reply, q?.shop);
      if (!auth) return;

      const shop = auth.shop;

      const body = (req.body ?? {}) as any;
      const parsed = parseOverrideBody(body);
      if (!parsed.ok) return reply.status(parsed.status).send({ error: parsed.error });

      const store = shop === ctx.shop ? ctx.cogsOverridesStore : await ctx.getCogsOverridesStoreForShop(shop);

      const rec = await store.upsert({
        variantId: parsed.variantId,
        unitCost: parsed.unitCost,
        ignoreCogs: parsed.ignoreCogs,
      });

      return reply.send({ ok: true, shop, override: rec });
    } catch (err: any) {
      return reply.status(500).send({ error: "Unexpected error", details: String(err?.message ?? err) });
    }
  });

  app.get("/api/cogs/missing", async (req, reply) => {
    try {
      const q = req.query as any;
      const auth = await requireEmbeddedAuthAndMatchShop(app, req, reply, q?.shop);
      if (!auth) return;

      const shop = auth.shop;
      const daysNum = parseDays(q, 30);

      const orders = shop === ctx.shop ? await ctx.fetchOrders(daysNum) : await ctx.fetchOrdersForShop(shop, daysNum);
      const shopifyClient = shop === ctx.shop ? ctx.shopify : await ctx.createShopifyForShop(shop);
      const cogsService = shop === ctx.shop ? ctx.cogsService : await ctx.getCogsServiceForShop(shop);
      const store = shop === ctx.shop ? ctx.cogsOverridesStore : await ctx.getCogsOverridesStoreForShop(shop);

      const result = await buildProductsProfit({
        shop,
        days: daysNum,
        orders,
        costProfile: ctx.costProfile,
        cogsService,
        shopifyGET: shopifyClient.get,
      });

      const rawMissing = (result?.highlights?.missingCogs ?? []) as any[];

      const missing = rawMissing
        .filter((x) => !store.isIgnoredSync(Number(x.variantId)))
        .map((x) => ({
          ...x,
          unitCostOverride: store.getUnitCostSync(Number(x.variantId)) ?? null,
          ignoreCogs: store.isIgnoredSync(Number(x.variantId)),
        }));

      return reply.send({ shop, days: daysNum, count: missing.length, missing });
    } catch (err: any) {
      const status = err?.status && Number.isFinite(err.status) ? err.status : 500;
      return reply.status(status).send({ error: "Unexpected error", details: String(err?.message ?? err) });
    }
  });
}