import { describe, it, expect } from "vitest";
import { buildDailyProfit } from "./profitDaily.js";
import { calcBreakEvenRoas, calcContributionMarginPct } from "./metrics.js";

describe("buildDailyProfit", () => {
  it("aggregiert pro Tag korrekt (inkl. shipping + ads) und berechnet Pct/ROAS über die Metrics-Funktionen", () => {
    const res = buildDailyProfit({
      shop: "test-shop",
      days: 30,
      orderProfits: [
        {
          createdAt: "2026-02-26T10:00:00Z",
          grossSales: 100,
          refunds: 10,
          netAfterRefunds: 90,
          cogs: 30,
          paymentFees: 3,

          profitAfterFees: 57, // nur compatibility field

          contributionMargin: 57, // explizit vorhanden

          shippingRevenue: 5,
          shippingCost: 7,
          profitAfterShipping: 50,

          allocatedAdSpend: 10,
          profitAfterAds: 47,
          profitAfterAdsAndShipping: 40
        },
        {
          createdAt: "2026-02-26T12:00:00Z",
          grossSales: 50,
          refunds: 0,
          netAfterRefunds: 50,
          cogs: 10,
          paymentFees: 2,

          profitAfterFees: 38,

          // contributionMargin absichtlich NICHT gesetzt -> fallback auf profitAfterFees
          shippingRevenue: 0,
          shippingCost: 5,
          // profitAfterShipping absichtlich NICHT gesetzt -> fallback profitAfterFees - shippingCost => 33

          allocatedAdSpend: 5
          // profitAfterAds absichtlich NICHT gesetzt -> fallback profitAfterFees - adSpend => 33
          // profitAfterAdsAndShipping absichtlich NICHT gesetzt -> fallback pAfterShip - adSpend => 28
        }
      ]
    });

    // meta
    expect(res.shop).toBe("test-shop");
    expect(res.days).toBe(30);

    // genau 1 Tag
    expect(res.daily.length).toBe(1);
    const d = res.daily[0];
    expect(d.day).toBe("2026-02-26");
    expect(d.orders).toBe(2);

    // Summen
    expect(d.grossSales).toBe(150);
    expect(d.refunds).toBe(10);
    expect(d.netAfterRefunds).toBe(140);

    expect(d.cogs).toBe(40);
    expect(d.paymentFees).toBe(5);

    // contributionMargin = 57 (explizit) + 38 (fallback profitAfterFees)
    expect(d.contributionMargin).toBe(95);

    // compatibility sum
    expect(d.profitAfterFees).toBe(95);

    // shipping sums + impact
    expect(d.shippingRevenue).toBe(5);
    expect(d.shippingCost).toBe(12);
    expect(d.shippingImpact).toBe(5 - 12); // -7
    expect(d.profitAfterShipping).toBe(50 + 33); // 83

    // ads sums + derived profits
    expect(d.allocatedAdSpend).toBe(15);
    expect(d.profitAfterAds).toBe(47 + 33); // 80
    expect(d.profitAfterAdsAndShipping).toBe(40 + 28); // 68

    // break-even spend = contributionMargin (aggregiert)
    expect(d.adSpendBreakEven).toBe(95);

    // Prozente/ROAS müssen aus metrics kommen (Glue-Test)
    const expectedCmPct = calcContributionMarginPct({
      netAfterRefunds: 140,
      contributionMargin: 95
    });
    const expectedBeRoas = calcBreakEvenRoas({
      netAfterRefunds: 140,
      contributionMargin: 95
    });

    expect(d.contributionMarginPct).toBeCloseTo(expectedCmPct, 2);

    if (expectedBeRoas === null) {
      expect(d.breakEvenRoas).toBeNull();
    } else {
      expect(d.breakEvenRoas).toBeCloseTo(expectedBeRoas, 2);
    }

    // Profit-Margins (shipping / ads / ads+shipping)
    expect(d.profitMarginAfterShippingPct).toBeCloseTo((83 / 140) * 100, 2);
    expect(d.profitMarginAfterAdsPct).toBeCloseTo((80 / 140) * 100, 2);
    expect(d.profitMarginAfterAdsAndShippingPct).toBeCloseTo((68 / 140) * 100, 2);

    // totals müssen exakt den Daily-Werten entsprechen (bei 1 Tag)
    expect(res.totals.orders).toBe(2);
    expect(res.totals.grossSales).toBe(150);
    expect(res.totals.refunds).toBe(10);
    expect(res.totals.netAfterRefunds).toBe(140);

    expect(res.totals.shippingRevenue).toBe(5);
    expect(res.totals.shippingCost).toBe(12);
    expect(res.totals.shippingImpact).toBe(-7);

    expect(res.totals.cogs).toBe(40);
    expect(res.totals.paymentFees).toBe(5);

    expect(res.totals.contributionMargin).toBe(95);

    // totals: adSpendBreakEven ist (aktuell) totals.contributionMargin
    expect(res.totals.adSpendBreakEven).toBe(95);

    expect(res.totals.profitAfterShipping).toBe(83);

    expect(res.totals.allocatedAdSpend).toBe(15);
    expect(res.totals.profitAfterAds).toBe(80);
    expect(res.totals.profitAfterAdsAndShipping).toBe(68);

    // totals profitAfterFees (compatibility)
    expect(res.totals.profitAfterFees).toBe(95);
  });

  it("sortiert unknown day ans Ende und clamped fehlende Dates zu 'unknown'", () => {
    const res = buildDailyProfit({
      shop: "x",
      days: 7,
      orderProfits: [
        {
          createdAt: null,
          grossSales: 10,
          refunds: 0,
          netAfterRefunds: 10,
          cogs: 0,
          paymentFees: 0,
          profitAfterFees: 10
        },
        {
          createdAt: "2026-02-01T00:00:00Z",
          grossSales: 5,
          refunds: 0,
          netAfterRefunds: 5,
          cogs: 0,
          paymentFees: 0,
          profitAfterFees: 5
        }
      ]
    });

    expect(res.daily.length).toBe(2);
    expect(res.daily[0].day).toBe("2026-02-01");
    expect(res.daily[1].day).toBe("unknown");
  });

  it("setzt Break-even ROAS auf null wenn netAfterRefunds 0 ist (via metrics)", () => {
    const res = buildDailyProfit({
      shop: "x",
      days: 1,
      orderProfits: [
        {
          createdAt: "2026-02-02T00:00:00Z",
          grossSales: 0,
          refunds: 0,
          netAfterRefunds: 0,
          cogs: 0,
          paymentFees: 0,
          profitAfterFees: 0,
          contributionMargin: 0
        }
      ]
    });

    expect(res.daily.length).toBe(1);
    const d = res.daily[0];

    const expectedBe = calcBreakEvenRoas({ netAfterRefunds: 0, contributionMargin: 0 });
    if (expectedBe === null) {
      expect(d.breakEvenRoas).toBeNull();
    } else {
      expect(d.breakEvenRoas).toBeCloseTo(expectedBe, 2);
    }
  });
});
