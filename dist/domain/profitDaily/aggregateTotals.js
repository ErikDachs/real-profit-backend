// src/domain/profitDaily/aggregateTotals.ts
import { round2 } from "../../utils/money.js";
import { calcBreakEvenRoas, calcContributionMarginPct } from "../metrics.js";
export function buildTotalsFromDaily(params) {
    const totals = params.daily.reduce((acc, d) => {
        acc.orders += d.orders;
        acc.grossSales += d.grossSales;
        acc.refunds += d.refunds;
        acc.netAfterRefunds += d.netAfterRefunds;
        acc.shippingRevenue += d.shippingRevenue;
        acc.shippingCost += d.shippingCost;
        acc.shippingImpact += d.shippingImpact;
        acc.cogs += d.cogs;
        acc.paymentFees += d.paymentFees;
        acc.contributionMargin += d.contributionMargin;
        acc.profitAfterFees += d.profitAfterFees;
        acc.profitAfterShipping += d.profitAfterShipping;
        acc.allocatedAdSpend += d.allocatedAdSpend;
        acc.profitAfterAds += d.profitAfterAds;
        acc.profitAfterAdsAndShipping += d.profitAfterAdsAndShipping;
        acc.fixedCostsAllocated += d.fixedCostsAllocated;
        acc.profitAfterFixedCosts += d.profitAfterFixedCosts;
        acc.missingCogsOrders += d.missingCogsOrders;
        return acc;
    }, {
        orders: 0,
        grossSales: 0,
        refunds: 0,
        netAfterRefunds: 0,
        shippingRevenue: 0,
        shippingCost: 0,
        shippingImpact: 0,
        cogs: 0,
        paymentFees: 0,
        contributionMargin: 0,
        profitAfterFees: 0,
        profitAfterShipping: 0,
        allocatedAdSpend: 0,
        profitAfterAds: 0,
        profitAfterAdsAndShipping: 0,
        fixedCostsAllocated: 0,
        profitAfterFixedCosts: 0,
        missingCogsOrders: 0,
    });
    const totalsCmPct = calcContributionMarginPct({
        netAfterRefunds: totals.netAfterRefunds,
        contributionMargin: totals.contributionMargin,
    });
    const totalsBeRoas = calcBreakEvenRoas({
        netAfterRefunds: totals.netAfterRefunds,
        contributionMargin: totals.contributionMargin,
    });
    const totalsProfitMarginAfterShippingPct = totals.netAfterRefunds > 0 ? (totals.profitAfterShipping / totals.netAfterRefunds) * 100 : 0;
    const totalsProfitMarginAfterAdsPct = totals.netAfterRefunds > 0 ? (totals.profitAfterAds / totals.netAfterRefunds) * 100 : 0;
    const totalsProfitMarginAfterAdsAndShippingPct = totals.netAfterRefunds > 0 ? (totals.profitAfterAdsAndShipping / totals.netAfterRefunds) * 100 : 0;
    const totalsProfitMarginAfterFixedCostsPct = totals.netAfterRefunds > 0 ? (totals.profitAfterFixedCosts / totals.netAfterRefunds) * 100 : 0;
    const totalsMissingCogsRatePct = totals.orders > 0 ? (totals.missingCogsOrders / totals.orders) * 100 : 0;
    return {
        orders: totals.orders,
        grossSales: round2(totals.grossSales),
        refunds: round2(totals.refunds),
        netAfterRefunds: round2(totals.netAfterRefunds),
        shippingRevenue: round2(totals.shippingRevenue),
        shippingCost: round2(totals.shippingCost),
        shippingImpact: round2(totals.shippingImpact),
        cogs: round2(totals.cogs),
        paymentFees: round2(totals.paymentFees),
        contributionMargin: round2(totals.contributionMargin),
        contributionMarginPct: round2(totalsCmPct),
        adSpendBreakEven: round2(totals.contributionMargin),
        breakEvenRoas: totalsBeRoas === null ? null : round2(totalsBeRoas),
        profitAfterShipping: round2(totals.profitAfterShipping),
        profitMarginAfterShippingPct: round2(totalsProfitMarginAfterShippingPct),
        allocatedAdSpend: round2(totals.allocatedAdSpend),
        profitAfterAds: round2(totals.profitAfterAds),
        profitMarginAfterAdsPct: round2(totalsProfitMarginAfterAdsPct),
        profitAfterAdsAndShipping: round2(totals.profitAfterAdsAndShipping),
        profitMarginAfterAdsAndShippingPct: round2(totalsProfitMarginAfterAdsAndShippingPct),
        fixedCostsAllocated: round2(totals.fixedCostsAllocated),
        profitAfterFixedCosts: round2(totals.profitAfterFixedCosts),
        profitMarginAfterFixedCostsPct: round2(totalsProfitMarginAfterFixedCostsPct),
        missingCogsOrders: totals.missingCogsOrders,
        missingCogsRatePct: round2(totalsMissingCogsRatePct),
        profitAfterFees: round2(totals.profitAfterFees),
    };
}
