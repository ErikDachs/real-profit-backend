// src/domain/simulations/impactSimulation.ts

import { round2 } from "../../utils/money.js";
import type { UnifiedOpportunity, OpportunityType } from "../opportunities/types.js";
import type { OpportunitySimulation, SimulationScenario } from "./types.js";

function annualize(monthly: number) {
  return round2(monthly * 12);
}

function clamp01(x: number) {
  if (!Number.isFinite(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

function finiteOr0(n: any) {
  const x = Number(n);
  return Number.isFinite(x) ? x : 0;
}

function defaultScenarios(type: OpportunityType): SimulationScenario[] {
  // Deterministic, simple, no shadow assumptions
  switch (type) {
    case "HIGH_REFUNDS":
      return [
        { key: "refunds_-10", label: "Reduce refunds by 10%", changePct: -0.1 },
        { key: "refunds_-20", label: "Reduce refunds by 20%", changePct: -0.2 },
        { key: "refunds_-30", label: "Reduce refunds by 30%", changePct: -0.3 },
      ];
    case "HIGH_FEES":
      return [
        { key: "fees_-10", label: "Reduce fees by 10%", changePct: -0.1 },
        { key: "fees_-20", label: "Reduce fees by 20%", changePct: -0.2 },
        { key: "fees_-30", label: "Reduce fees by 30%", changePct: -0.3 },
      ];
    case "SHIPPING_SUBSIDY":
      return [
        { key: "ship_-25", label: "Reduce shipping subsidy by 25%", changePct: -0.25 },
        { key: "ship_-50", label: "Reduce shipping subsidy by 50%", changePct: -0.5 },
        { key: "ship_-75", label: "Reduce shipping subsidy by 75%", changePct: -0.75 },
      ];
    case "LOW_MARGIN":
      // Low margin is already a loss estimate to reach threshold; simulate closing part of the gap.
      return [
        { key: "margin_fix_25", label: "Close 25% of margin gap", changePct: -0.25 },
        { key: "margin_fix_50", label: "Close 50% of margin gap", changePct: -0.5 },
        { key: "margin_fix_100", label: "Close 100% of margin gap", changePct: -1.0 },
      ];
    case "NEGATIVE_CM":
      // Negative CM loss is the sum of unprofitable orders; simulate reducing that exposure.
      return [
        { key: "neg_fix_25", label: "Fix 25% of unprofitable exposure", changePct: -0.25 },
        { key: "neg_fix_50", label: "Fix 50% of unprofitable exposure", changePct: -0.5 },
        { key: "neg_fix_75", label: "Fix 75% of unprofitable exposure", changePct: -0.75 },
      ];
    case "MISSING_COGS":
      return [
        { key: "cogs_fix_50", label: "Add COGS for 50% of missing items", changePct: -0.5 },
        { key: "cogs_fix_100", label: "Add COGS for all missing items", changePct: -1.0 },
      ];
    default:
      return [
        { key: "improve_25", label: "Improve by 25%", changePct: -0.25 },
        { key: "improve_50", label: "Improve by 50%", changePct: -0.5 },
      ];
  }
}

export function buildImpactSimulation(params: {
  opportunities: UnifiedOpportunity[]; // usually unifiedOpportunitiesAll
  limit?: number; // default 5
}) {
  const limit = Math.max(1, Math.min(Number(params.limit ?? 5), 50));

  const sims: OpportunitySimulation[] = (params.opportunities ?? [])
    .slice(0, limit)
    .map((opp) => {
      // ✅ must be finite (never NaN/Infinity)
      const baselineMonthly = round2(finiteOr0(opp.estimatedMonthlyLoss));
      const baselineAnnual = annualize(baselineMonthly);

      const scenarios = defaultScenarios(opp.type).map((sc) => {
        // changePct is negative => reduction of loss
        const reductionShare = clamp01(Math.abs(finiteOr0(sc.changePct)));
        const liftMonthly = round2(baselineMonthly * reductionShare);
        const newMonthly = round2(Math.max(0, baselineMonthly - liftMonthly));

        return {
          scenario: sc,
          profitLiftMonthly: liftMonthly,
          profitLiftAnnual: annualize(liftMonthly),
          newEstimatedMonthlyLoss: newMonthly,
          newEstimatedAnnualLoss: annualize(newMonthly),
        };
      });

      return {
        type: opp.type,
        title: opp.title,
        currency: opp.currency,
        days: opp.days,

        // ✅ IMPORTANT: provide top-level fields for golden test shape
        estimatedMonthlyLoss: baselineMonthly,
        estimatedAnnualLoss: baselineAnnual,

        baseline: {
          estimatedMonthlyLoss: baselineMonthly,
          estimatedAnnualLoss: baselineAnnual,
        },
        scenarios,
        meta: opp.meta ?? undefined,
      } as any;
    });

  return {
    top: sims,
  };
}
