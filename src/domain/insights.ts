// src/domain/insights.ts
export type {
  OrderProfitRow,
  ProductProfitRow,
  ProfitKillersParams,
  ShippingTotalsInput,
  ShippingSubsidyInsight,
  Reason,
} from "./insights/types";

export { buildProfitKillersInsights } from "./insights/profitKillers";