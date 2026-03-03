// src/domain/insights/cmDecomposition.utils.ts
import { round2 } from "../../utils/money.js";
export function safeDiv(a, b) {
    if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0)
        return 0;
    return a / b;
}
export function marginPct(net, profit) {
    if (!Number.isFinite(net) || net <= 0)
        return 0;
    return (profit / net) * 100;
}
export function roundDriver(d) {
    return { ...d, deltaPctPoints: round2(d.deltaPctPoints), impactOnCm: round2(d.impactOnCm) };
}
