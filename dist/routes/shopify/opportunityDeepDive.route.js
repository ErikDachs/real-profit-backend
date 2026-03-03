import { calculateOrderProfit, buildProductsProfit } from "../../domain/profit.js";
import { buildDailyProfit } from "../../domain/profitDaily.js";
import { parseDays, parseLimit, parseAdInputs, precomputeUnitCostsForOrders, effectiveCostOverrides } from "./helpers.js";
import { buildShippingSubsidyInsight } from "../../domain/insights/shippingSubsidy.js";
import { buildUnifiedOpportunityRanking } from "../../domain/opportunities/unifiedOpportunityRanking.js";
import { buildImpactSimulation } from "../../domain/simulations/impactSimulation.js";
import { enrichOrdersWithAds, enrichProductsWithAds } from "../../domain/insights/adsAllocation.js";
import { buildOpportunityDeepDive } from "../../domain/opportunities/deepDive.js";
// ✅ SSOT Cost Model Engine
import { resolveCostProfile } from "../../domain/costModel/resolve.js";
export function registerOpportunityDeepDiveRoute(app, ctx) {
    app.get("/api/opportunities/deep-dive", async (req, reply) => {
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
            const type = (q?.type ? String(q.type) : undefined);
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
            const currency = ordersEnriched[0]?.currency ?? "USD";
            const shippingSubsidy = buildShippingSubsidyInsight({
                currency,
                days: daysNum,
                shippingTotals: {
                    orders: daily.totals.orders,
                    shippingRevenue: daily.totals.shippingRevenue,
                    shippingCost: daily.totals.shippingCost,
                    shippingImpact: daily.totals.shippingImpact,
                },
            });
            const unified = buildUnifiedOpportunityRanking({
                days: daysNum,
                currency,
                refunds: {
                    lossInPeriod: ordersEnriched.reduce((s, o) => s + Number(o.refunds || 0), 0),
                    refundRatePct: (() => {
                        const gross = ordersEnriched.reduce((s, o) => s + Number(o.grossSales || 0), 0);
                        const refunds = ordersEnriched.reduce((s, o) => s + Number(o.refunds || 0), 0);
                        return gross > 0 ? (refunds / gross) * 100 : 0;
                    })(),
                },
                fees: {
                    lossInPeriod: ordersEnriched.reduce((s, o) => s + Number(o.paymentFees || 0), 0),
                    feePctOfNet: (() => {
                        const net = ordersEnriched.reduce((s, o) => s + Number(o.netAfterRefunds || 0), 0);
                        const fees = ordersEnriched.reduce((s, o) => s + Number(o.paymentFees || 0), 0);
                        return net > 0 ? (fees / net) * 100 : 0;
                    })(),
                },
                missingCogsCount,
                missingCogsLossInPeriod: 0,
                shippingSubsidy: shippingSubsidy
                    ? {
                        lossInPeriod: Number(shippingSubsidy.lossInPeriod || shippingSubsidy.estimatedLossInPeriod || 0),
                        subsidyRatePct: shippingSubsidy.subsidyRatePct ?? null,
                    }
                    : undefined,
                limit: 5,
            });
            const sim = buildImpactSimulation({
                opportunities: unified.all,
                limit: Math.min(5, unified.all.length),
            });
            const simulationByType = new Map();
            for (const s of sim.top ?? [])
                simulationByType.set(s.type, s);
            const deepDive = buildOpportunityDeepDive({
                shop: ctx.shop,
                days: daysNum,
                currency,
                opportunities: unified.all,
                orders: ordersEnriched,
                products: productsEnriched,
                simulationByType,
                type,
                limit: limitNum,
            });
            return reply.send({
                ...deepDive,
                meta: {
                    adSpend: Number.isFinite(spend) ? spend : 0,
                    currentRoas: currentRoas ?? null,
                    costModel: {
                        fingerprint: costProfile.meta.fingerprint,
                        persistedUpdatedAt: ctx.costModelOverridesStore.getUpdatedAtSync() ?? null,
                    },
                },
            });
        }
        catch (err) {
            const status = err?.status && Number.isFinite(err.status) ? err.status : 500;
            return reply.status(status).send({ error: "Unexpected error", details: String(err?.message ?? err) });
        }
    });
}
