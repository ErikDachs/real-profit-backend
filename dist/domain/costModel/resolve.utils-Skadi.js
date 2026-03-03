export function clampNonNegative(n, fallback) {
    return Number.isFinite(n) && n >= 0 ? n : fallback;
}
export function clampPositive(n, fallback) {
    return Number.isFinite(n) && n > 0 ? n : fallback;
}
export function isAdMode(x) {
    return x === "BY_NET_SALES" || x === "PER_ORDER";
}
export function isFixedAllocMode(x) {
    return x === "PER_ORDER" || x === "BY_NET_SALES";
}
