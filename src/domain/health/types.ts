// src/domain/health/types.ts

export type HealthStatus = "HEALTHY" | "UNSTABLE" | "CRITICAL";

export type HealthDriverType =
  | "LOW_CM_PCT"
  | "NEGATIVE_CM"
  | "HIGH_REFUND_RATE"
  | "HIGH_FEE_BURDEN"
  | "HIGH_COGS_RATE"
  | "SHIPPING_SUBSIDY"
  | "MISSING_COGS"
  | "ROAS_BELOW_BREAK_EVEN"
  | "FIXED_COST_PRESSURE"
  | "MISSING_SIGNALS"
  // ✅ NEW (data quality governance)
  | "DATA_QUALITY_CAP";

export type HealthDriver = {
  type: HealthDriverType;

  // negative values reduce health score; deterministic based on weights + component score deficit
  impact: number;

  title: string;
  explanation: string;

  // optional detail for UI/debugging
  meta?: Record<string, any>;
};

export type ProfitHealthSignals = {
  currency?: string;

  orders: number;

  grossSales: number;
  refunds: number;
  netAfterRefunds: number;

  cogs: number;
  paymentFees: number;

  contributionMarginPct: number;

  // shipping (optional)
  shippingRevenue?: number;
  shippingCost?: number;

  // missing cogs context (optional)
  missingCogsCount?: number;

  // ads (optional)
  adSpend?: number;
  roas?: number | null;
  breakEvenRoas?: number | null;

  // ✅ fixed costs (optional)
  fixedCostsAllocatedInPeriod?: number;
};

export type ProfitHealth = {
  score: number; // 0..100
  status: HealthStatus;

  // sorted by absolute impact desc (most important first)
  drivers: HealthDriver[];

  // same components as before, for debugging + UI
  components: Record<string, number>;

  ratios: Record<string, number | null | undefined>;

  signals: ProfitHealthSignals;
};