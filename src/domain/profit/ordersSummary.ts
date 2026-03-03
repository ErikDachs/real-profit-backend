// src/domain/profit/ordersSummary.ts
import { round2 } from "../../utils/money.js";
import type { CogsService, VariantQty } from "../cogs.js";
import { calcContributionMargin, calcContributionMarginPct, calcBreakEvenRoas } from "../metrics.js";
import { extractRefundsFromOrder } from "./refunds.js";
import { extractShippingRevenueFromOrder } from "./shipping.js";
import { calcPaymentFees } from "./fees.js";
import { extractVariantQtyFromOrder, getOrderLineItemFacts, orderIsGiftCardOnly } from "./variants.js";
import { isMissingUnitCost } from "./cogsGovernance.js";

// ✅ Cost Model
import type { CostProfile } from "../costModel/types.js";

export async function buildOrdersSummary(params: {
  shop: string;
  days: number;
  adSpend: number;
  orders: any[];

  costProfile: CostProfile & { derived?: { fixedCostsMonthlyTotal?: number } };

  cogsService: CogsService;
  shopifyGET: (path: string) => Promise<any>;

  unitCostByVariant?: Map<number, number | undefined>;

  /**
   * ✅ Missing-COGS governance:
   * ignoreCogs=true means cost is not required (also allows 0/undefined without "missing").
   */
  isIgnoredVariant?: (variantId: number) => boolean;
}) {
  const { shop, days, adSpend, orders, costProfile, cogsService, shopifyGET, isIgnoredVariant } = params;

  const count = orders.length;

  // -------------------------
  // Gift card CFO handling (summary)
  // -------------------------
  let giftCardOrdersCount = 0;
  let giftCardNetSalesExcluded = 0;

  // Operational totals exclude gift-card-only orders
  const grossSales = orders.reduce((sum: number, o: any) => {
    return sum + (orderIsGiftCardOnly(o) ? 0 : Number(o.total_price || 0));
  }, 0);

  const refunds = orders.reduce((sum: number, o: any) => {
    return sum + (orderIsGiftCardOnly(o) ? 0 : extractRefundsFromOrder(o));
  }, 0);

  // RAW totals for fees (fees are real cash costs, also for gift cards)
  const rawGrossSalesTotal = orders.reduce((sum: number, o: any) => sum + Number(o.total_price || 0), 0);
  const rawRefundsTotal = orders.reduce((sum: number, o: any) => sum + extractRefundsFromOrder(o), 0);
  const rawNetAfterRefundsTotal = rawGrossSalesTotal - rawRefundsTotal;

  for (const o of orders) {
    if (orderIsGiftCardOnly(o)) {
      giftCardOrdersCount += 1;
      const rawNet = Number(o.total_price || 0) - extractRefundsFromOrder(o);
      giftCardNetSalesExcluded += rawNet;
    }
  }

  const netAfterRefunds = grossSales - refunds;

  // Shipping revenue (for transparency) — still show what customers paid
  const shippingRevenue = orders.reduce((sum: number, o: any) => sum + extractShippingRevenueFromOrder(o), 0);

  const includeShippingCost = Boolean(costProfile.flags?.includeShippingCost ?? true);
  const shippingCostPerOrder = includeShippingCost ? Number(costProfile.shipping.costPerOrder || 0) : 0;

  // ✅ For shipping COST allocation we exclude gift-card-only orders (no fulfillment).
  const nonGiftCardOrderCount = orders.reduce((n: number, o: any) => n + (orderIsGiftCardOnly(o) ? 0 : 1), 0);
  const shippingCost = shippingCostPerOrder * nonGiftCardOrderCount;

  const shippingImpact = shippingRevenue - shippingCost;

  // --- COGS ---
  const allLineItems: VariantQty[] = [];
  for (const o of orders) allLineItems.push(...extractVariantQtyFromOrder(o));

  const variantIds = allLineItems.map((x) => x.variantId).filter((x) => Number.isFinite(x) && x > 0);

  const unitCostByVariant =
    params.unitCostByVariant ?? (await cogsService.computeUnitCostsByVariant(shopifyGET, variantIds));

  // Compute Σ(qty * unitCost). Unknown costs contribute 0 here.
  let cogs = 0;
  for (const li of allLineItems) {
    const unitCost = unitCostByVariant.get(li.variantId);
    if (unitCost !== undefined) cogs += li.qty * unitCost;
  }

  // ✅ Missing COGS count (per order):
  // - orders with unmapped variants
  // - OR orders with at least one non-ignored variant where unit cost is missing by governance
  // Gift-card-only orders are naturally excluded (no relevant line items).
  let missingCogsCount = 0;

  for (const o of orders) {
    // skip gift-card-only orders (no COGS required)
    if (orderIsGiftCardOnly(o)) continue;

    const facts = getOrderLineItemFacts(o);

    // unmapped variants => missing COGS
    if (facts.hasUnmappedVariants) {
      missingCogsCount += 1;
      continue;
    }

    const vqs = facts.extractedVariantQty;

    let hasMissing = false;
    for (const li of vqs) {
      const unitCost = unitCostByVariant.get(li.variantId);

      if (isMissingUnitCost({ unitCost, variantId: li.variantId, isIgnoredVariant })) {
        hasMissing = true;
        break;
      }
    }

    if (hasMissing) missingCogsCount += 1;
  }

  const missingCogsRatePct = count > 0 ? round2((missingCogsCount / count) * 100) : 0;

  const MISSING_COGS_OK_PCT = 3; // align with healthConfig.missingCogsRatePct.ok
  const isCogsReliable = missingCogsRatePct <= MISSING_COGS_OK_PCT;

  const feePercent = Number(costProfile.payment.feePercent || 0);
  const feeFixed = Number(costProfile.payment.feeFixed || 0);

  // ✅ Fees are real cash costs => always use RAW net total (includes gift-card-only sales)
  const paymentFees = calcPaymentFees({
    netAfterRefunds: rawNetAfterRefundsTotal,
    orderCount: count,
    feePercent,
    feeFixed,
  });

  // Operational contribution margin excludes gift card sales, but subtracts real fees
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

  const profitAfterFees = contributionMargin;
  const profitAfterShipping = profitAfterFees - shippingCost;
  const profitMarginAfterShippingPct = netAfterRefunds > 0 ? (profitAfterShipping / netAfterRefunds) * 100 : 0;

  const profitAfterAds = round2(profitAfterFees - adSpend);
  const profitAfterAdsAndShipping = round2(profitAfterShipping - adSpend);

  // ✅ FIXED COSTS (derived from SSOT cost profile)
  const fixedCostsMonthlyTotal = round2(Number(costProfile.derived?.fixedCostsMonthlyTotal ?? 0));
  const daysInMonth = Math.max(1, Number(costProfile.fixedCosts?.daysInMonth ?? 30));
  const fixedCostsAllocatedInPeriod = round2(fixedCostsMonthlyTotal * (Math.max(1, Number(days)) / daysInMonth));

  const fixedAllocMode = costProfile.fixedCosts?.allocationMode ?? "PER_ORDER";
  const fixedCostPerOrder =
    fixedAllocMode === "PER_ORDER" && count > 0 ? round2(fixedCostsAllocatedInPeriod / count) : 0;

  const profitAfterFixedCosts = round2(profitAfterAdsAndShipping - fixedCostsAllocatedInPeriod);
  const profitMarginAfterFixedCostsPct =
    netAfterRefunds > 0 ? round2((profitAfterFixedCosts / netAfterRefunds) * 100) : 0;

  const fixedCostRatioPct = netAfterRefunds > 0 ? round2((fixedCostsAllocatedInPeriod / netAfterRefunds) * 100) : 0;

  const operatingProfit = profitAfterFixedCosts;
  const operatingMarginPct = profitMarginAfterFixedCostsPct;

  const variableCostsInPeriod = round2(cogs + paymentFees + shippingCost);
  const requiredNetSalesForBreakEvenWithFixedCosts = round2(variableCostsInPeriod + fixedCostsAllocatedInPeriod);

  const breakEvenAdSpendWithFixedCosts = round2(Math.max(0, profitAfterShipping - fixedCostsAllocatedInPeriod));
  const breakEvenRoasWithFixedCosts =
    adSpend > 0 && breakEvenAdSpendWithFixedCosts > 0 ? round2(netAfterRefunds / breakEvenAdSpendWithFixedCosts) : null;

  const grossProfit = netAfterRefunds - cogs;
  const grossMarginPct = netAfterRefunds > 0 ? (grossProfit / netAfterRefunds) * 100 : 0;

  const profitMarginAfterFeesPct = netAfterRefunds > 0 ? round2((profitAfterFees / netAfterRefunds) * 100) : 0;
  const profitMarginAfterAdsPct = netAfterRefunds > 0 ? round2((profitAfterAds / netAfterRefunds) * 100) : 0;
  const profitMarginAfterAdsAndShippingPct =
    netAfterRefunds > 0 ? round2((profitAfterAdsAndShipping / netAfterRefunds) * 100) : 0;

  const targetProfitPct = 10;
  const adSpendForTarget = round2(profitAfterFees - (targetProfitPct / 100) * netAfterRefunds);
  const targetRoasFor10PctProfit = adSpendForTarget > 0 ? round2(netAfterRefunds / adSpendForTarget) : null;

  const adSpendForTargetAfterShipping = round2(profitAfterShipping - (targetProfitPct / 100) * netAfterRefunds);
  const targetRoasFor10PctProfitAfterShipping =
    adSpendForTargetAfterShipping > 0 ? round2(netAfterRefunds / adSpendForTargetAfterShipping) : null;

  return {
    shop,
    days,
    count,

    // ✅ gift card transparency (CFO)
    giftCardOrdersCount,
    giftCardNetSalesExcluded: round2(giftCardNetSalesExcluded),

    missingCogsCount,
    missingCogsRatePct,
    isCogsReliable,

    grossSales: round2(grossSales),
    refunds: round2(refunds),
    netAfterRefunds: round2(netAfterRefunds),

    shippingRevenue: round2(shippingRevenue),
    shippingCost: round2(shippingCost),
    shippingImpact: round2(shippingImpact),

    cogs: round2(cogs),
    grossProfit: round2(grossProfit),
    grossMarginPct: round2(grossMarginPct),

    paymentFees: round2(paymentFees),

    contributionMargin: round2(contributionMargin),
    contributionMarginPct: round2(contributionMarginPct),

    adSpendBreakEven: round2(contributionMargin),
    breakEvenRoas: breakEvenRoas === null ? null : round2(breakEvenRoas),

    profitAfterShipping: round2(profitAfterShipping),
    profitMarginAfterShippingPct: round2(profitMarginAfterShippingPct),

    profitAfterFees: round2(profitAfterFees),
    profitMarginAfterFeesPct: round2(profitMarginAfterFeesPct),

    adSpend: round2(adSpend),
    profitAfterAds,
    profitMarginAfterAdsPct,

    profitAfterAdsAndShipping: round2(profitAfterAdsAndShipping),
    profitMarginAfterAdsAndShippingPct,

    fixedCostsMonthlyTotal,
    fixedCostsAllocatedInPeriod,
    fixedCostPerOrder,

    operatingProfit,
    operatingMarginPct,
    fixedCostRatioPct,

    profitAfterFixedCosts,
    profitMarginAfterFixedCostsPct,

    requiredNetSalesForBreakEvenWithFixedCosts,
    breakEvenAdSpendWithFixedCosts,
    breakEvenRoasWithFixedCosts,

    targetRoasFor10PctProfit,
    targetRoasFor10PctProfitAfterShipping,
  };
}
