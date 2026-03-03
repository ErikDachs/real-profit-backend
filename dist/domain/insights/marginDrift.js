// src/domain/insights/marginDrift.ts
import { round2 } from "../../utils/money.js";
import { decomposeCmDrift } from "./cmDecomposition.js";
function isDayKey(s) {
    return typeof s === "string" && s.length >= 10 && s[4] === "-" && s[7] === "-";
}
function takeLastNDays(rows, n) {
    const cleaned = rows
        .filter((r) => isDayKey(r.day) && r.day !== "unknown")
        .slice()
        .sort((a, b) => a.day.localeCompare(b.day));
    if (cleaned.length <= n)
        return cleaned;
    return cleaned.slice(cleaned.length - n);
}
function sumAgg(rows) {
    return rows.reduce((acc, r) => {
        acc.orders += Number(r.orders || 0);
        acc.grossSales += Number(r.grossSales || 0);
        acc.refunds += Number(r.refunds || 0);
        acc.net += Number(r.netAfterRefunds || 0);
        acc.cm += Number(r.contributionMargin || 0);
        acc.cogs += Number(r.cogs || 0);
        acc.fees += Number(r.paymentFees || 0);
        acc.shippingRevenue += Number(r.shippingRevenue || 0);
        acc.shippingCost += Number(r.shippingCost || 0);
        return acc;
    }, {
        orders: 0,
        grossSales: 0,
        refunds: 0,
        net: 0,
        cm: 0,
        cogs: 0,
        fees: 0,
        shippingRevenue: 0,
        shippingCost: 0,
    });
}
function cmPctFrom(net, cm) {
    if (!Number.isFinite(net) || net <= 0)
        return 0;
    return (Number(cm || 0) / net) * 100;
}
function canDecompose(a) {
    // minimum needed for useful decomposition: net, cogs, fees exist (they are aggregated anyway)
    // refunds driver needs grossSales+refunds, shipping driver needs shippingCost.
    // We treat decomposition as enabled if we have cogs+fees at least.
    return Number.isFinite(a.net) && a.net > 0 && (Number.isFinite(a.cogs) || Number.isFinite(a.fees));
}
export function detectMarginDrift(params) {
    const currency = params.currency || "USD";
    const periodDays = Math.max(1, Number(params.days || 0));
    const shortWindowDays = Math.max(1, Number(params.shortWindowDays ?? 7));
    const longWindowDays = Math.max(shortWindowDays, Number(params.longWindowDays ?? 30));
    const threshold = Number(params.thresholdPctPoints ?? 2.0);
    const minShort = Math.max(1, Number(params.minRequiredShortDays ?? 5));
    const minLong = Math.max(1, Number(params.minRequiredLongDays ?? 14));
    const shortRows = takeLastNDays(params.daily || [], shortWindowDays);
    const longRows = takeLastNDays(params.daily || [], longWindowDays);
    if (shortRows.length < minShort || longRows.length < minLong)
        return null;
    const shortAgg = sumAgg(shortRows);
    const longAgg = sumAgg(longRows);
    const shortCmPct = cmPctFrom(shortAgg.net, shortAgg.cm);
    const longCmPct = cmPctFrom(longAgg.net, longAgg.cm);
    const drift = shortCmPct - longCmPct;
    let status = "STABLE";
    if (!Number.isFinite(drift))
        status = "INSUFFICIENT_DATA";
    else if (drift <= -Math.abs(threshold))
        status = "DETERIORATING";
    else if (drift >= Math.abs(threshold))
        status = "IMPROVING";
    else
        status = "STABLE";
    const lossInPeriod = status === "DETERIORATING"
        ? Math.max(0, ((longCmPct - shortCmPct) / 100) * shortAgg.net)
        : 0;
    // ✅ NEW: decomposition (best effort)
    let decomposition = null;
    const decompositionEnabled = canDecompose(shortAgg) && canDecompose(longAgg);
    if (decompositionEnabled) {
        const shortInput = {
            orders: shortAgg.orders,
            grossSales: shortAgg.grossSales,
            refunds: shortAgg.refunds,
            netAfterRefunds: shortAgg.net,
            cogs: shortAgg.cogs,
            paymentFees: shortAgg.fees,
            shippingRevenue: shortAgg.shippingRevenue,
            shippingCost: shortAgg.shippingCost,
        };
        const longInput = {
            orders: longAgg.orders,
            grossSales: longAgg.grossSales,
            refunds: longAgg.refunds,
            netAfterRefunds: longAgg.net,
            cogs: longAgg.cogs,
            paymentFees: longAgg.fees,
            shippingRevenue: longAgg.shippingRevenue,
            shippingCost: longAgg.shippingCost,
        };
        decomposition = decomposeCmDrift({ short: shortInput, long: longInput, currency });
    }
    return {
        type: "marginDrift",
        currency,
        periodDays,
        shortWindowDays,
        longWindowDays,
        shortNetAfterRefunds: round2(shortAgg.net),
        longNetAfterRefunds: round2(longAgg.net),
        shortContributionMargin: round2(shortAgg.cm),
        longContributionMargin: round2(longAgg.cm),
        shortCmPct: round2(shortCmPct),
        longCmPct: round2(longCmPct),
        driftPctPoints: round2(drift),
        status,
        estimatedLossInPeriod: round2(lossInPeriod),
        decomposition,
        meta: {
            minRequiredShortDays: minShort,
            minRequiredLongDays: minLong,
            includedDaysShort: shortRows.length,
            includedDaysLong: longRows.length,
            thresholdPctPoints: threshold,
            decompositionEnabled,
        },
    };
}
