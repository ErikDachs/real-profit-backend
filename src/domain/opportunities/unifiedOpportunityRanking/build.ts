// src/domain/opportunities/unifiedOpportunityRanking/build.ts
import type { UnifiedOpportunity } from "../types.js";
import { nonZero } from "./factory.js";
import {
  addProfitImpactSignals,
  addRefundSignals,
  addFeeSignals,
  addMissingCogsSignals,
  addShippingSignals,
  addMarginDriftSignals,
  addBreakEvenRiskSignals,
  addFixedCostSignals,
} from "./signals.js";

export type UnifiedOpportunityRankingParams = {
  days: number;
  currency: string;

  profitImpact?: {
    lowMargin?: { lossInPeriod: number; marginPct?: number | null };
    negativeCm?: { lossInPeriod: number; cm?: number | null; cmPct?: number | null };
  };

  refunds?: { lossInPeriod: number; refundRatePct?: number | null };
  fees?: { lossInPeriod: number; feePctOfNet?: number | null };

  missingCogsCount?: number;
  missingCogsLossInPeriod?: number;

  shippingSubsidy?: { lossInPeriod: number; subsidyRatePct?: number | null };

  marginDrift?: {
    lossInPeriod: number;
    driftPctPoints: number;
    shortWindowDays: number;
    longWindowDays: number;
    shortCmPct: number;
    longCmPct: number;
  };

  breakEvenRisk?: {
    lossInPeriod: number;
    adSpend?: number | null;
    currentRoas?: number | null;
    breakEvenRoas?: number | null;
    roasGap?: number | null;
  };

  fixedCosts?: { lossInPeriod: number; fixedCostRatePct?: number | null };

  limit?: number;
};

export function buildUnifiedOpportunityRanking(params: UnifiedOpportunityRankingParams): {
  top: UnifiedOpportunity[];
  all: UnifiedOpportunity[];
} {
  const days = Math.max(1, Number(params.days || 0));
  const currency = params.currency || "USD";
  const limit = Math.max(1, Math.min(Number(params.limit ?? 5), 50));

  const out: UnifiedOpportunity[] = [];

  const base = { days, currency };

  addProfitImpactSignals(out, params, base);
  addRefundSignals(out, params, base);
  addFeeSignals(out, params, base);
  addMissingCogsSignals(out, params, base);
  addShippingSignals(out, params, base);
  addMarginDriftSignals(out, params, base);
  addBreakEvenRiskSignals(out, params, base);
  addFixedCostSignals(out, params, base);

  const all = nonZero(out).sort((a, b) => {
    const as = Number(a.score ?? 0);
    const bs = Number(b.score ?? 0);
    if (bs !== as) return bs - as;

    const al = Number(a.estimatedMonthlyLoss || 0);
    const bl = Number(b.estimatedMonthlyLoss || 0);
    if (bl !== al) return bl - al;

    const at = String(a.type);
    const bt = String(b.type);
    if (at !== bt) return at.localeCompare(bt);

    return String(a.title).localeCompare(String(b.title));
  });

  return { all, top: all.slice(0, limit) };
}
