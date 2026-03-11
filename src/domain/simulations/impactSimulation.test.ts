import { describe, expect, it } from "vitest";
import { buildImpactSimulation } from "./impactSimulation.js";

describe("buildImpactSimulation", () => {
  it("builds simulations for supported opportunity types with deterministic scenarios", () => {
    const res = buildImpactSimulation({
      opportunities: [
        {
          type: "HIGH_REFUNDS",
          title: "High refunds",
          summary: "Refunds are high",
          estimatedMonthlyLoss: 100,
          currency: "USD",
          days: 30,
        },
        {
          type: "HIGH_FEES",
          title: "High fees",
          summary: "Fees are high",
          estimatedMonthlyLoss: 200,
          currency: "USD",
          days: 30,
        },
        {
          type: "SHIPPING_SUBSIDY",
          title: "Shipping subsidy",
          summary: "Shipping is subsidized",
          estimatedMonthlyLoss: 80,
          currency: "USD",
          days: 30,
        },
        {
          type: "LOW_MARGIN",
          title: "Low margin",
          summary: "Margins are low",
          estimatedMonthlyLoss: 60,
          currency: "USD",
          days: 30,
        },
        {
          type: "NEGATIVE_CM",
          title: "Negative CM",
          summary: "Negative contribution margin",
          estimatedMonthlyLoss: 40,
          currency: "USD",
          days: 30,
        },
        {
          type: "MISSING_COGS",
          title: "Missing COGS",
          summary: "COGS missing",
          estimatedMonthlyLoss: 50,
          currency: "USD",
          days: 30,
        },
      ],
      limit: 6,
    });

    expect(res.top).toHaveLength(6);

    expect(res.top[0]).toMatchObject({
      type: "HIGH_REFUNDS",
      title: "High refunds",
      currency: "USD",
      days: 30,
      estimatedMonthlyLoss: 100,
      estimatedAnnualLoss: 1200,
      baseline: {
        estimatedMonthlyLoss: 100,
        estimatedAnnualLoss: 1200,
      },
    });
    expect(res.top[0].scenarios).toEqual([
      {
        scenario: { key: "refunds_-10", label: "Reduce refunds by 10%", changePct: -0.1 },
        profitLiftMonthly: 10,
        profitLiftAnnual: 120,
        newEstimatedMonthlyLoss: 90,
        newEstimatedAnnualLoss: 1080,
      },
      {
        scenario: { key: "refunds_-20", label: "Reduce refunds by 20%", changePct: -0.2 },
        profitLiftMonthly: 20,
        profitLiftAnnual: 240,
        newEstimatedMonthlyLoss: 80,
        newEstimatedAnnualLoss: 960,
      },
      {
        scenario: { key: "refunds_-30", label: "Reduce refunds by 30%", changePct: -0.3 },
        profitLiftMonthly: 30,
        profitLiftAnnual: 360,
        newEstimatedMonthlyLoss: 70,
        newEstimatedAnnualLoss: 840,
      },
    ]);

    expect(res.top[1].type).toBe("HIGH_FEES");
    expect(res.top[1].scenarios).toEqual([
      {
        scenario: { key: "fees_-10", label: "Reduce fees by 10%", changePct: -0.1 },
        profitLiftMonthly: 20,
        profitLiftAnnual: 240,
        newEstimatedMonthlyLoss: 180,
        newEstimatedAnnualLoss: 2160,
      },
      {
        scenario: { key: "fees_-20", label: "Reduce fees by 20%", changePct: -0.2 },
        profitLiftMonthly: 40,
        profitLiftAnnual: 480,
        newEstimatedMonthlyLoss: 160,
        newEstimatedAnnualLoss: 1920,
      },
      {
        scenario: { key: "fees_-30", label: "Reduce fees by 30%", changePct: -0.3 },
        profitLiftMonthly: 60,
        profitLiftAnnual: 720,
        newEstimatedMonthlyLoss: 140,
        newEstimatedAnnualLoss: 1680,
      },
    ]);

    expect(res.top[2].type).toBe("SHIPPING_SUBSIDY");
    expect(res.top[2].scenarios).toEqual([
      {
        scenario: { key: "ship_-25", label: "Reduce shipping subsidy by 25%", changePct: -0.25 },
        profitLiftMonthly: 20,
        profitLiftAnnual: 240,
        newEstimatedMonthlyLoss: 60,
        newEstimatedAnnualLoss: 720,
      },
      {
        scenario: { key: "ship_-50", label: "Reduce shipping subsidy by 50%", changePct: -0.5 },
        profitLiftMonthly: 40,
        profitLiftAnnual: 480,
        newEstimatedMonthlyLoss: 40,
        newEstimatedAnnualLoss: 480,
      },
      {
        scenario: { key: "ship_-75", label: "Reduce shipping subsidy by 75%", changePct: -0.75 },
        profitLiftMonthly: 60,
        profitLiftAnnual: 720,
        newEstimatedMonthlyLoss: 20,
        newEstimatedAnnualLoss: 240,
      },
    ]);

    expect(res.top[3].type).toBe("LOW_MARGIN");
    expect(res.top[3].scenarios).toEqual([
      {
        scenario: { key: "margin_fix_25", label: "Close 25% of margin gap", changePct: -0.25 },
        profitLiftMonthly: 15,
        profitLiftAnnual: 180,
        newEstimatedMonthlyLoss: 45,
        newEstimatedAnnualLoss: 540,
      },
      {
        scenario: { key: "margin_fix_50", label: "Close 50% of margin gap", changePct: -0.5 },
        profitLiftMonthly: 30,
        profitLiftAnnual: 360,
        newEstimatedMonthlyLoss: 30,
        newEstimatedAnnualLoss: 360,
      },
      {
        scenario: { key: "margin_fix_100", label: "Close 100% of margin gap", changePct: -1 },
        profitLiftMonthly: 60,
        profitLiftAnnual: 720,
        newEstimatedMonthlyLoss: 0,
        newEstimatedAnnualLoss: 0,
      },
    ]);

    expect(res.top[4].type).toBe("NEGATIVE_CM");
    expect(res.top[4].scenarios).toEqual([
      {
        scenario: { key: "neg_fix_25", label: "Fix 25% of unprofitable exposure", changePct: -0.25 },
        profitLiftMonthly: 10,
        profitLiftAnnual: 120,
        newEstimatedMonthlyLoss: 30,
        newEstimatedAnnualLoss: 360,
      },
      {
        scenario: { key: "neg_fix_50", label: "Fix 50% of unprofitable exposure", changePct: -0.5 },
        profitLiftMonthly: 20,
        profitLiftAnnual: 240,
        newEstimatedMonthlyLoss: 20,
        newEstimatedAnnualLoss: 240,
      },
      {
        scenario: { key: "neg_fix_75", label: "Fix 75% of unprofitable exposure", changePct: -0.75 },
        profitLiftMonthly: 30,
        profitLiftAnnual: 360,
        newEstimatedMonthlyLoss: 10,
        newEstimatedAnnualLoss: 120,
      },
    ]);

    expect(res.top[5].type).toBe("MISSING_COGS");
    expect(res.top[5].scenarios).toEqual([
      {
        scenario: { key: "cogs_fix_50", label: "Add COGS for 50% of missing items", changePct: -0.5 },
        profitLiftMonthly: 25,
        profitLiftAnnual: 300,
        newEstimatedMonthlyLoss: 25,
        newEstimatedAnnualLoss: 300,
      },
      {
        scenario: { key: "cogs_fix_100", label: "Add COGS for all missing items", changePct: -1 },
        profitLiftMonthly: 50,
        profitLiftAnnual: 600,
        newEstimatedMonthlyLoss: 0,
        newEstimatedAnnualLoss: 0,
      },
    ]);
  });

  it("uses default fallback scenarios for unsupported opportunity types", () => {
    const res = buildImpactSimulation({
      opportunities: [
        {
          type: "BREAK_EVEN_RISK",
          title: "Break-even risk",
          summary: "Risky economics",
          estimatedMonthlyLoss: 120,
          currency: "USD",
          days: 30,
        },
      ],
    });

    expect(res.top).toHaveLength(1);
    expect(res.top[0].scenarios).toEqual([
      {
        scenario: { key: "improve_25", label: "Improve by 25%", changePct: -0.25 },
        profitLiftMonthly: 30,
        profitLiftAnnual: 360,
        newEstimatedMonthlyLoss: 90,
        newEstimatedAnnualLoss: 1080,
      },
      {
        scenario: { key: "improve_50", label: "Improve by 50%", changePct: -0.5 },
        profitLiftMonthly: 60,
        profitLiftAnnual: 720,
        newEstimatedMonthlyLoss: 60,
        newEstimatedAnnualLoss: 720,
      },
    ]);
  });

  it("clamps limit into allowed range", () => {
    const opps = Array.from({ length: 3 }, (_, i) => ({
      type: "HIGH_FEES" as const,
      title: `Opp ${i + 1}`,
      summary: "x",
      estimatedMonthlyLoss: 100,
      currency: "USD",
      days: 30,
    }));

    const resMin = buildImpactSimulation({
      opportunities: opps,
      limit: 0,
    });
    expect(resMin.top).toHaveLength(1);
    expect(resMin.top[0].title).toBe("Opp 1");

    const manyOpps = Array.from({ length: 60 }, (_, i) => ({
      type: "HIGH_FEES" as const,
      title: `Opp ${i + 1}`,
      summary: "x",
      estimatedMonthlyLoss: 100,
      currency: "USD",
      days: 30,
    }));

    const resMax = buildImpactSimulation({
      opportunities: manyOpps,
      limit: 999,
    });
    expect(resMax.top).toHaveLength(50);
    expect(resMax.top[0].title).toBe("Opp 1");
    expect(resMax.top[49].title).toBe("Opp 50");
  });

  it("handles non-finite estimatedMonthlyLoss defensively", () => {
    const res = buildImpactSimulation({
      opportunities: [
        {
          type: "HIGH_FEES",
          title: "NaN loss",
          summary: "x",
          estimatedMonthlyLoss: Number.NaN,
          currency: "USD",
          days: 30,
        },
        {
          type: "HIGH_FEES",
          title: "Infinity loss",
          summary: "x",
          estimatedMonthlyLoss: Number.POSITIVE_INFINITY,
          currency: "USD",
          days: 30,
        },
      ],
      limit: 2,
    });

    expect(res.top).toHaveLength(2);

    for (const row of res.top) {
      expect(row.estimatedMonthlyLoss).toBe(0);
      expect(row.estimatedAnnualLoss).toBe(0);
      expect(row.baseline).toEqual({
        estimatedMonthlyLoss: 0,
        estimatedAnnualLoss: 0,
      });

      for (const sc of row.scenarios) {
        expect(sc.profitLiftMonthly).toBe(0);
        expect(sc.profitLiftAnnual).toBe(0);
        expect(sc.newEstimatedMonthlyLoss).toBe(0);
        expect(sc.newEstimatedAnnualLoss).toBe(0);
      }
    }
  });

  it("preserves meta when present and leaves it undefined otherwise", () => {
    const res = buildImpactSimulation({
      opportunities: [
        {
          type: "HIGH_FEES",
          title: "With meta",
          summary: "x",
          estimatedMonthlyLoss: 100,
          currency: "USD",
          days: 30,
          meta: { source: "test" },
        },
        {
          type: "HIGH_FEES",
          title: "Without meta",
          summary: "x",
          estimatedMonthlyLoss: 100,
          currency: "USD",
          days: 30,
        },
      ],
      limit: 2,
    });

    expect(res.top[0].meta).toEqual({ source: "test" });
    expect("meta" in res.top[1]).toBe(true);
    expect(res.top[1].meta).toBeUndefined();
  });

  it("returns empty top list for missing opportunities input", () => {
    const res = buildImpactSimulation({
      opportunities: [],
    });

    expect(res).toEqual({
      top: [],
    });
  });
});