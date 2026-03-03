// src/domain/profit/fees.ts
export function calcPaymentFees(params) {
    const { netAfterRefunds, orderCount, feePercent, feeFixed } = params;
    return netAfterRefunds * feePercent + orderCount * feeFixed;
}
