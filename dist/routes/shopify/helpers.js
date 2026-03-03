// src/routes/shopify/helpers.ts
import { round2, toNumber } from "../../utils/money.js";
import { extractVariantQtyFromOrder } from "../../domain/profit/variants.js";
import { costOverridesFromAny } from "../../domain/costModel/resolve.js";
import { isValidShopDomain } from "../../storage/shopsStore.js";
export function parseShop(query, fallback) {
    const shopRaw = query?.shop;
    const shop = shopRaw === undefined || shopRaw === null ? (fallback ?? "") : String(shopRaw);
    const s = shop.trim().toLowerCase();
    if (!s)
        return fallback ?? "";
    if (!isValidShopDomain(s))
        return ""; // caller can 400
    return s;
}
export function parseDays(query, fallback = 30) {
    const days = Number(query?.days);
    return Number.isFinite(days) && days > 0 ? Math.floor(days) : fallback;
}
export function parseLimit(query, fallback = 10) {
    const limit = Number(query?.limit);
    if (!Number.isFinite(limit))
        return fallback;
    return Math.max(1, Math.min(Math.floor(limit), 50));
}
export function parseAdInputs(query) {
    const adSpend = query?.adSpend;
    const currentRoas = query?.currentRoas;
    const adSpendNum = adSpend === "" || adSpend === undefined ? undefined : round2(Number(adSpend) || 0);
    const currentRoasNum = currentRoas === "" || currentRoas === undefined ? undefined : round2(Number(currentRoas) || 0);
    return { adSpend: adSpendNum, currentRoas: currentRoasNum };
}
export async function precomputeUnitCostsForOrders(params) {
    const { orders, cogsService, shopifyGET } = params;
    const variantIds = [];
    for (const o of orders) {
        const vqs = extractVariantQtyFromOrder(o);
        for (const li of vqs) {
            if (li.variantId > 0)
                variantIds.push(li.variantId);
        }
    }
    return cogsService.computeUnitCostsByVariant(shopifyGET, variantIds);
}
export function parseOverrideBody(body) {
    const variantId = Number(body?.variantId);
    if (!Number.isFinite(variantId) || variantId <= 0) {
        return { ok: false, status: 400, error: "variantId must be a positive number" };
    }
    let unitCost = undefined;
    if (body.unitCost !== undefined) {
        if (body.unitCost === null) {
            unitCost = null;
        }
        else {
            const parsed = toNumber(body.unitCost, NaN);
            if (!Number.isFinite(parsed) || parsed < 0) {
                return {
                    ok: false,
                    status: 400,
                    error: "unitCost must be a number >= 0 (or null to clear)",
                };
            }
            unitCost = round2(parsed);
        }
    }
    let ignoreCogs = undefined;
    if (body.ignoreCogs !== undefined) {
        if (body.ignoreCogs === null)
            ignoreCogs = null;
        else
            ignoreCogs = Boolean(body.ignoreCogs);
    }
    return { ok: true, variantId, unitCost, ignoreCogs };
}
// ------------------------------------------------------------
// COST MODEL helpers unchanged
// ------------------------------------------------------------
export function mergeCostOverrides(a, b) {
    if (!a && !b)
        return undefined;
    const out = {};
    if (a?.payment || b?.payment)
        out.payment = { ...(a?.payment ?? {}), ...(b?.payment ?? {}) };
    if (a?.shipping || b?.shipping)
        out.shipping = { ...(a?.shipping ?? {}), ...(b?.shipping ?? {}) };
    if (a?.ads || b?.ads)
        out.ads = { ...(a?.ads ?? {}), ...(b?.ads ?? {}) };
    if (a?.flags || b?.flags)
        out.flags = { ...(a?.flags ?? {}), ...(b?.flags ?? {}) };
    if (a?.fixedCosts || b?.fixedCosts)
        out.fixedCosts = { ...(a?.fixedCosts ?? {}), ...(b?.fixedCosts ?? {}) };
    if (!out.payment && !out.shipping && !out.ads && !out.flags && !out.fixedCosts)
        return undefined;
    return out;
}
export function effectiveCostOverrides(params) {
    const requestOverrides = costOverridesFromAny(params.input);
    return mergeCostOverrides(params.persisted, requestOverrides);
}
export function pickCostOverrideInput(query) {
    return {
        feePercent: query?.feePercent,
        feeFixed: query?.feeFixed,
        shippingCostPerOrder: query?.shippingCostPerOrder,
        includeShippingCost: query?.includeShippingCost,
        adAllocationMode: query?.adAllocationMode,
    };
}
