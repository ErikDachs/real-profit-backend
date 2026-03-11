import { describe, expect, it } from "vitest";

import {
  annualize,
  lossInPeriodFromMonthly,
  clampPct,
  finalizeShares,
  concentration,
  findOpportunity,
} from "./deepDive.utils.js";

describe("deepDive.utils", () => {
  describe("annualize", () => {
    it("annualizes monthly value", () => {
      expect(annualize(100)).toBe(1200);
    });

    it("returns 0 for falsy input", () => {
      expect(annualize(0)).toBe(0);
      expect(annualize(NaN)).toBe(0);
    });
  });

  describe("lossInPeriodFromMonthly", () => {
    it("converts monthly loss to selected period on 30-day baseline", () => {
      expect(
        lossInPeriodFromMonthly({
          estimatedMonthlyLoss: 300,
          days: 15,
        })
      ).toBe(150);

      expect(
        lossInPeriodFromMonthly({
          estimatedMonthlyLoss: 300,
          days: 60,
        })
      ).toBe(600);
    });

    it("clamps invalid or zero days to minimum 1", () => {
      expect(
        lossInPeriodFromMonthly({
          estimatedMonthlyLoss: 300,
          days: 0,
        })
      ).toBe(10);

      expect(
        lossInPeriodFromMonthly({
          estimatedMonthlyLoss: 300,
          days: -50,
        })
      ).toBe(10);
    });

    it("returns 0 for missing monthly loss", () => {
      expect(
        lossInPeriodFromMonthly({
          estimatedMonthlyLoss: 0,
          days: 30,
        })
      ).toBe(0);
    });
  });

  describe("clampPct", () => {
    it("returns number unchanged when already inside 0..100", () => {
      expect(clampPct(0)).toBe(0);
      expect(clampPct(42.5)).toBe(42.5);
      expect(clampPct(100)).toBe(100);
    });

    it("clamps below 0 to 0", () => {
      expect(clampPct(-1)).toBe(0);
      expect(clampPct(-999)).toBe(0);
    });

    it("clamps above 100 to 100", () => {
      expect(clampPct(101)).toBe(100);
      expect(clampPct(999)).toBe(100);
    });

    it("returns 0 for non-finite values", () => {
      expect(clampPct(NaN)).toBe(0);
      expect(clampPct(Infinity)).toBe(0);
      expect(clampPct(-Infinity)).toBe(0);
    });
  });

  describe("finalizeShares", () => {
    it("rounds impacts and computes impact shares", () => {
      const result = finalizeShares(
        [
          {
            key: "a",
            title: "A",
            impact: 100.123,
            impactSharePct: 0,
          },
          {
            key: "b",
            title: "B",
            impact: 50.555,
            impactSharePct: 0,
          },
        ] as any,
        150.678
      );

      expect(result.totalImpact).toBe(150.68);
expect(result.drivers).toEqual([
  {
    key: "a",
    title: "A",
    impact: 100.12,
    impactSharePct: 66.45,
  },
  {
    key: "b",
    title: "B",
    impact: 50.56,
    impactSharePct: 33.55,
  },
]);
    });

    it("returns 0 shares when total impact is 0", () => {
      const result = finalizeShares(
        [
          {
            key: "a",
            title: "A",
            impact: 10,
            impactSharePct: 0,
          },
        ] as any,
        0
      );

      expect(result.totalImpact).toBe(0);
      expect(result.drivers).toEqual([
        {
          key: "a",
          title: "A",
          impact: 10,
          impactSharePct: 0,
        },
      ]);
    });
  });

  describe("concentration", () => {
    it("computes top1/top3/top5 shares from sorted impacts", () => {
      const result = concentration([
        { key: "a", title: "A", impact: 50, impactSharePct: 0 },
        { key: "b", title: "B", impact: 30, impactSharePct: 0 },
        { key: "c", title: "C", impact: 20, impactSharePct: 0 },
        { key: "d", title: "D", impact: 10, impactSharePct: 0 },
      ] as any);

      expect(result).toEqual({
        top1SharePct: 45.45454545454545,
        top3SharePct: 90.9090909090909,
        top5SharePct: 100,
      });
    });

    it("returns 0 shares when total impact is 0", () => {
      const result = concentration([
        { key: "a", title: "A", impact: 0, impactSharePct: 0 },
        { key: "b", title: "B", impact: 0, impactSharePct: 0 },
      ] as any);

      expect(result).toEqual({
        top1SharePct: 0,
        top3SharePct: 0,
        top5SharePct: 0,
      });
    });

    it("handles empty drivers", () => {
      const result = concentration([]);

      expect(result).toEqual({
        top1SharePct: 0,
        top3SharePct: 0,
        top5SharePct: 0,
      });
    });

    it("sorts by impact descending before computing shares", () => {
      const result = concentration([
        { key: "c", title: "C", impact: 20, impactSharePct: 0 },
        { key: "a", title: "A", impact: 50, impactSharePct: 0 },
        { key: "b", title: "B", impact: 30, impactSharePct: 0 },
      ] as any);

      expect(result.top1SharePct).toBe(50);
      expect(result.top3SharePct).toBe(100);
      expect(result.top5SharePct).toBe(100);
    });
  });

  describe("findOpportunity", () => {
    it("returns matching opportunity by type", () => {
      const opps = [
        {
          type: "HIGH_FEES",
          title: "High fees",
          summary: "Fees are high",
          estimatedMonthlyLoss: 300,
          currency: "USD",
          days: 30,
        },
        {
          type: "SHIPPING_SUBSIDY",
          title: "Shipping subsidy",
          summary: "Shipping loses money",
          estimatedMonthlyLoss: 200,
          currency: "USD",
          days: 30,
        },
      ] as any;

      expect(findOpportunity(opps, "SHIPPING_SUBSIDY")).toEqual(opps[1]);
    });

    it("returns null when not found", () => {
      const opps = [
        {
          type: "HIGH_FEES",
          title: "High fees",
          summary: "Fees are high",
          estimatedMonthlyLoss: 300,
          currency: "USD",
          days: 30,
        },
      ] as any;

      expect(findOpportunity(opps, "LOW_MARGIN")).toBeNull();
    });

    it("returns null for empty input", () => {
      expect(findOpportunity([], "LOW_MARGIN")).toBeNull();
    });
  });
});