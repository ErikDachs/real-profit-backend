// src/routes/shopify/helpers.ts
import { round2, toNumber } from "../../utils/money.js";
import type { CogsService } from "../../domain/cogs.js";
import { extractVariantQtyFromOrder } from "../../domain/profit/variants.js";
import type { CostProfileOverrides } from "../../domain/costModel/types.js";
import { costOverridesFromAny } from "../../domain/costModel/resolve.js";
import { isValidShopDomain, normalizeShopDomain } from "../../storage/shopsStore.js";

export function parseShop(query: any, fallback?: string): string {
  const raw = query?.shop ?? fallback ?? "";
  const shop = normalizeShopDomain(raw);

  if (!shop) return "";
  if (!isValidShopDomain(shop)) return "";

  return shop;
}

export function parseDays(query: any, fallback = 30): number {
  const days = Number(query?.days);
  return Number.isFinite(days) && days > 0 ? Math.floor(days) : fallback;
}

export function parseLimit(query: any, fallback = 10): number {
  const limit = Number(query?.limit);
  if (!Number.isFinite(limit)) return fallback;
  return Math.max(1, Math.min(Math.floor(limit), 50));
}

export function parseAdInputs(query: any): { adSpend?: number; currentRoas?: number } {
  const adSpend = query?.adSpend;
  const currentRoas = query?.currentRoas;

  const adSpendNum = adSpend === "" || adSpend === undefined ? undefined : round2(Number(adSpend) || 0);
  const currentRoasNum = currentRoas === "" || currentRoas === undefined ? undefined : round2(Number(currentRoas) || 0);

  return { adSpend: adSpendNum, currentRoas: currentRoasNum };
}

export async function precomputeUnitCostsForOrders(params: {
  orders: any[];
  cogsService: CogsService;
  shopifyGET: (path: string) => Promise<any>;
}): Promise<Map<number, number | undefined>> {
  const { orders, cogsService, shopifyGET } = params;

  const variantIds: number[] = [];
  for (const o of orders) {
    const vqs = extractVariantQtyFromOrder(o);
    for (const li of vqs) {
      if (li.variantId > 0) variantIds.push(li.variantId);
    }
  }

  return cogsService.computeUnitCostsByVariant(shopifyGET, variantIds);
}

export function parseOverrideBody(body: any) {
  const variantId = Number(body?.variantId);
  if (!Number.isFinite(variantId) || variantId <= 0) {
    return { ok: false as const, status: 400 as const, error: "variantId must be a positive number" };
  }

  let unitCost: number | null | undefined = undefined;
  if (body.unitCost !== undefined) {
    if (body.unitCost === null) {
      unitCost = null;
    } else {
      const parsed = toNumber(body.unitCost, NaN);
      if (!Number.isFinite(parsed) || parsed < 0) {
        return {
          ok: false as const,
          status: 400 as const,
          error: "unitCost must be a number >= 0 (or null to clear)",
        };
      }
      unitCost = round2(parsed);
    }
  }

  let ignoreCogs: boolean | null | undefined = undefined;
  if (body.ignoreCogs !== undefined) {
    if (body.ignoreCogs === null) ignoreCogs = null;
    else ignoreCogs = Boolean(body.ignoreCogs);
  }

  return { ok: true as const, variantId, unitCost, ignoreCogs };
}

// ------------------------------------------------------------
// COST MODEL helpers unchanged
// ------------------------------------------------------------
export function mergeCostOverrides(a?: CostProfileOverrides, b?: CostProfileOverrides): CostProfileOverrides | undefined {
  if (!a && !b) return undefined;

  const out: CostProfileOverrides = {};

  if (a?.payment || b?.payment) out.payment = { ...(a?.payment ?? {}), ...(b?.payment ?? {}) };
  if (a?.shipping || b?.shipping) out.shipping = { ...(a?.shipping ?? {}), ...(b?.shipping ?? {}) };
  if (a?.ads || b?.ads) out.ads = { ...(a?.ads ?? {}), ...(b?.ads ?? {}) };
  if (a?.flags || b?.flags) out.flags = { ...(a?.flags ?? {}), ...(b?.flags ?? {}) };
  if (a?.fixedCosts || b?.fixedCosts) out.fixedCosts = { ...(a?.fixedCosts ?? {}), ...(b?.fixedCosts ?? {}) };

  if (!out.payment && !out.shipping && !out.ads && !out.flags && !out.fixedCosts) return undefined;
  return out;
}

export function effectiveCostOverrides(params: { persisted?: CostProfileOverrides; input: any }): CostProfileOverrides | undefined {
  const requestOverrides = costOverridesFromAny(params.input);
  return mergeCostOverrides(params.persisted, requestOverrides);
}

export function pickCostOverrideInput(query: any) {
  return {
    feePercent: query?.feePercent,
    feeFixed: query?.feeFixed,
    shippingCostPerOrder: query?.shippingCostPerOrder,
    includeShippingCost: query?.includeShippingCost,
    adAllocationMode: query?.adAllocationMode,
  };
}