// src/domain/profit/ordersSummary.ts
import { round2 } from "../../utils/money.js";
import type { CogsService, VariantQty } from "../cogs.js";
import { calcBreakEvenRoas, calcContributionMarginPct } from "../metrics.js";
import { extractRefundsFromOrder } from "./refunds.js";
import { extractVariantQtyFromOrder, getOrderLineItemFacts, orderIsGiftCardOnly } from "./variants.js";
import { isMissingUnitCost } from "./cogsGovernance.js";

// ✅ SSOT
import { calculateOrderProfit } from "./orderProfit.js";

// ✅ Cost Model
import type { CostProfile } from "../costModel/types.js";

function sum(nums: Array<number | undefined | null>) {
  let s = 0;
  for (const n of nums) s += Number(n ?? 0);
  return s;
}

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
  // Gift card CFO handling (diagnostics/transparency)
  // -------------------------
  let giftCardOrdersCount = 0;
  let giftCardNetSalesExcluded = 0;

  for (const o of orders) {
    if (orderIsGiftCardOnly(o)) {
      giftCardOrdersCount += 1;
      const rawNet = Number(o.total_price || 0) - extractRefundsFromOrder(o);
      giftCardNetSalesExcluded += rawNet;
    }
  }

  // -------------------------
  // ✅ SSOT per-order profits
  // -------------------------
  const orderProfits = await Promise.all(
    orders.map((o) =>
      calculateOrderProfit({
        order: o,
        costProfile,
        cogsService,
        shopifyGET,
        unitCostByVariant: params.unitCostByVariant,
        isIgnoredVariant,
      } as any)
    )
  );

  // Hard SSOT invariant: downstream MUST NOT reconstruct derived profits.
  // If you ever see undefined here, your SSOT engine regressed.
  for (const r of orderProfits) {
    if (r.profitAfterShipping === undefined) throw new Error("SSOT breach: profitAfterShipping undefined");
    if (r.profitAfterFees === undefined) throw new Error("SSOT breach: profitAfterFees undefined");
  }

  // -------------------------
  // Totals are ONLY sums of SSOT fields
  // -------------------------
  const grossSales = sum(orderProfits.map((r: any) => r.grossSales));
  const refunds = sum(orderProfits.map((r: any) => r.refunds));
  const netAfterRefunds = sum(orderProfits.map((r: any) => r.netAfterRefunds));

  const shippingRevenue = sum(orderProfits.map((r: any) => r.shippingRevenue));
  const shippingCost = sum(orderProfits.map((r: any) => r.shippingCost));
  const shippingImpact = sum(orderProfits.map((r: any) => r.shippingImpact));

  const cogs = sum(orderProfits.map((r: any) => r.cogs));
  const paymentFees = sum(orderProfits.map((r: any) => r.paymentFees));

  const contributionMargin = sum(orderProfits.map((r: any) => r.contributionMargin));
  const profitAfterFees = sum(orderProfits.map((r: any) => r.profitAfterFees));
  const profitAfterShipping = sum(orderProfits.map((r: any) => r.profitAfterShipping));

  const contributionMarginPct = calcContributionMarginPct({
    netAfterRefunds,
    contributionMargin,
  });

  const breakEvenRoas = calcBreakEvenRoas({
    netAfterRefunds,
    contributionMargin,
  });

  const profitMarginAfterShippingPct = netAfterRefunds > 0 ? (profitAfterShipping / netAfterRefunds) * 100 : 0;

  // Ads (still summary-level; SSOT has per-order allocation optionally, but here it's period total)
  const profitAfterAds = round2(profitAfterFees - adSpend);
  const profitAfterAdsAndShipping = round2(profitAfterShipping - adSpend);

  const profitMarginAfterFeesPct = netAfterRefunds > 0 ? round2((profitAfterFees / netAfterRefunds) * 100) : 0;
  const profitMarginAfterAdsPct = netAfterRefunds > 0 ? round2((profitAfterAds / netAfterRefunds) * 100) : 0;
  const profitMarginAfterAdsAndShippingPct =
    netAfterRefunds > 0 ? round2((profitAfterAdsAndShipping / netAfterRefunds) * 100) : 0;

  // -------------------------
  // Missing COGS diagnostics (kept, but MUST NOT affect SSOT profit)
  // -------------------------
  const allLineItems: VariantQty[] = [];
  for (const o of orders) allLineItems.push(...extractVariantQtyFromOrder(o));

  const variantIds = allLineItems.map((x) => x.variantId).filter((x) => Number.isFinite(x) && x > 0);

  const unitCostByVariant =
    params.unitCostByVariant ?? (await cogsService.computeUnitCostsByVariant(shopifyGET, variantIds));

  let missingCogsCount = 0;

  for (const o of orders) {
    if (orderIsGiftCardOnly(o)) continue;

    const facts = getOrderLineItemFacts(o);

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

  // -------------------------
  // Fixed costs (kept as you had it; summary-level allocation)
  // -------------------------
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