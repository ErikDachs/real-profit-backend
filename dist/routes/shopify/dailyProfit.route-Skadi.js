import { round2 } from "../../utils/money";
import { calculateOrderProfit, applyAdsToOrderProfitRow, applyFixedCostsToOrderProfitRow, allocateFixedCostsForOrders, } from "../../domain/profit";
import { buildDailyProfit } from "../../domain/profitDaily";
import { computeProfitHealthFromSummary } from "../../domain/health/profitHealth";
import { allocateAdSpendForOrders } from "../../domain/profit/ads";
import { parseDays, precomputeUnitCostsForOrders, effectiveCostOverrides } from "./helpers";
// ✅ SSOT Cost Model Engine
import { resolveCostProfile } from "../../domain/costModel/resolve";
export function registerDailyProfitRoute(app, ctx) {
    app.get("/api/orders/daily-profit", async (req, reply) => {
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
            // Base order rows (SSOT)
            // -------------------------
            const baseRows = [];
            let missingCogsCount = 0;
            for (const o of orders) {
                const p = await calculateOrderProfit({
                    order: o,
                    costProfile,
                    cogsService: ctx.cogsService,
                    shopifyGET: ctx.shopify.get,
                    unitCostByVariant,
                    isIgnoredVariant: (variantId) => ctx.cogsOverridesStore.isIgnoredSync(variantId),
                });
                // ✅ SSOT: daily missing-cogs comes from governance in calculateOrderProfit
                const hasMissingCogs = Boolean(p.hasMissingCogs);
                if (hasMissingCogs)
                    missingCogsCount += 1;
                baseRows.push({
                    id: o.id,
                    createdAt: o.created_at ?? null,
                    grossSales: p.grossSales,
                    refunds: p.refunds,
                    netAfterRefunds: p.netAfterRefunds,
                    cogs: p.cogs,
                    paymentFees: p.paymentFees,
                    profitAfterFees: p.profitAfterFees,
                    contributionMargin: p.contributionMargin,
                    shippingRevenue: p.shippingRevenue,
                    shippingCost: p.shippingCost,
                    profitAfterShipping: p.profitAfterShipping,
                    hasMissingCogs,
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
            // -------------------------
            // Daily aggregation (sum-only)
            // -------------------------
            const daily = buildDailyProfit({
                shop: ctx.shop,
                days: daysNum,
                orderProfits: withFixed,
                fixedCostsAllocatedInPeriod,
                fixedCostsAllocationMode: fixedAllocMode,
            });
            const health = computeProfitHealthFromSummary({
                grossSales: daily.totals.grossSales,
                refunds: daily.totals.refunds,
                netAfterRefunds: daily.totals.netAfterRefunds,
                cogs: daily.totals.cogs,
                paymentFees: daily.totals.paymentFees,
                contributionMarginPct: daily.totals.contributionMarginPct,
                ordersCount: orders.length,
                breakEvenRoas: daily.totals.breakEvenRoas,
                shippingRevenue: daily.totals.shippingRevenue,
                shippingCost: daily.totals.shippingCost,
                adSpend: adSpendNum > 0 ? adSpendNum : undefined,
                fixedCostsAllocatedInPeriod,
                // ✅ now deterministic & governance-aligned
                missingCogsCount,
            });
            return reply.send({
                ...daily,
                adSpend: adSpendNum > 0 ? adSpendNum : 0,
                fixedCosts: {
                    monthlyTotal,
                    allocatedInPeriod: fixedCostsAllocatedInPeriod,
                    allocationMode: fixedAllocMode,
                    daysInMonth,
                },
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
