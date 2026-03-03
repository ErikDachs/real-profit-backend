// src/domain/simulations/scenarioPresets.ts
import type { OpportunityType } from "../opportunities/types.js";

/**
 * Deterministic presets: Only scenarios we can simulate via SSOT CostProfile knobs
 * (fees, shipping). No refunds/Cogs/ads here to avoid shadow assumptions.
 */
export type ScenarioPreset = {
  key: string; // e.g. "fees_-20"
  label: string; // UI label
};

export function getScenarioPresetsForOpportunity(type: OpportunityType): ScenarioPreset[] {
  switch (type) {
    case "HIGH_FEES":
      return [
        { key: "fees_-10", label: "Reduce fees by 10%" },
        { key: "fees_-20", label: "Reduce fees by 20%" },
        { key: "fees_-30", label: "Reduce fees by 30%" },
      ];

    case "SHIPPING_SUBSIDY":
      return [
        { key: "ship_-25", label: "Reduce shipping cost by 25%" },
        { key: "ship_-50", label: "Reduce shipping cost by 50%" },
        { key: "ship_-75", label: "Reduce shipping cost by 75%" },
        { key: "ship_off", label: "Disable shipping cost (debug)" },
      ];

    default:
      return [];
  }
}

export function mergeDeepShallow(a: any, b: any) {
  // minimal deterministic merge for our overrides shape
  const out = { ...(a ?? {}) };
  for (const k of Object.keys(b ?? {})) {
    const av = (out as any)[k];
    const bv = (b as any)[k];
    if (av && bv && typeof av === "object" && typeof bv === "object" && !Array.isArray(av) && !Array.isArray(bv)) {
      (out as any)[k] = mergeDeepShallow(av, bv);
    } else {
      (out as any)[k] = bv;
    }
  }
  return out;
}

/**
 * Scenario -> costProfile override patch (SSOT knobs only).
 * IMPORTANT: We derive the numeric base from *baseCostProfile* so the scenario is relative to current config.
 */
export function scenarioToCostOverrides(params: { scenario: string; baseCostProfile: any }) {
  const { scenario, baseCostProfile } = params;

  const feePercentBase = Number(baseCostProfile?.payment?.feePercent ?? 0);
  const feeFixedBase = Number(baseCostProfile?.payment?.feeFixed ?? 0);
  const shipCostPerOrderBase = Number(baseCostProfile?.shipping?.costPerOrder ?? 0);

  switch (scenario) {
    case "fees_-10":
      return { payment: { feePercent: feePercentBase * 0.9, feeFixed: feeFixedBase * 0.9 } };
    case "fees_-20":
      return { payment: { feePercent: feePercentBase * 0.8, feeFixed: feeFixedBase * 0.8 } };
    case "fees_-30":
      return { payment: { feePercent: feePercentBase * 0.7, feeFixed: feeFixedBase * 0.7 } };

    case "ship_-25":
      return { shipping: { costPerOrder: shipCostPerOrderBase * 0.75 } };
    case "ship_-50":
      return { shipping: { costPerOrder: shipCostPerOrderBase * 0.5 } };
    case "ship_-75":
      return { shipping: { costPerOrder: shipCostPerOrderBase * 0.25 } };

    case "ship_off":
      return { flags: { includeShippingCost: false } };

    default:
      return null;
  }
}
