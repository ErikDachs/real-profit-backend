export type OrderProfitRow = {
  id: number | string;
  name?: string | null;
  createdAt?: string | null;
  currency?: string | null;

  grossSales: number;
  refunds: number;
  netAfterRefunds: number;
  cogs: number;
  paymentFees: number;

  contributionMargin: number;
  contributionMarginPct: number;

  // ✅ Gift-card governance facts
  isGiftCardOnlyOrder?: boolean;
  giftCardNetSalesExcluded?: number;

  // Shipping (optional, but you already send it in many places)
  shippingRevenue?: number;
  shippingCost?: number;
  shippingImpact?: number;
  profitAfterShipping?: number;
  profitMarginAfterShippingPct?: number;

  // Ads (optional; will exist after allocation)
  allocatedAdSpend?: number;
  profitAfterAds?: number;
  profitAfterAdsAndShipping?: number;

  adSpendBreakEven: number;
  breakEvenRoas: number | null;
};

export type ProductProfitRow = {
  productId: number;
  variantId: number;
  title: string;
  variantTitle: string | null;
  sku: string | null;

  qty: number;
  grossSales: number;
  refundsAllocated: number;
  netSales: number;

  cogs: number;

  /**
   * SSOT-aligned fact:
   * true => this variant is missing COGS under governance rules
   * false => not missing (including ignored variants)
   */
  hasMissingCogs: boolean;

  paymentFeesAllocated: number;

  profitAfterFees: number;
  marginPct: number;

  // Ads (optional; will exist after allocation)
  allocatedAdSpend?: number;
  profitAfterAds?: number;
};

export type ShippingTotalsInput = {
  orders: number;
  shippingRevenue: number;
  shippingCost: number;
  shippingImpact: number;
};

export type ShippingSubsidyInsight = {
  type: "shippingSubsidy";
  periodDays: number;
  periodLabel: string;
  currency: string;

  totalShippingRevenue: number;
  totalShippingCost: number;
  totalShippingImpact: number;

  averageShippingLossPerOrder: number;
};

export type ProfitKillersParams = {
  shop: string;
  days: number;
  orders: OrderProfitRow[];
  products: ProductProfitRow[];
  missingCogsCount: number;
  limit?: number;

  adSpend?: number;
  currentRoas?: number;

  shippingTotals?: ShippingTotalsInput;

  fixedCosts?: {
    monthlyTotal: number;
    allocatedInPeriod: number;
    allocationMode: "PER_ORDER" | "BY_NET_SALES";
    daysInMonth: number;
  };
};

export type Reason =
  | "HIGH_REFUNDS"
  | "MISSING_COGS"
  | "LOW_MARGIN"
  | "HIGH_FEES"
  | "NEGATIVE_CM";