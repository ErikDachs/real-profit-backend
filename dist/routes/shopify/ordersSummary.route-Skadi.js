import { round2 } from "../../utils/money";
import { buildOrdersSummary } from "../../domain/profit";
import { computeProfitHealthFromSummary } from "../../domain/health/profitHealth";
import { parseDays, effectiveCostOverrides } from "./helpers";
// ✅ SSOT Cost Model Engine
import { resolveCostProfile } from "../../domain/costModel/resolve";
export function registerOrdersSummaryRoute(app, ctx) {
    app.get("/api/orders/summary", async (req, reply) => {
        try {
            const q = req.query;
            const daysNum = parseDays(q, 30);
            const adSpendNum = round2(Number(q?.adSpend ?? 0) || 0);
            // ✅ persisted overrides + request overrides (request wins) — SSOT helper
            await ctx.costModelOverridesStore.ensureLoaded();
            const persisted = ctx.costModelOverridesStore.getOverridesSync();
            const mergedOverrides = effectiveCostOverrides({ persisted, input: q });
            // ✅ Resolve cost profile per request (config + merged overrides)
            const costProfile = resolveCostProfile({
                config: app.config ?? {},
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
                isIgnoredVariant: (variantId) => ctx.cogsOverridesStore.isIgnoredSync(variantId),
            });
            // ✅ SSOT fix:
            // Health must NOT recompute missingCogsRatePct.
            // Always pass the upstream value from OrdersSummary (which already excludes gift-card-only orders).
            const health = computeProfitHealthFromSummary({
                grossSales: summary.grossSales,
                refunds: summary.refunds,
                netAfterRefunds: summary.netAfterRefunds,
                cogs: summary.cogs,
                paymentFees: summary.paymentFees,
                contributionMarginPct: summary.contributionMarginPct,
                // keep the "ordersCount" signal as before (total orders in period)
                // (this is NOT used for missingCogsRatePct anymore because we pass SSOT below)
                ordersCount: orders.length,
                breakEvenRoas: summary.breakEvenRoas,
                adSpend: summary.adSpend,
                shippingRevenue: summary.shippingRevenue,
                shippingCost: summary.shippingCost,
                missingCogsCount: summary.missingCogsCount,
                // ✅ CRITICAL: pass SSOT ratio
                missingCogsRatePct: summary.missingCogsRatePct,
                // ✅ FIXED COSTS signal
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
        }
        catch (err) {
            const status = err?.status && Number.isFinite(err.status) ? err.status : 500;
            return reply.status(status).send({ error: "Unexpected error", details: String(err?.message ?? err) });
        }
    });
}
