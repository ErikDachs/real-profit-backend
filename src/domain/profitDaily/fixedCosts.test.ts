import { describe, it, expect } from "vitest";
import { ensureFixedCosts } from "./fixedCosts.js";

describe("profitDaily/fixedCosts.ts", () => {
  it("keeps upstream fixed costs when all rows already have fixedCostAllocated", () => {
    const out = ensureFixedCosts({
      orderProfits: [
        {
          id: 1,
          netAfterRefunds: 100,
          profitAfterAdsAndShipping: 80,
          fixedCostAllocated: 10,
        },
        {
          id: 2,
          netAfterRefunds: 200,
          profitAfterAdsAndShipping: 150,
          fixedCostAllocated: 20,
        },
      ],
      fixedCostsAllocatedInPeriod: 999,
      fixedCostsAllocationMode: "PER_ORDER",
    } as any);

    expect(out).toEqual([
      expect.objectContaining({
        id: 1,
        fixedCostAllocated: 10,
        profitAfterFixedCosts: 70,
      }),
      expect.objectContaining({
        id: 2,
        fixedCostAllocated: 20,
        profitAfterFixedCosts: 130,
      }),
    ]);
  });

  it("preserves upstream profitAfterFixedCosts when already provided", () => {
    const out = ensureFixedCosts({
      orderProfits: [
        {
          id: 1,
          netAfterRefunds: 100,
          profitAfterAdsAndShipping: 80,
          fixedCostAllocated: 10,
          profitAfterFixedCosts: 66.66,
        },
      ],
      fixedCostsAllocatedInPeriod: 500,
      fixedCostsAllocationMode: "PER_ORDER",
    } as any);

    expect(out[0]).toMatchObject({
      id: 1,
      fixedCostAllocated: 10,
      profitAfterFixedCosts: 66.66,
    });
  });

  it("returns rows with zero fixed costs when total is 0", () => {
    const out = ensureFixedCosts({
      orderProfits: [
        {
          id: 1,
          netAfterRefunds: 100,
          profitAfterAdsAndShipping: 80,
        },
        {
          id: 2,
          netAfterRefunds: 200,
          profitAfterAdsAndShipping: 150,
        },
      ],
      fixedCostsAllocatedInPeriod: 0,
      fixedCostsAllocationMode: "PER_ORDER",
    } as any);

    expect(out).toEqual([
      expect.objectContaining({
        id: 1,
        fixedCostAllocated: 0,
        profitAfterFixedCosts: 80,
      }),
      expect.objectContaining({
        id: 2,
        fixedCostAllocated: 0,
        profitAfterFixedCosts: 150,
      }),
    ]);
  });

  it("returns rows with zero fixed costs when total is invalid", () => {
    const out = ensureFixedCosts({
      orderProfits: [
        {
          id: 1,
          netAfterRefunds: 100,
          profitAfterAdsAndShipping: 80,
        },
      ],
      fixedCostsAllocatedInPeriod: Number.NaN,
      fixedCostsAllocationMode: "PER_ORDER",
    } as any);

    expect(out[0]).toMatchObject({
      id: 1,
      fixedCostAllocated: 0,
      profitAfterFixedCosts: 80,
    });
  });

  it("does not invent calendar allocation for BY_DAYS and simply normalizes existing values", () => {
    const out = ensureFixedCosts({
      orderProfits: [
        {
          id: 1,
          netAfterRefunds: 100,
          profitAfterAdsAndShipping: 80,
        },
        {
          id: 2,
          netAfterRefunds: 200,
          profitAfterAdsAndShipping: 150,
          fixedCostAllocated: 2.345,
        },
      ],
      fixedCostsAllocatedInPeriod: 50,
      fixedCostsAllocationMode: "BY_DAYS",
    } as any);

    expect(out).toEqual([
      expect.objectContaining({
        id: 1,
        fixedCostAllocated: 0,
        profitAfterFixedCosts: 80,
      }),
      expect.objectContaining({
        id: 2,
        fixedCostAllocated: 2.35,
        profitAfterFixedCosts: 147.65,
      }),
    ]);
  });

  it("allocates PER_ORDER when upstream did not provide fixed costs", () => {
    const out = ensureFixedCosts({
      orderProfits: [
        {
          id: 1,
          netAfterRefunds: 100,
          profitAfterAdsAndShipping: 80,
        },
        {
          id: 2,
          netAfterRefunds: 200,
          profitAfterAdsAndShipping: 150,
        },
      ],
      fixedCostsAllocatedInPeriod: 20,
      fixedCostsAllocationMode: "PER_ORDER",
    } as any);

    expect(out).toEqual([
      expect.objectContaining({
        id: 1,
        fixedCostAllocated: 10,
        profitAfterFixedCosts: 70,
      }),
      expect.objectContaining({
        id: 2,
        fixedCostAllocated: 10,
        profitAfterFixedCosts: 140,
      }),
    ]);
  });

  it("allocates BY_NET_SALES proportionally", () => {
    const out = ensureFixedCosts({
      orderProfits: [
        {
          id: 1,
          netAfterRefunds: 100,
          profitAfterAdsAndShipping: 80,
        },
        {
          id: 2,
          netAfterRefunds: 300,
          profitAfterAdsAndShipping: 200,
        },
      ],
      fixedCostsAllocatedInPeriod: 40,
      fixedCostsAllocationMode: "BY_NET_SALES",
    } as any);

    expect(out).toEqual([
      expect.objectContaining({
        id: 1,
        fixedCostAllocated: 10,
        profitAfterFixedCosts: 70,
      }),
      expect.objectContaining({
        id: 2,
        fixedCostAllocated: 30,
        profitAfterFixedCosts: 170,
      }),
    ]);
  });

  it("rounds fixedCostAllocated and profitAfterFixedCosts after PER_ORDER allocation", () => {
    const out = ensureFixedCosts({
      orderProfits: [
        {
          id: 1,
          netAfterRefunds: 100,
          profitAfterAdsAndShipping: 80.115,
        },
        {
          id: 2,
          netAfterRefunds: 100,
          profitAfterAdsAndShipping: 80.115,
        },
      ],
      fixedCostsAllocatedInPeriod: 12.35,
      fixedCostsAllocationMode: "PER_ORDER",
    } as any);

    expect(out[0]).toMatchObject({
      fixedCostAllocated: 6.18,
      profitAfterFixedCosts: 73.94,
    });

    expect(out[1]).toMatchObject({
      fixedCostAllocated: 6.18,
      profitAfterFixedCosts: 73.94,
    });
  });

  it("rounds fixedCostAllocated and profitAfterFixedCosts after BY_NET_SALES allocation", () => {
    const out = ensureFixedCosts({
      orderProfits: [
        {
          id: 1,
          netAfterRefunds: 50,
          profitAfterAdsAndShipping: 20,
        },
        {
          id: 2,
          netAfterRefunds: 50,
          profitAfterAdsAndShipping: 20,
        },
      ],
      fixedCostsAllocatedInPeriod: 12.35,
      fixedCostsAllocationMode: "BY_NET_SALES",
    } as any);

    expect(out[0]).toMatchObject({
      fixedCostAllocated: 6.18,
      profitAfterFixedCosts: 13.82,
    });

    expect(out[1]).toMatchObject({
      fixedCostAllocated: 6.17,
      profitAfterFixedCosts: 13.83,
    });
  });

  it("handles empty rows", () => {
    const out = ensureFixedCosts({
      orderProfits: [],
      fixedCostsAllocatedInPeriod: 50,
      fixedCostsAllocationMode: "PER_ORDER",
    } as any);

    expect(out).toEqual([]);
  });

  it("normalizes fixedCostsAllocationMode fallback to PER_ORDER for unknown modes", () => {
    const out = ensureFixedCosts({
      orderProfits: [
        {
          id: 1,
          netAfterRefunds: 100,
          profitAfterAdsAndShipping: 80,
        },
        {
          id: 2,
          netAfterRefunds: 100,
          profitAfterAdsAndShipping: 80,
        },
      ],
      fixedCostsAllocatedInPeriod: 20,
      fixedCostsAllocationMode: "SOMETHING_ELSE",
    } as any);

    expect(out).toEqual([
      expect.objectContaining({
        id: 1,
        fixedCostAllocated: 10,
        profitAfterFixedCosts: 70,
      }),
      expect.objectContaining({
        id: 2,
        fixedCostAllocated: 10,
        profitAfterFixedCosts: 70,
      }),
    ]);
  });
});