// src/domain/profit/fixedCosts.ts
import { round2 } from "../../utils/money.js";

export type FixedCostsMode = "PER_ORDER" | "BY_NET_SALES";

/**
 * Deterministic fixed cost allocation.
 * - PER_ORDER: even split
 * - BY_NET_SALES: proportional to netAfterRefunds (like Ads), with rounding drift correction on last row
 */
export function allocateFixedCostsForOrders<T extends { netAfterRefunds: number }>(params: {
  rows: T[];
  fixedCostsTotal: number; // allocated for the period already
  mode?: FixedCostsMode;
}): Array<T & { fixedCostAllocated: number }> {
  const { rows } = params;
  const total = Number(params.fixedCostsTotal || 0);
  const mode = params.mode ?? "PER_ORDER";

  if (!Number.isFinite(total) || total <= 0 || rows.length === 0) {
    return rows.map((r) => ({ ...r, fixedCostAllocated: 0 }));
  }

  if (mode === "PER_ORDER") {
    const per = total / rows.length;
    return rows.map((r) => ({ ...r, fixedCostAllocated: round2(per) }));
  }

  // BY_NET_SALES
  const totalNet = rows.reduce((s, r) => s + Number(r.netAfterRefunds || 0), 0);

  if (totalNet <= 0) {
    // fallback: even split
    const per = total / rows.length;
    return rows.map((r) => ({ ...r, fixedCostAllocated: round2(per) }));
  }

  let allocatedSum = 0;
  const out = rows.map((r, idx) => {
    const net = Number(r.netAfterRefunds || 0);
    let alloc = (net / totalNet) * total;
    alloc = round2(alloc);

    if (idx === rows.length - 1) {
      // correct rounding drift on last row
      const drift = round2(total - allocatedSum);
      alloc = round2(drift);
    } else {
      allocatedSum = round2(allocatedSum + alloc);
    }

    return { ...r, fixedCostAllocated: alloc };
  });

  return out;
}
