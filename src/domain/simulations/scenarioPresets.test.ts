import { describe, expect, it } from "vitest";

import {
  getScenarioPresetsForOpportunity,
  mergeDeepShallow,
  scenarioToCostOverrides,
} from "./scenarioPresets.js";

describe("scenarioPresets", () => {
  describe("getScenarioPresetsForOpportunity", () => {
    it("returns fee reduction presets for HIGH_FEES", () => {
      expect(getScenarioPresetsForOpportunity("HIGH_FEES")).toEqual([
        { key: "fees_-10", label: "Reduce fees by 10%" },
        { key: "fees_-20", label: "Reduce fees by 20%" },
        { key: "fees_-30", label: "Reduce fees by 30%" },
      ]);
    });

    it("returns shipping presets for SHIPPING_SUBSIDY", () => {
      expect(getScenarioPresetsForOpportunity("SHIPPING_SUBSIDY")).toEqual([
        { key: "ship_-25", label: "Reduce shipping cost by 25%" },
        { key: "ship_-50", label: "Reduce shipping cost by 50%" },
        { key: "ship_-75", label: "Reduce shipping cost by 75%" },
        { key: "ship_off", label: "Disable shipping cost (debug)" },
      ]);
    });

    it("returns empty array for unsupported opportunity types", () => {
      expect(getScenarioPresetsForOpportunity("LOW_MARGIN")).toEqual([]);
      expect(getScenarioPresetsForOpportunity("NEGATIVE_CM")).toEqual([]);
      expect(getScenarioPresetsForOpportunity("HIGH_REFUNDS")).toEqual([]);
      expect(getScenarioPresetsForOpportunity("MISSING_COGS")).toEqual([]);
      expect(getScenarioPresetsForOpportunity("MARGIN_DRIFT")).toEqual([]);
      expect(getScenarioPresetsForOpportunity("BREAK_EVEN_RISK")).toEqual([]);
      expect(getScenarioPresetsForOpportunity("HIGH_FIXED_COST_LOAD")).toEqual([]);
      expect(getScenarioPresetsForOpportunity("OPERATING_LEVERAGE_RISK")).toEqual([]);
    });
  });

  describe("mergeDeepShallow", () => {
    it("returns shallow copy of second object when first is missing", () => {
      expect(
        mergeDeepShallow(undefined, {
          payment: { feePercent: 0.03 },
        })
      ).toEqual({
        payment: { feePercent: 0.03 },
      });
    });

    it("returns shallow copy of first object when second is missing", () => {
      expect(
        mergeDeepShallow(
          {
            shipping: { costPerOrder: 8 },
          },
          undefined
        )
      ).toEqual({
        shipping: { costPerOrder: 8 },
      });
    });

    it("merges nested objects recursively", () => {
      const a = {
        payment: {
          feePercent: 0.03,
          feeFixed: 0.3,
        },
        shipping: {
          costPerOrder: 8,
        },
        flags: {
          includeShippingCost: true,
        },
      };

      const b = {
        payment: {
          feePercent: 0.024,
        },
        flags: {
          includeShippingCost: false,
        },
      };

      expect(mergeDeepShallow(a, b)).toEqual({
        payment: {
          feePercent: 0.024,
          feeFixed: 0.3,
        },
        shipping: {
          costPerOrder: 8,
        },
        flags: {
          includeShippingCost: false,
        },
      });
    });

    it("replaces arrays instead of deep merging them", () => {
      const a = {
        meta: {
          tags: ["a", "b"],
        },
      };

      const b = {
        meta: {
          tags: ["x"],
        },
      };

      expect(mergeDeepShallow(a, b)).toEqual({
        meta: {
          tags: ["x"],
        },
      });
    });

    it("overwrites scalar values directly", () => {
      const a = {
        payment: {
          feePercent: 0.03,
        },
      };

      const b = {
        payment: 123,
      };

      expect(mergeDeepShallow(a, b)).toEqual({
        payment: 123,
      });
    });
  });

  describe("scenarioToCostOverrides", () => {
    const baseCostProfile = {
      payment: {
        feePercent: 0.03,
        feeFixed: 0.3,
      },
      shipping: {
        costPerOrder: 8,
      },
    };

    it("builds overrides for fees_-10", () => {
      expect(
        scenarioToCostOverrides({
          scenario: "fees_-10",
          baseCostProfile,
        })
      ).toEqual({
        payment: {
          feePercent: 0.027,
          feeFixed: 0.27,
        },
      });
    });

    it("builds overrides for fees_-20", () => {
      expect(
        scenarioToCostOverrides({
          scenario: "fees_-20",
          baseCostProfile,
        })
      ).toEqual({
        payment: {
          feePercent: 0.024,
          feeFixed: 0.24,
        },
      });
    });

it("builds overrides for fees_-30", () => {
  const out = scenarioToCostOverrides({
    scenario: "fees_-30",
    baseCostProfile,
  });

  expect(out).not.toBeNull();
  expect(out?.payment?.feeFixed).toBeCloseTo(0.21, 10);
  expect(out?.payment?.feePercent).toBeCloseTo(0.021, 10);
});

    it("builds overrides for ship_-25", () => {
      expect(
        scenarioToCostOverrides({
          scenario: "ship_-25",
          baseCostProfile,
        })
      ).toEqual({
        shipping: {
          costPerOrder: 6,
        },
      });
    });

    it("builds overrides for ship_-50", () => {
      expect(
        scenarioToCostOverrides({
          scenario: "ship_-50",
          baseCostProfile,
        })
      ).toEqual({
        shipping: {
          costPerOrder: 4,
        },
      });
    });

    it("builds overrides for ship_-75", () => {
      expect(
        scenarioToCostOverrides({
          scenario: "ship_-75",
          baseCostProfile,
        })
      ).toEqual({
        shipping: {
          costPerOrder: 2,
        },
      });
    });

    it("builds overrides for ship_off", () => {
      expect(
        scenarioToCostOverrides({
          scenario: "ship_off",
          baseCostProfile,
        })
      ).toEqual({
        flags: {
          includeShippingCost: false,
        },
      });
    });

    it("returns null for unknown scenario", () => {
      expect(
        scenarioToCostOverrides({
          scenario: "unknown",
          baseCostProfile,
        })
      ).toBeNull();
    });

    it("falls back to zero-based calculations when base profile fields are missing", () => {
      expect(
        scenarioToCostOverrides({
          scenario: "fees_-20",
          baseCostProfile: {},
        })
      ).toEqual({
        payment: {
          feePercent: 0,
          feeFixed: 0,
        },
      });

      expect(
        scenarioToCostOverrides({
          scenario: "ship_-50",
          baseCostProfile: {},
        })
      ).toEqual({
        shipping: {
          costPerOrder: 0,
        },
      });
    });
  });
});