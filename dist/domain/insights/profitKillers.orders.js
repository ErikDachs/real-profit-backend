// src/domain/insights/profitKillers.orders.ts
import { round2 } from "../../utils/money.js";
import { safeDiv, computeOrderReasons } from "./utils.js";
export function enrichOrdersWithReasons(orders) {
    return orders.map((o) => {
        const gross = Number(o.grossSales || 0);
        const refunds = Number(o.refunds || 0);
        const net = Number(o.netAfterRefunds || 0);
        const fees = Number(o.paymentFees || 0);
        const refundRatePct = safeDiv(refunds, gross) * 100;
        const feeRatePct = safeDiv(fees, net) * 100;
        return {
            ...o,
            refundRatePct: round2(refundRatePct),
            feeRatePct: round2(feeRatePct),
            reasons: computeOrderReasons(o),
        };
    });
}
function orderProfitValue(o) {
    return Number(o.profitAfterAds ?? o.contributionMargin ?? 0);
}
export function pickWorstOrders(ordersWithReasons, limit) {
    return [...ordersWithReasons]
        .sort((a, b) => orderProfitValue(a) - orderProfitValue(b))
        .slice(0, limit);
}
export function pickBestOrders(ordersWithReasons, limit) {
    return [...ordersWithReasons]
        .sort((a, b) => orderProfitValue(b) - orderProfitValue(a))
        .slice(0, limit);
}
