import { round2 } from "../../utils/money.js";
import { calculateOrderProfit, allocateFixedCostsForOrders } from "../../domain/profit.js";
import { allocateAdSpendForOrders, computeProfitAfterAds } from "../../domain/profit/ads.js";
import { parseDays, precomputeUnitCostsForOrders, effectiveCostOverrides } from "./helpers.js";
// ✅ SSOT Cost Model Engine
import { resolveCostProfile } from "../../domain/costModel/resolve.js";
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
            const orderProfits = [];
            for (const o of orders) {
                const p = await calculateOrderProfit({
                    order: o,
                    costProfile,
                    cogsService: ctx.cogsService,
                    shopifyGET: ctx.shopify.get,
                    unitCostByVariant,
                    isIgnoredVariant: (variantId) => ctx.cogsOverridesStore.isIgnoredSync(variantId),
                });
                orderProfits.push({
                    id: o.id,
                    name: o.name ?? null,
                    createdAt: o.created_at ?? null,
                    currency: o.currency ?? null,
                    ...p,
                });
            }
            // Helper: operational vs gift-card-only
            const isOperational = (o) => !o.isGiftCardOnlyOrder;
            const operationalRows = orderProfits.filter(isOperational);
            // -------------------------
            // Ads allocation (optional)
            // -------------------------
            let enriched = orderProfits;
            if (adSpendNum > 0) {
                const adMode = costProfile.ads.allocationMode ?? "BY_NET_SALES";
                // ✅ PER_ORDER: exclude gift-card-only orders, otherwise they would get ad spend even though operational net=0
                const rowsForAds = adMode === "PER_ORDER" ? operationalRows : orderProfits;
                const adsAllocated = allocateAdSpendForOrders({
                    rows: rowsForAds,
                    adSpend: adSpendNum,
                    mode: adMode,
                }).map((o) => {
                    const allocatedAdSpend = round2(Number(o.allocatedAdSpend ?? 0));
                    const profitAfterAds = computeProfitAfterAds({
                        profitBeforeAds: Number(o.profitAfterFees ?? o.contributionMargin ?? 0),
                        allocatedAdSpend,
                    });
                    const profitAfterAdsAndShipping = computeProfitAfterAds({
                        profitBeforeAds: Number(o.profitAfterShipping ?? 0),
                        allocatedAdSpend,
                    });
                    return {
                        ...o,
                        allocatedAdSpend,
                        profitAfterAds,
                        profitAfterAdsAndShipping,
                    };
                });
                if (adMode === "PER_ORDER") {
                    // Merge back: gift-card-only rows get 0 ad spend deterministically
                    const byId = new Map(adsAllocated.map((x) => [x.id, x]));
                    enriched = orderProfits.map((o) => {
                        const hit = byId.get(o.id);
                        if (hit)
                            return hit;
                        return {
                            ...o,
                            allocatedAdSpend: 0,
                            profitAfterAds: Number(o.profitAfterFees ?? o.contributionMargin ?? 0),
                            profitAfterAdsAndShipping: Number(o.profitAfterShipping ?? 0),
                        };
                    });
                }
                else {
                    enriched = adsAllocated;
                }
            }
            else {
                enriched = orderProfits.map((o) => ({
                    ...o,
                    allocatedAdSpend: 0,
                    profitAfterAds: Number(o.profitAfterFees ?? o.contributionMargin ?? 0),
                    profitAfterAdsAndShipping: Number(o.profitAfterShipping ?? 0),
                }));
            }
            // -------------------------
            // ✅ Fixed costs allocation (SSOT)
            // -------------------------
            const daysInMonth = Math.max(1, Number(costProfile.fixedCosts?.daysInMonth ?? 30));
            const monthlyTotal = round2(Number(costProfile.derived?.fixedCostsMonthlyTotal ?? 0));
            const fixedCostsAllocatedInPeriod = round2(monthlyTotal * (Math.max(1, Number(daysNum || 0)) / daysInMonth));
            // NOTE: cost model types currently only include PER_ORDER | BY_NET_SALES.
            // We keep BY_DAYS support here as a route-level mode (deterministic, no per-order split).
            const fixedAllocMode = (costProfile.fixedCosts?.allocationMode ?? "PER_ORDER");
            if (fixedAllocMode === "BY_DAYS") {
                enriched = enriched.map((o) => {
                    const fixedCostAllocated = 0;
                    const profitAfterFixedCosts = round2(Number(o.profitAfterAdsAndShipping ?? 0) - fixedCostAllocated);
                    return {
                        ...o,
                        fixedCostAllocated,
                        profitAfterFixedCosts,
                    };
                });
            }
            else {
                // ✅ Exclude gift-card-only orders from fixed-cost allocation (operational expenses)
                const enrichedOperational = enriched.filter(isOperational);
                const enrichedGiftOnly = enriched.filter((o) => !isOperational(o));
                const allocatedOperational = allocateFixedCostsForOrders({
                    rows: enrichedOperational,
                    fixedCostsTotal: fixedCostsAllocatedInPeriod,
                    mode: fixedAllocMode === "BY_NET_SALES" ? "BY_NET_SALES" : "PER_ORDER",
                }).map((o) => {
                    const fixedCostAllocated = round2(Number(o.fixedCostAllocated ?? 0));
                    const profitAfterFixedCosts = round2(Number(o.profitAfterAdsAndShipping ?? 0) - fixedCostAllocated);
                    return {
                        ...o,
                        fixedCostAllocated,
                        profitAfterFixedCosts,
                    };
                });
                const giftOnlyPatched = enrichedGiftOnly.map((o) => ({
                    ...o,
                    fixedCostAllocated: 0,
                    profitAfterFixedCosts: round2(Number(o.profitAfterAdsAndShipping ?? 0)),
                }));
                // merge back in original order
                const byId = new Map([...allocatedOperational, ...giftOnlyPatched].map((x) => [x.id, x]));
                enriched = enriched.map((o) => byId.get(o.id) ?? o);
            }
            // sort by most negative first (operational view)
            enriched.sort((a, b) => {
                const av = Number(a.profitAfterFixedCosts ?? a.profitAfterAds ?? a.profitAfterFees ?? 0);
                const bv = Number(b.profitAfterFixedCosts ?? b.profitAfterAds ?? b.profitAfterFees ?? 0);
                return av - bv;
            });
            return reply.send({
                shop: ctx.shop,
                days: daysNum,
                count: enriched.length,
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
                orders: enriched,
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
