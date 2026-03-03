// src/domain/insights.ts
export type {
  OrderProfitRow,
  ProductProfitRow,
  ProfitKillersParams,
  ShippingTotalsInput,
  ShippingSubsidyInsight,
  Reason,
} from "./insights/types.js";

export { buildProfitKillersInsights } from "./insights/profitKillers.js";
