// src/domain/profit/ordersSummary.ts
import { round2 } from "../../utils/money";
import { calcContributionMargin, calcContributionMarginPct, calcBreakEvenRoas } from "../metrics";
import { extractRefundsFromOrder } from "./refunds";
import { extractShippingRevenueFromOrder } from "./shipping";
import { calcPaymentFees } from "./fees";
import { extractVariantQtyFromOrder, getOrderLineItemFacts, orderHasGiftCardLineItems } from "./variants";
import { isMissingUnitCost } from "./cogsGovernance";
export async function buildOrdersSummary(params) {
    const { shop, days, adSpend, orders, costProfile, cogsService, shopifyGET } = params;
    const excludeGiftCards = Boolean(costProfile.flags?.excludeGiftCards ?? true);
    // ✅ Per requirements:
    // - count includes ALL orders
    // - gift-card-only orders excluded from KPI sums (net/cogs/fees/cm/etc)
    const includedOrders = [];
    const excludedGiftCardOrders = [];
    for (const o of orders) {
        const facts = getOrderLineItemFacts(o);
        const hasGiftCard = orderHasGiftCardLineItems(o);
        // gift-card-only per spec: relevantLineItemsCount === 0 && rawLineItemsCount > 0
        const isGiftCardOnly = hasGiftCard && facts.relevantLineItemsCount === 0 && facts.rawLineItemsCount > 0;
        if (excludeGiftCards && isGiftCardOnly)
            excludedGiftCardOrders.push(o);
        else
            includedOrders.push(o);
    }
    const giftCardOrdersCount = excludedGiftCardOrders.length;
    // ✅ count = ALL orders (requirement)
    const count = orders.length;
    // ✅ includedCount = KPI denominator (do not distort rates/per-order costs)
    const includedCount = includedOrders.length;
    // Transparent excluded net sales (gross - refunds) for gift-card-only orders
    const giftCardNetSalesExcluded = excludedGiftCardOrders.reduce((sum, o) => {
        const gross = Number(o.total_price || 0);
        const ref = extractRefundsFromOrder(o);
        return sum + (gross - ref);
    }, 0);
    // --- KPI totals (INCLUDED only)
    const grossSales = includedOrders.reduce((sum, o) => sum + Number(o.total_price || 0), 0);
    const refunds = includedOrders.reduce((sum, o) => sum + extractRefundsFromOrder(o), 0);
    const netAfterRefunds = grossSales - refunds;
    // Shipping revenue (transparency KPI) – still for included orders only (avoid gift-card distortion)
    const shippingRevenue = includedOrders.reduce((sum, o) => sum + extractShippingRevenueFromOrder(o), 0);
    const includeShippingCost = Boolean(costProfile.flags?.includeShippingCost ?? true);
    const shippingCostPerOrder = includeShippingCost ? Number(costProfile.shipping.costPerOrder || 0) : 0;
    // ✅ shipping cost based on INCLUDED count to avoid gift-card-only distortion
    const shippingCost = shippingCostPerOrder * includedCount;
    const shippingImpact = shippingRevenue - shippingCost;
    // --- COGS (included orders only)
    const allLineItems = [];
    for (const o of includedOrders)
        allLineItems.push(...extractVariantQtyFromOrder(o));
    const variantIds = allLineItems.map((x) => x.variantId).filter((x) => Number.isFinite(x) && x > 0);
    const unitCostByVariant = params.unitCostByVariant ??
        (variantIds.length > 0
            ? await cogsService.computeUnitCostsByVariant(shopifyGET, variantIds)
            : new Map());
    // ✅ SSOT default governance: ignoreCogs from overrides store via CogsService
    const isIgnoredVariant = params.isIgnoredVariant ??
        ((variantId) => {
            return cogsService.isIgnoredVariantSync(variantId);
        });
    // Compute Σ(qty * unitCost). Unknown costs contribute 0 here.
    let cogs = 0;
    for (const li of allLineItems) {
        const unitCost = unitCostByVariant.get(li.variantId);
        if (unitCost !== undefined)
            cogs += li.qty * unitCost;
    }
    // ✅ Missing COGS count (per INCLUDED order only)
    let missingCogsCount = 0;
    for (const o of includedOrders) {
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
        if (hasMissing)
            missingCogsCount += 1;
    }
    // ✅ Missing-COGS rate must ignore gift-card-only orders (denominator = includedCount)
    const missingCogsRatePct = includedCount > 0 ? round2((missingCogsCount / includedCount) * 100) : 0;
    const MISSING_COGS_OK_PCT = 3; // align with healthConfig.missingCogsRatePct.ok
    const isCogsReliable = missingCogsRatePct <= MISSING_COGS_OK_PCT;
    const feePercent = Number(costProfile.payment.feePercent || 0);
    const feeFixed = Number(costProfile.payment.feeFixed || 0);
    // ✅ fees fixed-part should scale with INCLUDED order count (not total)
    const paymentFees = includedCount <= 0
        ? 0
        : calcPaymentFees({
            netAfterRefunds,
            orderCount: includedCount,
            feePercent,
            feeFixed,
        });
    const contributionMargin = includedCount <= 0
        ? 0
        : calcContributionMargin({
            netAfterRefunds,
            cogs,
            paymentFees,
        });
    const contributionMarginPct = includedCount <= 0
        ? 0
        : calcContributionMarginPct({
            netAfterRefunds,
            contributionMargin,
        });
    const breakEvenRoas = includedCount <= 0
        ? null
        : calcBreakEvenRoas({
            netAfterRefunds,
            contributionMargin,
        });
    const profitAfterFees = contributionMargin;
    const profitAfterShipping = includedCount <= 0 ? 0 : profitAfterFees - shippingCost;
    const profitMarginAfterShippingPct = netAfterRefunds > 0 ? (profitAfterShipping / netAfterRefunds) * 100 : 0;
    const profitAfterAds = round2(profitAfterFees - adSpend);
    const profitAfterAdsAndShipping = round2(profitAfterShipping - adSpend);
    // ✅ FIXED COSTS (derived from SSOT cost profile)
    const fixedCostsMonthlyTotal = round2(Number(costProfile.derived?.fixedCostsMonthlyTotal ?? 0));
    const daysInMonth = Math.max(1, Number(costProfile.fixedCosts?.daysInMonth ?? 30));
    const fixedCostsAllocatedInPeriod = round2(fixedCostsMonthlyTotal * (Math.max(1, Number(days)) / daysInMonth));
    const fixedAllocMode = costProfile.fixedCosts?.allocationMode ?? "PER_ORDER";
    // ✅ PER_ORDER must use INCLUDED orders to avoid dilution by excluded gift-card-only orders
    const fixedCostPerOrder = fixedAllocMode === "PER_ORDER" && includedCount > 0 ? round2(fixedCostsAllocatedInPeriod / includedCount) : 0;
    const profitAfterFixedCosts = round2(profitAfterAdsAndShipping - fixedCostsAllocatedInPeriod);
    const profitMarginAfterFixedCostsPct = netAfterRefunds > 0 ? round2((profitAfterFixedCosts / netAfterRefunds) * 100) : 0;
    const fixedCostRatioPct = netAfterRefunds > 0 ? round2((fixedCostsAllocatedInPeriod / netAfterRefunds) * 100) : 0;
    const operatingProfit = profitAfterFixedCosts;
    const operatingMarginPct = profitMarginAfterFixedCostsPct;
    const variableCostsInPeriod = round2(cogs + paymentFees + shippingCost);
    const requiredNetSalesForBreakEvenWithFixedCosts = round2(variableCostsInPeriod + fixedCostsAllocatedInPeriod);
    const breakEvenAdSpendWithFixedCosts = round2(Math.max(0, profitAfterShipping - fixedCostsAllocatedInPeriod));
    const breakEvenRoasWithFixedCosts = adSpend > 0 && breakEvenAdSpendWithFixedCosts > 0 ? round2(netAfterRefunds / breakEvenAdSpendWithFixedCosts) : null;
    const grossProfit = netAfterRefunds - cogs;
    const grossMarginPct = netAfterRefunds > 0 ? (grossProfit / netAfterRefunds) * 100 : 0;
    const profitMarginAfterFeesPct = netAfterRefunds > 0 ? round2((profitAfterFees / netAfterRefunds) * 100) : 0;
    const profitMarginAfterAdsPct = netAfterRefunds > 0 ? round2((profitAfterAds / netAfterRefunds) * 100) : 0;
    const profitMarginAfterAdsAndShippingPct = netAfterRefunds > 0 ? round2((profitAfterAdsAndShipping / netAfterRefunds) * 100) : 0;
    const targetProfitPct = 10;
    const adSpendForTarget = round2(profitAfterFees - (targetProfitPct / 100) * netAfterRefunds);
    const targetRoasFor10PctProfit = adSpendForTarget > 0 ? round2(netAfterRefunds / adSpendForTarget) : null;
    const adSpendForTargetAfterShipping = round2(profitAfterShipping - (targetProfitPct / 100) * netAfterRefunds);
    const targetRoasFor10PctProfitAfterShipping = adSpendForTargetAfterShipping > 0 ? round2(netAfterRefunds / adSpendForTargetAfterShipping) : null;
    return {
        shop,
        days,
        // ✅ count includes ALL orders (requirement)
        count,
        // ✅ new transparency fields
        giftCardOrdersCount,
        giftCardNetSalesExcluded: round2(giftCardNetSalesExcluded),
        missingCogsCount,
        missingCogsRatePct,
        isCogsReliable,
        // KPI sums (included only)
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
