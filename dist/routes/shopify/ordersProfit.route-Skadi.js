import { round2 } from "../../utils/money";
import { calculateOrderProfit, applyAdsToOrderProfitRow, applyFixedCostsToOrderProfitRow, allocateFixedCostsForOrders, } from "../../domain/profit";
import { allocateAdSpendForOrders } from "../../domain/profit/ads";
import { parseDays, precomputeUnitCostsForOrders, effectiveCostOverrides } from "./helpers";
// ✅ SSOT Cost Model Engine
import { resolveCostProfile } from "../../domain/costModel/resolve";
export function registerOrdersProfitRoute(app, ctx) {
    app.get("/api/orders/profit", async (req, reply) => {
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
            const unitCostByVariant = await precomputeUnitCostsForOrders({
                orders,
                cogsService: ctx.cogsService,
                shopifyGET: ctx.shopify.get,
            });
            // -------------------------
            // Base order profit rows (SSOT)
            // -------------------------
            const baseRows = [];
            for (const o of orders) {
                const p = await calculateOrderProfit({
                    order: o,
                    costProfile,
                    cogsService: ctx.cogsService,
                    shopifyGET: ctx.shopify.get,
                    unitCostByVariant,
                    isIgnoredVariant: (variantId) => ctx.cogsOverridesStore.isIgnoredSync(variantId),
                });
                baseRows.push({
                    id: o.id,
                    name: o.name ?? null,
                    createdAt: o.created_at ?? null,
                    currency: o.currency ?? null,
                    ...p,
                });
            }
            // -------------------------
            // Ads allocation (optional) -> SSOT apply
            // -------------------------
            let withAds = baseRows;
            if (adSpendNum > 0) {
                withAds = allocateAdSpendForOrders({
                    rows: withAds,
                    adSpend: adSpendNum,
                    mode: costProfile.ads.allocationMode ?? "BY_NET_SALES",
                }).map((o) => applyAdsToOrderProfitRow(o, Number(o.allocatedAdSpend ?? 0)));
            }
            else {
                withAds = withAds.map((o) => applyAdsToOrderProfitRow(o, 0));
            }
            // -------------------------
            // Fixed costs allocation (SSOT) -> SSOT apply
            // -------------------------
            const daysInMonth = Math.max(1, Number(costProfile.fixedCosts?.daysInMonth ?? 30));
            const monthlyTotal = round2(Number(costProfile.derived?.fixedCostsMonthlyTotal ?? 0));
            const fixedCostsAllocatedInPeriod = round2(monthlyTotal * (Math.max(1, Number(daysNum || 0)) / daysInMonth));
            const fixedAllocMode = (costProfile.fixedCosts?.allocationMode ?? "PER_ORDER");
            const withFixed = allocateFixedCostsForOrders({
                rows: withAds,
                fixedCostsTotal: fixedCostsAllocatedInPeriod,
                mode: fixedAllocMode === "BY_NET_SALES" ? "BY_NET_SALES" : "PER_ORDER",
            }).map((o) => applyFixedCostsToOrderProfitRow(o, Number(o.fixedCostAllocated ?? 0)));
            // sort by most negative first (operational view)
            withFixed.sort((a, b) => {
                const av = Number(a.operatingProfit ?? a.profitAfterFixedCosts ?? a.profitAfterAds ?? a.profitAfterFees ?? 0);
                const bv = Number(b.operatingProfit ?? b.profitAfterFixedCosts ?? b.profitAfterAds ?? b.profitAfterFees ?? 0);
                return av - bv;
            });
            return reply.send({
                shop: ctx.shop,
                days: daysNum,
                count: withFixed.length,
                adSpend: adSpendNum > 0 ? adSpendNum : 0,
                fixedCosts: {
                    monthlyTotal,
                    allocatedInPeriod: fixedCostsAllocatedInPeriod,
                    allocationMode: fixedAllocMode,
                    daysInMonth,
                },
                costModel: {
                    fingerprint: costProfile.meta.fingerprint,
                    persistedUpdatedAt: ctx.costModelOverridesStore.getUpdatedAtSync() ?? null,
                },
                orders: withFixed,
            });
        }
        catch (err) {
            const status = err?.status && Number.isFinite(err.status) ? err.status : 500;
            return reply.status(status).send({
                error: "Unexpected error",
                details: String(err?.message ?? err),
            });
        }
    });
}
