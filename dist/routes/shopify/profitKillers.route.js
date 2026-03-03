import { calculateOrderProfit, buildProductsProfit } from "../../domain/profit.js";
import { buildDailyProfit } from "../../domain/profitDaily.js";
import { buildProfitKillersInsights } from "../../domain/insights.js";
import { parseDays, parseLimit, parseAdInputs, precomputeUnitCostsForOrders, effectiveCostOverrides } from "./helpers.js";
import { enrichOrdersWithAds, enrichProductsWithAds } from "../../domain/insights/adsAllocation.js";
// ✅ SSOT Cost Model Engine
import { resolveCostProfile } from "../../domain/costModel/resolve.js";
// ✅ NEW: Opportunity -> Scenario simulations (true re-run via SSOT engine)
import { runOpportunityScenarioSimulations } from "../../domain/simulations/runScenarioPresets.js";
export function registerProfitKillersRoute(app, ctx) {
    app.get("/api/insights/profit-killers", async (req, reply) => {
        try {
            const q = req.query;
            const daysNum = parseDays(q, 30);
            const limitNum = parseLimit(q, 10);
            const { adSpend, currentRoas } = parseAdInputs(q);
            // ✅ Persisted overrides + request overrides (request wins)
            await ctx.costModelOverridesStore.ensureLoaded();
            const persisted = ctx.costModelOverridesStore.getOverridesSync();
            const mergedOverrides = effectiveCostOverrides({ persisted, input: q });
            // ✅ Resolve cost profile per request (config + merged overrides)
            const costProfile = resolveCostProfile({
                config: app.config ?? {},
                overrides: mergedOverrides,
            });
            const orders = await ctx.fetchOrders(daysNum);
            // Precompute unit costs (shared across all order profits + scenario simulations)
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
                    grossSales: p.grossSales,
                    refunds: p.refunds,
                    netAfterRefunds: p.netAfterRefunds,
                    cogs: p.cogs,
                    paymentFees: p.paymentFees,
                    contributionMargin: p.contributionMargin,
                    contributionMarginPct: p.contributionMarginPct,
                    shippingRevenue: p.shippingRevenue,
                    shippingCost: p.shippingCost,
                    shippingImpact: p.shippingImpact,
                    profitAfterShipping: p.profitAfterShipping,
                    adSpendBreakEven: p.adSpendBreakEven,
                    breakEvenRoas: p.breakEvenRoas,
                });
            }
            const daily = buildDailyProfit({
                shop: ctx.shop,
                days: daysNum,
                orderProfits: orderProfits.map((x) => ({
                    createdAt: x.createdAt,
                    grossSales: x.grossSales,
                    refunds: x.refunds,
                    netAfterRefunds: x.netAfterRefunds,
                    cogs: x.cogs,
                    paymentFees: x.paymentFees,
                    profitAfterFees: x.contributionMargin,
                    contributionMargin: x.contributionMargin,
                    shippingRevenue: x.shippingRevenue,
                    shippingCost: x.shippingCost,
                    profitAfterShipping: x.profitAfterShipping,
                })),
            });
            const productResult = await buildProductsProfit({
                shop: ctx.shop,
                days: daysNum,
                orders,
                costProfile,
                cogsService: ctx.cogsService,
                shopifyGET: ctx.shopify.get,
            });
            const productsRaw = (productResult?.products ?? []);
            const missingCogsCount = Number(productResult?.highlights?.missingCogsCount ?? 0);
            const spend = Number(adSpend ?? 0);
            const ordersEnriched = enrichOrdersWithAds({
                orders: orderProfits,
                totalAdSpend: Number.isFinite(spend) ? spend : 0,
                weight: (o) => Number(o.netAfterRefunds || 0),
                baseProfit: (o) => Number(o.contributionMargin || 0),
                profitAfterShipping: (o) => Number(o.profitAfterShipping ?? 0),
            });
            const productsEnriched = enrichProductsWithAds({
                products: productsRaw,
                totalAdSpend: Number.isFinite(spend) ? spend : 0,
                weight: (p) => Number(p.netSales ?? 0),
                baseProfit: (p) => Number(p.profitAfterFees ?? 0),
            });
            const insights = buildProfitKillersInsights({
                shop: ctx.shop,
                days: daysNum,
                orders: ordersEnriched,
                products: productsEnriched,
                missingCogsCount,
                limit: limitNum,
                adSpend,
                currentRoas,
                shippingTotals: {
                    orders: daily.totals.orders,
                    shippingRevenue: daily.totals.shippingRevenue,
                    shippingCost: daily.totals.shippingCost,
                    shippingImpact: daily.totals.shippingImpact,
                },
            });
            // ✅ Scenario simulations for TOP opportunities (SSOT)
            const topOpps = insights?.opportunities?.top ?? insights?.unifiedOpportunitiesTop5 ?? [];
            const adSpendNum = Number.isFinite(spend) ? spend : 0;
            const scenarioPack = topOpps.length > 0
                ? await runOpportunityScenarioSimulations({
                    shop: ctx.shop,
                    days: daysNum,
                    adSpend: adSpendNum,
                    orders,
                    baseCostProfile: costProfile,
                    config: app.config ?? {},
                    baseOverrides: mergedOverrides, // ✅ important: merged persisted+request
                    cogsService: ctx.cogsService,
                    shopifyGET: ctx.shopify.get,
                    unitCostByVariant,
                    opportunities: topOpps,
                })
                : { baselineSummary: null, simulationsByOpportunity: [] };
            return reply.send({
                ...insights,
                scenarioSimulations: {
                    baselineSummary: scenarioPack.baselineSummary,
                    byOpportunity: scenarioPack.simulationsByOpportunity,
                },
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
