// src/domain/health/profitHealth.scoring.ts
import type { ProfitHealthConfig, } from "./healthConfig";
import type { HealthStatus } from "./types";

export type ProfitHealthGrade = "A" | "B" | "C" | "D" | "F";

export function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function pctOrNaN(numer: number, denom: number): number {
  if (!Number.isFinite(numer) || !Number.isFinite(denom) || denom <= 0) return Number.NaN;
  return (numer / denom) * 100;
}

export function scoreHigherIsBetter(value: number, t: { low: number; ok: number; good: number; great: number }): number {
  if (!Number.isFinite(value)) return 0;

  if (value <= t.low) return 0;

  if (value <= t.ok) {
    const k = (value - t.low) / (t.ok - t.low);
    return 60 * clamp(k, 0, 1);
  }

  if (value <= t.good) {
    const k = (value - t.ok) / (t.good - t.ok);
    return 60 + 25 * clamp(k, 0, 1);
  }

  if (value <= t.great) {
    const k = (value - t.good) / (t.great - t.good);
    return 85 + 15 * clamp(k, 0, 1);
  }

  return 100;
}

export function scoreLowerIsBetter(value: number, t: { low: number; ok: number; bad: number; awful: number }): number {
  if (!Number.isFinite(value)) return 0;

  if (value <= t.low) return 100;

  if (value <= t.ok) {
    const k = (value - t.low) / (t.ok - t.low);
    return 100 - 20 * clamp(k, 0, 1);
  }

  if (value <= t.bad) {
    const k = (value - t.ok) / (t.bad - t.ok);
    return 80 - 40 * clamp(k, 0, 1);
  }

  if (value <= t.awful) {
    const k = (value - t.bad) / (t.awful - t.bad);
    return 40 - 40 * clamp(k, 0, 1);
  }

  return 0;
}

export function gradeFromScore(score: number): ProfitHealthGrade {
  if (score >= 85) return "A";
  if (score >= 70) return "B";
  if (score >= 55) return "C";
  if (score >= 40) return "D";
  return "F";
}

export function statusFromScore(score: number, cfg: ProfitHealthConfig): HealthStatus {
  if (score >= cfg.status.healthyMin) return "HEALTHY";
  if (score >= cfg.status.unstableMin) return "UNSTABLE";
  return "CRITICAL";
}