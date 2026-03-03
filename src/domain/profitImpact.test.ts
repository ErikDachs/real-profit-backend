import { describe, it, expect } from "vitest";
import { buildProfitImpact } from "./profitImpact.js";

describe("buildProfitImpact", () => {
  it("HIGH_REFUNDS: triggert nur wenn refundRatePct > threshold und skaliert Monthly korrekt", () => {
    // totals: gross=1000, refunds=200 => 20% refunds
    // threshold=10 => excess=10% => loss=(10%)*gross=100
    // days=10 => monthly = 100*(30/10)=300
    const out = buildProfitImpact({
      days: 10,
      currency: "EUR",
      thresholds: { highRefundsPct: 10, lowMarginPct: 15, highFeesPct: 4 },
      orders: [
        {
          id: "o1",
          grossSales: 1000,
          refunds: 200,
          netAfterRefunds: 800,
          cogs: 0,
          paymentFees: 0,
          contributionMargin: 800,
          contributionMarginPct: 100,
          reasons: ["HIGH_REFUNDS"]
        }
      ],
      totals: {
        grossSales: 1000,
        refunds: 200,
        netAfterRefunds: 800,
        cogs: 0,
        paymentFees: 0,
        contributionMargin: 800,
        contributionMarginPct: 100
      }
    });

    const opp = out.all.find((x) => x.reason === "HIGH_REFUNDS")!;
    expect(opp).toBeTruthy();
    expect(opp.estimatedLoss).toBe(100);
    expect(opp.estimatedMonthlyLoss).toBe(300);
  });

  it("HIGH_FEES: triggert wenn feeRatePct > threshold und nutzt netAfterRefunds als Base", () => {
    // totals: net=1000, fees=100 => 10%
    // threshold 4 => excess 6% => loss=0.06*net=60
    // days=30 => monthly = 60
    const out = buildProfitImpact({
      days: 30,
      currency: "EUR",
      thresholds: { highRefundsPct: 10, lowMarginPct: 15, highFeesPct: 4 },
      orders: [
        {
          id: "o1",
          grossSales: 1100,
          refunds: 100,
          netAfterRefunds: 1000,
          cogs: 0,
          paymentFees: 100,
          contributionMargin: 900,
          contributionMarginPct: 90,
          reasons: ["HIGH_FEES"]
        }
      ],
      totals: {
        grossSales: 1100,
        refunds: 100,
        netAfterRefunds: 1000,
        cogs: 0,
        paymentFees: 100,
        contributionMargin: 900,
        contributionMarginPct: 90
      }
    });

    const opp = out.all.find((x) => x.reason === "HIGH_FEES")!;
    expect(opp.estimatedLoss).toBe(60);
    expect(opp.estimatedMonthlyLoss).toBe(60);
  });

  it("LOW_MARGIN: nutzt AFTER_ADS Basis wenn profitAfterAds auf mindestens 1 Order vorhanden ist", () => {
    // Basis AFTER_ADS: selectedProfit = profitAfterAds (wenn gesetzt)
    // totals.net=1000
    // selectedProfit total = sum(profitAfterAds) = 50
    // selectedProfitPct = 5%
    // threshold=15 => gap=10% => loss=0.10*1000=100
    const out = buildProfitImpact({
      days: 30,
      currency: "EUR",
      thresholds: { highRefundsPct: 99, lowMarginPct: 15, highFeesPct: 99 },
      orders: [
        {
          id: "a",
          grossSales: 500,
          refunds: 0,
          netAfterRefunds: 500,
          cogs: 0,
          paymentFees: 0,
          contributionMargin: 200,
          contributionMarginPct: 40,
          profitAfterAds: 10,
          reasons: ["LOW_MARGIN"]
        },
        {
          id: "b",
          grossSales: 500,
          refunds: 0,
          netAfterRefunds: 500,
          cogs: 0,
          paymentFees: 0,
          contributionMargin: 200,
          contributionMarginPct: 40,
          profitAfterAds: 40,
          reasons: ["LOW_MARGIN"]
        }
      ],
      totals: {
        grossSales: 1000,
        refunds: 0,
        netAfterRefunds: 1000,
        cogs: 0,
        paymentFees: 0,
        contributionMargin: 400,
        contributionMarginPct: 40,
        profitAfterAds: 50
      }
    });

    const opp = out.all.find((x) => x.reason === "LOW_MARGIN")!;
    expect(opp).toBeTruthy();
    expect(opp.evidence && (opp.evidence as any).basis).toBe("AFTER_ADS");
    expect(opp.estimatedLoss).toBe(100);
    expect(opp.estimatedMonthlyLoss).toBe(100);
  });

  it("NEGATIVE_CM: zählt negative Orders auf AFTER_ADS wenn verfügbar und loss = Sum(abs(negative profits))", () => {
    // AFTER_ADS basis (profitAfterAds exists)
    // negative orders: -10 and -5 => loss = 15
    // days=15 => monthly = 15*(30/15)=30
    const out = buildProfitImpact({
      days: 15,
      currency: "EUR",
      thresholds: { highRefundsPct: 99, lowMarginPct: 0, highFeesPct: 99 },
      orders: [
        {
          id: "n1",
          grossSales: 100,
          refunds: 0,
          netAfterRefunds: 100,
          cogs: 0,
          paymentFees: 0,
          contributionMargin: 20,
          contributionMarginPct: 20,
          profitAfterAds: -10,
          reasons: ["NEGATIVE_CM"]
        },
        {
          id: "n2",
          grossSales: 100,
          refunds: 0,
          netAfterRefunds: 100,
          cogs: 0,
          paymentFees: 0,
          contributionMargin: 20,
          contributionMarginPct: 20,
          profitAfterAds: -5,
          reasons: ["NEGATIVE_CM"]
        },
        {
          id: "p",
          grossSales: 100,
          refunds: 0,
          netAfterRefunds: 100,
          cogs: 0,
          paymentFees: 0,
          contributionMargin: 20,
          contributionMarginPct: 20,
          profitAfterAds: 1,
          reasons: []
        }
      ],
      totals: {
        grossSales: 300,
        refunds: 0,
        netAfterRefunds: 300,
        cogs: 0,
        paymentFees: 0,
        contributionMargin: 60,
        contributionMarginPct: 20
      }
    });

    const opp = out.all.find((x) => x.reason === "NEGATIVE_CM")!;
    expect(opp).toBeTruthy();
    expect((opp.evidence as any).basis).toBe("AFTER_ADS");
    expect(opp.estimatedLoss).toBe(15);
    expect(opp.estimatedMonthlyLoss).toBe(30);
  });

  it("MISSING_COGS: schätzt loss anhand typischem COGS% der bekannten Orders", () => {
    // missing order net=200 with cogs=0
    // known order: net=100, cogs=30 => typicalCogsPct=0.3
    // loss = 200*0.3 = 60
    // days=30 => monthly=60
    const out = buildProfitImpact({
      days: 30,
      currency: "EUR",
      thresholds: { highRefundsPct: 99, lowMarginPct: 0, highFeesPct: 99 },
      orders: [
        {
          id: "missing",
          grossSales: 200,
          refunds: 0,
          netAfterRefunds: 200,
          cogs: 0,
          paymentFees: 0,
          contributionMargin: 200,
          contributionMarginPct: 100,
          reasons: ["MISSING_COGS"]
        },
        {
          id: "known",
          grossSales: 100,
          refunds: 0,
          netAfterRefunds: 100,
          cogs: 30,
          paymentFees: 0,
          contributionMargin: 70,
          contributionMarginPct: 70,
          reasons: []
        }
      ],
      totals: {
        grossSales: 300,
        refunds: 0,
        netAfterRefunds: 300,
        cogs: 30,
        paymentFees: 0,
        contributionMargin: 270,
        contributionMarginPct: 90
      }
    });

    const opp = out.all.find((x) => x.reason === "MISSING_COGS")!;
    expect(opp).toBeTruthy();
    expect(opp.estimatedLoss).toBe(60);
    expect(opp.estimatedMonthlyLoss).toBe(60);
    expect((opp.evidence as any).missingCogsOrdersCount).toBe(1);
  });

  it("sortiert Opportunities nach estimatedMonthlyLoss desc", () => {
    const out = buildProfitImpact({
      days: 30,
      currency: "EUR",
      thresholds: { highRefundsPct: 0, lowMarginPct: 100, highFeesPct: 0 }, // erzwingt refunds+fees+lowmargin
      orders: [
        {
          id: "x",
          grossSales: 100,
          refunds: 1,
          netAfterRefunds: 99,
          cogs: 0,
          paymentFees: 1,
          contributionMargin: 98,
          contributionMarginPct: 99,
          reasons: ["HIGH_REFUNDS", "HIGH_FEES", "LOW_MARGIN"]
        }
      ],
      totals: {
        grossSales: 100,
        refunds: 1,
        netAfterRefunds: 99,
        cogs: 0,
        paymentFees: 1,
        contributionMargin: 98,
        contributionMarginPct: 99
      }
    });

    // monthlyLoss should be in descending order
    for (let i = 1; i < out.all.length; i++) {
      expect(out.all[i - 1].estimatedMonthlyLoss).toBeGreaterThanOrEqual(out.all[i].estimatedMonthlyLoss);
    }
  });
});
