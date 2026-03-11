import { describe, it, expect } from "vitest";
import { allocateFixedCostsForOrders } from "./fixedCosts.js";

describe("profit/fixedCosts.ts", () => {
  describe("allocateFixedCostsForOrders", () => {
    it("returns zero allocations when fixedCostsTotal <= 0", () => {
      const out = allocateFixedCostsForOrders({
        rows: [
          { id: 1, netAfterRefunds: 100 },
          { id: 2, netAfterRefunds: 200 },
        ],
        fixedCostsTotal: 0,
        mode: "PER_ORDER",
      });

      expect(out.map((x) => x.fixedCostAllocated)).toEqual([0, 0]);
    });

    it("returns zero allocations when fixedCostsTotal is invalid", () => {
      const out = allocateFixedCostsForOrders({
        rows: [
          { id: 1, netAfterRefunds: 100 },
          { id: 2, netAfterRefunds: 200 },
        ],
        fixedCostsTotal: Number.NaN,
        mode: "PER_ORDER",
      });

      expect(out.map((x) => x.fixedCostAllocated)).toEqual([0, 0]);
    });

    it("returns empty array for empty rows", () => {
      const out = allocateFixedCostsForOrders({
        rows: [],
        fixedCostsTotal: 50,
        mode: "PER_ORDER",
      });

      expect(out).toEqual([]);
    });

    it("allocates evenly in PER_ORDER mode", () => {
      const out = allocateFixedCostsForOrders({
        rows: [
          { id: 1, netAfterRefunds: 100 },
          { id: 2, netAfterRefunds: 200 },
          { id: 3, netAfterRefunds: 300 },
        ],
        fixedCostsTotal: 30,
        mode: "PER_ORDER",
      });

      expect(out.map((x) => x.fixedCostAllocated)).toEqual([10, 10, 10]);
    });

    it("PER_ORDER can leave rounding shortfall because there is no drift correction there", () => {
      const out = allocateFixedCostsForOrders({
        rows: [
          { id: 1, netAfterRefunds: 100 },
          { id: 2, netAfterRefunds: 100 },
          { id: 3, netAfterRefunds: 100 },
        ],
        fixedCostsTotal: 10,
        mode: "PER_ORDER",
      });

      const allocs = out.map((x) => x.fixedCostAllocated);
      const sum = allocs.reduce((a, b) => a + b, 0);

      expect(allocs).toEqual([3.33, 3.33, 3.33]);
      expect(sum).toBe(9.99);
    });

    it("preserves row shape", () => {
      const out = allocateFixedCostsForOrders({
        rows: [
          { id: 1, name: "#1", netAfterRefunds: 100 },
          { id: 2, name: "#2", netAfterRefunds: 200 },
        ],
        fixedCostsTotal: 20,
        mode: "PER_ORDER",
      });

      expect(out[0]).toMatchObject({
        id: 1,
        name: "#1",
        netAfterRefunds: 100,
        fixedCostAllocated: 10,
      });

      expect(out[1]).toMatchObject({
        id: 2,
        name: "#2",
        netAfterRefunds: 200,
        fixedCostAllocated: 10,
      });
    });

    it("allocates proportionally in BY_NET_SALES mode", () => {
      const out = allocateFixedCostsForOrders({
        rows: [
          { id: 1, netAfterRefunds: 100 },
          { id: 2, netAfterRefunds: 300 },
        ],
        fixedCostsTotal: 40,
        mode: "BY_NET_SALES",
      });

      expect(out.map((x) => x.fixedCostAllocated)).toEqual([10, 30]);
    });

    it("corrects rounding drift on the last row in BY_NET_SALES mode", () => {
      const out = allocateFixedCostsForOrders({
        rows: [
          { id: 1, netAfterRefunds: 1 },
          { id: 2, netAfterRefunds: 1 },
          { id: 3, netAfterRefunds: 1 },
        ],
        fixedCostsTotal: 10,
        mode: "BY_NET_SALES",
      });

      const allocs = out.map((x) => x.fixedCostAllocated);
      const sum = allocs.reduce((a, b) => a + b, 0);

      expect(allocs).toEqual([3.33, 3.33, 3.34]);
      expect(sum).toBe(10);
    });

    it("falls back to even split in BY_NET_SALES mode when totalNet <= 0", () => {
      const out = allocateFixedCostsForOrders({
        rows: [
          { id: 1, netAfterRefunds: 0 },
          { id: 2, netAfterRefunds: 0 },
        ],
        fixedCostsTotal: 10,
        mode: "BY_NET_SALES",
      });

      expect(out.map((x) => x.fixedCostAllocated)).toEqual([5, 5]);
    });

    it("uses raw numeric coercion for negative netAfterRefunds too", () => {
      const out = allocateFixedCostsForOrders({
        rows: [
          { id: 1, netAfterRefunds: -100 },
          { id: 2, netAfterRefunds: 200 },
        ],
        fixedCostsTotal: 10,
        mode: "BY_NET_SALES",
      });

      const allocs = out.map((x) => x.fixedCostAllocated);
      const sum = allocs.reduce((a, b) => a + b, 0);

      expect(sum).toBe(10);
      expect(allocs).toEqual([-10, 20]);
    });

it("propagates NaN when a truthy invalid netAfterRefunds value is used in BY_NET_SALES mode", () => {
  const out = allocateFixedCostsForOrders({
    rows: [
      { id: 1, netAfterRefunds: "abc" as any },
      { id: 2, netAfterRefunds: 50 },
    ],
    fixedCostsTotal: 15,
    mode: "BY_NET_SALES",
  });

  const allocs = out.map((x) => x.fixedCostAllocated);

  expect(Number.isNaN(allocs[0])).toBe(true);
  expect(Number.isNaN(allocs[1])).toBe(true);
});

it("works with decimal fixed cost totals using the implementation's rounding order", () => {
  const out = allocateFixedCostsForOrders({
    rows: [
      { id: 1, netAfterRefunds: 50 },
      { id: 2, netAfterRefunds: 50 },
    ],
    fixedCostsTotal: 12.35,
    mode: "BY_NET_SALES",
  });

  expect(out.map((x) => x.fixedCostAllocated)).toEqual([6.18, 6.17]);
});
  });
});