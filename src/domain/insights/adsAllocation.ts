// src/domain/insights/adsAllocation.ts
import { round2 } from "../../utils/money";
import { allocateAdSpendForOrders, allocateAdSpendForProducts } from "../profit/ads";

type Key = number | string;

function num(x: any): number {
  const n = Number(x ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * ✅ SSOT WRAPPER
 * This module is kept for backwards compatibility, but allocation logic lives in domain/profit/ads.ts
 */
export function allocateAdSpend<T>(params: {
  rows: T[];
  getId: (row: T) => Key;
  getWeight: (row: T) => number; // e.g. net sales
  totalAdSpend: number;
}): Map<Key, number> {
  const { rows, getId, getWeight } = params;

  // We adapt to SSOT allocator which expects netAfterRefunds / netSales fields.
  // Create a lightweight view model.
  const view = rows.map((r) => ({
    __id: getId(r),
    __w: num(getWeight(r)),
    netAfterRefunds: num(getWeight(r)), // weight = allocation base
  }));

  const allocated = allocateAdSpendForOrders({
    rows: view,
    adSpend: num(params.totalAdSpend),
    mode: "BY_NET_SALES",
  });

  const out = new Map<Key, number>();
  for (const r of allocated) out.set(r.__id, round2((r as any).allocatedAdSpend ?? 0));
  return out;
}

export function enrichOrdersWithAds<T extends { id: Key }>(params: {
  orders: T[];
  totalAdSpend: number;
  // Default weight: netAfterRefunds
  weight?: (o: T) => number;
  // Default base profit: contributionMargin
  baseProfit?: (o: T) => number;
  // Optional: if provided, we compute profitAfterAdsAndShipping using profitAfterShipping
  profitAfterShipping?: (o: T) => number;
}) {
  const {
    orders,
    totalAdSpend,
    weight = (o) => num((o as any).netAfterRefunds),
    baseProfit = (o) => num((o as any).contributionMargin),
    profitAfterShipping,
  } = params;

  const view = orders.map((o) => ({
    __ref: o,
    netAfterRefunds: weight(o),
  }));

  const allocated = allocateAdSpendForOrders({
    rows: view,
    adSpend: num(totalAdSpend),
    mode: "BY_NET_SALES",
  });

  return allocated.map((row) => {
    const o = (row as any).__ref as T;
    const adSpendAllocated = round2((row as any).allocatedAdSpend ?? 0);

    const cm = baseProfit(o);
    const profitAfterAds = round2(cm - adSpendAllocated);

    const out: any = { ...o, adSpendAllocated, profitAfterAds };

    if (profitAfterShipping) {
      const pas = num(profitAfterShipping(o));
      out.profitAfterAdsAndShipping = round2(pas - adSpendAllocated);
    }

    return out as T & {
      adSpendAllocated: number;
      profitAfterAds: number;
      profitAfterAdsAndShipping?: number;
    };
  });
}

export function enrichProductsWithAds<T extends { productId: number; variantId: number }>(params: {
  products: T[];
  totalAdSpend: number;
  // Default weight: netSales
  weight?: (p: T) => number;
  // Default base profit: profitAfterFees
  baseProfit?: (p: T) => number;
}) {
  const {
    products,
    totalAdSpend,
    weight = (p) => num((p as any).netSales),
    baseProfit = (p) => num((p as any).profitAfterFees),
  } = params;

  const view = products.map((p) => ({
    __ref: p,
    netSales: weight(p),
  }));

  // SSOT product allocator expects netSales
  const allocated = allocateAdSpendForProducts({
    rows: view,
    adSpend: num(totalAdSpend),
  });

  return allocated.map((row) => {
    const p = (row as any).__ref as T;
    const adSpendAllocated = round2((row as any).allocatedAdSpend ?? 0);

    const profit = baseProfit(p);
    const profitAfterAds = round2(profit - adSpendAllocated);

    return {
      ...(p as any),
      adSpendAllocated,
      profitAfterAds,
    } as T & { adSpendAllocated: number; profitAfterAds: number };
  });
}