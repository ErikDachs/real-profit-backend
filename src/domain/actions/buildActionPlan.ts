// src/domain/actions/buildActionPlan.ts
import type { OpportunityType } from "../opportunities/types.js";
import type { OpportunityDeepDive } from "../opportunities/deepDive/types.js";

import type { ActionPlan, ActionItem, BuildActionPlanParams, ActionEffort } from "./types.js";
import { buildTemplatesForOpportunity } from "./actionLibrary.js";
import { computePriorityScore } from "./priority.js";

function pickDeepDiveByType(deepDives: OpportunityDeepDive[] | undefined, type: OpportunityType) {
  return (deepDives ?? []).find((d) => d.type === type) ?? null;
}

function pickScenarioByType(map: Map<OpportunityType, any> | undefined, type: OpportunityType) {
  return map?.get(type) ?? null;
}

function confidenceFromType(base: "LOW" | "MEDIUM" | "HIGH", dd?: OpportunityDeepDive | null) {
  // deterministic upgrade if deep dive is very concentrated
  if (!dd) return base;

  const top3 = Number(dd.concentration?.top3SharePct ?? 0);
  if (top3 >= 80) return "HIGH";

  return base;
}

function isSummaryActionCode(code: string) {
  // synthetic summary items should not be shown as "actions"
  // (you currently generate wrappers like FIX_* plus older ACTION_* wrappers)
  return code.startsWith("ACTION_") || code.startsWith("FIX_");
}

function effortRank(e?: ActionEffort | null): number {
  // Lower effort should win ties
  if (e === "LOW") return 1;
  if (e === "MEDIUM") return 2;
  if (e === "HIGH") return 3;
  return 99;
}

export function buildActionPlan(params: BuildActionPlanParams): ActionPlan {
  const limit = Math.max(1, Math.min(Number(params.limit ?? 10), 50));

  const actions: ActionItem[] = [];

  for (const opp of params.unifiedOpportunities ?? []) {
    const type = opp.type;
    const dd = pickDeepDiveByType(params.deepDives, type);
    const scenario = pickScenarioByType(params.scenarioSimulationsByOpportunityType, type);

    const templates = buildTemplatesForOpportunity(opp);

    for (const t of templates) {
      // ✅ Filter out non-actionable summary wrappers so they don't "duplicate" real actions
      if (isSummaryActionCode(String(t.code))) continue;

      // NOTE: current system uses opportunity loss as "gain potential" if fixed
      const estimatedMonthlyGain = Math.max(0, Number(opp.estimatedMonthlyLoss || 0));

      const conf = confidenceFromType(t.confidence, dd);

      const score = computePriorityScore({
        estimatedMonthlyGain,
        effort: t.effort,
        confidence: conf,
        type,
        deepDive: dd,
      });

      actions.push({
        code: t.code,
        label: t.label,

        effort: t.effort,
        confidence: conf,

        estimatedMonthlyGain,
        priorityScore: score,

        opportunityType: type,

        why: t.buildWhy({ opp }),

        checklist: (t.checklist ?? []).map((x) => ({ code: x.code, label: x.label })),

        evidence: {
          currency: opp.currency,
          days: opp.days,
          estimatedMonthlyLoss: Number(opp.estimatedMonthlyLoss || 0),
          meta: opp.meta ?? undefined,

          concentration: dd?.concentration ?? undefined,
          topDrivers: dd?.drivers ? dd.drivers.slice(0, 10) : undefined,
          worstOrders: dd?.worstOrders ? dd.worstOrders.slice(0, 10) : undefined,

          scenarios: scenario ?? undefined,
        },
      });
    }
  }

  /**
   * ✅ Stable ordering:
   * 1) estimatedMonthlyGain DESC  (biggest impact first)
   * 2) priorityScore DESC         (then your scoring as tie-breaker)
   * 3) effort ASC                 (lower effort wins ties)
   * 4) code ASC                   (fully stable)
   */
  actions.sort((a, b) => {
    const dg = Number(b.estimatedMonthlyGain || 0) - Number(a.estimatedMonthlyGain || 0);
    if (dg !== 0) return dg;

    const ds = Number(b.priorityScore || 0) - Number(a.priorityScore || 0);
    if (ds !== 0) return ds;

    const de = effortRank(a.effort) - effortRank(b.effort);
    if (de !== 0) return de;

    return String(a.code).localeCompare(String(b.code));
  });

  // Deduplicate by code (keep best ranked occurrence)
  const seen = new Set<string>();
  const deduped: ActionItem[] = [];
  for (const a of actions) {
    const c = String(a.code);
    if (seen.has(c)) continue;
    seen.add(c);
    deduped.push(a);
  }

  // ✅ Avoid flooding UI: keep max N actions per opportunityType (deterministic)
  const perTypeLimit = 2;
  const perTypeCount = new Map<string, number>();
  const limited: ActionItem[] = [];

  for (const a of deduped) {
    const k = String(a.opportunityType);
    const c = perTypeCount.get(k) ?? 0;
    if (c >= perTypeLimit) continue;
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
