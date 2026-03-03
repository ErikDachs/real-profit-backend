// src/domain/opportunities/deepDive/types.ts
import type { OpportunityType, UnifiedOpportunity } from "../types.js";
import type { OrderProfitRow, ProductProfitRow, ShippingTotalsInput } from "../../insights/types.js";

export type DeepDiveDriver = {
  // stable identifier for UI
  key: string;

  // optional product linkage
  productId?: number;
  variantId?: number;

  title: string; // human label
  sku?: string | null;
  variantTitle?: string | null;

  // main impact metric used for ranking inside deep dive
  impact: number; // positive = "loss contribution" (bigger worse)
  impactSharePct: number; // share of total impact in this deep dive

  // helpful context metrics
  metrics?: Record<string, number | string | null | undefined>;
};

export type OpportunityDeepDive = {
  type: OpportunityType;

  // repeat base info for UI convenience
  title: string;
  summary: string;

  currency: string;
  days: number;

  // Baseline loss (period + normalized)
  baseline: {
    lossInPeriod: number;
    estimatedMonthlyLoss: number;
    estimatedAnnualLoss: number;
  };

  // Concentration: how much of the problem comes from top drivers
  concentration: {
    top1SharePct: number;
    top3SharePct: number;
    top5SharePct: number;
  };

  // ranked contributors
  drivers: DeepDiveDriver[];

  // supporting evidence (kept small, deterministic)
  worstOrders?: Array<{
    id: number | string;
    name?: string | null;
    createdAt?: string | null;

    // quick money fields
    grossSales: number;
    refunds: number;
    netAfterRefunds: number;
    cogs: number;
    paymentFees: number;

    contributionMargin: number;
    contributionMarginPct: number;

    // optional
    shippingRevenue?: number;
    shippingCost?: number;
    shippingImpact?: number;
    profitAfterShipping?: number;

    allocatedAdSpend?: number;
    profitAfterAds?: number;
    profitAfterAdsAndShipping?: number;
  }>;

  // optional context for UI/debugging (no ranking dependency)
  meta?: Record<string, any>;

  // deterministic suggested actions (from UnifiedOpportunity)
  actions?: UnifiedOpportunity["actions"];

  // Optional: attach simulation scenarios (if provided by caller)
  simulation?: any;
};

export type BuildOpportunityDeepDiveParams = {
  shop: string;
  days: number;
  currency: string;

  // SSOT inputs
  opportunities: UnifiedOpportunity[];
  orders: OrderProfitRow[];
  products: ProductProfitRow[];

  shippingTotals?: ShippingTotalsInput;

  // optional: attach simulation outputs by type
  simulationByType?: Map<OpportunityType, any>;

  // selection
  type?: OpportunityType; // if set: build only this one
  limit?: number; // default 10 drivers
};
