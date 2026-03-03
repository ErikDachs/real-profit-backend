// src/domain/opportunities/unifiedOpportunityRanking/factory.ts
import type { UnifiedOpportunity } from "../types.js";
import { round2 } from "../../../utils/money.js";
import { safeDiv } from "../../insights/utils.js";
import { scoreOpportunity } from "../scoring.js";
import { mkWhyEvidence } from "./explainability.js";

export function monthlyize(lossInPeriod: number, days: number): number {
  const factor = safeDiv(30, Math.max(1, Number(days || 0)));
  return round2(Number(lossInPeriod || 0) * factor);
}

export function mk(
  params: Omit<UnifiedOpportunity, "estimatedMonthlyLoss" | "score" | "confidence" | "controllability" | "severity"> & {
    lossInPeriod: number;
  }
): UnifiedOpportunity {
  const base: UnifiedOpportunity = {
    ...params,
    estimatedMonthlyLoss: monthlyize(params.lossInPeriod, params.days),
  };

  const s = scoreOpportunity(base);

  const { why, evidence } = mkWhyEvidence({
    type: base.type,
    currency: base.currency,
    days: base.days,
    lossInPeriod: params.lossInPeriod,

    refundRatePct: base.meta?.refundRatePct ?? null,
    feePctOfNet: base.meta?.feePctOfNet ?? null,

    marginPct: base.meta?.marginPct ?? null,
    cm: base.meta?.cm ?? null,
    cmPct: base.meta?.cmPct ?? null,

    missingCogsCount: base.meta?.missingCogsCount ?? null,

    subsidyRatePct: base.meta?.subsidyRatePct ?? null,

    driftPctPoints: base.meta?.driftPctPoints ?? null,
    shortWindowDays: base.meta?.shortWindowDays ?? null,
    longWindowDays: base.meta?.longWindowDays ?? null,
    shortCmPct: base.meta?.shortCmPct ?? null,
    longCmPct: base.meta?.longCmPct ?? null,

    adSpend: base.meta?.adSpend ?? null,
    currentRoas: base.meta?.currentRoas ?? null,
    breakEvenRoas: base.meta?.breakEvenRoas ?? null,
    roasGap: base.meta?.roasGap ?? null,

    fixedCostRatePct: (base.meta as any)?.fixedCostRatePct ?? null,
  });

  const meta = {
    ...(base.meta ?? {}),
    why,
    evidence,
  };

  return {
    ...base,
    meta,
    score: s.score,
    confidence: s.confidence,
    controllability: Math.max(0, Math.min(1, Number(s.controllability ?? 0))),
    severity: s.severity,
  };
}

export function nonZero(opps: UnifiedOpportunity[]): UnifiedOpportunity[] {
  return opps.filter((o) => Number(o.estimatedMonthlyLoss || 0) > 0);
}
