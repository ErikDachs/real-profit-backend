// src/domain/profit/refunds.ts
export function extractRefundsFromOrder(order) {
    const rs = order.refunds ?? [];
    const refundTx = rs.flatMap((r) => r.transactions ?? []);
    return refundTx.reduce((s, t) => s + Number(t.amount || 0), 0);
}
