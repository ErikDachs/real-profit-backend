import { resolveCostProfile, costOverridesFromAny } from "../../domain/costModel/resolve.js";
function mergeOverrides(a, b) {
    if (!a && !b)
        return undefined;
    const out = {};
    if (a?.payment || b?.payment)
        out.payment = { ...(a?.payment ?? {}), ...(b?.payment ?? {}) };
    if (a?.shipping || b?.shipping)
        out.shipping = { ...(a?.shipping ?? {}), ...(b?.shipping ?? {}) };
    if (a?.ads || b?.ads)
        out.ads = { ...(a?.ads ?? {}), ...(b?.ads ?? {}) };
    if (a?.flags || b?.flags)
        out.flags = { ...(a?.flags ?? {}), ...(b?.flags ?? {}) };
    if (a?.fixedCosts || b?.fixedCosts)
        out.fixedCosts = { ...(a?.fixedCosts ?? {}), ...(b?.fixedCosts ?? {}) };
    if (!out.payment && !out.shipping && !out.ads && !out.flags && !out.fixedCosts)
        return undefined;
    return out;
}
/**
 * SECURITY:
 * Never return resolvedFrom/config/env in API responses (can contain secrets like SHOPIFY_ADMIN_TOKEN).
 * Only return resolved values + fingerprint.
 */
function sanitizeResolvedProfile(resolved) {
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
export function registerCostModelRoutes(app, ctx) {
    // GET: show persisted overrides + resolved profile from config+persisted
    app.get("/api/cost-model", async (_req, reply) => {
        try {
            await ctx.costModelOverridesStore.ensureLoaded();
            const persisted = ctx.costModelOverridesStore.getOverridesSync();
            const resolved = resolveCostProfile({
                config: app.config ?? {},
                overrides: persisted,
            });
            return reply.send({
                shop: ctx.shop,
                persistedOverrides: persisted ?? null,
                persistedUpdatedAt: ctx.costModelOverridesStore.getUpdatedAtSync() ?? null,
                resolvedProfile: sanitizeResolvedProfile(resolved),
            });
        }
        catch (err) {
            return reply.status(500).send({ error: "Unexpected error", details: String(err?.message ?? err) });
        }
    });
    // PUT: replace persisted overrides
    app.put("/api/cost-model", async (req, reply) => {
        try {
            const body = req.body ?? {};
            const overrides = costOverridesFromAny(body);
            if (!overrides) {
                return reply.status(400).send({
                    error: "No valid overrides provided",
                    hint: "Provide at least one of: feePercent, feeFixed, shippingCostPerOrder, includeShippingCost, adAllocationMode, fixedCosts",
                });
            }
            await ctx.costModelOverridesStore.setOverrides(overrides);
            const resolved = resolveCostProfile({
                config: app.config ?? {},
                overrides,
            });
            return reply.send({
                ok: true,
                shop: ctx.shop,
                persistedOverrides: overrides,
                persistedUpdatedAt: ctx.costModelOverridesStore.getUpdatedAtSync() ?? null,
                resolvedProfile: sanitizeResolvedProfile(resolved),
            });
        }
        catch (err) {
            return reply.status(500).send({ error: "Unexpected error", details: String(err?.message ?? err) });
        }
    });
    // PATCH: merge into persisted overrides (partial update)
    app.patch("/api/cost-model", async (req, reply) => {
        try {
            const body = req.body ?? {};
            const patch = costOverridesFromAny(body);
            if (!patch) {
                return reply.status(400).send({
                    error: "No valid overrides provided",
                    hint: "Provide at least one of: feePercent, feeFixed, shippingCostPerOrder, includeShippingCost, adAllocationMode, fixedCosts",
                });
            }
            await ctx.costModelOverridesStore.ensureLoaded();
            const current = ctx.costModelOverridesStore.getOverridesSync();
            const merged = mergeOverrides(current, patch) ?? {};
            await ctx.costModelOverridesStore.setOverrides(merged);
            const resolved = resolveCostProfile({
                config: app.config ?? {},
                overrides: merged,
            });
            return reply.send({
                ok: true,
                shop: ctx.shop,
                persistedOverrides: merged,
                persistedUpdatedAt: ctx.costModelOverridesStore.getUpdatedAtSync() ?? null,
                resolvedProfile: sanitizeResolvedProfile(resolved),
            });
        }
        catch (err) {
            return reply.status(500).send({ error: "Unexpected error", details: String(err?.message ?? err) });
        }
    });
    // DELETE: clear persisted overrides
    app.delete("/api/cost-model", async (_req, reply) => {
        try {
            await ctx.costModelOverridesStore.clear();
            const resolved = resolveCostProfile({
                config: app.config ?? {},
                overrides: undefined,
            });
            return reply.send({
                ok: true,
                shop: ctx.shop,
                persistedOverrides: null,
                persistedUpdatedAt: null,
                resolvedProfile: sanitizeResolvedProfile(resolved),
            });
        }
        catch (err) {
            return reply.status(500).send({ error: "Unexpected error", details: String(err?.message ?? err) });
        }
    });
}
