import { buildTemplatesForOpportunity } from "./actionLibrary";
import { computePriorityScore } from "./priority";
import { round2 } from "../../utils/money";
function clamp01(x) {
    if (!Number.isFinite(x))
        return 0;
    return Math.max(0, Math.min(1, x));
}
function pickDeepDiveByType(deepDives, type) {
    return (deepDives ?? []).find((d) => d.type === type) ?? null;
}
function pickScenarioByType(map, type) {
    return map?.get(type) ?? null;
}
/**
 * Deep-dive concentration boost:
 * deterministic multiplier based on concentration.
 * (We apply it ONCE into confidenceScore; priority.ts should not apply DD again.)
 */
function deepDiveBoostMultiplier(dd) {
    if (!dd)
        return 1.0;
    const top3 = Number(dd.concentration?.top3SharePct ?? 0);
    const top5 = Number(dd.concentration?.top5SharePct ?? 0);
    if (top3 >= 80)
        return 1.15;
    if (top5 >= 80)
        return 1.1;
    if (top5 >= 60)
        return 1.05;
    return 1.0;
}
function labelFromScore(score) {
    const s = clamp01(score);
    if (s >= 0.8)
        return "HIGH";
    if (s >= 0.55)
        return "MEDIUM";
    return "LOW";
}
/**
 * We prefer a "realistic" default scenario key per opportunity type (deterministic),
 * instead of always picking the absolute best-case.
 */
function preferredScenarioKey(type) {
    switch (type) {
        case "HIGH_FEES":
            return "fees_-20";
        case "HIGH_REFUNDS":
            return "refunds_-20";
        case "SHIPPING_SUBSIDY":
            return "ship_-50";
        case "LOW_MARGIN":
            return "margin_fix_50";
        case "NEGATIVE_CM":
            return "neg_fix_50";
        case "MISSING_COGS":
            return "cogs_fix_100";
        default:
            return null;
    }
}
function scenarioKeyOf(s) {
    // supports both shapes:
    // A) { scenario: { key } }
    // B) { key }
    return String(s?.scenario?.key ?? s?.key ?? "");
}
function scenarioLiftMonthlyOf(s) {
    // supports both shapes:
    // A) { profitLiftMonthly }
    // B) { result: { delta: { profitLiftAfterFees / profitLiftAfterShipping } } }
    const direct = Number(s?.profitLiftMonthly ?? NaN);
    if (Number.isFinite(direct))
        return direct;
    // Your simulation result has lifts in delta.*
    const liftFees = Number(s?.result?.delta?.profitLiftAfterFees ?? NaN);
    if (Number.isFinite(liftFees))
        return liftFees;
    const liftShip = Number(s?.result?.delta?.profitLiftAfterShipping ?? NaN);
    if (Number.isFinite(liftShip))
        return liftShip;
    return 0;
}
function findScenario(sim, key) {
    const scenarios = Array.isArray(sim?.scenarios) ? sim.scenarios : null;
    if (!Array.isArray(scenarios))
        return null;
    return scenarios.find((s) => scenarioKeyOf(s) === key) ?? null;
}
function monthlyLiftFromScenario(sim, type) {
    if (!sim || typeof sim !== "object")
        return null;
    const scenarios = Array.isArray(sim?.scenarios) ? sim.scenarios : null;
    if (!Array.isArray(scenarios) || scenarios.length === 0)
        return null;
    const prefKey = preferredScenarioKey(type);
    if (prefKey) {
        const hit = findScenario(sim, prefKey);
        const lift = scenarioLiftMonthlyOf(hit);
        if (Number.isFinite(lift) && lift > 0) {
            return { lift: round2(Math.max(0, lift)), key: prefKey, mode: "PREFERRED_KEY" };
        }
    }
    let bestLift = 0;
    let bestKey = null;
    for (const s of scenarios) {
        const lift = scenarioLiftMonthlyOf(s);
        if (!Number.isFinite(lift))
            continue;
        if (lift > bestLift) {
            bestLift = lift;
            const k = scenarioKeyOf(s);
            bestKey = k ? k : null;
        }
    }
    return { lift: round2(Math.max(0, bestLift)), key: bestKey, mode: "MAX" };
}
/**
 * SSOT impact selection:
 * 1) Prefer scenario simulation profit lift (preferred deterministic scenario key if available)
 * 2) Fallback to opportunity baseline loss (explicitly documented)
 */
function deriveEstimatedMonthlyGain(params) {
    const { opp, scenarioSim } = params;
    const picked = monthlyLiftFromScenario(scenarioSim, opp.type);
    if (picked && picked.lift > 0) {
        const note = picked.mode === "PREFERRED_KEY"
            ? `Impact is taken from scenario simulation using preferred scenario '${picked.key}'.`
            : picked.key
                ? `Impact is taken from scenario simulation (max profit lift for scenario '${picked.key}').`
                : "Impact is taken from scenario simulation (max profit lift among scenarios).";
        return {
            gain: picked.lift,
            source: "SCENARIO_SIMULATION",
            chosenScenarioKey: picked.key,
            note,
        };
    }
    const fallback = round2(Math.max(0, Number(opp.estimatedMonthlyLoss || 0)));
    return {
        gain: fallback,
        source: "OPPORTUNITY_BASELINE_FALLBACK",
        chosenScenarioKey: null,
        note: "No scenario simulation available for this opportunity type; using opportunity baseline estimatedMonthlyLoss as fallback upper bound.",
    };
}
/**
 * Deterministic effort sorting helper.
 */
function effortRank(e) {
    if (e === "LOW")
        return 1;
    if (e === "MEDIUM")
        return 2;
    if (e === "HIGH")
        return 3;
    return 99;
}
export function buildActionPlan(params) {
    const limit = Math.max(1, Math.min(Number(params.limit ?? 10), 50));
    const actions = [];
    for (const opp of params.unifiedOpportunities ?? []) {
        const type = opp.type;
        const dd = pickDeepDiveByType(params.deepDives, type);
        const scenarioSim = pickScenarioByType(params.scenarioSimulationsByOpportunityType, type);
        const templates = buildTemplatesForOpportunity(opp);
        // Confidence base comes from opportunity (scoring.ts) if present; else deterministic fallback from days.
        const baseFromOpp = clamp01(Number(opp.confidence ?? 0));
        const ddBoost = deepDiveBoostMultiplier(dd);
        const confidenceScore = round2(clamp01(baseFromOpp * ddBoost));
        const confidenceLabel = labelFromScore(confidenceScore);
        const { gain, source, chosenScenarioKey, note: impactNote } = deriveEstimatedMonthlyGain({
            opp,
            scenarioSim,
        });
        for (const t of templates) {
            const estimatedMonthlyGain = gain;
            const priorityScore = computePriorityScore({
                estimatedMonthlyGain,
                effort: t.effort,
                confidenceScore,
            });
            const why = t.buildWhy({ opp });
            actions.push({
                code: t.code,
                label: t.label,
                effort: t.effort,
                confidenceScore,
                confidenceLabel,
                estimatedMonthlyGain,
                priorityScore,
                opportunityType: type,
                why,
                checklist: (t.checklist ?? []).map((x) => ({ code: x.code, label: x.label })),
                explainability: {
                    impact: {
                        source,
                        chosenScenarioKey,
                        note: impactNote,
                    },
                    confidence: {
                        baseFromOpportunity: round2(baseFromOpp),
                        deepDiveBoostApplied: round2(ddBoost),
                        final: confidenceScore,
                        note: dd
                            ? "Confidence is boosted deterministically based on deep-dive concentration."
                            : "Confidence comes from opportunity scoring (no deep dive available).",
                    },
                    effort: {
                        level: t.effort,
                        note: "Effort is a deterministic per-opportunity-type classification from the action library.",
                    },
                },
                evidence: {
                    currency: opp.currency,
                    days: opp.days,
                    estimatedMonthlyLoss: Number(opp.estimatedMonthlyLoss || 0),
                    meta: opp.meta ?? undefined,
                    concentration: dd?.concentration ?? undefined,
                    topDrivers: dd?.drivers ? dd.drivers.slice(0, 10) : undefined,
                    worstOrders: dd?.worstOrders ? dd.worstOrders.slice(0, 10) : undefined,
                    scenarios: scenarioSim ?? undefined,
                },
            });
        }
    }
    /**
     * Stable ordering:
     * 1) priorityScore DESC
     * 2) estimatedMonthlyGain DESC
     * 3) effort ASC
     * 4) code ASC
     */
    actions.sort((a, b) => {
        const ds = Number(b.priorityScore || 0) - Number(a.priorityScore || 0);
        if (ds !== 0)
            return ds;
        const dg = Number(b.estimatedMonthlyGain || 0) - Number(a.estimatedMonthlyGain || 0);
        if (dg !== 0)
            return dg;
        const de = effortRank(a.effort) - effortRank(b.effort);
        if (de !== 0)
            return de;
        return String(a.code).localeCompare(String(b.code));
    });
    // Deduplicate by (opportunityType + code)
    const seen = new Set();
    const deduped = [];
    for (const a of actions) {
        const k = `${String(a.opportunityType)}|${String(a.code)}`;
        if (seen.has(k))
            continue;
        seen.add(k);
        deduped.push(a);
    }
    // Avoid flooding: max N per opportunity type (deterministic)
    const perTypeLimit = 2;
    const perTypeCount = new Map();
    const limited = [];
    for (const a of deduped) {
        const k = String(a.opportunityType);
        const c = perTypeCount.get(k) ?? 0;
        if (c >= perTypeLimit)
            continue;
        perTypeCount.set(k, c + 1);
        limited.push(a);
    }
    return {
        shop: params.shop,
        days: params.days,
        currency: params.currency,
        costModelFingerprint: params.costModelFingerprint,
        actions: limited.slice(0, limit),
        meta: {
            generatedAtIso: new Date().toISOString(),
            inputs: params.inputs ?? undefined,
        },
    };
}
