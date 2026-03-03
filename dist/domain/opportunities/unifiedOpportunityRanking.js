import { round2 } from "../../utils/money.js";
import { safeDiv } from "../insights/utils.js";
import { scoreOpportunity } from "./scoring.js";
function monthlyize(lossInPeriod, days) {
    // Deterministic normalization (30-day baseline)
    const factor = safeDiv(30, Math.max(1, Number(days || 0)));
    return round2(Number(lossInPeriod || 0) * factor);
}
/**
 * Explainability helpers (NO shadow calc):
 * We only use the already-available inputs you pass into buildUnifiedOpportunityRanking.
 */
function pctFmt(x) {
    if (x === null || x === undefined)
        return null;
    const n = Number(x);
    if (!Number.isFinite(n))
        return null;
    return round2(n);
}
function numFmt(x) {
    if (x === null || x === undefined)
        return null;
    const n = Number(x);
    if (!Number.isFinite(n))
        return null;
    return round2(n);
}
function mkWhyEvidence(input) {
    const loss = round2(Number(input.lossInPeriod || 0));
    const monthly = monthlyize(loss, input.days);
    const baseEvidence = {
        lossInPeriod: loss,
        estimatedMonthlyLoss: monthly,
        currency: input.currency,
        days: input.days,
    };
    switch (input.type) {
        case "HIGH_REFUNDS": {
            const rr = pctFmt(input.refundRatePct);
            return {
                why: rr === null ? "Refunds are high in this period." : `Refunds are high (${rr}%).`,
                evidence: {
                    ...baseEvidence,
                    refundRatePct: rr,
                },
            };
        }
        case "HIGH_FEES": {
            const fr = pctFmt(input.feePctOfNet);
            return {
                why: fr === null ? "Payment fees are high in this period." : `Payment fees are high (${fr}% of net).`,
                evidence: {
                    ...baseEvidence,
                    feePctOfNet: fr,
                },
            };
        }
        case "MISSING_COGS": {
            const mc = input.missingCogsCount ?? null;
            return {
                why: mc
                    ? `Some variants are missing COGS (${mc} missing). Profit is overstated.`
                    : "Some variants are missing COGS. Profit is overstated.",
                evidence: {
                    ...baseEvidence,
                    missingCogsCount: mc,
                },
            };
        }
        case "SHIPPING_SUBSIDY": {
            const sr = pctFmt(input.subsidyRatePct);
            return {
                why: "Shipping cost is higher than shipping revenue (you subsidize shipping).",
                evidence: {
                    ...baseEvidence,
                    subsidyRatePct: sr,
                },
            };
        }
        case "LOW_MARGIN": {
            const m = pctFmt(input.marginPct);
            return {
                why: m === null ? "Margins are too thin after ad costs." : `Margins are thin after ad costs (${m}% margin).`,
                evidence: {
                    ...baseEvidence,
                    marginPct: m,
                },
            };
        }
        case "NEGATIVE_CM": {
            const cm = numFmt(input.cm);
            const cmp = pctFmt(input.cmPct);
            return {
                why: cmp !== null
                    ? `Average contribution margin is negative after ads (${cmp}%).`
                    : "Average contribution margin is negative after ads.",
                evidence: {
                    ...baseEvidence,
                    cm,
                    cmPct: cmp,
                },
            };
        }
        case "MARGIN_DRIFT": {
            const drift = numFmt(input.driftPctPoints);
            return {
                why: "Your recent margin dropped versus your longer-term baseline.",
                evidence: {
                    ...baseEvidence,
                    driftPctPoints: drift,
                    shortWindowDays: input.shortWindowDays ?? null,
                    longWindowDays: input.longWindowDays ?? null,
                    shortCmPct: pctFmt(input.shortCmPct),
                    longCmPct: pctFmt(input.longCmPct),
                },
            };
        }
        case "BREAK_EVEN_RISK": {
            const gap = numFmt(input.roasGap);
            const cur = numFmt(input.currentRoas);
            const be = numFmt(input.breakEvenRoas);
            return {
                why: gap !== null && cur !== null && be !== null
                    ? `ROAS is below break-even by ${gap} (current ${cur} vs break-even ${be}).`
                    : "ROAS is below break-even (ads lose money before fixed costs).",
                evidence: {
                    ...baseEvidence,
                    adSpend: numFmt(input.adSpend),
                    currentRoas: cur,
                    breakEvenRoas: be,
                    roasGap: gap,
                },
            };
        }
        // NEW: fixed costs
        case "HIGH_FIXED_COST_LOAD": {
            const pct = pctFmt(input.fixedCostRatePct);
            return {
                why: pct !== null ? `Fixed costs are heavy (${pct}% of net sales).` : "Fixed costs are heavy in this period.",
                evidence: {
                    ...baseEvidence,
                    fixedCostRatePct: pct,
                },
            };
        }
        case "OPERATING_LEVERAGE_RISK": {
            const pct = pctFmt(input.fixedCostRatePct);
            return {
                why: pct !== null
                    ? `Operating leverage risk: fixed costs are high (${pct}% of net), so volume swings hit profit hard.`
                    : "Operating leverage risk: fixed costs are high relative to net sales.",
                evidence: {
                    ...baseEvidence,
                    fixedCostRatePct: pct,
                },
            };
        }
        default:
            return {
                why: "This factor is causing measurable profit loss.",
                evidence: baseEvidence,
            };
    }
}
function mk(params) {
    // Build base opportunity
    const base = {
        ...params,
        estimatedMonthlyLoss: monthlyize(params.lossInPeriod, params.days),
    };
    // Score it
    const s = scoreOpportunity(base);
    // Build explainability fields (NO shadow assumptions)
    const { why, evidence } = mkWhyEvidence({
        type: base.type,
        currency: base.currency,
        days: base.days,
        lossInPeriod: params.lossInPeriod,
        refundRatePct: base.meta?.refundRatePct ?? null,
        feePctOfNet: base.meta?.feePctOfNet ?? null,
        marginPct: base.meta?.marginPct ?? null,
        cm: base.meta?.cm ?? null,
        cmPct: base.meta?.cmPct ?? null,
        missingCogsCount: base.meta?.missingCogsCount ?? null,
        subsidyRatePct: base.meta?.subsidyRatePct ?? null,
        driftPctPoints: base.meta?.driftPctPoints ?? null,
        shortWindowDays: base.meta?.shortWindowDays ?? null,
        longWindowDays: base.meta?.longWindowDays ?? null,
        shortCmPct: base.meta?.shortCmPct ?? null,
        longCmPct: base.meta?.longCmPct ?? null,
        adSpend: base.meta?.adSpend ?? null,
        currentRoas: base.meta?.currentRoas ?? null,
        breakEvenRoas: base.meta?.breakEvenRoas ?? null,
        roasGap: base.meta?.roasGap ?? null,
        fixedCostRatePct: base.meta?.fixedCostRatePct ?? null,
    });
    // IMPORTANT: keep your existing meta, but enrich with why/evidence (UI-friendly)
    const meta = {
        ...(base.meta ?? {}),
        why,
        evidence,
    };
    return {
        ...base,
        meta,
        score: s.score,
        confidence: s.confidence,
        // Optional cleanup: controllability should be 0..1
        controllability: Math.max(0, Math.min(1, Number(s.controllability ?? 0))),
        severity: s.severity,
    };
}
function nonZero(opps) {
    return opps.filter((o) => Number(o.estimatedMonthlyLoss || 0) > 0);
}
export function buildUnifiedOpportunityRanking(params) {
    const days = Math.max(1, Number(params.days || 0));
    const currency = params.currency || "USD";
    const limit = Math.max(1, Math.min(Number(params.limit ?? 5), 50));
    const out = [];
    // LOW_MARGIN (After Ads)
    if (params.profitImpact?.lowMargin) {
        out.push(mk({
            type: "LOW_MARGIN",
            title: "Low margin after ads",
            summary: "Margins are too thin after ad costs.",
            lossInPeriod: Number(params.profitImpact.lowMargin.lossInPeriod || 0),
            currency,
            days,
            meta: {
                marginPct: params.profitImpact.lowMargin.marginPct ?? null,
            },
            actions: [
                { label: "Review pricing & discounting", code: "FIX_PRICING" },
                { label: "Cut wasteful ad spend", code: "OPTIMIZE_ADS" },
            ],
        }));
    }
    // NEGATIVE_CM (After Ads)
    if (params.profitImpact?.negativeCm) {
        out.push(mk({
            type: "NEGATIVE_CM",
            title: "Negative contribution margin after ads",
            summary: "You lose money on average after ads.",
            lossInPeriod: Number(params.profitImpact.negativeCm.lossInPeriod || 0),
            currency,
            days,
            meta: {
                cm: params.profitImpact.negativeCm.cm ?? null,
                cmPct: params.profitImpact.negativeCm.cmPct ?? null,
            },
            actions: [
                { label: "Pause/limit unprofitable campaigns", code: "PAUSE_LOSERS" },
                { label: "Increase AOV / upsells", code: "INCREASE_AOV" },
            ],
        }));
    }
    // HIGH_REFUNDS
    if (params.refunds) {
        out.push(mk({
            type: "HIGH_REFUNDS",
            title: "High refunds",
            summary: "Refunds are eating into net sales.",
            lossInPeriod: Number(params.refunds.lossInPeriod || 0),
            currency,
            days,
            meta: {
                refundRatePct: params.refunds.refundRatePct ?? null,
            },
            actions: [
                { label: "Audit product quality & expectations", code: "REDUCE_REFUNDS" },
                { label: "Improve support & delivery clarity", code: "IMPROVE_SUPPORT" },
            ],
        }));
    }
    // HIGH_FEES
    if (params.fees) {
        out.push(mk({
            type: "HIGH_FEES",
            title: "High payment fees",
            summary: "Payment fees are unusually costly vs net revenue.",
            lossInPeriod: Number(params.fees.lossInPeriod || 0),
            currency,
            days,
            meta: {
                feePctOfNet: params.fees.feePctOfNet ?? null,
            },
            actions: [
                { label: "Negotiate payment provider rates", code: "NEGOTIATE_FEES" },
                { label: "Shift customers to cheaper methods", code: "PAYMENT_MIX" },
            ],
        }));
    }
    // MISSING_COGS
    const missingCount = Number(params.missingCogsCount || 0);
    const missingLoss = Number(params.missingCogsLossInPeriod || 0);
    if (missingCount > 0 && missingLoss > 0) {
        out.push(mk({
            type: "MISSING_COGS",
            title: "Missing COGS",
            summary: "Some variants have no COGS, profit is overstated.",
            lossInPeriod: missingLoss,
            currency,
            days,
            meta: { missingCogsCount: missingCount },
            actions: [
                { label: "Fill in COGS for missing variants", code: "ADD_COGS" },
                { label: "Enable COGS alerts", code: "COGS_ALERTS" },
            ],
        }));
    }
    // SHIPPING_SUBSIDY
    if (params.shippingSubsidy) {
        out.push(mk({
            type: "SHIPPING_SUBSIDY",
            title: "Shipping subsidy",
            summary: "You subsidize shipping (cost > shipping revenue).",
            lossInPeriod: Number(params.shippingSubsidy.lossInPeriod || 0),
            currency,
            days,
            meta: {
                subsidyRatePct: params.shippingSubsidy.subsidyRatePct ?? null,
            },
            actions: [
                { label: "Raise shipping fees / thresholds", code: "FIX_SHIPPING_PRICING" },
                { label: "Renegotiate carrier rates", code: "NEGOTIATE_SHIPPING" },
            ],
        }));
    }
    // MARGIN_DRIFT
    if (params.marginDrift && Number(params.marginDrift.lossInPeriod || 0) > 0) {
        out.push(mk({
            type: "MARGIN_DRIFT",
            title: "Margin drift",
            summary: "Your recent margin dropped compared to your longer-term baseline.",
            lossInPeriod: Number(params.marginDrift.lossInPeriod || 0),
            currency,
            days,
            meta: {
                driftPctPoints: params.marginDrift.driftPctPoints,
                shortWindowDays: params.marginDrift.shortWindowDays,
                longWindowDays: params.marginDrift.longWindowDays,
                shortCmPct: params.marginDrift.shortCmPct,
                longCmPct: params.marginDrift.longCmPct,
            },
            actions: [
                { label: "Find the products causing the drop", code: "DRIFT_ROOT_CAUSE" },
                { label: "Check refunds, discounts, and COGS changes", code: "AUDIT_MARGIN_DRIVERS" },
            ],
        }));
    }
    // BREAK_EVEN_RISK
    if (params.breakEvenRisk && Number(params.breakEvenRisk.lossInPeriod || 0) > 0) {
        out.push(mk({
            type: "BREAK_EVEN_RISK",
            title: "ROAS below break-even",
            summary: "Your current ROAS is below break-even, meaning ads lose money (before fixed costs).",
            lossInPeriod: Number(params.breakEvenRisk.lossInPeriod || 0),
            currency,
            days,
            meta: {
                adSpend: params.breakEvenRisk.adSpend ?? null,
                currentRoas: params.breakEvenRisk.currentRoas ?? null,
                breakEvenRoas: params.breakEvenRisk.breakEvenRoas ?? null,
                roasGap: params.breakEvenRisk.roasGap ?? null,
            },
            actions: [
                { label: "Reduce spend until ROAS is above break-even", code: "STOP_BURN" },
                { label: "Shift budget to higher-margin products", code: "SHIFT_BUDGET" },
            ],
        }));
    }
    // FIXED COSTS
    if (params.fixedCosts && Number(params.fixedCosts.lossInPeriod || 0) > 0) {
        out.push(mk({
            type: "HIGH_FIXED_COST_LOAD",
            title: "High fixed cost load",
            summary: "Fixed costs take a large share of net sales.",
            lossInPeriod: Number(params.fixedCosts.lossInPeriod || 0),
            currency,
            days,
            meta: {
                fixedCostRatePct: params.fixedCosts.fixedCostRatePct ?? null,
            },
            actions: [
                { label: "Cut non-essential overhead", code: "REDUCE_OVERHEAD" },
                { label: "Increase contribution margin / AOV", code: "RAISE_CM_OR_AOV" },
            ],
        }));
        // Optional 2nd: Operating leverage risk if fixed costs are very high vs net
        const pct = Number(params.fixedCosts.fixedCostRatePct ?? 0);
        if (Number.isFinite(pct) && pct >= 20) {
            out.push(mk({
                type: "OPERATING_LEVERAGE_RISK",
                title: "Operating leverage risk",
                summary: "High fixed costs make profit highly sensitive to volume changes.",
                lossInPeriod: Number(params.fixedCosts.lossInPeriod || 0),
                currency,
                days,
                meta: {
                    fixedCostRatePct: params.fixedCosts.fixedCostRatePct ?? null,
                },
                actions: [
                    { label: "Stabilize demand (retention / repeat)", code: "STABILIZE_DEMAND" },
                    { label: "Lower fixed baseline costs", code: "LOWER_FIXED_BASELINE" },
                ],
            }));
        }
    }
    // ✅ Ranking is now score-first (expected value), then stable deterministic tie-breakers.
    const all = nonZero(out).sort((a, b) => {
        const as = Number(a.score ?? 0);
        const bs = Number(b.score ?? 0);
        if (bs !== as)
            return bs - as;
        const al = Number(a.estimatedMonthlyLoss || 0);
        const bl = Number(b.estimatedMonthlyLoss || 0);
        if (bl !== al)
            return bl - al;
        const at = String(a.type);
        const bt = String(b.type);
        if (at !== bt)
            return at.localeCompare(bt);
        return String(a.title).localeCompare(String(b.title));
    });
    return {
        all,
        top: all.slice(0, limit),
    };
}
