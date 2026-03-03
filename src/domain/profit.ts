// src/domain/profit.ts

export { extractRefundsFromOrder } from "./profit/refunds";
export { extractShippingRevenueFromOrder } from "./profit/shipping";
export { calcPaymentFees } from "./profit/fees";
export { extractVariantQtyFromOrder } from "./profit/variants";

export { calculateOrderProfit } from "./profit/orderProfit";
export { buildOrdersSummary } from "./profit/ordersSummary";
export { buildProductsProfit } from "./profit/productsProfit";
export { allocateFixedCostsForOrders } from "./profit/fixedCosts";