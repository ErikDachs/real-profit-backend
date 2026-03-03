// src/domain/profit/orderProfit.ts
import { round2 } from "../../utils/money.js";
import type { CogsService } from "../cogs.js";
import { calcContributionMargin, calcContributionMarginPct, calcBreakEvenRoas } from "../metrics.js";
import { extractRefundsFromOrder } from "./refunds.js";
import { extractShippingRevenueFromOrder } from "./shipping.js";
import { getOrderLineItemFacts, orderIsGiftCardOnly } from "./variants.js";
import { isMissingUnitCost } from "./cogsGovernance.js";
import { calcPaymentFees } from "./fees.js";

// ✅ Cost Model
import type { CostProfile } from "../costModel/types.js";

export async function calculateOrderProfit(params: {
  order: any;

  costProfile: CostProfile;

  cogsService: CogsService;
  shopifyGET: (path: string) => Promise<any>;

  // Optional fast path: variantId -> unitCost (override already applied)
  unitCostByVariant?: Map<number, number | undefined>;

  /**
   * ✅ Missing-COGS governance:
   * If a variant is flagged ignoreCogs=true, unitCost can be 0 "by design" and must NOT count as missing.
   */
  isIgnoredVariant?: (variantId: number) => boolean;
}) {
  const { order, costProfile, cogsService, shopifyGET, isIgnoredVariant } = params;

  const orderId = String(order?.id ?? "");

  // -------------------------
  // Raw amounts from Shopify
  // -------------------------
  const rawGrossSales = Number(order?.total_price || 0);
  const rawRefunds = extractRefundsFromOrder(order);
  const rawNetAfterRefunds = rawGrossSales - rawRefunds;

  // -------------------------
  // SSOT line item facts
  // -------------------------
  const facts = getOrderLineItemFacts(order);
  const variantQty = facts.extractedVariantQty;

  // ✅ Gift card CFO handling (liability):
  // Gift-card-only orders contribute 0 operational sales, but fees remain real.
  const isGiftCardOnlyOrder = orderIsGiftCardOnly(order);
  const giftCardNetSalesExcluded = isGiftCardOnlyOrder ? rawNetAfterRefunds : 0;

  // Operational view (what counts as "sales" for profit)
  const grossSales = isGiftCardOnlyOrder ? 0 : rawGrossSales;
  const refunds = isGiftCardOnlyOrder ? 0 : rawRefunds;
  const netAfterRefunds = isGiftCardOnlyOrder ? 0 : rawNetAfterRefunds;

  let cogs = 0;

  // ✅ Explicit missing COGS flag (for insights/reasons/UX)
  let hasMissingCogs = false;
  const missingVariantIds: number[] = [];

  // ✅ unmapped variants => missing COGS
  if (facts.hasUnmappedVariants) {
    hasMissingCogs = true;
  }

  // Determine unit costs map
  const unitCostByVariant =
    params.unitCostByVariant ??
    (variantQty.length > 0
      ? await cogsService.computeUnitCostsByVariant(
          shopifyGET,
          variantQty.map((x) => x.variantId)
        )
      : undefined);

  // Compute COGS & missing detection deterministically when we have variants
  if (variantQty.length > 0) {
    if (unitCostByVariant) {
      for (const li of variantQty) {
        const unitCost = unitCostByVariant.get(li.variantId);

        // Unknown cost contributes 0, but is governed by missing flag below
        if (unitCost !== undefined) cogs += li.qty * unitCost;

        if (isMissingUnitCost({ unitCost, variantId: li.variantId, isIgnoredVariant })) {
          hasMissingCogs = true;
          missingVariantIds.push(li.variantId);
        }
      }
    } else {
      // fallback path (older) – does not allow per-variant missing detection
      cogs = await cogsService.computeCogsForVariants(shopifyGET, variantQty);
      // unmapped variants guard is already applied via facts.hasUnmappedVariants
    }
  }

  // ✅ Payment fees (SSOT):
  // Fees are REAL CASH costs => always compute on RAW netAfterRefunds (even for gift-card-only orders)
  const feePercent = Number(costProfile.payment.feePercent || 0);
  const feeFixed = Number(costProfile.payment.feeFixed || 0);

  const paymentFees = calcPaymentFees({
    netAfterRefunds: rawNetAfterRefunds,
    orderCount: 1,
    feePercent,
    feeFixed,
  });

  // Core metrics (operational)
  const contributionMargin = calcContributionMargin({
    netAfterRefunds,
    cogs,
    paymentFees,
  });

  const contributionMarginPct = calcContributionMarginPct({
    netAfterRefunds,
    contributionMargin,
  });

  const breakEvenRoas = calcBreakEvenRoas({
    netAfterRefunds,
    contributionMargin,
  });

  // Shipping transparency + real-profit adjustment
  const shippingRevenue = extractShippingRevenueFromOrder(order);

  const includeShippingCost = Boolean(costProfile.flags?.includeShippingCost ?? true);

  // ✅ Gift-card-only orders: treat shipping cost as 0 (no fulfillment/shipping),
  // even if you have a global per-order shipping fallback.
  const shippingCostPerOrder =
    includeShippingCost && !isGiftCardOnlyOrder ? Number(costProfile.shipping.costPerOrder || 0) : 0;

  const shippingCost = shippingCostPerOrder;
  const shippingImpact = shippingRevenue - shippingCost;

  const profitAfterFees = contributionMargin;
  const profitAfterShipping = profitAfterFees - shippingCost;

  const profitMarginAfterShippingPct = netAfterRefunds > 0 ? (profitAfterShipping / netAfterRefunds) * 100 : 0;

  // Compatibility fields (existing names)
  const marginAfterFeesPct = contributionMarginPct;

  return {
    orderId,

    // ✅ Gift card transparency
    isGiftCardOnlyOrder,
    giftCardNetSalesExcluded: round2(giftCardNetSalesExcluded),

    // Operational money fields
    grossSales: round2(grossSales),
    refunds: round2(refunds),
    netAfterRefunds: round2(netAfterRefunds),

    cogs: round2(cogs),

    paymentFees: round2(paymentFees),

    contributionMargin: round2(contributionMargin),
    contributionMarginPct: round2(contributionMarginPct),

    // ✅ Missing COGS governance (SSOT)
    hasMissingCogs,
    missingCogsVariantIds: Array.from(new Set(missingVariantIds)),

    // Shipping
    shippingRevenue: round2(shippingRevenue),
    shippingCost: round2(shippingCost),
    shippingImpact: round2(shippingImpact),

    profitAfterShipping: round2(profitAfterShipping),
    profitMarginAfterShippingPct: round2(profitMarginAfterShippingPct),

    // Break-even ad spend + ROAS (still based on CM)
    adSpendBreakEven: round2(contributionMargin),
    breakEvenRoas: breakEvenRoas === null ? null : round2(breakEvenRoas),

    // OLD (keep)
    profitAfterFees: round2(profitAfterFees),
    marginAfterFeesPct: round2(marginAfterFeesPct),
  };
}
