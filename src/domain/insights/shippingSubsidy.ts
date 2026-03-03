// src/domain/insights/shippingSubsidy.ts
import { round2 } from "../../utils/money";
import type { ShippingSubsidyInsight, ShippingTotalsInput } from "./types";
import { periodLabel } from "./utils";

export function buildShippingSubsidyInsight(params: {
  currency: string;
  days: number;
  shippingTotals?: ShippingTotalsInput;
}): ShippingSubsidyInsight | null {
  const { currency, days, shippingTotals } = params;
  if (!shippingTotals) return null;

  const orders = Number(shippingTotals.orders || 0);
  const rev = Number(shippingTotals.shippingRevenue || 0);
  const cost = Number(shippingTotals.shippingCost || 0);
  const impact = Number(shippingTotals.shippingImpact || 0);

  if (!Number.isFinite(impact) || impact >= 0) return null;

  const avgLossPerOrder = orders > 0 ? Math.abs(impact) / orders : Math.abs(impact);

  return {
    type: "shippingSubsidy",
    periodDays: days,
    periodLabel: periodLabel(days),
    currency,

    totalShippingRevenue: round2(rev),
    totalShippingCost: round2(cost),
    totalShippingImpact: round2(impact),

    averageShippingLossPerOrder: round2(avgLossPerOrder),
  };
}