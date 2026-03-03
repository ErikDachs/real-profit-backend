// src/domain/health/profitHealth.governance.ts
import type { ProfitHealthConfig } from "./healthConfig";

/**
 * ✅ Launch-ready data-quality governance:
 * Cap health score based on missing COGS rate.
 * Deterministic, easy to explain, no guessing.
 */
export function applyMissingCogsCap(params: {
  score: number;
  missingCogsRatePct: number | null;
  cfg: ProfitHealthConfig;
}): { cappedScore: number; capApplied: boolean; capValue: number | null } {
  const { score, missingCogsRatePct, cfg } = params;

  if (missingCogsRatePct === null || !Number.isFinite(missingCogsRatePct)) {
    return { cappedScore: score, capApplied: false, capValue: null };
  }

  const ok = cfg.missingCogsRatePct.ok;
  const bad = cfg.missingCogsRatePct.bad;
  const awful = cfg.missingCogsRatePct.awful;

  // within ok → no cap
  if (missingCogsRatePct <= ok) return { cappedScore: score, capApplied: false, capValue: null };

  // deterministic caps
  // ok..bad -> max 75
  // bad..awful -> max 60
  // >awful -> max 45
  let cap = 75;
  if (missingCogsRatePct > bad) cap = 60;
  if (missingCogsRatePct > awful) cap = 45;

  const cappedScore = Math.min(score, cap);

  return {
    cappedScore,
    capApplied: cappedScore !== score,
    capValue: cap,
  };
}