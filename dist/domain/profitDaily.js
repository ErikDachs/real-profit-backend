// src/domain/profitDaily.ts
import { round2 } from "../utils/money.js";
import { calcBreakEvenRoas, calcContributionMarginPct } from "./metrics.js";
import { allocateFixedCostsForOrders } from "./profit/fixedCosts.js";
export function buildDailyProfit(params) {
    const { shop, days } = params;
    function toDayKey(createdAt) {
        if (!createdAt)
            return "unknown";
        return String(createdAt).slice(0, 10);
    }
    /**
     * ✅ SSOT: ensure fixedCostAllocated exists for all rows when possible.
     * We only do this if upstream did NOT already provide per-order fixed costs for ALL rows.
     */
    function ensureFixedCosts(rows) {
        const total = Number(params.fixedCostsAllocatedInPeriod ?? 0);
        const modeRaw = params.fixedCostsAllocationMode ?? "PER_ORDER";
        // ✅ IMPORTANT: consider upstream "complete" only if ALL rows have fixedCostAllocated.
        const hasAllFixed = rows.length > 0 && rows.every((r) => r.fixedCostAllocated !== undefined);
        const canAllocate = Number.isFinite(total) && total > 0;
        // If upstream already allocated for all rows, just normalize + compute profitAfterFixedCosts if missing.
        // If BY_DAYS: we keep deterministic and do not invent calendar rows here.
        if (hasAllFixed || !canAllocate || modeRaw === "BY_DAYS") {
            return rows.map((r) => {
                const fc = round2(Number(r.fixedCostAllocated ?? 0));
                const pBase = Number(r.profitAfterAdsAndShipping ?? 0);
                const pAfterFixed = r.profitAfterFixedCosts !== undefined ? Number(r.profitAfterFixedCosts ?? 0) : pBase - fc;
                return {
                    ...r,
                    fixedCostAllocated: fc,
                    profitAfterFixedCosts: round2(pAfterFixed),
                };
            });
        }
        // Otherwise allocate deterministically via SSOT allocator
        const mode = modeRaw === "BY_NET_SALES" ? "BY_NET_SALES" : "PER_ORDER";
        const allocated = allocateFixedCostsForOrders({
            rows,
            fixedCostsTotal: total,
            mode,
        });
        return allocated.map((r) => {
            const fc = round2(Number(r.fixedCostAllocated ?? 0));
            const pBase = Number(r.profitAfterAdsAndShipping ?? 0);
            const pAfterFixed = r.profitAfterFixedCosts !== undefined ? Number(r.profitAfterFixedCosts ?? 0) : pBase - fc;
            return {
                ...r,
                fixedCostAllocated: fc,
                profitAfterFixedCosts: round2(pAfterFixed),
            };
        });
    }
    const rows = ensureFixedCosts(params.orderProfits);
    const byDay = new Map();
    for (const o of rows) {
        const day = toDayKey(o.createdAt);
        const cur = byDay.get(day) ?? {
            day,
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
            adSpendBreakEven: 0,
        };
        cur.orders += 1;
        cur.grossSales += Number(o.grossSales || 0);
        cur.refunds += Number(o.refunds || 0);
        cur.netAfterRefunds += Number(o.netAfterRefunds || 0);
        cur.cogs += Number(o.cogs || 0);
        cur.paymentFees += Number(o.paymentFees || 0);
        const cm = Number(o.contributionMargin ?? o.profitAfterFees ?? 0);
        cur.contributionMargin += cm;
        cur.profitAfterFees += Number(o.profitAfterFees || 0);
        const sRev = Number(o.shippingRevenue ?? 0);
        const sCost = Number(o.shippingCost ?? 0);
        cur.shippingRevenue += sRev;
        cur.shippingCost += sCost;
        cur.shippingImpact += sRev - sCost;
        const pAfterShip = o.profitAfterShipping !== undefined
            ? Number(o.profitAfterShipping || 0)
            : Number(o.profitAfterFees || 0) - sCost;
        cur.profitAfterShipping += pAfterShip;
        const aSpend = Number(o.allocatedAdSpend ?? 0);
        cur.allocatedAdSpend += aSpend;
        const pAfterAds = o.profitAfterAds !== undefined ? Number(o.profitAfterAds || 0) : Number(o.profitAfterFees || 0) - aSpend;
        const pAfterAdsAndShip = o.profitAfterAdsAndShipping !== undefined ? Number(o.profitAfterAdsAndShipping || 0) : pAfterShip - aSpend;
        cur.profitAfterAds += pAfterAds;
        cur.profitAfterAdsAndShipping += pAfterAdsAndShip;
        cur.fixedCostsAllocated += Number(o.fixedCostAllocated ?? 0);
        cur.profitAfterFixedCosts += Number(o.profitAfterFixedCosts ?? 0);
        if (o.hasMissingCogs)
            cur.missingCogsOrders += 1;
        cur.adSpendBreakEven += cm;
        byDay.set(day, cur);
    }
    const daysArr = Array.from(byDay.values())
        .map((d) => {
        const net = d.netAfterRefunds;
        const cm = d.contributionMargin;
        const cmPct = calcContributionMarginPct({ netAfterRefunds: net, contributionMargin: cm });
        const beRoas = calcBreakEvenRoas({ netAfterRefunds: net, contributionMargin: cm });
        const profitMarginAfterShippingPct = net > 0 ? (d.profitAfterShipping / net) * 100 : 0;
        const profitMarginAfterAdsPct = net > 0 ? (d.profitAfterAds / net) * 100 : 0;
        const profitMarginAfterAdsAndShippingPct = net > 0 ? (d.profitAfterAdsAndShipping / net) * 100 : 0;
        const profitMarginAfterFixedCostsPct = net > 0 ? (d.profitAfterFixedCosts / net) * 100 : 0;
        const missingCogsRatePct = d.orders > 0 ? (d.missingCogsOrders / d.orders) * 100 : 0;
        return {
            day: d.day,
            orders: d.orders,
            grossSales: round2(d.grossSales),
            refunds: round2(d.refunds),
            netAfterRefunds: round2(d.netAfterRefunds),
            shippingRevenue: round2(d.shippingRevenue),
            shippingCost: round2(d.shippingCost),
            shippingImpact: round2(d.shippingImpact),
            cogs: round2(d.cogs),
            paymentFees: round2(d.paymentFees),
            contributionMargin: round2(d.contributionMargin),
            contributionMarginPct: round2(cmPct),
            profitAfterShipping: round2(d.profitAfterShipping),
            profitMarginAfterShippingPct: round2(profitMarginAfterShippingPct),
            profitAfterFees: round2(d.profitAfterFees),
            allocatedAdSpend: round2(d.allocatedAdSpend),
            profitAfterAds: round2(d.profitAfterAds),
            profitMarginAfterAdsPct: round2(profitMarginAfterAdsPct),
            profitAfterAdsAndShipping: round2(d.profitAfterAdsAndShipping),
            profitMarginAfterAdsAndShippingPct: round2(profitMarginAfterAdsAndShippingPct),
            fixedCostsAllocated: round2(d.fixedCostsAllocated),
            profitAfterFixedCosts: round2(d.profitAfterFixedCosts),
            profitMarginAfterFixedCostsPct: round2(profitMarginAfterFixedCostsPct),
            missingCogsOrders: d.missingCogsOrders,
            missingCogsRatePct: round2(missingCogsRatePct),
            adSpendBreakEven: round2(d.adSpendBreakEven),
            breakEvenRoas: beRoas === null ? null : round2(beRoas),
        };
    })
        .sort((a, b) => {
        if (a.day === "unknown")
            return 1;
        if (b.day === "unknown")
            return -1;
        return a.day.localeCompare(b.day);
    });
    const totals = daysArr.reduce((acc, d) => {
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
        shop,
        days,
        totals: {
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
            // ✅ optional diagnostics
            missingCogsOrders: totals.missingCogsOrders,
            missingCogsRatePct: round2(totalsMissingCogsRatePct),
            profitAfterFees: round2(totals.profitAfterFees),
        },
        daily: daysArr,
    };
}
