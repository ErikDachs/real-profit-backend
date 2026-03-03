// src/domain/costModel/overrides.parse.ts
import type { CostProfileOverrides } from "./types";

/**
 * Helper to build overrides from raw query/body safely.
 *
 * Supports BOTH:
 * 1) flat legacy keys: fixedCostsDaysInMonth, fixedCostsMonthlyItems, fixedCostsAllocationMode
 * 2) nested object: { fixedCosts: { daysInMonth, allocationMode, monthlyItems } }
 */
export function costOverridesFromAny(input: any): CostProfileOverrides | undefined {
  if (!input || typeof input !== "object") return undefined;

  // payment/shipping/flags/ads (flat)
  const feePercent = input.feePercent ?? input.paymentFeePercent ?? undefined;
  const feeFixed = input.feeFixed ?? input.paymentFeeFixed ?? undefined;

  const shippingCost =
    input.shippingCostPerOrder ?? input.defaultShippingCost ?? input.shippingCost ?? undefined;

  const includeShippingCost = input.includeShippingCost ?? undefined;
  const allocationMode = input.adAllocationMode ?? input.allocationMode ?? undefined;

  // fixed costs: accept nested OR flat
  const fixedObj = input.fixedCosts && typeof input.fixedCosts === "object" ? input.fixedCosts : undefined;

  const fixedCostsAllocationMode = fixedObj?.allocationMode ?? input.fixedCostsAllocationMode ?? undefined;
  const fixedCostsDaysInMonth = fixedObj?.daysInMonth ?? input.fixedCostsDaysInMonth ?? undefined;
  const fixedCostsMonthlyItems = fixedObj?.monthlyItems ?? input.fixedCostsMonthlyItems ?? undefined;

  const out: CostProfileOverrides = {};

  if (feePercent !== undefined || feeFixed !== undefined) {
    out.payment = {};
    if (feePercent !== undefined) out.payment.feePercent = Number(feePercent);
    if (feeFixed !== undefined) out.payment.feeFixed = Number(feeFixed);
  }

  if (shippingCost !== undefined) {
    out.shipping = { costPerOrder: Number(shippingCost) };
  }

  if (allocationMode !== undefined && (allocationMode === "BY_NET_SALES" || allocationMode === "PER_ORDER")) {
    out.ads = { allocationMode };
  }

  if (includeShippingCost !== undefined) {
    out.flags = { includeShippingCost: Boolean(includeShippingCost) };
  }

  // fixed costs parse (only if anything present)
  if (
    fixedCostsAllocationMode !== undefined ||
    fixedCostsDaysInMonth !== undefined ||
    fixedCostsMonthlyItems !== undefined
  ) {
    out.fixedCosts = {};

    if (fixedCostsAllocationMode !== undefined) {
      const m = String(fixedCostsAllocationMode);
      if (m === "PER_ORDER" || m === "BY_NET_SALES" || m === "BY_DAYS") {
        out.fixedCosts.allocationMode = m as any;
      }
    }

    if (fixedCostsDaysInMonth !== undefined) out.fixedCosts.daysInMonth = Number(fixedCostsDaysInMonth);

    if (fixedCostsMonthlyItems !== undefined) {
      // accept array only, ignore otherwise
      if (Array.isArray(fixedCostsMonthlyItems)) out.fixedCosts.monthlyItems = fixedCostsMonthlyItems as any;
    }
  }

  if (!out.payment && !out.shipping && !out.ads && !out.flags && !out.fixedCosts) return undefined;
  return out;
}