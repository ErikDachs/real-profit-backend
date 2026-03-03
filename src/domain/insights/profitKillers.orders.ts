// src/domain/insights/profitKillers.orders.ts
import { round2 } from "../../utils/money";
import { safeDiv, computeOrderReasons } from "./utils";

export function enrichOrdersWithReasons(orders: Array<any>) {
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

function orderProfitValue(o: any): number {
  return Number((o as any).profitAfterAds ?? o.contributionMargin ?? 0);
}

export function pickWorstOrders(ordersWithReasons: Array<any>, limit: number) {
  return [...ordersWithReasons]
    .sort((a, b) => orderProfitValue(a) - orderProfitValue(b))
    .slice(0, limit);
}

export function pickBestOrders(ordersWithReasons: Array<any>, limit: number) {
  return [...ordersWithReasons]
    .sort((a, b) => orderProfitValue(b) - orderProfitValue(a))
    .slice(0, limit);
}