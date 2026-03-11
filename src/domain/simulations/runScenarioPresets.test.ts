import { describe, expect, it, vi, beforeEach } from "vitest";

const {
  buildOrdersSummaryMock,
  resolveCostProfileMock,
  buildProfitScenarioResultMock,
  getScenarioPresetsForOpportunityMock,
  mergeDeepShallowMock,
  scenarioToCostOverridesMock,
} = vi.hoisted(() => ({
  buildOrdersSummaryMock: vi.fn(),
  resolveCostProfileMock: vi.fn(),
  buildProfitScenarioResultMock: vi.fn(),
  getScenarioPresetsForOpportunityMock: vi.fn(),
  mergeDeepShallowMock: vi.fn(),
  scenarioToCostOverridesMock: vi.fn(),
}));

vi.mock("../profit.js", () => ({
  buildOrdersSummary: buildOrdersSummaryMock,
}));

vi.mock("../costModel/resolve.js", () => ({
  resolveCostProfile: resolveCostProfileMock,
}));

vi.mock("./profitScenarioSimulation.js", () => ({
  buildProfitScenarioResult: buildProfitScenarioResultMock,
}));

vi.mock("./scenarioPresets.js", () => ({
  getScenarioPresetsForOpportunity: getScenarioPresetsForOpportunityMock,
  mergeDeepShallow: mergeDeepShallowMock,
  scenarioToCostOverrides: scenarioToCostOverridesMock,
}));

import { runOpportunityScenarioSimulations } from "./runScenarioPresets.js";

describe("runOpportunityScenarioSimulations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns baseline summary and empty simulations when no presets exist", async () => {
    buildOrdersSummaryMock.mockResolvedValue({ profitAfterFees: 100 });

    getScenarioPresetsForOpportunityMock.mockReturnValue([]);

    const result = await runOpportunityScenarioSimulations({
      shop: "test-shop",
      days: 30,
      adSpend: 0,
      orders: [{ id: 1 }],

      baseCostProfile: {
        meta: { fingerprint: "base_fp" },
      } as any,

      config: {},
      baseOverrides: {},

      cogsService: {} as any,
      shopifyGET: vi.fn(),

      opportunities: [
        {
          type: "LOW_MARGIN",
          title: "Low margin",
          currency: "USD",
          days: 30,
        } as any,
      ],
    });

    expect(result).toEqual({
      baselineSummary: { profitAfterFees: 100 },
      simulationsByOpportunity: [],
    });

    expect(buildOrdersSummaryMock).toHaveBeenCalledTimes(1);
  });

  it("runs scenario simulations and builds results", async () => {
    buildOrdersSummaryMock
      .mockResolvedValueOnce({ baseline: true })
      .mockResolvedValueOnce({ simulated: "s1" })
      .mockResolvedValueOnce({ simulated: "s2" });

    getScenarioPresetsForOpportunityMock.mockReturnValue([
      { key: "scenario1", label: "Scenario 1" },
      { key: "scenario2", label: "Scenario 2" },
    ]);

    scenarioToCostOverridesMock
      .mockReturnValueOnce({ override: 1 })
      .mockReturnValueOnce({ override: 2 });

    mergeDeepShallowMock
      .mockReturnValueOnce({ merged: "m1" })
      .mockReturnValueOnce({ merged: "m2" });

    resolveCostProfileMock
      .mockReturnValueOnce({ meta: { fingerprint: "fp1" } })
      .mockReturnValueOnce({ meta: { fingerprint: "fp2" } });

    buildProfitScenarioResultMock
      .mockReturnValueOnce({ result: "r1" })
      .mockReturnValueOnce({ result: "r2" });

    const result = await runOpportunityScenarioSimulations({
      shop: "test-shop",
      days: 30,
      adSpend: 10,
      orders: [{ id: 1 }],

      baseCostProfile: {
        meta: { fingerprint: "base_fp" },
      } as any,

      config: { cfg: true },
      baseOverrides: { base: true },

      cogsService: {} as any,
      shopifyGET: vi.fn(),

      opportunities: [
        {
          type: "LOW_MARGIN",
          title: "Low margin",
          currency: "USD",
          days: 30,
        } as any,
      ],
    });

    expect(buildOrdersSummaryMock).toHaveBeenCalledTimes(3);

    expect(resolveCostProfileMock).toHaveBeenCalledTimes(2);

    expect(buildProfitScenarioResultMock).toHaveBeenCalledTimes(2);

    expect(result).toEqual({
      baselineSummary: { baseline: true },
      simulationsByOpportunity: [
        {
          type: "LOW_MARGIN",
          title: "Low margin",
          currency: "USD",
          days: 30,
          baselineFingerprint: "base_fp",
          simulatedFingerprints: {
            scenario1: "fp1",
            scenario2: "fp2",
          },
          scenarios: [
            {
              key: "scenario1",
              label: "Scenario 1",
              result: { result: "r1" },
            },
            {
              key: "scenario2",
              label: "Scenario 2",
              result: { result: "r2" },
            },
          ],
        },
      ],
    });
  });

  it("skips scenarios when scenarioToCostOverrides returns null", async () => {
    buildOrdersSummaryMock.mockResolvedValue({ baseline: true });

    getScenarioPresetsForOpportunityMock.mockReturnValue([
      { key: "scenario1", label: "Scenario 1" },
    ]);

    scenarioToCostOverridesMock.mockReturnValue(null);

    const result = await runOpportunityScenarioSimulations({
      shop: "test-shop",
      days: 30,
      adSpend: 0,
      orders: [{ id: 1 }],

      baseCostProfile: {
        meta: { fingerprint: "base_fp" },
      } as any,

      config: {},
      baseOverrides: {},

      cogsService: {} as any,
      shopifyGET: vi.fn(),

      opportunities: [
        {
          type: "LOW_MARGIN",
          title: "Low margin",
          currency: "USD",
          days: 30,
        } as any,
      ],
    });

    expect(result.simulationsByOpportunity[0].scenarios).toEqual([]);
  });
});