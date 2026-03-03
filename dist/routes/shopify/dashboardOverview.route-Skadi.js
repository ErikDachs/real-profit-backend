import { round2 } from "../../utils/money";
import { parseDays, precomputeUnitCostsForOrders, effectiveCostOverrides } from "./helpers";
// ✅ SSOT Cost Model Engine
import { resolveCostProfile } from "../../domain/costModel/resolve";
// Aggregation + Health
import { buildOrdersSummary } from "../../domain/profit/ordersSummary";
import { computeProfitHealthFromSummary } from "../../domain/health/profitHealth";
// ✅ Order profit engine (same as /api/orders/profit)
import { calculateOrderProfit, allocateFixedCostsForOrders } from "../../domain/profit";
import { allocateAdSpendForOrders, computeProfitAfterAds } from "../../domain/profit/ads";
// Insights / Opportunities / Actions
import { buildProfitKillersInsights } from "../../domain/insights/profitKillers";
import { buildActionPlan } from "../../domain/actions/buildActionPlan";
import { runOpportunityScenarioSimulations } from "../../domain/simulations/runScenarioPresets";
import { buildOpportunityDeepDive } from "../../domain/opportunities/deepDive";
async function readPersistedOverrides(store) {
    if (!store)
        return null;
    if (typeof store.getOverridesSync === "function") {
        return {
            overrides: store.getOverridesSync(),
            updatedAt: store.getUpdatedAtSync?.(),
        };
    }
    if (typeof store.get === "function")
        return await store.get();
    if (typeof store.read === "function")
        return await store.read();
    if (typeof store.load === "function")
        return await store.load();
    if (typeof store.current === "function")
        return await store.current();
    return null;
}
function safeCall(label, fn) {
    try {
        return { ok: true, value: fn() };
    }
    catch (e) {
        return { ok: false, error: `[${label}] ${String(e?.message ?? e)}` };
    }
}
function pickInsight(insightsArr, type) {
    if (!Array.isArray(insightsArr))
        return null;
    return insightsArr.find((x) => x?.type === type) ?? null;
}
function pickCurrency(summary, fallback) {
    const c = summary?.currency ?? summary?.meta?.currency ?? null;
    return typeof c === "string" && c.trim().length ? c : fallback;
}
export function registerDashboardOverviewRoute(app, ctx) {
    app.get("/api/dashboard/overview", async (req, reply) => {
        try {
            const q = req.query;
            const days = parseDays(q, 30);
            const adSpend = round2(Number(q?.adSpend ?? 0) || 0);
            const currentRoas = Number(q?.currentRoas ?? 0) || 0;
            // ---- Orders (raw from Shopify)
            const raw = await ctx.fetchOrders(days);
            const ordersRaw = Array.isArray(raw) ? raw : Array.isArray(raw?.orders) ? raw.orders : [];
            // ---- Cost Profile (SSOT)
            const persisted = await readPersistedOverrides(ctx.costModelOverridesStore);
            const persistedOverrides = persisted?.overrides;
            const overrides = effectiveCostOverrides({ persisted: persistedOverrides, input: q });
            const costProfile = resolveCostProfile({
                config: app.config,
                overrides,
            });
            // ---- Unit costs
            const unitCostByVariant = await precomputeUnitCostsForOrders({
                orders: ordersRaw,
                cogsService: ctx.cogsService,
                shopifyGET: ctx.shopify.get,
            });
            // ---- SSOT summary (store-level)
            const summary = await buildOrdersSummary({
                shop: ctx.shop,
                days,
                adSpend,
                orders: ordersRaw,
                costProfile,
                cogsService: ctx.cogsService,
                shopifyGET: ctx.shopify.get,
                unitCostByVariant,
                isIgnoredVariant: (variantId) => ctx.cogsOverridesStore.isIgnoredSync(variantId),
            });
            // ---- Health
            const health = computeProfitHealthFromSummary(summary);
            // ---- Build order profit rows (same logic as /api/orders/profit)
            const orderProfitsBase = [];
            for (const o of ordersRaw) {
                const p = await calculateOrderProfit({
                    order: o,
                    costProfile,
                    cogsService: ctx.cogsService,
                    shopifyGET: ctx.shopify.get,
                    unitCostByVariant,
                    isIgnoredVariant: (variantId) => ctx.cogsOverridesStore.isIgnoredSync(variantId),
                });
                orderProfitsBase.push({
                    id: o.id,
                    name: o.name ?? null,
                    createdAt: o.created_at ?? null,
                    currency: o.currency ?? null,
                    ...p,
                    // ✅ FIX 2 harden: ensure deterministic fields exist for computeOrderReasons()
                    hasMissingCogs: Boolean(p.hasMissingCogs ?? p.missingCogs ?? false),
                    missingCogsVariantIds: p.missingCogsVariantIds ?? [],
                });
            }
            // Ads allocation (optional)
            let enriched = orderProfitsBase;
            if (adSpend > 0) {
                enriched = allocateAdSpendForOrders({
                    rows: enriched,
                    adSpend,
                    mode: costProfile.ads.allocationMode ?? "BY_NET_SALES",
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
            }
            else {
                enriched = enriched.map((o) => ({
                    ...o,
                    allocatedAdSpend: 0,
                    profitAfterAds: Number(o.profitAfterFees ?? 0),
                    profitAfterAdsAndShipping: Number(o.profitAfterShipping ?? 0),
                }));
            }
            // Fixed costs allocation (SSOT)
            const daysInMonth = Math.max(1, Number(costProfile.fixedCosts?.daysInMonth ?? 30));
            const monthlyTotal = round2(Number(costProfile.derived?.fixedCostsMonthlyTotal ?? 0));
            const fixedCostsAllocatedInPeriod = round2(monthlyTotal * (Math.max(1, Number(days || 0)) / daysInMonth));
            const fixedAllocMode = (costProfile.fixedCosts?.allocationMode ?? "PER_ORDER");
            enriched = allocateFixedCostsForOrders({
                rows: enriched,
                fixedCostsTotal: fixedCostsAllocatedInPeriod,
                mode: fixedAllocMode === "BY_NET_SALES" ? "BY_NET_SALES" : "PER_ORDER",
            }).map((o) => {
                const profitAfterFixedCosts = round2(Number(o.profitAfterAdsAndShipping ?? 0) - Number(o.fixedCostAllocated ?? 0));
                return {
                    ...o,
                    fixedCostAllocated: round2(Number(o.fixedCostAllocated ?? 0)),
                    profitAfterFixedCosts,
                };
            });
            // ---- Insights (Profit Killers produces SSOT unified opportunities internally)
            const debug = { insightErrors: [] };
            let profitKillers = null;
            {
                const r = safeCall("profitKillers", () => buildProfitKillersInsights({
                    shop: ctx.shop,
                    days,
                    orders: enriched,
                    products: [], // keep iterable; wire real products later
                    missingCogsCount: Number(summary?.missingCogsCount ?? 0),
                    adSpend,
                    currentRoas,
                    shippingTotals: {
                        orders: Number(summary?.count ?? 0),
                        shippingRevenue: Number(summary?.shippingRevenue ?? 0),
                        shippingCost: Number(summary?.shippingCost ?? 0),
                        shippingImpact: Number(summary?.shippingImpact ?? 0),
                    },
                    fixedCosts: {
                        monthlyTotal,
                        allocatedInPeriod: fixedCostsAllocatedInPeriod,
                        allocationMode: fixedAllocMode,
                        daysInMonth,
                    },
                    limit: 10,
                }));
                if (r.ok)
                    profitKillers = r.value;
                else
                    debug.insightErrors.push(r.error);
            }
            // Pull optional insights from ProfitKillers output (single source)
            const shippingSubsidy = pickInsight(profitKillers?.insights, "shippingSubsidy");
            const marginDrift = pickInsight(profitKillers?.insights, "marginDrift");
            const breakEvenRisk = pickInsight(profitKillers?.insights, "breakEvenRisk");
            const insights = {
                profitKillers,
                shippingSubsidy,
                marginDrift,
                breakEvenRisk,
            };
            // ✅ Canonical opportunities (from ProfitKillers SSOT ranking)
            const opportunities = profitKillers?.opportunities ?? { top: [], all: [] };
            // ✅ Decision system (ActionPlan MUST be built from UnifiedOpportunity[] — not summary/health/insights)
            const currency = pickCurrency(summary, "USD");
            const fingerprint = costProfile?.meta?.fingerprint ?? undefined;
            const unifiedTop = Array.isArray(opportunities?.top) ? opportunities.top : [];
            const unifiedAll = Array.isArray(opportunities?.all) ? opportunities.all : [];
            // ---- Scenario sims (like /api/actions/plan)
            const scenarioPack = unifiedTop.length > 0
                ? await runOpportunityScenarioSimulations({
                    shop: ctx.shop,
                    days,
                    adSpend,
                    orders: ordersRaw,
                    baseCostProfile: costProfile,
                    config: app.config ?? {},
                    baseOverrides: overrides,
                    cogsService: ctx.cogsService,
                    shopifyGET: ctx.shopify.get,
                    unitCostByVariant,
                    opportunities: unifiedTop,
                })
                : { baselineSummary: null, simulationsByOpportunity: [] };
            const scenarioByType = new Map();
            for (const s of scenarioPack.simulationsByOpportunity ?? []) {
                scenarioByType.set(String(s.type), s);
            }
            // ---- Deep dives
            const deepDivePack = buildOpportunityDeepDive({
                shop: ctx.shop,
                days,
                currency,
                opportunities: unifiedAll,
                orders: enriched,
                products: [], // TODO wire products later
                simulationByType: scenarioByType,
                limit: Math.min(10, Number(q?.actionsLimit ?? 10) || 10),
            });
            const actions = buildActionPlan({
                shop: ctx.shop,
                days,
                currency,
                costModelFingerprint: fingerprint,
                unifiedOpportunities: unifiedAll, // ✅ use all like actionsPlan
                deepDives: deepDivePack.deepDives, // ✅
                scenarioSimulationsByOpportunityType: scenarioByType, // ✅
                limit: Number(q?.actionsLimit ?? 10) || 10,
                inputs: { adSpend, currentRoas, fixedCostsAllocatedInPeriod },
            });
            return reply.send({
                shop: ctx.shop,
                meta: {
                    currency: summary?.currency ?? null,
                    periodDays: days,
                    periodLabel: `Last ${days} days`,
                    costModelFingerprint: costProfile?.meta?.fingerprint ?? null,
                    costModelPersistedUpdatedAt: persisted?.updatedAt ?? null,
                },
                scenarioSimulations: {
                    baselineSummary: scenarioPack.baselineSummary,
                    byOpportunity: scenarioPack.simulationsByOpportunity,
                },
                totals: summary,
                health,
                insights,
                actions,
                opportunities,
                debug,
            });
        }
        catch (err) {
            console.error("[dashboardOverview] ERROR:", err);
            console.error("[dashboardOverview] STACK:", err?.stack);
            return reply.status(500).send({
                error: "Unexpected error",
                details: String(err?.message ?? err),
            });
        }
    });
}
