// src/domain/insights/adsAllocation.ts
import { round2 } from "../../utils/money.js";
import { allocateAdSpendForOrders, allocateAdSpendForProducts } from "../profit/ads.js";
function num(x) {
    const n = Number(x ?? 0);
    return Number.isFinite(n) ? n : 0;
}
/**
 * ✅ SSOT WRAPPER
 * This module is kept for backwards compatibility, but allocation logic lives in domain/profit/ads.ts
 */
export function allocateAdSpend(params) {
    const { rows, getId, getWeight } = params;
    // We adapt to SSOT allocator which expects netAfterRefunds / netSales fields.
    // Create a lightweight view model.
    const view = rows.map((r) => ({
        __id: getId(r),
        __w: num(getWeight(r)),
        netAfterRefunds: num(getWeight(r)), // weight = allocation base
    }));
    const allocated = allocateAdSpendForOrders({
        rows: view,
        adSpend: num(params.totalAdSpend),
        mode: "BY_NET_SALES",
    });
    const out = new Map();
    for (const r of allocated)
        out.set(r.__id, round2(r.allocatedAdSpend ?? 0));
    return out;
}
export function enrichOrdersWithAds(params) {
    const { orders, totalAdSpend, weight = (o) => num(o.netAfterRefunds), baseProfit = (o) => num(o.contributionMargin), profitAfterShipping, } = params;
    const view = orders.map((o) => ({
        __ref: o,
        netAfterRefunds: weight(o),
    }));
    const allocated = allocateAdSpendForOrders({
        rows: view,
        adSpend: num(totalAdSpend),
        mode: "BY_NET_SALES",
    });
    return allocated.map((row) => {
        const o = row.__ref;
        const adSpendAllocated = round2(row.allocatedAdSpend ?? 0);
        const cm = baseProfit(o);
        const profitAfterAds = round2(cm - adSpendAllocated);
        const out = { ...o, adSpendAllocated, profitAfterAds };
        if (profitAfterShipping) {
            const pas = num(profitAfterShipping(o));
            out.profitAfterAdsAndShipping = round2(pas - adSpendAllocated);
        }
        return out;
    });
}
export function enrichProductsWithAds(params) {
    const { products, totalAdSpend, weight = (p) => num(p.netSales), baseProfit = (p) => num(p.profitAfterFees), } = params;
    const view = products.map((p) => ({
        __ref: p,
        netSales: weight(p),
    }));
    // SSOT product allocator expects netSales
    const allocated = allocateAdSpendForProducts({
        rows: view,
        adSpend: num(totalAdSpend),
    });
    return allocated.map((row) => {
        const p = row.__ref;
        const adSpendAllocated = round2(row.allocatedAdSpend ?? 0);
        const profit = baseProfit(p);
        const profitAfterAds = round2(profit - adSpendAllocated);
        return {
            ...p,
            adSpendAllocated,
            profitAfterAds,
        };
    });
}
