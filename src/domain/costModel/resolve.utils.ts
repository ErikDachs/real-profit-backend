// src/domain/costModel/resolve.utils.ts
import type { AdSpendAllocationMode, FixedCostsAllocationMode } from "./types";

export function clampNonNegative(n: number, fallback: number) {
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export function clampPositive(n: number, fallback: number) {
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function isAdMode(x: any): x is AdSpendAllocationMode {
  return x === "BY_NET_SALES" || x === "PER_ORDER";
}

export function isFixedAllocMode(x: any): x is FixedCostsAllocationMode {
  return x === "PER_ORDER" || x === "BY_NET_SALES" || x === "BY_DAYS";
}