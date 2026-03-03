// src/domain/profit/fees.ts

export function calcPaymentFees(params: {
  netAfterRefunds: number;
  orderCount: number;
  feePercent: number;
  feeFixed: number;
}): number {
  const { netAfterRefunds, orderCount, feePercent, feeFixed } = params;
  return netAfterRefunds * feePercent + orderCount * feeFixed;
}