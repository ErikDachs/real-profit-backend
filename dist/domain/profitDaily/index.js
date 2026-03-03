// src/domain/profitDaily/index.ts
import { ensureFixedCosts } from "./fixedCosts.js";
import { buildDailyRows } from "./aggregateDaily.js";
import { buildTotalsFromDaily } from "./aggregateTotals.js";
export function buildDailyProfit(params) {
    const { shop, days } = params;
    const rows = ensureFixedCosts(params);
    const daily = buildDailyRows({ rows });
    const totals = buildTotalsFromDaily({ daily });
    return {
        shop,
        days,
        totals,
        daily,
    };
}
