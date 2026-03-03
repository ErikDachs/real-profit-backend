// src/domain/profit.ts
export { extractRefundsFromOrder } from "./profit/refunds.js";
export { extractShippingRevenueFromOrder } from "./profit/shipping.js";
export { calcPaymentFees } from "./profit/fees.js";
export { extractVariantQtyFromOrder } from "./profit/variants.js";
export { calculateOrderProfit } from "./profit/orderProfit.js";
export { buildOrdersSummary } from "./profit/ordersSummary.js";
export { buildProductsProfit } from "./profit/productsProfit.js";
export { allocateFixedCostsForOrders } from "./profit/fixedCosts.js";
