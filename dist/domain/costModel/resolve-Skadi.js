// src/domain/costModel/resolve.ts
import { toNumber } from "../../utils/money";
import { DEFAULT_COST_PROFILE } from "./defaults";
import { clampNonNegative, clampPositive, isAdMode, isFixedAllocMode } from "./resolve.utils";
import { buildFingerprint } from "./fingerprint";
import { sanitizeMonthlyItem, computeFixedCostsMonthlyTotal } from "./fixedCosts.monthlyItems";
export { costOverridesFromAny } from "./overrides.parse";
/**
 * Base profile derived from ENV/app config only.
 */
export function resolveCostProfileFromConfig(config) {
    const feePercent = toNumber(config.PAYMENT_FEE_PERCENT, DEFAULT_COST_PROFILE.payment.feePercent);
    const feeFixed = toNumber(config.PAYMENT_FEE_FIXED, DEFAULT_COST_PROFILE.payment.feeFixed);
    const shippingCostPerOrder = toNumber(config.DEFAULT_SHIPPING_COST, DEFAULT_COST_PROFILE.shipping.costPerOrder);
    const daysInMonth = toNumber(config.FIXED_COSTS_DAYS_IN_MONTH, DEFAULT_COST_PROFILE.fixedCosts.daysInMonth);
    // base has no monthly items by default (persisted overrides will add)
    const baseFixedItems = DEFAULT_COST_PROFILE.fixedCosts.monthlyItems;
    const fixedCostsMonthlyTotal = computeFixedCostsMonthlyTotal(baseFixedItems);
    return {
        ...DEFAULT_COST_PROFILE,
        payment: {
            feePercent: clampNonNegative(feePercent, DEFAULT_COST_PROFILE.payment.feePercent),
            feeFixed: clampNonNegative(feeFixed, DEFAULT_COST_PROFILE.payment.feeFixed),
        },
        shipping: {
            costPerOrder: clampNonNegative(shippingCostPerOrder, DEFAULT_COST_PROFILE.shipping.costPerOrder),
        },
        fixedCosts: {
            allocationMode: DEFAULT_COST_PROFILE.fixedCosts.allocationMode,
            daysInMonth: clampPositive(daysInMonth, DEFAULT_COST_PROFILE.fixedCosts.daysInMonth),
            monthlyItems: baseFixedItems,
        },
        derived: {
            fixedCostsMonthlyTotal,
        },
        flags: {
            includeShippingCost: DEFAULT_COST_PROFILE.flags.includeShippingCost,
            excludeGiftCards: DEFAULT_COST_PROFILE.flags.excludeGiftCards,
        },
    };
}
/**
 * ✅ Cost Model Engine (SSOT)
 */
export function resolveCostProfile(params) {
    const base = resolveCostProfileFromConfig(params.config);
    const o = params.overrides;
    const feePercentRaw = o?.payment?.feePercent;
    const feeFixedRaw = o?.payment?.feeFixed;
    const shipRaw = o?.shipping?.costPerOrder;
    const includeShippingCostRaw = o?.flags?.includeShippingCost;
    // ✅ NEW
    const excludeGiftCardsRaw = o?.flags?.excludeGiftCards;
    const modeRaw = o?.ads?.allocationMode;
    const fixedModeRaw = o?.fixedCosts?.allocationMode;
    const fixedDaysRaw = o?.fixedCosts?.daysInMonth;
    const fixedItemsRaw = o?.fixedCosts?.monthlyItems;
    const fixedItems = Array.isArray(fixedItemsRaw) && fixedItemsRaw.length > 0
        ? fixedItemsRaw.map(sanitizeMonthlyItem).filter((x) => x !== null)
        : base.fixedCosts.monthlyItems;
    const fixedCostsMonthlyTotal = computeFixedCostsMonthlyTotal(fixedItems);
    const resolved = {
        payment: {
            feePercent: feePercentRaw === undefined
                ? base.payment.feePercent
                : clampNonNegative(Number(feePercentRaw), base.payment.feePercent),
            feeFixed: feeFixedRaw === undefined ? base.payment.feeFixed : clampNonNegative(Number(feeFixedRaw), base.payment.feeFixed),
        },
        shipping: {
            costPerOrder: shipRaw === undefined ? base.shipping.costPerOrder : clampNonNegative(Number(shipRaw), base.shipping.costPerOrder),
        },
        ads: {
            allocationMode: isAdMode(modeRaw) ? modeRaw : base.ads.allocationMode,
        },
        fixedCosts: {
            allocationMode: isFixedAllocMode(fixedModeRaw) ? fixedModeRaw : base.fixedCosts.allocationMode,
            daysInMonth: fixedDaysRaw === undefined
                ? base.fixedCosts.daysInMonth
                : clampPositive(Number(fixedDaysRaw), base.fixedCosts.daysInMonth),
            monthlyItems: fixedItems,
        },
        derived: {
            fixedCostsMonthlyTotal,
        },
        flags: {
            includeShippingCost: includeShippingCostRaw === undefined ? base.flags.includeShippingCost : Boolean(includeShippingCostRaw),
            // ✅ NEW
            excludeGiftCards: excludeGiftCardsRaw === undefined ? base.flags.excludeGiftCards : Boolean(excludeGiftCardsRaw),
        },
    };
    const metaPayload = {
        resolved,
        resolvedFrom: {
            config: params.config,
            overrides: params.overrides ?? undefined,
        },
    };
    const fingerprint = buildFingerprint(metaPayload);
    return {
        ...resolved,
        meta: {
            fingerprint,
            resolvedFrom: metaPayload.resolvedFrom,
        },
    };
}
