// src/domain/profit/refunds.ts
export function extractRefundsFromOrder(order: any): number {
  const rs = order.refunds ?? [];
  const refundTx = rs.flatMap((r: any) => r.transactions ?? []);
  return refundTx.reduce((s: number, t: any) => s + Number(t.amount || 0), 0);
}