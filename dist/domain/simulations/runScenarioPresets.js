import { buildOrdersSummary } from "../profit.js";
import { resolveCostProfile } from "../costModel/resolve.js";
import { buildProfitScenarioResult } from "./profitScenarioSimulation.js";
import { getScenarioPresetsForOpportunity, mergeDeepShallow, scenarioToCostOverrides } from "./scenarioPresets.js";
export async function runOpportunityScenarioSimulations(params) {
    const { shop, days, adSpend, orders, baseCostProfile, config, baseOverrides, cogsService, shopifyGET, unitCostByVariant, opportunities, } = params;
    // Baseline summary once (SSOT)
    const baselineSummary = await buildOrdersSummary({
        shop,
        days,
        adSpend,
        orders,
        costProfile: baseCostProfile,
        cogsService,
        shopifyGET,
        unitCostByVariant,
    });
    const out = [];
    for (const opp of opportunities ?? []) {
        const presets = getScenarioPresetsForOpportunity(opp.type);
        if (presets.length === 0)
            continue;
        const scenarios = [];
        const simulatedFingerprints = {};
        for (const sc of presets) {
            const scenarioOverrides = scenarioToCostOverrides({ scenario: sc.key, baseCostProfile });
            if (!scenarioOverrides)
                continue;
            const mergedOverrides = mergeDeepShallow(baseOverrides, scenarioOverrides);
            const simulatedProfile = resolveCostProfile({
                config,
                overrides: mergedOverrides,
            });
            simulatedFingerprints[sc.key] = simulatedProfile.meta.fingerprint;
            const simulatedSummary = await buildOrdersSummary({
                shop,
                days,
                adSpend,
                orders,
                costProfile: simulatedProfile,
                cogsService,
                shopifyGET,
                unitCostByVariant,
            });
            const result = buildProfitScenarioResult({
                baseline: baselineSummary,
                simulated: simulatedSummary,
            });
            scenarios.push({
                key: sc.key,
                label: sc.label,
                result,
            });
        }
        out.push({
            type: opp.type,
            title: opp.title,
            currency: opp.currency,
            days: opp.days,
            baselineFingerprint: baseCostProfile.meta.fingerprint,
            simulatedFingerprints,
            scenarios,
        });
    }
    return {
        baselineSummary,
        simulationsByOpportunity: out,
    };
}
