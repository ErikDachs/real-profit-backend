// src/domain/profitDaily/fixedCosts.ts
import { round2 } from "../../utils/money.js";
import { allocateFixedCostsForOrders, type FixedCostsMode } from "../profit/fixedCosts.js";

import type { BuildDailyProfitParams, RowWithFixed } from "./types.js";

export function ensureFixedCosts(params: BuildDailyProfitParams): RowWithFixed[] {
  const rows = params.orderProfits;
  const total = Number(params.fixedCostsAllocatedInPeriod ?? 0);
  const modeRaw = params.fixedCostsAllocationMode ?? "PER_ORDER";

  const hasAllFixed = rows.length > 0 && rows.every((r) => r.fixedCostAllocated !== undefined);
  const canAllocate = Number.isFinite(total) && total > 0;

  // If upstream already allocated for all rows, OR we can't allocate, OR BY_DAYS (no calendar invention here)
  if (hasAllFixed || !canAllocate || modeRaw === "BY_DAYS") {
    return rows.map((r) => {
      const fc = round2(Number(r.fixedCostAllocated ?? 0));
      const pBase = Number(r.profitAfterAdsAndShipping ?? 0);
      const pAfterFixed = r.profitAfterFixedCosts !== undefined ? Number(r.profitAfterFixedCosts ?? 0) : pBase - fc;

      return {
        ...r,
        fixedCostAllocated: fc,
        profitAfterFixedCosts: round2(pAfterFixed),
      };
    });
  }

  const mode: FixedCostsMode = modeRaw === "BY_NET_SALES" ? "BY_NET_SALES" : "PER_ORDER";

  const allocated = allocateFixedCostsForOrders({
    rows,
    fixedCostsTotal: total,
    mode,
  });

  return allocated.map((r: any) => {
    const fc = round2(Number(r.fixedCostAllocated ?? 0));
    const pBase = Number(r.profitAfterAdsAndShipping ?? 0);
    const pAfterFixed = r.profitAfterFixedCosts !== undefined ? Number(r.profitAfterFixedCosts ?? 0) : pBase - fc;

    return {
      ...r,
      fixedCostAllocated: fc,
      profitAfterFixedCosts: round2(pAfterFixed),
    };
  });
}
