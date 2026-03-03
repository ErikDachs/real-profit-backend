// src/domain/opportunities/unifiedOpportunityRanking.test.ts
import { describe, it, expect } from "vitest";
import { buildUnifiedOpportunityRanking } from "./unifiedOpportunityRanking";

function assertScoreSortedDesc(items: any[]) {
  for (let i = 1; i < items.length; i++) {
    const prev = Number(items[i - 1]?.score ?? 0);
    const cur = Number(items[i]?.score ?? 0);
    expect(cur).toBeLessThanOrEqual(prev + 1e-9);
  }
}

describe("buildUnifiedOpportunityRanking", () => {
  it("monthlyize: normalisiert lossInPeriod deterministisch auf 30 Tage", () => {
    // days=10 => factor=30/10=3
    const out = buildUnifiedOpportunityRanking({
      days: 10,
      currency: "EUR",
      refunds: { lossInPeriod: 100 },
    });

    expect(out.all.length).toBe(1);
    expect(out.all[0].type).toBe("HIGH_REFUNDS");
    expect(out.all[0].estimatedMonthlyLoss).toBe(300);

    // new fields exist
    expect(typeof out.all[0].score).toBe("number");
    expect(typeof out.all[0].confidence).toBe("number");
    expect(typeof out.all[0].controllability).toBe("number");
    expect(typeof out.all[0].severity).toBe("string");
  });

  it("filtert estimatedMonthlyLoss<=0 raus (nonZero)", () => {
    const out = buildUnifiedOpportunityRanking({
      days: 30,
      currency: "EUR",
      fees: { lossInPeriod: 0 }, // 0 => muss raus
      refunds: { lossInPeriod: 50 }, // bleibt
      shippingSubsidy: { lossInPeriod: 200 }, // bleibt
    });

    expect(out.all.map((x) => x.type)).toEqual(["SHIPPING_SUBSIDY", "HIGH_REFUNDS"]);
  });

  it("sortiert deterministisch nach score desc (expected value)", () => {
    const out = buildUnifiedOpportunityRanking({
      days: 30,
      currency: "EUR",
      refunds: { lossInPeriod: 50, refundRatePct: 9.9 },
      shippingSubsidy: { lossInPeriod: 200, subsidyRatePct: 3.3 },
    });

    // generally shipping should still outrank refunds here
    expect(out.all[0].type).toBe("SHIPPING_SUBSIDY");
    expect(out.all[1].type).toBe("HIGH_REFUNDS");

    assertScoreSortedDesc(out.all);

    // score must be finite and >= 0
    for (const x of out.all) {
      expect(Number.isFinite(Number(x.score))).toBe(true);
      expect(Number(x.score)).toBeGreaterThanOrEqual(0);
    }
  });

  it("limit: default 5, clamp 1..50", () => {
    const base = {
      days: 30,
      currency: "EUR",
      refunds: { lossInPeriod: 10 },
      fees: { lossInPeriod: 20 },
      shippingSubsidy: { lossInPeriod: 30 },
      profitImpact: {
        lowMargin: { lossInPeriod: 40, marginPct: 10 },
        negativeCm: { lossInPeriod: 50, cm: -5, cmPct: -2 },
      },
    };

    const def = buildUnifiedOpportunityRanking(base as any);
    expect(def.top.length).toBeLessThanOrEqual(5);

    const lim1 = buildUnifiedOpportunityRanking({ ...(base as any), limit: 1 });
    expect(lim1.top.length).toBe(1);

    const limTooHigh = buildUnifiedOpportunityRanking({ ...(base as any), limit: 999 });
    // clamp to 50 but we only have 5 here anyway
    expect(limTooHigh.top.length).toBe(5);

    const limZero = buildUnifiedOpportunityRanking({ ...(base as any), limit: 0 });
    // clamp min 1
    expect(limZero.top.length).toBe(1);
  });

  it("MISSING_COGS wird nur aufgenommen wenn missingCogsCount>0 UND missingCogsLossInPeriod>0", () => {
    const a = buildUnifiedOpportunityRanking({
      days: 30,
      currency: "EUR",
      missingCogsCount: 10,
      missingCogsLossInPeriod: 0,
    });

    expect(a.all.length).toBe(0);

    const b = buildUnifiedOpportunityRanking({
      days: 30,
      currency: "EUR",
      missingCogsCount: 0,
      missingCogsLossInPeriod: 100,
    });

    expect(b.all.length).toBe(0);

    const c = buildUnifiedOpportunityRanking({
      days: 30,
      currency: "EUR",
      missingCogsCount: 10,
      missingCogsLossInPeriod: 100,
    });

    expect(c.all.length).toBe(1);
    expect(c.all[0].type).toBe("MISSING_COGS");
    expect(c.all[0].meta?.missingCogsCount).toBe(10);
    expect(Number(c.all[0].score ?? 0)).toBeGreaterThan(0);
  });

  it("Margin Drift & Break-even Risk nur wenn lossInPeriod>0", () => {
    const out = buildUnifiedOpportunityRanking({
      days: 30,
      currency: "EUR",
      marginDrift: {
        lossInPeriod: 0,
        driftPctPoints: -1,
        shortWindowDays: 7,
        longWindowDays: 30,
        shortCmPct: 10,
        longCmPct: 11,
      },
      breakEvenRisk: {
        lossInPeriod: -5,
        adSpend: 1000,
        currentRoas: 1.5,
        breakEvenRoas: 2.0,
        roasGap: 0.5,
      },
    });

    expect(out.all.length).toBe(0);

    const out2 = buildUnifiedOpportunityRanking({
      days: 30,
      currency: "EUR",
      marginDrift: {
        lossInPeriod: 123,
        driftPctPoints: -1.2,
        shortWindowDays: 7,
        longWindowDays: 30,
        shortCmPct: 10,
        longCmPct: 11.2,
      },
      breakEvenRisk: {
        lossInPeriod: 456,
        adSpend: 1000,
        currentRoas: 1.5,
        breakEvenRoas: 2.0,
        roasGap: 0.5,
      },
    });

    expect(out2.all.some((x) => x.type === "BREAK_EVEN_RISK")).toBe(true);
    expect(out2.all.some((x) => x.type === "MARGIN_DRIFT")).toBe(true);

    assertScoreSortedDesc(out2.all);
  });

  it("setzt meta-Felder korrekt durch (Smoke)", () => {
    const out = buildUnifiedOpportunityRanking({
      days: 15,
      currency: "EUR",
      profitImpact: {
        lowMargin: { lossInPeriod: 100, marginPct: 12.34 },
      },
      refunds: { lossInPeriod: 50, refundRatePct: 9.9 },
      fees: { lossInPeriod: 25, feePctOfNet: 4.4 },
      shippingSubsidy: { lossInPeriod: 10, subsidyRatePct: 3.3 },
    });

    const low = out.all.find((x) => x.type === "LOW_MARGIN")!;
    expect(low.meta?.marginPct).toBe(12.34);

    const refunds = out.all.find((x) => x.type === "HIGH_REFUNDS")!;
    expect(refunds.meta?.refundRatePct).toBe(9.9);

    const fees = out.all.find((x) => x.type === "HIGH_FEES")!;
    expect(fees.meta?.feePctOfNet).toBe(4.4);

    const ship = out.all.find((x) => x.type === "SHIPPING_SUBSIDY")!;
    expect(ship.meta?.subsidyRatePct).toBe(3.3);

    // days=15 => monthlyize factor=2
    expect(low.estimatedMonthlyLoss).toBe(200);
  });
});