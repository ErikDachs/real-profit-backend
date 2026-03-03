// src/domain/opportunities/deepDive/deepDive.utils.ts
import { round2 } from "../../../utils/money.js";
import { safeDiv } from "../../insights/utils.js";
export function annualize(monthly) {
    return round2(Number(monthly || 0) * 12);
}
export function lossInPeriodFromMonthly(params) {
    const days = Math.max(1, Number(params.days || 0));
    // inverse of monthlyize() (30-day baseline)
    return round2(Number(params.estimatedMonthlyLoss || 0) * safeDiv(days, 30));
}
export function clampPct(x) {
    if (!Number.isFinite(x))
        return 0;
    return Math.max(0, Math.min(100, x));
}
export function finalizeShares(drivers, totalImpact) {
    const tot = Number(totalImpact || 0);
    const out = drivers.map((d) => ({
        ...d,
        impact: round2(Number(d.impact || 0)),
        impactSharePct: tot > 0 ? round2((Number(d.impact || 0) / tot) * 100) : 0,
    }));
    return { totalImpact: round2(tot), drivers: out };
}
export function concentration(drivers) {
    const top = [...drivers].sort((a, b) => Number(b.impact || 0) - Number(a.impact || 0));
    const total = top.reduce((s, d) => s + Number(d.impact || 0), 0);
    const sumTop = (n) => top.slice(0, n).reduce((s, d) => s + Number(d.impact || 0), 0);
    return {
        top1SharePct: total > 0 ? clampPct((sumTop(1) / total) * 100) : 0,
        top3SharePct: total > 0 ? clampPct((sumTop(3) / total) * 100) : 0,
        top5SharePct: total > 0 ? clampPct((sumTop(5) / total) * 100) : 0,
    };
}
export function findOpportunity(opps, type) {
    return (opps ?? []).find((o) => o.type === type) ?? null;
}
