// src/domain/insights/cmDecomposition.ts
import { decomposeMarginDriftCore } from "./cmDecomposition.core";

export type CmAgg = {
  orders?: number;

  grossSales?: number; // optional but best
  refunds?: number; // optional but best

  netAfterRefunds: number;

  cogs: number;
  paymentFees: number;

  // optional shipping transparency
  shippingRevenue?: number;
  shippingCost?: number;

  // ✅ NEW: fixed costs (optional)
  fixedCostsAllocatedInPeriod?: number;
};

export type CmDecompositionDriver = {
  code: "REFUNDS" | "COGS" | "PAYMENT_FEES" | "SHIPPING_COST" | "FIXED_COSTS" | "OTHER";
  label: string;

  // impact on margin% in percentage points (approx, deterministic)
  deltaPctPoints: number;

  // impact as money in the short window (approx, deterministic)
  impactOnCm: number;

  meta?: Record<string, any>;
};

export type CmDecompositionResult = {
  baseline: { window: "LONG"; cmPct: number };
  current: { window: "SHORT"; cmPct: number };

  driftPctPoints: number;
  drivers: CmDecompositionDriver[];

  meta: { method: "RATIO_TO_SHORT_WINDOW"; notes: string[] };
};

/**
 * Deterministic decomposition of CM% drift between two windows.
 */
export function decomposeCmDrift(params: { short: CmAgg; long: CmAgg; currency: string }): CmDecompositionResult | null {
  return decomposeMarginDriftCore({ ...params, mode: "CM" });
}

/**
 * ✅ NEW:
 * Decomposition of OPERATING margin drift:
 * operatingProfit = net - cogs - fees - shippingCost - fixedCosts
 */
export function decomposeOperatingMarginDrift(params: {
  short: CmAgg;
  long: CmAgg;
  currency: string;
}): CmDecompositionResult | null {
  return decomposeMarginDriftCore({ ...params, mode: "OPERATING" });
}