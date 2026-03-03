// src/domain/insights/cmDecomposition.utils.ts
import { round2 } from "../../utils/money";
import type { CmDecompositionDriver } from "./cmDecomposition";

export function safeDiv(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return 0;
  return a / b;
}

export function marginPct(net: number, profit: number): number {
  if (!Number.isFinite(net) || net <= 0) return 0;
  return (profit / net) * 100;
}

export function roundDriver(d: CmDecompositionDriver): CmDecompositionDriver {
  return { ...d, deltaPctPoints: round2(d.deltaPctPoints), impactOnCm: round2(d.impactOnCm) };
}