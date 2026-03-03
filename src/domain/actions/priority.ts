// src/domain/actions/priority.ts
import type { ActionConfidence, ActionEffort } from "./types";
import type { OpportunityDeepDive } from "../opportunities/deepDive/types";
import type { OpportunityType } from "../opportunities/types";

// Deterministic mapping
export function effortWeight(e: ActionEffort): number {
  // Lower effort => higher score
  if (e === "LOW") return 1.0;
  if (e === "MEDIUM") return 0.75;
  return 0.5;
}

export function confidenceWeight(c: ActionConfidence): number {
  if (c === "HIGH") return 1.0;
  if (c === "MEDIUM") return 0.75;
  return 0.5;
}

export function urgencyBoost(type: OpportunityType): number {
  // deterministic "urgency" knobs
  if (type === "BREAK_EVEN_RISK") return 1.2;
  if (type === "NEGATIVE_CM") return 1.1;
  return 1.0;
}

export function deepDiveConfidenceBoost(dd?: OpportunityDeepDive | null): number {
  if (!dd) return 1.0;

  // If top drivers explain most of the impact -> higher confidence
  const top3 = Number(dd.concentration?.top3SharePct ?? 0);
  const top5 = Number(dd.concentration?.top5SharePct ?? 0);

  if (top3 >= 80) return 1.15;
  if (top5 >= 80) return 1.1;
  if (top5 >= 60) return 1.05;

  return 1.0;
}

// Score in range 0..100 (deterministic)
export function computePriorityScore(params: {
  estimatedMonthlyGain: number;
  effort: ActionEffort;
  confidence: ActionConfidence;
  type: OpportunityType;
  deepDive?: OpportunityDeepDive | null;
}): number {
  const gain = Math.max(0, Number(params.estimatedMonthlyGain || 0));

  // compress large values: log-ish curve without Math.log dependency complexity
  // 0 -> 0, 100 -> ~50, 1000 -> ~77, 10000 -> ~92
  const impactScore = (() => {
    const x = gain;
    if (x <= 0) return 0;
    const scaled = x / (x + 100); // 0..1
    return scaled * 100;
  })();

  const wEffort = effortWeight(params.effort);
  const wConf = confidenceWeight(params.confidence);
  const wUrg = urgencyBoost(params.type);
  const wDD = deepDiveConfidenceBoost(params.deepDive);

  const raw = impactScore * wEffort * wConf * wUrg * wDD;
  const clamped = Math.max(0, Math.min(100, raw));

  // stable rounding to 2 decimals is not necessary here; keep integer-like
  return Math.round(clamped * 10) / 10;
}