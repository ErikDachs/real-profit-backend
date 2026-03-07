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

  const rawShippingRevenue = extractShippingRevenueFromOrder(order);

  // -------------------------
  // SSOT line item facts
  // -------------------------
  const facts = getOrderLineItemFacts(order);
  const variantQty = facts.extractedVariantQty;

  const isGiftCardOnlyOrder = orderIsGiftCardOnly(order);

  // ✅ Flag-gated governance
  // If excludeGiftCards=true, gift-card-only orders are excluded from KPIs (fees/CM/etc = 0),
  // but raw values remain visible (grossSales/refunds/shippingRevenue).
  const excludeGiftCards = Boolean((costProfile as any)?.flags?.excludeGiftCards ?? false);
 const excludeGiftCardOnlyFromKpis = isGiftCardOnlyOrder && excludeGiftCards;

  // Gift card transparency (always)
  const giftCardNetSalesExcluded = isGiftCardOnlyOrder ? rawNetAfterRefunds : 0;

  // -------------------------
  // Output fields: grossSales/refunds have two possible meanings depending on governance
  // -------------------------
  // Default behavior (excludeGiftCards=false):
  //   Gift-card-only => operational view => grossSales/refunds/netAfterRefunds = 0
  // Governance behavior (excludeGiftCards=true):
  //   Gift-card-only => KPIs excluded, but raw values must remain visible for grossSales/refunds/shippingRevenue
  const grossSales = excludeGiftCardOnlyFromKpis ? rawGrossSales : isGiftCardOnlyOrder ? 0 : rawGrossSales;
  const refunds = excludeGiftCardOnlyFromKpis ? rawRefunds : isGiftCardOnlyOrder ? 0 : rawRefunds;

  // KPIs always use operational net:
  const netAfterRefunds = isGiftCardOnlyOrder ? 0 : rawNetAfterRefunds;

  // -------------------------
  // COGS + Missing COGS governance
  // -------------------------
  let cogs = 0;
  let hasMissingCogs = false;
  const missingVariantIds: number[] = [];

  // For gift-card-only, never trigger missing COGS (both contracts)
  if (!isGiftCardOnlyOrder) {
    if (facts.hasUnmappedVariants) hasMissingCogs = true;

    const unitCostByVariant =
      params.unitCostByVariant ??
      (variantQty.length > 0
        ? await cogsService.computeUnitCostsByVariant(
            shopifyGET,
            variantQty.map((x) => x.variantId)
          )
        : undefined);

    if (variantQty.length > 0) {
      if (unitCostByVariant) {
        for (const li of variantQty) {
          const unitCost = unitCostByVariant.get(li.variantId);
          if (unitCost !== undefined) cogs += li.qty * unitCost;

          if (isMissingUnitCost({ unitCost, variantId: li.variantId, isIgnoredVariant })) {
            hasMissingCogs = true;
            missingVariantIds.push(li.variantId);
          }
        }
      } else {
        cogs = await cogsService.computeCogsForVariants(shopifyGET, variantQty);
      }
    }
  }

  // -------------------------
  // Payment fees
  // -------------------------
  const feePercent = Number(costProfile.payment?.feePercent || 0);
  const feeFixed = Number(costProfile.payment?.feeFixed || 0);

  // Contract:
  // - excludeGiftCards=true + gift-only => paymentFees=0
  // - otherwise gift-only => fees are real on RAW netAfterRefunds (percent + fixed)
  // - non gift-only => also rawNetAfterRefunds (same as operational net here)
  const paymentFees = excludeGiftCardOnlyFromKpis
    ? 0
    : calcPaymentFees({
        netAfterRefunds: rawNetAfterRefunds,
        orderCount: 1,
        feePercent,
        feeFixed,
      });

  // -------------------------
  // Core metrics (operational KPIs)
  // -------------------------
  const contributionMargin = excludeGiftCardOnlyFromKpis
    ? 0
    : calcContributionMargin({
        netAfterRefunds,
        cogs,
        paymentFees,
      });

  const contributionMarginPct = excludeGiftCardOnlyFromKpis
    ? 0
    : calcContributionMarginPct({
        netAfterRefunds,
        contributionMargin,
      });

  // Contract:
  // - excludeGiftCards=true + gift-only => breakEvenRoas must be 0 (not null)
  // - otherwise use metrics result
  const breakEvenRoas = excludeGiftCardOnlyFromKpis
    ? 0
    : calcBreakEvenRoas({
        netAfterRefunds,
        contributionMargin,
      });

  // -------------------------
  // Shipping
  // -------------------------
  // Contract:
  // - excludeGiftCards=true + gift-only => shippingRevenue must remain visible (raw)
  // - otherwise: shippingRevenue is operational; for gift-only it can be 0 (not asserted elsewhere)
  const shippingRevenue = excludeGiftCardOnlyFromKpis ? rawShippingRevenue : isGiftCardOnlyOrder ? 0 : rawShippingRevenue;

  const includeShippingCost = Boolean((costProfile as any)?.flags?.includeShippingCost ?? true);

  // Gift-card-only: shipping cost must be 0 (both contracts)
  const shippingCostPerOrder =
    includeShippingCost && !isGiftCardOnlyOrder ? Number(costProfile.shipping?.costPerOrder || 0) : 0;

  const shippingCost = shippingCostPerOrder;
const shippingImpact = shippingRevenue - shippingCost;

// Profit fields (remain consistent with KPIs)
const profitAfterFees = contributionMargin;
const profitAfterShipping = profitAfterFees + shippingImpact;

  const profitMarginAfterShippingPct = netAfterRefunds > 0 ? (profitAfterShipping / netAfterRefunds) * 100 : 0;

  const marginAfterFeesPct = contributionMarginPct;

  return {
    orderId,

    isGiftCardOnlyOrder,
    giftCardNetSalesExcluded: round2(giftCardNetSalesExcluded),

    // money fields (note: grossSales/refunds may be raw-visible when excludeGiftCards=true + gift-only)
    grossSales: round2(grossSales),
    refunds: round2(refunds),
    netAfterRefunds: round2(netAfterRefunds),

    cogs: round2(cogs),
    paymentFees: round2(paymentFees),

    contributionMargin: round2(contributionMargin),
    contributionMarginPct: round2(contributionMarginPct),

    hasMissingCogs,
    missingCogsVariantIds: Array.from(new Set(missingVariantIds)),

    shippingRevenue: round2(shippingRevenue),
    shippingCost: round2(shippingCost),
    shippingImpact: round2(shippingImpact),

    profitAfterShipping: round2(profitAfterShipping),
    profitMarginAfterShippingPct: round2(profitMarginAfterShippingPct),

    adSpendBreakEven: round2(contributionMargin),
    breakEvenRoas:
      breakEvenRoas === null ? null : typeof breakEvenRoas === "number" ? round2(breakEvenRoas) : (breakEvenRoas as any),

    profitAfterFees: round2(profitAfterFees),
    marginAfterFeesPct: round2(marginAfterFeesPct),
  };
}