// src/domain/insights/profitKillers.totals.ts
import { round2 } from "../../utils/money.js";
export function computeTotals(orders) {
    return orders.reduce((acc, o) => {
        acc.orders += 1;
        acc.grossSales += Number(o.grossSales || 0);
        acc.refunds += Number(o.refunds || 0);
        acc.netAfterRefunds += Number(o.netAfterRefunds || 0);
        acc.cogs += Number(o.cogs || 0);
        acc.paymentFees += Number(o.paymentFees || 0);
        acc.contributionMargin += Number(o.contributionMargin || 0);
        return acc;
    }, {
        orders: 0,
        grossSales: 0,
        refunds: 0,
        netAfterRefunds: 0,
        cogs: 0,
        paymentFees: 0,
        contributionMargin: 0,
    });
}
export function computeContributionMarginPct(totals) {
    return totals.netAfterRefunds > 0 ? (totals.contributionMargin / totals.netAfterRefunds) * 100 : 0;
}
export function computeBreakEvenRoas(totals) {
    return totals.netAfterRefunds > 0 && totals.contributionMargin > 0 ? totals.netAfterRefunds / totals.contributionMargin : null;
}
export function buildTotalsOut(params) {
    const { currency, totals, contributionMarginPct, breakEvenRoas } = params;
    return {
        currency,
        orders: totals.orders,
        grossSales: round2(totals.grossSales),
        refunds: round2(totals.refunds),
        netAfterRefunds: round2(totals.netAfterRefunds),
        cogs: round2(totals.cogs),
        paymentFees: round2(totals.paymentFees),
        contributionMargin: round2(totals.contributionMargin),
        contributionMarginPct: round2(contributionMarginPct),
        adSpendBreakEven: round2(totals.contributionMargin),
        breakEvenRoas: breakEvenRoas === null ? null : round2(breakEvenRoas),
    };
}
