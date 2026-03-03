// src/domain/profit/orderProfit.ts
import { round2 } from "../../utils/money";
import { calcContributionMargin, calcContributionMarginPct, calcBreakEvenRoas } from "../metrics";
import { extractRefundsFromOrder } from "./refunds";
import { extractShippingRevenueFromOrder } from "./shipping";
import { getOrderLineItemFacts, orderHasGiftCardLineItems } from "./variants";
import { isMissingUnitCost } from "./cogsGovernance";
export async function calculateOrderProfit(params) {
    const { order, costProfile, cogsService, shopifyGET } = params;
    const orderId = String(order?.id ?? "");
    const grossSales = Number(order?.total_price || 0);
    const refunds = extractRefundsFromOrder(order);
    const rawNetAfterRefunds = grossSales - refunds;
    // --- Line items SSOT
    const facts = getOrderLineItemFacts(order);
    const variantQty = facts.extractedVariantQty;
    // ✅ Gift card detection SSOT
    const hasGiftCard = orderHasGiftCardLineItems(order);
    // ✅ Gift-card-only definition (per spec):
    // relevantLineItemsCount === 0 && rawLineItemsCount > 0
    const excludeGiftCards = Boolean(costProfile.flags?.excludeGiftCards ?? true);
    const isGiftCardOnlyOrder = hasGiftCard && facts.relevantLineItemsCount === 0 && facts.rawLineItemsCount > 0;
    const isExcludedFromProfit = excludeGiftCards && isGiftCardOnlyOrder;
    let cogs = 0;
    let hasMissingCogs = false;
    const missingVariantIds = [];
    if (facts.hasUnmappedVariants) {
        hasMissingCogs = true;
    }
    // ✅ SSOT default governance: ignoreCogs from overrides store via CogsService
    const isIgnoredVariant = params.isIgnoredVariant ??
        ((variantId) => {
            return cogsService.isIgnoredVariantSync(variantId);
        });
    const unitCostByVariant = params.unitCostByVariant ??
        (variantQty.length > 0
            ? await cogsService.computeUnitCostsByVariant(shopifyGET, variantQty.map((x) => x.variantId))
            : undefined);
    if (variantQty.length > 0) {
        if (unitCostByVariant) {
            for (const li of variantQty) {
                const unitCost = unitCostByVariant.get(li.variantId);
                if (unitCost !== undefined) {
                    cogs += li.qty * unitCost;
                }
                if (isMissingUnitCost({ unitCost, variantId: li.variantId, isIgnoredVariant })) {
                    hasMissingCogs = true;
                    missingVariantIds.push(li.variantId);
                }
            }
        }
        else {
            cogs = await cogsService.computeCogsForVariants(shopifyGET, variantQty);
        }
    }
    // Shipping revenue extracted (transparency) ✅ MUST remain even if excluded
    const shippingRevenue = extractShippingRevenueFromOrder(order);
    // Shipping cost from cost model (excluded => 0 to avoid KPI distortion)
    const includeShippingCost = Boolean(costProfile.flags?.includeShippingCost ?? true);
    const shippingCostPerOrder = includeShippingCost ? Number(costProfile.shipping.costPerOrder || 0) : 0;
    const netAfterRefunds = isExcludedFromProfit ? 0 : rawNetAfterRefunds;
    const feePercent = Number(costProfile.payment.feePercent || 0);
    const feeFixed = Number(costProfile.payment.feeFixed || 0);
    // If excluded => fees must be 0 (avoid inflating fee rate / health)
    const paymentFees = isExcludedFromProfit ? 0 : netAfterRefunds * feePercent + feeFixed;
    const contributionMargin = isExcludedFromProfit
        ? 0
        : calcContributionMargin({ netAfterRefunds, cogs, paymentFees });
    const contributionMarginPct = isExcludedFromProfit
        ? 0
        : calcContributionMarginPct({ netAfterRefunds, contributionMargin });
    // ✅ per requirement: breakEvenRoas must be 0 when excluded
    const breakEvenRoas = isExcludedFromProfit ? 0 : calcBreakEvenRoas({ netAfterRefunds, contributionMargin });
    // If excluded => shipping cost must not distort KPIs, but shippingRevenue stays for transparency
    const shippingCost = isExcludedFromProfit ? 0 : shippingCostPerOrder;
    const shippingImpact = shippingRevenue - shippingCost;
    // Per requirement: excluded => profit KPIs zeroed
    const profitAfterFees = isExcludedFromProfit ? 0 : contributionMargin;
    const profitAfterShipping = isExcludedFromProfit ? 0 : profitAfterFees - shippingCost;
    const profitMarginAfterShippingPct = netAfterRefunds > 0 ? (profitAfterShipping / netAfterRefunds) * 100 : 0;
    const marginAfterFeesPct = contributionMarginPct;
    return {
        orderId,
        // raw values remain visible
        grossSales: round2(grossSales),
        refunds: round2(refunds),
        // KPI net (excluded => 0)
        netAfterRefunds: round2(netAfterRefunds),
        // KPI costs (excluded => 0)
        cogs: round2(isExcludedFromProfit ? 0 : cogs),
        paymentFees: round2(paymentFees),
        contributionMargin: round2(contributionMargin),
        contributionMarginPct: round2(contributionMarginPct),
        // Missing COGS governance:
        // - Gift cards never count as missing by extraction SSOT.
        // - Gift-card-only excluded orders must never trigger missing caps.
        hasMissingCogs: isExcludedFromProfit ? false : hasMissingCogs,
        missingCogsVariantIds: isExcludedFromProfit ? [] : Array.from(new Set(missingVariantIds)),
        // ✅ shippingRevenue stays even if excluded (requirement)
        shippingRevenue: round2(shippingRevenue),
        shippingCost: round2(shippingCost),
        shippingImpact: round2(shippingImpact),
        profitAfterShipping: round2(profitAfterShipping),
        profitMarginAfterShippingPct: round2(profitMarginAfterShippingPct),
        // compatibility
        adSpendBreakEven: round2(contributionMargin),
        breakEvenRoas: breakEvenRoas === null ? null : round2(breakEvenRoas),
        profitAfterFees: round2(profitAfterFees),
        marginAfterFeesPct: round2(marginAfterFeesPct),
        hasGiftCard,
        isExcludedFromProfit,
    };
}
/**
 * ✅ SSOT helper (pure): apply allocated ad spend to an existing profit row.
 * Deterministic + respects gift-card exclusion.
 */
export function applyAdsToOrderProfitRow(row, allocatedAdSpend) {
    // ✅ If excluded: keep all KPI profits at 0 and do not allocate ads
    if (row.isExcludedFromProfit) {
        const net = Number(row.netAfterRefunds ?? 0);
        const profitAfterAds = 0;
        const profitAfterAdsAndShipping = 0;
        return {
            ...row,
            allocatedAdSpend: 0,
            profitAfterAds,
            profitAfterAdsAndShipping,
            profitMarginAfterAdsPct: net > 0 ? round2((profitAfterAds / net) * 100) : 0,
            profitMarginAfterAdsAndShippingPct: net > 0 ? round2((profitAfterAdsAndShipping / net) * 100) : 0,
        };
    }
    const a = round2(Number(allocatedAdSpend ?? 0));
    const profitAfterAds = round2(Number(row.profitAfterFees ?? row.contributionMargin ?? 0) - a);
    const profitAfterAdsAndShipping = round2(Number(row.profitAfterShipping ?? 0) - a);
    const net = Number(row.netAfterRefunds ?? 0);
    const profitMarginAfterAdsPct = net > 0 ? round2((profitAfterAds / net) * 100) : 0;
    const profitMarginAfterAdsAndShippingPct = net > 0 ? round2((profitAfterAdsAndShipping / net) * 100) : 0;
    return {
        ...row,
        allocatedAdSpend: a,
        profitAfterAds,
        profitAfterAdsAndShipping,
        profitMarginAfterAdsPct,
        profitMarginAfterAdsAndShippingPct,
    };
}
/**
 * ✅ SSOT helper (pure): apply allocated fixed costs to an existing row (after ads+shipping).
 * operatingProfit is SSOT-alias for profitAfterFixedCosts.
 * Deterministic + respects gift-card exclusion.
 */
export function applyFixedCostsToOrderProfitRow(row, fixedCostAllocated) {
    // ✅ If excluded: keep all KPI profits at 0 and do not allocate fixed costs
    if (row.isExcludedFromProfit) {
        const net = Number(row.netAfterRefunds ?? 0);
        const profitAfterFixedCosts = 0;
        const profitMarginAfterFixedCostsPct = net > 0 ? round2((profitAfterFixedCosts / net) * 100) : 0;
        return {
            ...row,
            fixedCostAllocated: 0,
            profitAfterFixedCosts,
            profitMarginAfterFixedCostsPct,
            operatingProfit: profitAfterFixedCosts,
            operatingMarginPct: profitMarginAfterFixedCostsPct,
        };
    }
    const f = round2(Number(fixedCostAllocated ?? 0));
    const profitAfterFixedCosts = round2(Number(row.profitAfterAdsAndShipping ?? 0) - f);
    const net = Number(row.netAfterRefunds ?? 0);
    const profitMarginAfterFixedCostsPct = net > 0 ? round2((profitAfterFixedCosts / net) * 100) : 0;
    const operatingProfit = profitAfterFixedCosts;
    const operatingMarginPct = profitMarginAfterFixedCostsPct;
    return {
        ...row,
        fixedCostAllocated: f,
        profitAfterFixedCosts,
        profitMarginAfterFixedCostsPct,
        operatingProfit,
        operatingMarginPct,
    };
}
