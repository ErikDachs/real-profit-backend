// src/routes/shopify/cogsOverrides.route.ts
import { FastifyInstance } from "fastify";
import type { ShopifyCtx } from "./ctx";
import { buildProductsProfit } from "../../domain/profit";
import { parseDays, parseOverrideBody } from "./helpers";

export function registerCogsOverridesRoutes(app: FastifyInstance, ctx: ShopifyCtx) {
  app.get("/api/cogs/overrides", async (_req, reply) => {
    try {
      const overrides = await ctx.cogsOverridesStore.list();
      return reply.send({ overrides });
    } catch (err: any) {
      return reply.status(500).send({ error: "Unexpected error", details: String(err?.message ?? err) });
    }
  });

  app.put("/api/cogs/overrides", async (req, reply) => {
    try {
      const body = (req.body ?? {}) as any;
      const parsed = parseOverrideBody(body);

      if (!parsed.ok) return reply.status(parsed.status).send({ error: parsed.error });

      const rec = await ctx.cogsOverridesStore.upsert({
        variantId: parsed.variantId,
        unitCost: parsed.unitCost,
        ignoreCogs: parsed.ignoreCogs,
      });

      return reply.send({ ok: true, override: rec });
    } catch (err: any) {
      return reply.status(500).send({ error: "Unexpected error", details: String(err?.message ?? err) });
    }
  });

  app.get("/api/cogs/missing", async (req, reply) => {
    try {
      const q = req.query as any;
      const daysNum = parseDays(q, 30);

      const orders = await ctx.fetchOrders(daysNum);

      const result = await buildProductsProfit({
        shop: ctx.shop,
        days: daysNum,
        orders,
        costProfile: ctx.costProfile, // ✅ NEW
        cogsService: ctx.cogsService,
        shopifyGET: ctx.shopify.get,
      });

      const rawMissing = (result?.highlights?.missingCogs ?? []) as any[];

      const missing = rawMissing
        .filter((x) => !ctx.cogsOverridesStore.isIgnoredSync(Number(x.variantId)))
        .map((x) => ({
          ...x,
          unitCostOverride: ctx.cogsOverridesStore.getUnitCostSync(Number(x.variantId)) ?? null,
          ignoreCogs: ctx.cogsOverridesStore.isIgnoredSync(Number(x.variantId)),
        }));

      return reply.send({ days: daysNum, count: missing.length, missing });
    } catch (err: any) {
      const status = err?.status && Number.isFinite(err.status) ? err.status : 500;
      return reply.status(status).send({ error: "Unexpected error", details: String(err?.message ?? err) });
    }
  });
}