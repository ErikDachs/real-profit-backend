// src/domain/profitDaily.ts
// SSOT enforcement wrapper:
// The real implementation lives in src/domain/profitDaily/index.ts.
// This file exists only to avoid duplicate logic and to keep older imports working.

import { buildDailyProfit as buildDailyProfitImpl } from "./profitDaily/index.js";
import type { BuildDailyProfitParams, OrderProfitInputRow } from "./profitDaily/types.js";

type LegacyParams = Omit<BuildDailyProfitParams, "orderProfits"> & {
  // legacy callers used `rows`
  rows?: OrderProfitInputRow[];
  // current callers use `orderProfits`
  orderProfits?: OrderProfitInputRow[];
};

export function buildDailyProfit(params: LegacyParams) {
  const orderProfits = params.orderProfits ?? params.rows ?? [];

  return buildDailyProfitImpl({
    shop: params.shop,
    days: params.days,
    fixedCostsAllocatedInPeriod: params.fixedCostsAllocatedInPeriod,
    fixedCostsAllocationMode: params.fixedCostsAllocationMode,
    orderProfits,
  });
}