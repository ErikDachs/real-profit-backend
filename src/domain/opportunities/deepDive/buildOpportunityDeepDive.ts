// src/domain/opportunities/deepDive/buildOpportunityDeepDive.ts
import { round2 } from "../../../utils/money.js";
import type { OpportunityType } from "../types.js";
import type { BuildOpportunityDeepDiveParams, OpportunityDeepDive } from "./types.js";

import { annualize, lossInPeriodFromMonthly, concentration, findOpportunity } from "./deepDive.utils.js";
import { pickWorstOrders } from "./deepDive.worstOrders.js";
import { mkDrivers } from "./drivers.js";

export function buildOpportunityDeepDive(params: BuildOpportunityDeepDiveParams): {
  shop: string;
  days: number;
  currency: string;
  deepDives: OpportunityDeepDive[];
} {
  const { shop, days, currency, opportunities, orders, products } = params;

  const limit = Math.max(3, Math.min(Number(params.limit ?? 10), 50));

  const selected: OpportunityType[] = params.type
    ? [params.type]
    : (opportunities ?? [])
        .slice(0, 5)
        .map((o) => o.type);

  const deepDives: OpportunityDeepDive[] = [];

  for (const type of selected) {
    const opp = findOpportunity(opportunities, type);
    if (!opp) continue;

    const lossInPeriod = lossInPeriodFromMonthly({ estimatedMonthlyLoss: opp.estimatedMonthlyLoss, days: opp.days });

    const { drivers } = mkDrivers({ type, orders, products, limit });

    const conc = concentration(drivers);

    const dd: OpportunityDeepDive = {
      type,
      title: opp.title,
      summary: opp.summary,
      currency: opp.currency,
      days: opp.days,

      baseline: {
        lossInPeriod,
        estimatedMonthlyLoss: round2(Number(opp.estimatedMonthlyLoss || 0)),
        estimatedAnnualLoss: annualize(Number(opp.estimatedMonthlyLoss || 0)),
      },

      concentration: {
        top1SharePct: round2(conc.top1SharePct),
        top3SharePct: round2(conc.top3SharePct),
        top5SharePct: round2(conc.top5SharePct),
      },

      drivers,

      worstOrders: pickWorstOrders({ orders, type, limit: Math.min(10, limit) }),

      meta: opp.meta ?? undefined,
      actions: opp.actions ?? undefined,

      simulation: params.simulationByType?.get(type),
    };

    deepDives.push(dd);
  }

  deepDives.sort((a, b) => Number(b.baseline.estimatedMonthlyLoss || 0) - Number(a.baseline.estimatedMonthlyLoss || 0));

  return { shop, days, currency, deepDives };
}
