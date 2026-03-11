import { describe, it, expect } from "vitest";
import {
  allocateAdSpendForOrders,
  allocateAdSpendForProducts,
  computeProfitAfterAds,
} from "./ads.js";

describe("profit/ads.ts", () => {
  describe("computeProfitAfterAds", () => {
    it("subtracts allocated ad spend from profit", () => {
      expect(
        computeProfitAfterAds({
          profitBeforeAds: 100,
          allocatedAdSpend: 25,
        })
      ).toBe(75);
    });

    it("rounds to 2 decimals", () => {
      expect(
        computeProfitAfterAds({
          profitBeforeAds: 100.105,
          allocatedAdSpend: 0.104,
        })
      ).toBe(100);
    });

    it("supports negative results", () => {
      expect(
        computeProfitAfterAds({
          profitBeforeAds: 10,
          allocatedAdSpend: 25,
        })
      ).toBe(-15);
    });

    it("coerces falsy values to 0", () => {
      expect(
        computeProfitAfterAds({
          profitBeforeAds: 0 as any,
          allocatedAdSpend: undefined as any,
        })
      ).toBe(0);
    });
  });

  describe("allocateAdSpendForOrders", () => {
    it("returns zero allocations when adSpend <= 0", () => {
      const out = allocateAdSpendForOrders({
        rows: [
          { id: 1, netAfterRefunds: 100 },
          { id: 2, netAfterRefunds: 200 },
        ],
        adSpend: 0,
        mode: "BY_NET_SALES",
      });

      expect(out.map((x) => x.allocatedAdSpend)).toEqual([0, 0]);
    });

    it("returns zero allocations when adSpend is invalid", () => {
      const out = allocateAdSpendForOrders({
        rows: [
          { id: 1, netAfterRefunds: 100 },
          { id: 2, netAfterRefunds: 200 },
        ],
        adSpend: Number.NaN,
        mode: "BY_NET_SALES",
      });

      expect(out.map((x) => x.allocatedAdSpend)).toEqual([0, 0]);
    });

    it("returns empty array for empty rows", () => {
      const out = allocateAdSpendForOrders({
        rows: [],
        adSpend: 50,
        mode: "BY_NET_SALES",
      });

      expect(out).toEqual([]);
    });

    it("allocates evenly in PER_ORDER mode", () => {
      const out = allocateAdSpendForOrders({
        rows: [
          { id: 1, netAfterRefunds: 100 },
          { id: 2, netAfterRefunds: 300 },
          { id: 3, netAfterRefunds: 600 },
        ],
        adSpend: 30,
        mode: "PER_ORDER",
      });

      expect(out.map((x) => x.allocatedAdSpend)).toEqual([10, 10, 10]);
    });

    it("preserves row shape in PER_ORDER mode", () => {
      const out = allocateAdSpendForOrders({
        rows: [
          { id: 1, name: "#1", netAfterRefunds: 100 },
          { id: 2, name: "#2", netAfterRefunds: 200 },
        ],
        adSpend: 20,
        mode: "PER_ORDER",
      });

      expect(out[0]).toMatchObject({
        id: 1,
        name: "#1",
        netAfterRefunds: 100,
        allocatedAdSpend: 10,
      });

      expect(out[1]).toMatchObject({
        id: 2,
        name: "#2",
        netAfterRefunds: 200,
        allocatedAdSpend: 10,
      });
    });

    it("PER_ORDER can leave rounding shortfall because there is no drift correction there", () => {
      const out = allocateAdSpendForOrders({
        rows: [
          { id: 1, netAfterRefunds: 100 },
          { id: 2, netAfterRefunds: 100 },
          { id: 3, netAfterRefunds: 100 },
        ],
        adSpend: 10,
        mode: "PER_ORDER",
      });

      const allocs = out.map((x) => x.allocatedAdSpend);
      const sum = allocs.reduce((a, b) => a + b, 0);

      expect(allocs).toEqual([3.33, 3.33, 3.33]);
      expect(sum).toBe(9.99);
    });

    it("allocates proportionally in BY_NET_SALES mode", () => {
      const out = allocateAdSpendForOrders({
        rows: [
          { id: 1, netAfterRefunds: 100 },
          { id: 2, netAfterRefunds: 300 },
        ],
        adSpend: 40,
        mode: "BY_NET_SALES",
      });

      expect(out.map((x) => x.allocatedAdSpend)).toEqual([10, 30]);
    });

    it("corrects rounding drift on the last row in BY_NET_SALES mode", () => {
      const out = allocateAdSpendForOrders({
        rows: [
          { id: 1, netAfterRefunds: 1 },
          { id: 2, netAfterRefunds: 1 },
          { id: 3, netAfterRefunds: 1 },
        ],
        adSpend: 10,
        mode: "BY_NET_SALES",
      });

      const allocs = out.map((x) => x.allocatedAdSpend);
      const sum = allocs.reduce((a, b) => a + b, 0);

      expect(allocs).toEqual([3.33, 3.33, 3.34]);
      expect(sum).toBe(10);
    });

    it("falls back to even split in BY_NET_SALES mode when total net <= 0", () => {
      const out = allocateAdSpendForOrders({
        rows: [
          { id: 1, netAfterRefunds: 0 },
          { id: 2, netAfterRefunds: 0 },
        ],
        adSpend: 10,
        mode: "BY_NET_SALES",
      });

      expect(out.map((x) => x.allocatedAdSpend)).toEqual([5, 5]);
    });

    it("allows negative net rows but uses their numeric value in proportional weighting", () => {
      const out = allocateAdSpendForOrders({
        rows: [
          { id: 1, netAfterRefunds: -100 },
          { id: 2, netAfterRefunds: 200 },
        ],
        adSpend: 10,
        mode: "BY_NET_SALES",
      });

      const allocs = out.map((x) => x.allocatedAdSpend);
      const sum = allocs.reduce((a, b) => a + b, 0);

      expect(sum).toBe(10);
      expect(allocs).toEqual([-10, 20]);
    });

it("propagates NaN when a truthy invalid netAfterRefunds value is used in BY_NET_SALES mode", () => {
  const out = allocateAdSpendForOrders({
    rows: [
      { id: 1, netAfterRefunds: "abc" as any },
      { id: 2, netAfterRefunds: 50 },
    ],
    adSpend: 15,
    mode: "BY_NET_SALES",
  });

  const allocs = out.map((x) => x.allocatedAdSpend);

  expect(Number.isNaN(allocs[0])).toBe(true);
  expect(Number.isNaN(allocs[1])).toBe(true);
});

it("works with decimal ad spend using the implementation's rounding order", () => {
  const out = allocateAdSpendForOrders({
    rows: [
      { id: 1, netAfterRefunds: 50 },
      { id: 2, netAfterRefunds: 50 },
    ],
    adSpend: 12.35,
    mode: "BY_NET_SALES",
  });

  expect(out.map((x) => x.allocatedAdSpend)).toEqual([6.18, 6.17]);
});
  });

  describe("allocateAdSpendForProducts", () => {
    it("returns zero allocations when adSpend <= 0", () => {
      const out = allocateAdSpendForProducts({
        rows: [
          { id: 1, netSales: 100 },
          { id: 2, netSales: 200 },
        ],
        adSpend: 0,
      });

      expect(out.map((x) => x.allocatedAdSpend)).toEqual([0, 0]);
    });

    it("returns empty array for empty rows", () => {
      const out = allocateAdSpendForProducts({
        rows: [],
        adSpend: 50,
      });

      expect(out).toEqual([]);
    });

    it("allocates proportionally by netSales", () => {
      const out = allocateAdSpendForProducts({
        rows: [
          { id: 1, netSales: 100 },
          { id: 2, netSales: 300 },
        ],
        adSpend: 40,
      });

      expect(out.map((x) => x.allocatedAdSpend)).toEqual([10, 30]);
    });

    it("corrects rounding drift on the last row", () => {
      const out = allocateAdSpendForProducts({
        rows: [
          { id: 1, netSales: 1 },
          { id: 2, netSales: 1 },
          { id: 3, netSales: 1 },
        ],
        adSpend: 10,
      });

      const allocs = out.map((x) => x.allocatedAdSpend);
      const sum = allocs.reduce((a, b) => a + b, 0);

      expect(allocs).toEqual([3.33, 3.33, 3.34]);
      expect(sum).toBe(10);
    });

    it("falls back to even split when total netSales <= 0", () => {
      const out = allocateAdSpendForProducts({
        rows: [
          { id: 1, netSales: 0 },
          { id: 2, netSales: 0 },
        ],
        adSpend: 10,
      });

      expect(out.map((x) => x.allocatedAdSpend)).toEqual([5, 5]);
    });

    it("uses raw numeric coercion for negative netSales too", () => {
      const out = allocateAdSpendForProducts({
        rows: [
          { id: 1, netSales: -100 },
          { id: 2, netSales: 200 },
        ],
        adSpend: 10,
      });

      const allocs = out.map((x) => x.allocatedAdSpend);
      const sum = allocs.reduce((a, b) => a + b, 0);

      expect(sum).toBe(10);
      expect(allocs).toEqual([-10, 20]);
    });

    it("preserves row shape", () => {
      const out = allocateAdSpendForProducts({
        rows: [
          { id: 1, sku: "A", netSales: 50 },
          { id: 2, sku: "B", netSales: 50 },
        ],
        adSpend: 10,
      });

      expect(out[0]).toMatchObject({ id: 1, sku: "A", allocatedAdSpend: 5 });
      expect(out[1]).toMatchObject({ id: 2, sku: "B", allocatedAdSpend: 5 });
    });
  });
});