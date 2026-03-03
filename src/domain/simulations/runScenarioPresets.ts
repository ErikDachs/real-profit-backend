// src/domain/simulations/runScenarioPresets.ts
import type { UnifiedOpportunity } from "../opportunities/types.js";
import type { ResolvedCostProfile } from "../costModel/types.js";
import type { CogsService } from "../cogs.js";

import { buildOrdersSummary } from "../profit.js";
import { resolveCostProfile } from "../costModel/resolve.js";
import { buildProfitScenarioResult } from "./profitScenarioSimulation.js";
import { getScenarioPresetsForOpportunity, mergeDeepShallow, scenarioToCostOverrides } from "./scenarioPresets.js";

export type OpportunityScenarioSimulation = {
  type: string;
  title: string;
  currency: string;
  days: number;

  baselineFingerprint: string;
  simulatedFingerprints: Record<string, string>;

  scenarios: Array<{
    key: string;
    label: string;
    result: ReturnType<typeof buildProfitScenarioResult>;
  }>;
};

export async function runOpportunityScenarioSimulations(params: {
  shop: string;
  days: number;
  adSpend: number;
  orders: any[];

  // ✅ must be resolved, because we read .meta.fingerprint
  baseCostProfile: ResolvedCostProfile;

  // needed to resolve simulated profiles
  config: any;
  baseOverrides: any;

  cogsService: CogsService;
  shopifyGET: (path: string) => Promise<any>;

  // ✅ perf fast path: unit costs computed once
  // ✅ IMPORTANT: undefined means "unknown/missing", 0 is valid "by design"
  unitCostByVariant?: Map<number, number | undefined>;

  opportunities: UnifiedOpportunity[]; // usually unifiedOpportunitiesTop5
}) {
  const {
    shop,
    days,
    adSpend,
    orders,
    baseCostProfile,
    config,
    baseOverrides,
    cogsService,
    shopifyGET,
    unitCostByVariant,
    opportunities,
  } = params;

  // Baseline summary once (SSOT)
  const baselineSummary = await buildOrdersSummary({
    shop,
    days,
    adSpend,
    orders,
    costProfile: baseCostProfile,
    cogsService,
    shopifyGET,
    unitCostByVariant,
  });

  const out: OpportunityScenarioSimulation[] = [];

  for (const opp of opportunities ?? []) {
    const presets = getScenarioPresetsForOpportunity(opp.type);
    if (presets.length === 0) continue;

    const scenarios: OpportunityScenarioSimulation["scenarios"] = [];
    const simulatedFingerprints: Record<string, string> = {};

    for (const sc of presets) {
      const scenarioOverrides = scenarioToCostOverrides({ scenario: sc.key, baseCostProfile });
      if (!scenarioOverrides) continue;

      const mergedOverrides = mergeDeepShallow(baseOverrides, scenarioOverrides);

      const simulatedProfile = resolveCostProfile({
        config,
        overrides: mergedOverrides,
      });

      simulatedFingerprints[sc.key] = simulatedProfile.meta.fingerprint;

      const simulatedSummary = await buildOrdersSummary({
        shop,
        days,
        adSpend,
        orders,
        costProfile: simulatedProfile,
        cogsService,
        shopifyGET,
        unitCostByVariant,
      });

      const result = buildProfitScenarioResult({
        baseline: baselineSummary,
        simulated: simulatedSummary,
      });

      scenarios.push({
        key: sc.key,
        label: sc.label,
        result,
      });
    }

    out.push({
      type: opp.type,
      title: opp.title,
      currency: opp.currency,
      days: opp.days,
      baselineFingerprint: baseCostProfile.meta.fingerprint,
      simulatedFingerprints,
      scenarios,
    });
  }

  return {
    baselineSummary,
    simulationsByOpportunity: out,
  };
}
