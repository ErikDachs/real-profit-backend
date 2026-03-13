import type { FastifyInstance } from "fastify";
import type { ShopifyCtx } from "./ctx.js";
import { resolveCostProfile, costOverridesFromAny } from "../../domain/costModel/resolve.js";
import type { CostProfileOverrides } from "../../domain/costModel/types.js";
import { requireEmbeddedAuthAndMatchShop } from "./auth.js";

function mergeOverrides(a?: CostProfileOverrides, b?: CostProfileOverrides): CostProfileOverrides | undefined {
  if (!a && !b) return undefined;

  const out: CostProfileOverrides = {};

  if (a?.payment || b?.payment) out.payment = { ...(a?.payment ?? {}), ...(b?.payment ?? {}) };
  if (a?.shipping || b?.shipping) out.shipping = { ...(a?.shipping ?? {}), ...(b?.shipping ?? {}) };
  if (a?.ads || b?.ads) out.ads = { ...(a?.ads ?? {}), ...(b?.ads ?? {}) };
  if (a?.flags || b?.flags) out.flags = { ...(a?.flags ?? {}), ...(b?.flags ?? {}) };
  if (a?.fixedCosts || b?.fixedCosts) out.fixedCosts = { ...(a?.fixedCosts ?? {}), ...(b?.fixedCosts ?? {}) };

  if (!out.payment && !out.shipping && !out.ads && !out.flags && !out.fixedCosts) return undefined;
  return out;
}

function sanitizeResolvedProfile(resolved: any) {
  return {
    payment: resolved?.payment,
    shipping: resolved?.shipping,
    ads: resolved?.ads,
    fixedCosts: {
      daysInMonth: resolved?.fixedCosts?.daysInMonth ?? null,
      allocationMode: resolved?.fixedCosts?.allocationMode ?? null,
      monthlyItems: resolved?.fixedCosts?.monthlyItems ?? [],
    },
    derived: {
      fixedCostsMonthlyTotal: resolved?.derived?.fixedCostsMonthlyTotal ?? 0,
    },
    flags: resolved?.flags,
    meta: {
      fingerprint: resolved?.meta?.fingerprint ?? null,
    },
  };
}

export function registerCostModelRoutes(app: FastifyInstance, ctx: ShopifyCtx) {
  app.get("/api/cost-model", async (req, reply) => {
    try {
      const q = req.query as any;
      const auth = await requireEmbeddedAuthAndMatchShop(app, req, reply, q?.shop);
      if (!auth) return;

      const shop = auth.shop;

      const costModelOverridesStore =
        shop === ctx.shop ? ctx.costModelOverridesStore : await ctx.getCostModelOverridesStoreForShop(shop);

      await costModelOverridesStore.ensureLoaded();
      const persisted = costModelOverridesStore.getOverridesSync();

      const resolved = resolveCostProfile({
        config: (app as any).config ?? {},
        overrides: persisted,
      });

      return reply.send({
        shop,
        persistedOverrides: persisted ?? null,
        persistedUpdatedAt: costModelOverridesStore.getUpdatedAtSync() ?? null,
        resolvedProfile: sanitizeResolvedProfile(resolved),
      });
    } catch (err: any) {
      return reply.status(500).send({ error: "Unexpected error", details: String(err?.message ?? err) });
    }
  });

  app.put("/api/cost-model", async (req, reply) => {
    try {
      const q = req.query as any;
      const auth = await requireEmbeddedAuthAndMatchShop(app, req, reply, q?.shop);
      if (!auth) return;

      const shop = auth.shop;

      const costModelOverridesStore =
        shop === ctx.shop ? ctx.costModelOverridesStore : await ctx.getCostModelOverridesStoreForShop(shop);

      const body: any = (req as any).body ?? {};
      const overrides = costOverridesFromAny(body);

      if (!overrides) {
        return reply.status(400).send({
          error: "No valid overrides provided",
          hint: "Provide at least one of: feePercent, feeFixed, shippingCostPerOrder, includeShippingCost, adAllocationMode, fixedCosts",
        });
      }

      await costModelOverridesStore.setOverrides(overrides);

      const resolved = resolveCostProfile({
        config: (app as any).config ?? {},
        overrides,
      });

      return reply.send({
        ok: true,
        shop,
        persistedOverrides: overrides,
        persistedUpdatedAt: costModelOverridesStore.getUpdatedAtSync() ?? null,
        resolvedProfile: sanitizeResolvedProfile(resolved),
      });
    } catch (err: any) {
      return reply.status(500).send({ error: "Unexpected error", details: String(err?.message ?? err) });
    }
  });

  app.patch("/api/cost-model", async (req, reply) => {
    try {
      const q = req.query as any;
      const auth = await requireEmbeddedAuthAndMatchShop(app, req, reply, q?.shop);
      if (!auth) return;

      const shop = auth.shop;

      const costModelOverridesStore =
        shop === ctx.shop ? ctx.costModelOverridesStore : await ctx.getCostModelOverridesStoreForShop(shop);

      const body: any = (req as any).body ?? {};
      const patch = costOverridesFromAny(body);

      if (!patch) {
        return reply.status(400).send({
          error: "No valid overrides provided",
          hint: "Provide at least one of: feePercent, feeFixed, shippingCostPerOrder, includeShippingCost, adAllocationMode, fixedCosts",
        });
      }

      await costModelOverridesStore.ensureLoaded();
      const current = costModelOverridesStore.getOverridesSync();

      const merged = mergeOverrides(current, patch) ?? {};
      await costModelOverridesStore.setOverrides(merged);

      const resolved = resolveCostProfile({
        config: (app as any).config ?? {},
        overrides: merged,
      });

      return reply.send({
        ok: true,
        shop,
        persistedOverrides: merged,
        persistedUpdatedAt: costModelOverridesStore.getUpdatedAtSync() ?? null,
        resolvedProfile: sanitizeResolvedProfile(resolved),
      });
    } catch (err: any) {
      return reply.status(500).send({ error: "Unexpected error", details: String(err?.message ?? err) });
    }
  });

  app.delete("/api/cost-model", async (req, reply) => {
    try {
      const q = req.query as any;
      const auth = await requireEmbeddedAuthAndMatchShop(app, req, reply, q?.shop);
      if (!auth) return;

      const shop = auth.shop;

      const costModelOverridesStore =
        shop === ctx.shop ? ctx.costModelOverridesStore : await ctx.getCostModelOverridesStoreForShop(shop);

      await costModelOverridesStore.clear();

      const resolved = resolveCostProfile({
        config: (app as any).config ?? {},
        overrides: undefined,
      });

      return reply.send({
        ok: true,
        shop,
        persistedOverrides: null,
        persistedUpdatedAt: null,
        resolvedProfile: sanitizeResolvedProfile(resolved),
      });
    } catch (err: any) {
      return reply.status(500).send({ error: "Unexpected error", details: String(err?.message ?? err) });
    }
  });
}