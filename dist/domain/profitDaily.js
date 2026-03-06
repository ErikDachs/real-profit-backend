// src/domain/profitDaily.ts
// SSOT enforcement wrapper:
// The real implementation lives in src/domain/profitDaily/index.ts.
// This file exists only to avoid duplicate logic and to keep older imports working.
import { buildDailyProfit as buildDailyProfitImpl } from "./profitDaily/index.js";
export function buildDailyProfit(params) {
    const orderProfits = params.orderProfits ?? params.rows ?? [];
    return buildDailyProfitImpl({
        shop: params.shop,
        days: params.days,
        fixedCostsAllocatedInPeriod: params.fixedCostsAllocatedInPeriod,
        fixedCostsAllocationMode: params.fixedCostsAllocationMode,
        orderProfits,
    });
}
