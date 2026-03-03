import { round2 } from "../../utils/money.js";
import { buildOrdersSummary } from "../../domain/profit.js";
import { parseDays } from "./helpers.js";
import { resolveCostProfile, costOverridesFromAny } from "../../domain/costModel/resolve.js";
import { buildProfitScenarioResult } from "../../domain/simulations/profitScenarioSimulation.js";
function mergeDeepShallow(a, b) {
    // minimal deterministic merge for our overrides shape
    const out = { ...(a ?? {}) };
    for (const k of Object.keys(b ?? {})) {
        const av = out[k];
        const bv = b[k];
        if (av && bv && typeof av === "object" && typeof bv === "object" && !Array.isArray(av) && !Array.isArray(bv)) {
            out[k] = mergeDeepShallow(av, bv);
        }
        else {
            out[k] = bv;
        }
    }
    return out;
}
function scenarioToOverrides(params) {
    const { scenario, baseCostProfile } = params;
    const feePercentBase = Number(baseCostProfile?.payment?.feePercent ?? 0);
    const feeFixedBase = Number(baseCostProfile?.payment?.feeFixed ?? 0);
    const shipCostPerOrderBase = Number(baseCostProfile?.shipping?.costPerOrder ?? 0);
    // Deterministic, limited v1: only knobs that are SSOT in costProfile
    switch (scenario) {
        case "fees_-10":
            return { payment: { feePercent: feePercentBase * 0.9, feeFixed: feeFixedBase * 0.9 } };
        case "fees_-20":
            return { payment: { feePercent: feePercentBase * 0.8, feeFixed: feeFixedBase * 0.8 } };
        case "fees_-30":
            return { payment: { feePercent: feePercentBase * 0.7, feeFixed: feeFixedBase * 0.7 } };
        case "ship_-25":
            return { shipping: { costPerOrder: shipCostPerOrderBase * 0.75 } };
        case "ship_-50":
            return { shipping: { costPerOrder: shipCostPerOrderBase * 0.5 } };
        case "ship_-75":
            return { shipping: { costPerOrder: shipCostPerOrderBase * 0.25 } };
        case "ship_off":
            return { flags: { includeShippingCost: false } };
        default:
            return null;
    }
}
export function registerProfitScenariosRoute(app, ctx) {
    app.get("/api/simulations/profit-scenarios", async (req, reply) => {
        try {
            const q = req.query;
            const daysNum = parseDays(q, 30);
            const adSpendNum = round2(Number(q?.adSpend ?? 0) || 0);
            const scenarioKey = String(q?.scenario ?? "").trim();
            if (!scenarioKey) {
                return reply.status(400).send({
                    error: "Missing scenario",
                    details: "Provide ?scenario=fees_-20 | fees_-10 | fees_-30 | ship_-25 | ship_-50 | ship_-75 | ship_off",
                });
            }
            const orders = await ctx.fetchOrders(daysNum);
            // Precompute unit costs once (baseline + simulated share same unit costs)
            const allVariantIds = [];
            for (const o of orders) {
                const lineItems = (o?.line_items ?? []);
                for (const li of lineItems) {
                    const vId = Number(li?.variant_id ?? 0);
                    if (Number.isFinite(vId) && vId > 0)
                        allVariantIds.push(vId);
                }
            }
            const unitCostByVariant = await ctx.cogsService.computeUnitCostsByVariant(ctx.shopify.get, allVariantIds);
            // Baseline profile (config + persisted overrides + optional explicit overrides in query)
            // Order: persisted -> query (query wins)
            const persistedOverrides = ctx.costModelOverridesStore.getOverridesSync();
            const queryOverrides = costOverridesFromAny(q);
            const baseOverrides = mergeDeepShallow(persistedOverrides, queryOverrides);
            const baselineProfile = resolveCostProfile({
                config: app.config ?? {},
                overrides: baseOverrides,
            });
            const scenarioOverrides = scenarioToOverrides({
                scenario: scenarioKey,
                baseCostProfile: baselineProfile,
            });
            if (!scenarioOverrides) {
                return reply.status(400).send({
                    error: "Unknown scenario",
                    details: "Valid: fees_-10 | fees_-20 | fees_-30 | ship_-25 | ship_-50 | ship_-75 | ship_off",
                });
            }
            const simulatedOverrides = mergeDeepShallow(baseOverrides, scenarioOverrides);
            const simulatedProfile = resolveCostProfile({
                config: app.config ?? {},
                overrides: simulatedOverrides,
            });
            const baseline = await buildOrdersSummary({
                shop: ctx.shop,
                days: daysNum,
                adSpend: adSpendNum,
                orders,
                costProfile: baselineProfile,
                cogsService: ctx.cogsService,
                shopifyGET: ctx.shopify.get,
                unitCostByVariant,
            });
            const simulated = await buildOrdersSummary({
                shop: ctx.shop,
                days: daysNum,
                adSpend: adSpendNum,
                orders,
                costProfile: simulatedProfile,
                cogsService: ctx.cogsService,
                shopifyGET: ctx.shopify.get,
                unitCostByVariant,
            });
            const result = buildProfitScenarioResult({ baseline, simulated });
            return reply.send({
                scenario: scenarioKey,
                ...result,
                costModel: {
                    baselineFingerprint: baselineProfile.meta.fingerprint,
                    simulatedFingerprint: simulatedProfile.meta.fingerprint,
                },
            });
        }
        catch (err) {
            const status = err?.status && Number.isFinite(err.status) ? err.status : 500;
            return reply.status(status).send({ error: "Unexpected error", details: String(err?.message ?? err) });
        }
    });
}
