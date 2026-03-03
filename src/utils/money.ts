// src/utils/money.ts
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function toNumber(v: unknown, fallback = 0): number {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : fallback;
}

export function toCents(n: number): number {
  return Math.round((n + Number.EPSILON) * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}