// src/domain/profitImpact.ts
import { round2 } from "../utils/money.js";
function safeDiv(a, b) {
    if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0)
        return 0;
    return a / b;
}
function clamp01(x) {
    if (!Number.isFinite(x))
        return 0;
    return Math.max(0, Math.min(1, x));
}
function enrichWithTimeScaling(lossForPeriod, days) {
    const monthly = round2(lossForPeriod * (30 / Math.max(1, days)));
    const annual = round2(monthly * 12);
    return {
        estimatedLoss: round2(lossForPeriod),
        estimatedMonthlyLoss: monthly,
        estimatedAnnualLoss: annual,
    };
}
function topIds(rows, limit = 3) {
    return rows
        .map((r) => r.id)
        .filter((id) => id !== undefined && id !== null)
        .slice(0, limit);
}
function actionsForReason(reason) {
    switch (reason) {
        case "HIGH_REFUNDS":
            return [
                "Investigate product quality, shipping time, and customer expectations",
                "Review the top refunded orders/products and identify patterns",
                "Improve product pages (photos, sizing, claims) to reduce mismatched expectations",
            ];
        case "HIGH_FEES":
            return [
                "Review your payment provider plan and fee structure",
                "Check if refunds/chargebacks are inflating fees",
                "Consider small pricing adjustments to offset high fee share",
            ];
        case "LOW_MARGIN":
            return [
                "Review pricing and unit economics (COGS, shipping/fulfillment, packaging)",
                "Focus ads on higher-margin products and pause low-margin offers",
                "Negotiate supplier costs or reduce fulfillment costs",
            ];
        case "NEGATIVE_CM":
            return [
                "Identify which products/orders are structurally unprofitable",
                "Pause ads for those products until margins are fixed",
                "Check shipping/discounting/refunds as root causes",
            ];
        case "MISSING_COGS":
            return [
                "Add COGS (unit cost) overrides for missing variants",
                "Import costs from supplier/ERP or set default costs",
                "Re-run insights after adding costs to get accurate profit",
            ];
        default:
            return [];
    }
}
function detectBasis(orders) {
    // If at least one order has a finite profitAfterAds -> treat as After-Ads capable.
    const anyAfterAds = orders.some((o) => Number.isFinite(Number(o.profitAfterAds)));
    return anyAfterAds ? "AFTER_ADS" : "BEFORE_ADS";
}
function selectedProfit(o, basis) {
    if (basis === "AFTER_ADS") {
        const p = Number(o.profitAfterAds);
        if (Number.isFinite(p))
            return p;
    }
    return Number(o.contributionMargin || 0);
}
function selectedProfitPct(o, basis) {
    const net = Number(o.netAfterRefunds || 0);
    const p = selectedProfit(o, basis);
    return net > 0 ? (p / net) * 100 : 0;
}
export function buildProfitImpact(params) {
    const { thresholds, orders, totals, days, currency } = params;
    const opportunities = [];
    const refundRatePct = safeDiv(totals.refunds, totals.grossSales) * 100;
    const feeRatePct = safeDiv(totals.paymentFees, totals.netAfterRefunds) * 100;
    // Basis selection: AFTER_ADS if available, else BEFORE_ADS
    const basis = detectBasis(orders);
    // Compute totals profit pct for LOW_MARGIN basis
    const totalSelectedProfit = basis === "AFTER_ADS" && Number.isFinite(Number(totals.profitAfterAds))
        ? Number(totals.profitAfterAds)
        : orders.reduce((s, o) => s + selectedProfit(o, basis), 0);
    const totalSelectedProfitPct = totals.netAfterRefunds > 0 ? (totalSelectedProfit / totals.netAfterRefunds) * 100 : 0;
    // Helpers for evidence (always computed from per-order values)
    const ordersByRefundPct = [...orders]
        .filter((o) => Number(o.grossSales || 0) > 0 && Number(o.refunds || 0) > 0)
        .map((o) => ({
        ...o,
        refundPct: safeDiv(Number(o.refunds || 0), Number(o.grossSales || 0)) * 100,
    }))
        .sort((a, b) => (b.refundPct ?? 0) - (a.refundPct ?? 0));
    const ordersByFeePct = [...orders]
        .filter((o) => Number(o.netAfterRefunds || 0) > 0 && Number(o.paymentFees || 0) > 0)
        .map((o) => ({
        ...o,
        feePct: safeDiv(Number(o.paymentFees || 0), Number(o.netAfterRefunds || 0)) * 100,
    }))
        .sort((a, b) => (b.feePct ?? 0) - (a.feePct ?? 0));
    const ordersByLowMargin = [...orders]
        .filter((o) => Number(o.netAfterRefunds || 0) > 0)
        .map((o) => ({
        ...o,
        cmPct: selectedProfitPct(o, basis),
    }))
        .sort((a, b) => (a.cmPct ?? 0) - (b.cmPct ?? 0));
    // ----------------------------
    // HIGH_REFUNDS (unchanged)
    // ----------------------------
    if (totals.grossSales > 0 && refundRatePct > thresholds.highRefundsPct) {
        const excessPct = refundRatePct - thresholds.highRefundsPct;
        const loss = (excessPct / 100) * totals.grossSales;
        const scaled = enrichWithTimeScaling(loss, days);
        opportunities.push({
            reason: "HIGH_REFUNDS",
            title: "Refund rate above threshold",
            ...scaled,
            currency,
            confidence: 0.9,
            why: `Refund rate is ${round2(refundRatePct)}% vs threshold ${thresholds.highRefundsPct}%.`,
            actions: actionsForReason("HIGH_REFUNDS"),
            evidence: {
                refundRatePct: round2(refundRatePct),
                thresholdPct: thresholds.highRefundsPct,
                topRefundedOrderIds: topIds(ordersByRefundPct, 3),
            },
        });
    }
    // ----------------------------
    // HIGH_FEES (unchanged)
    // ----------------------------
    if (totals.netAfterRefunds > 0 && feeRatePct > thresholds.highFeesPct) {
        const excessPct = feeRatePct - thresholds.highFeesPct;
        const loss = (excessPct / 100) * totals.netAfterRefunds;
        const scaled = enrichWithTimeScaling(loss, days);
        opportunities.push({
            reason: "HIGH_FEES",
            title: "Payment fee rate above threshold",
            ...scaled,
            currency,
            confidence: 0.85,
            why: `Fee rate is ${round2(feeRatePct)}% vs threshold ${thresholds.highFeesPct}%.`,
            actions: actionsForReason("HIGH_FEES"),
            evidence: {
                feeRatePct: round2(feeRatePct),
                thresholdPct: thresholds.highFeesPct,
                topHighFeeOrderIds: topIds(ordersByFeePct, 3),
            },
        });
    }
    // ----------------------------
    // LOW_MARGIN (✅ basis-aware)
    // ----------------------------
    if (totals.netAfterRefunds > 0 && totalSelectedProfitPct < thresholds.lowMarginPct) {
        const gapPct = thresholds.lowMarginPct - totalSelectedProfitPct;
        const loss = (gapPct / 100) * totals.netAfterRefunds;
        const scaled = enrichWithTimeScaling(loss, days);
        const label = basis === "AFTER_ADS" ? "after ads" : "before ads";
        opportunities.push({
            reason: "LOW_MARGIN",
            title: `Contribution margin below threshold (${label})`,
            ...scaled,
            currency,
            confidence: basis === "AFTER_ADS" ? 0.8 : 0.75,
            why: `CM% (${label}) is ${round2(totalSelectedProfitPct)}% vs threshold ${thresholds.lowMarginPct}%.`,
            actions: actionsForReason("LOW_MARGIN"),
            evidence: {
                contributionMarginPct: round2(totalSelectedProfitPct),
                thresholdPct: thresholds.lowMarginPct,
                topLowMarginOrderIds: topIds(ordersByLowMargin, 3),
                basis,
            },
        });
    }
    // ----------------------------
    // NEGATIVE_CM (✅ basis-aware; becomes "negative after ads" when available)
    // ----------------------------
    const negativeOrders = orders
        .filter((o) => selectedProfit(o, basis) < 0)
        .sort((a, b) => selectedProfit(a, basis) - selectedProfit(b, basis));
    const negativeLoss = negativeOrders.reduce((s, o) => {
        const p = selectedProfit(o, basis);
        return p < 0 ? s + Math.abs(p) : s;
    }, 0);
    if (negativeLoss > 0) {
        const scaled = enrichWithTimeScaling(negativeLoss, days);
        const label = basis === "AFTER_ADS" ? "after ads" : "before ads";
        opportunities.push({
            reason: "NEGATIVE_CM",
            title: `Orders with negative profit (${label})`,
            ...scaled,
            currency,
            confidence: 0.95,
            why: `Some orders are unprofitable (${label}).`,
            actions: actionsForReason("NEGATIVE_CM"),
            evidence: {
                negativeOrdersCount: negativeOrders.length,
                exampleNegativeOrderIds: topIds(negativeOrders, 3),
                basis,
            },
        });
    }
    // ----------------------------
    // MISSING_COGS (unchanged)
    // ----------------------------
    const missingOrders = orders.filter((o) => (o.reasons ?? []).includes("MISSING_COGS"));
    if (missingOrders.length > 0) {
        const netMissing = missingOrders.reduce((s, o) => s + Number(o.netAfterRefunds || 0), 0);
        const knownOrders = orders.filter((o) => Number(o.netAfterRefunds || 0) > 0 && Number(o.cogs || 0) > 0);
        const knownNet = knownOrders.reduce((s, o) => s + Number(o.netAfterRefunds || 0), 0);
        const knownCogs = knownOrders.reduce((s, o) => s + Number(o.cogs || 0), 0);
        const typicalCogsPct = knownNet > 0 ? knownCogs / knownNet : 0;
        const loss = netMissing * typicalCogsPct;
        const scaled = enrichWithTimeScaling(loss, days);
        opportunities.push({
            reason: "MISSING_COGS",
            title: "Missing COGS (profit likely overstated)",
            ...scaled,
            currency,
            confidence: clamp01(0.35 + Math.min(0.35, knownOrders.length / 200)),
            why: `Missing COGS detected in ${missingOrders.length} orders.`,
            actions: actionsForReason("MISSING_COGS"),
            evidence: {
                missingCogsOrdersCount: missingOrders.length,
                exampleMissingCogsOrderIds: topIds(missingOrders, 3),
            },
        });
    }
    opportunities.sort((a, b) => b.estimatedMonthlyLoss - a.estimatedMonthlyLoss);
    return {
        all: opportunities,
        top: opportunities.slice(0, 5),
    };
}
