// src/utils/money.ts
export function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
}
export function toNumber(v, fallback = 0) {
    const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
    return Number.isFinite(n) ? n : fallback;
}
export function toCents(n) {
    return Math.round((n + Number.EPSILON) * 100);
}
export function fromCents(cents) {
    return cents / 100;
}
