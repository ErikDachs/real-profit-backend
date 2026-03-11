import { describe, expect, it } from "vitest";
import { buildProfitScenarioResult } from "./profitScenarioSimulation.js";

describe("buildProfitScenarioResult", () => {
  it("calculates absolute and percentage deltas for normal numeric inputs", () => {
    const result = buildProfitScenarioResult({
      baseline: {
        profitAfterFees: 100,
        profitAfterShipping: 80,
        paymentFees: 20,
        shippingCost: 10,
        contributionMargin: 140,
        contributionMarginPct: 35,
        breakEvenRoas: 2.5,
        profitMarginAfterShippingPct: 20,
      },
      simulated: {
        profitAfterFees: 130,
        profitAfterShipping: 110,
        paymentFees: 12,
        shippingCost: 6,
        contributionMargin: 160,
        contributionMarginPct: 40,
        breakEvenRoas: 2.1,
        profitMarginAfterShippingPct: 27,
      },
    });

    expect(result).toEqual({
      baseline: {
        profitAfterFees: 100,
        profitAfterShipping: 80,
        paymentFees: 20,
        shippingCost: 10,
        contributionMargin: 140,
        contributionMarginPct: 35,
        breakEvenRoas: 2.5,
        profitMarginAfterShippingPct: 20,
      },
      simulated: {
        profitAfterFees: 130,
        profitAfterShipping: 110,
        paymentFees: 12,
        shippingCost: 6,
        contributionMargin: 160,
        contributionMarginPct: 40,
        breakEvenRoas: 2.1,
        profitMarginAfterShippingPct: 27,
      },
      delta: {
        profitLiftAfterFees: 30,
        profitLiftAfterShipping: 30,
        paymentFeesChange: -8,
        shippingCostChange: -4,
        contributionMarginChange: 20,
        contributionMarginPctChange: 5,
        breakEvenRoasChange: -0.4,
        profitAfterShippingChange: 30,
        profitMarginAfterShippingPctChange: 7,
        profitAfterShippingPctChange: 37.5,
      },
    });
  });

  it("returns null for pct-based fields when baseline or simulated pct inputs are null", () => {
    const result = buildProfitScenarioResult({
      baseline: {
        profitAfterFees: 100,
        profitAfterShipping: 50,
        paymentFees: 10,
        shippingCost: 5,
        contributionMargin: 90,
        contributionMarginPct: null,
        breakEvenRoas: null,
        profitMarginAfterShippingPct: null,
      },
      simulated: {
        profitAfterFees: 110,
        profitAfterShipping: 60,
        paymentFees: 8,
        shippingCost: 4,
        contributionMargin: 100,
        contributionMarginPct: null,
        breakEvenRoas: null,
        profitMarginAfterShippingPct: null,
      },
    });

    expect(result.delta.contributionMarginPctChange).toBeNull();
    expect(result.delta.breakEvenRoasChange).toBeNull();
    expect(result.delta.profitMarginAfterShippingPctChange).toBeNull();

    expect(result.delta.profitLiftAfterFees).toBe(10);
    expect(result.delta.profitLiftAfterShipping).toBe(10);
    expect(result.delta.paymentFeesChange).toBe(-2);
    expect(result.delta.shippingCostChange).toBe(-1);
    expect(result.delta.contributionMarginChange).toBe(10);
    expect(result.delta.profitAfterShippingChange).toBe(10);
    expect(result.delta.profitAfterShippingPctChange).toBe(20);
  });

  it("returns null for profitAfterShippingPctChange when baseline profitAfterShipping is zero", () => {
    const result = buildProfitScenarioResult({
      baseline: {
        profitAfterFees: 100,
        profitAfterShipping: 0,
        paymentFees: 10,
        shippingCost: 5,
        contributionMargin: 90,
        contributionMarginPct: 30,
        breakEvenRoas: 2,
        profitMarginAfterShippingPct: 10,
      },
      simulated: {
        profitAfterFees: 110,
        profitAfterShipping: 25,
        paymentFees: 8,
        shippingCost: 4,
        contributionMargin: 100,
        contributionMarginPct: 35,
        breakEvenRoas: 1.8,
        profitMarginAfterShippingPct: 15,
      },
    });

    expect(result.delta.profitAfterShippingPctChange).toBeNull();
    expect(result.delta.profitAfterShippingChange).toBe(25);
    expect(result.delta.contributionMarginPctChange).toBe(5);
    expect(result.delta.breakEvenRoasChange).toBe(-0.2);
    expect(result.delta.profitMarginAfterShippingPctChange).toBe(5);
  });

  it("falls back missing numeric inputs to zero", () => {
    const result = buildProfitScenarioResult({
      baseline: {},
      simulated: {},
    });

    expect(result).toEqual({
      baseline: {},
      simulated: {},
      delta: {
        profitLiftAfterFees: 0,
        profitLiftAfterShipping: 0,
        paymentFeesChange: 0,
        shippingCostChange: 0,
        contributionMarginChange: 0,
        contributionMarginPctChange: 0,
        breakEvenRoasChange: 0,
        profitAfterShippingChange: 0,
        profitMarginAfterShippingPctChange: 0,
        profitAfterShippingPctChange: null,
      },
    });
  });

  it("handles negative changes correctly", () => {
    const result = buildProfitScenarioResult({
      baseline: {
        profitAfterFees: 150,
        profitAfterShipping: 120,
        paymentFees: 10,
        shippingCost: 8,
        contributionMargin: 180,
        contributionMarginPct: 45,
        breakEvenRoas: 1.8,
        profitMarginAfterShippingPct: 30,
      },
      simulated: {
        profitAfterFees: 100,
        profitAfterShipping: 90,
        paymentFees: 18,
        shippingCost: 12,
        contributionMargin: 140,
        contributionMarginPct: 35,
        breakEvenRoas: 2.4,
        profitMarginAfterShippingPct: 22,
      },
    });

    expect(result.delta.profitLiftAfterFees).toBe(-50);
    expect(result.delta.profitLiftAfterShipping).toBe(-30);
    expect(result.delta.paymentFeesChange).toBe(8);
    expect(result.delta.shippingCostChange).toBe(4);
    expect(result.delta.contributionMarginChange).toBe(-40);
    expect(result.delta.contributionMarginPctChange).toBe(-10);
    expect(result.delta.breakEvenRoasChange).toBe(0.6);
    expect(result.delta.profitAfterShippingChange).toBe(-30);
    expect(result.delta.profitMarginAfterShippingPctChange).toBe(-8);
    expect(result.delta.profitAfterShippingPctChange).toBe(-25);
  });

  it("treats null pct fields differently from missing fields", () => {
    const result = buildProfitScenarioResult({
      baseline: {
        contributionMarginPct: null,
        breakEvenRoas: undefined,
        profitMarginAfterShippingPct: null,
        profitAfterShipping: 40,
      },
      simulated: {
        contributionMarginPct: 25,
        breakEvenRoas: undefined,
        profitMarginAfterShippingPct: 10,
        profitAfterShipping: 50,
      },
    });

    expect(result.delta.contributionMarginPctChange).toBeNull();
    expect(result.delta.breakEvenRoasChange).toBe(0);
    expect(result.delta.profitMarginAfterShippingPctChange).toBeNull();
    expect(result.delta.profitAfterShippingPctChange).toBe(25);
  });
});