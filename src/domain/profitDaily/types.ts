// src/domain/profitDaily/types.ts
export type FixedCostsAllocationMode = "PER_ORDER" | "BY_NET_SALES" | "BY_DAYS";

export type OrderProfitInputRow = {
  createdAt: string | null;
  grossSales: number;
  refunds: number;
  netAfterRefunds: number;
  cogs: number;
  paymentFees: number;

  profitAfterFees: number;
  contributionMargin?: number;

  shippingRevenue?: number;
  shippingCost?: number;
  profitAfterShipping?: number;

  allocatedAdSpend?: number;
  profitAfterAds?: number;
  profitAfterAdsAndShipping?: number;

  fixedCostAllocated?: number;
  profitAfterFixedCosts?: number;

  hasMissingCogs?: boolean;

  // ✅ optional transparency (safe for future UI)
  hasGiftCard?: boolean;
  isExcludedFromProfit?: boolean;
};

export type BuildDailyProfitParams = {
  shop: string;
  days: number;

  fixedCostsAllocatedInPeriod?: number;
  fixedCostsAllocationMode?: FixedCostsAllocationMode;

  orderProfits: OrderProfitInputRow[];
};

export type RowWithFixed = OrderProfitInputRow & {
  fixedCostAllocated: number;
  profitAfterFixedCosts: number;
};

export type DayAgg = {
  day: string;
  orders: number;

  grossSales: number;
  refunds: number;
  netAfterRefunds: number;

  shippingRevenue: number;
  shippingCost: number;
  shippingImpact: number;

  cogs: number;
  paymentFees: number;

  contributionMargin: number;
  contributionMarginPct: number;

  profitAfterShipping: number;
  profitMarginAfterShippingPct: number;

  profitAfterFees: number;

  allocatedAdSpend: number;
  profitAfterAds: number;
  profitMarginAfterAdsPct: number;

  profitAfterAdsAndShipping: number;
  profitMarginAfterAdsAndShippingPct: number;

  fixedCostsAllocated: number;
  profitAfterFixedCosts: number;
  profitMarginAfterFixedCostsPct: number;

  missingCogsOrders: number;
  missingCogsRatePct: number;

  adSpendBreakEven: number;
  breakEvenRoas: number | null;
};

export type TotalsAgg = Omit<DayAgg, "day">;
