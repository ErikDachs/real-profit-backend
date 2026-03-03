// src/domain/opportunities/scoring.ts
import { round2 } from "../../utils/money";
import type { OpportunityType, UnifiedOpportunity, OpportunitySeverity } from "./types";

function clamp01(x: number) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function finiteOr0(n: any): number {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

/**
 * Deterministic controllability factor.
 * Purely "how actionable is this type typically".
 *
 * IMPORTANT:
 * - Keep in [0..1] so UI + ranking semantics are consistent.
 */
export function controllabilityForType(type: OpportunityType): number {
  switch (type) {
    case "MISSING_COGS":
      return 1.0;
    case "HIGH_FEES":
      return 0.85;
    case "HIGH_REFUNDS":
      return 0.9;
    case "SHIPPING_SUBSIDY":
      return 0.9;
    case "BREAK_EVEN_RISK":
      return 1.0;
    case "LOW_MARGIN":
      return 0.8;
    case "NEGATIVE_CM":
      return 0.85;
    case "MARGIN_DRIFT":
      return 0.75;

    // ✅ NEW
    case "HIGH_FIXED_COST_LOAD":
      return 0.8; // overhead reduzieren ist möglich, aber oft nicht instant
    case "OPERATING_LEVERAGE_RISK":
      return 0.75; // eher “systemisch” (Mix, AOV, Marge, Volumen)

    default:
      return 0.85;
  }
}

/**
 * Deterministic confidence from:
 * - period length (more days => more stable)
 * - presence of a key supporting metric
 */
export function confidenceForOpportunity(opp: UnifiedOpportunity): number {
  const days = Math.max(1, finiteOr0(opp.days));

  // 1 day -> ~0.37, 7d -> ~0.50, 30d+ -> 1.00
  const base = clamp01(0.35 + 0.65 * Math.min(1, days / 30));

  const meta = (opp.meta ?? {}) as Record<string, any>;

  let bump = 0;

  const evidenceFields = [
    "refundRatePct",
    "feePctOfNet",
    "subsidyRatePct",
    "roasGap",
    "driftPctPoints",
    "marginPct",
    "missingCogsCount",

    // ✅ NEW fixed costs evidence
    "fixedCostRatePct",
    "fixedCostsAllocatedInPeriod",
  ];

  for (const k of evidenceFields) {
    if (Number.isFinite(Number(meta[k]))) {
      bump += 0.05;
      break;
    }
  }

  if (opp.type === "MISSING_COGS" && Number(meta.missingCogsCount || 0) > 0) bump += 0.05;

  return round2(clamp01(base + bump));
}

/**
 * Severity is a UI/ops label.
 * Deterministic thresholds on monthly loss (currency-agnostic).
 */
export function severityForMonthlyLoss(monthlyLoss: number): OpportunitySeverity {
  const m = finiteOr0(monthlyLoss);
  if (m >= 5000) return "CRITICAL";
  if (m >= 1000) return "HIGH";
  if (m >= 200) return "MEDIUM";
  return "LOW";
}

/**
 * The single opportunity score used for ranking.
 * SSOT: score is derived ONLY from existing outputs (monthlyLoss + meta signals).
 */
export function scoreOpportunity(opp: UnifiedOpportunity): {
  score: number;
  confidence: number;
  controllability: number;
  severity: OpportunitySeverity;
} {
  const monthlyLoss = Math.max(0, finiteOr0(opp.estimatedMonthlyLoss));

  const confidence = confidenceForOpportunity(opp);
  const controllability = round2(clamp01(controllabilityForType(opp.type)));
  const severity = severityForMonthlyLoss(monthlyLoss);

  // Score is "expected value": loss × confidence × controllability
  const raw = monthlyLoss * confidence * controllability;
  const score = round2(Number.isFinite(raw) ? raw : 0);

  return { score, confidence, controllability, severity };
}