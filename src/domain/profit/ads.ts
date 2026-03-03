// src/domain/profit/ads.ts
import { round2 } from "../../utils/money";

export type AdSpendMode = "BY_NET_SALES" | "PER_ORDER";

/**
 * Deterministic allocation.
 * Default for MVP: BY_NET_SALES (proportional to net sales).
 */
export function allocateAdSpendForOrders<T extends { netAfterRefunds: number }>(params: {
  rows: T[];
  adSpend: number;
  mode?: AdSpendMode;
}): Array<T & { allocatedAdSpend: number }> {
  const { rows } = params;
  const adSpend = Number(params.adSpend || 0);
  const mode = params.mode ?? "BY_NET_SALES";

  if (!Number.isFinite(adSpend) || adSpend <= 0 || rows.length === 0) {
    return rows.map((r) => ({ ...r, allocatedAdSpend: 0 }));
  }

  if (mode === "PER_ORDER") {
    const per = adSpend / rows.length;
    return rows.map((r) => ({ ...r, allocatedAdSpend: round2(per) }));
  }

  // BY_NET_SALES
  const totalNet = rows.reduce((s, r) => s + Number(r.netAfterRefunds || 0), 0);

  if (totalNet <= 0) {
    // fallback: even split
    const per = adSpend / rows.length;
    return rows.map((r) => ({ ...r, allocatedAdSpend: round2(per) }));
  }

  // Allocate proportionally; keep rounding drift controlled by correcting last row
  let allocatedSum = 0;
  const out = rows.map((r, idx) => {
    const net = Number(r.netAfterRefunds || 0);
    let alloc = (net / totalNet) * adSpend;
    alloc = round2(alloc);

    if (idx === rows.length - 1) {
      const drift = round2(adSpend - allocatedSum);
      alloc = round2(drift);
    } else {
      allocatedSum = round2(allocatedSum + alloc);
    }

    return { ...r, allocatedAdSpend: alloc };
  });

  return out;
}

export function allocateAdSpendForProducts<T extends { netSales: number }>(params: {
  rows: T[];
  adSpend: number;
}): Array<T & { allocatedAdSpend: number }> {
  const { rows } = params;
  const adSpend = Number(params.adSpend || 0);

  if (!Number.isFinite(adSpend) || adSpend <= 0 || rows.length === 0) {
    return rows.map((r) => ({ ...r, allocatedAdSpend: 0 }));
  }

  const totalNet = rows.reduce((s, r) => s + Number(r.netSales || 0), 0);

  if (totalNet <= 0) {
    const per = adSpend / rows.length;
    return rows.map((r) => ({ ...r, allocatedAdSpend: round2(per) }));
  }

  let allocatedSum = 0;
  const out = rows.map((r, idx) => {
    const net = Number(r.netSales || 0);
    let alloc = (net / totalNet) * adSpend;
    alloc = round2(alloc);

    if (idx === rows.length - 1) {
      const drift = round2(adSpend - allocatedSum);
      alloc = round2(drift);
    } else {
      allocatedSum = round2(allocatedSum + alloc);
    }

    return { ...r, allocatedAdSpend: alloc };
  });

  return out;
}

export function computeProfitAfterAds(params: {
  profitBeforeAds: number;
  allocatedAdSpend: number;
}) {
  const p = Number(params.profitBeforeAds || 0);
  const a = Number(params.allocatedAdSpend || 0);
  return round2(p - a);
}