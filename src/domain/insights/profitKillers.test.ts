import { describe, it, expect, vi } from "vitest";

// ---- Mock: unified ranking & simulation (nicht Kern dieser Tests)
vi.mock("../opportunities/unifiedOpportunityRanking", () => {
  return {
    buildUnifiedOpportunityRanking: () => ({
      top: [{ type: "MOCK", estimatedMonthlyLoss: 123 }],
      all: [{ type: "MOCK", estimatedMonthlyLoss: 123 }],
    }),
  };
});

vi.mock("../simulations/impactSimulation", () => {
  return {
    buildImpactSimulation: ({ opportunities }: any) => ({
      top: (opportunities ?? []).slice(0, 5),
    }),
  };
});

// ---- Mock: margin drift & break-even risk (damit wir gezielt Szenarien testen)
vi.mock("./marginDrift", () => {
  return {
    detectMarginDrift: () => ({
      type: "marginDrift",
      status: "DETERIORATING",
      estimatedLossInPeriod: 50,
      driftPctPoints: -1.2,
      shortWindowDays: 7,
      longWindowDays: 30,
      shortCmPct: 10,
      longCmPct: 11.2,
    }),
  };
});

vi.mock("./breakEvenRisk", () => {
  return {
    computeBreakEvenRisk: () => ({
      type: "breakEvenRisk",
      status: "BURNING_CASH",
      lossInPeriod: 120,
      adSpend: 1000,
      currentRoas: 1.5,
      breakEvenRoas: 2.0,
      meta: { roasGap: 0.5 },
    }),
  };
});

import { buildProfitKillersInsights } from "./profitKillers";

type OrderRow = any;
type ProductRow = any;

function getRankedTop(out: any): any[] {
  // Support BOTH response shapes:
  // - old: out.unifiedOpportunitiesTop5
  // - new: out.opportunities.top  (if you decided to move ranking there)
  return out?.unifiedOpportunitiesTop5 ?? out?.opportunities?.top ?? [];
}

function getRankedAll(out: any): any[] {
  return out?.unifiedOpportunitiesAll ?? out?.opportunities?.all ?? [];
}

describe("buildProfitKillersInsights", () => {
  it("berechnet totals korrekt, fügt shippingSubsidy + marginDrift + breakEvenRisk hinzu, und sortiert worst/best Orders/Products korrekt", () => {
    const orders: OrderRow[] = [
      // Worst: negative CM
      {
        id: "o1",
        currency: "EUR",
        createdAt: "2026-02-01T10:00:00Z",
        grossSales: 100,
        refunds: 0,
        netAfterRefunds: 100,
        cogs: 90,
        paymentFees: 5,
        contributionMargin: 5, // 100-90-5 = 5 (still low)
        contributionMarginPct: 5,
        profitAfterAds: -10, // present => used for sorting worst/best
        shippingRevenue: 5,
        shippingCost: 10,
      },
      // Best
      {
        id: "o2",
        currency: "EUR",
        createdAt: "2026-02-02T10:00:00Z",
        grossSales: 200,
        refunds: 10,
        netAfterRefunds: 190,
        cogs: 50,
        paymentFees: 6,
        contributionMargin: 134,
        contributionMarginPct: 70.5263,
        profitAfterAds: 120,
        shippingRevenue: 0,
        shippingCost: 0,
      },
    ];

    const products: ProductRow[] = [
      { productId: 1, variantId: 11, title: "A", qty: 1, netSales: 50, cogs: 40, profitAfterFees: 5, profitAfterAds: 2 },
      { productId: 2, variantId: 22, title: "B", qty: 1, netSales: 200, cogs: 50, profitAfterFees: 120, profitAfterAds: 110 },
    ];

    const out = buildProfitKillersInsights({
      shop: "test-shop",
      days: 30,
      orders,
      products,
      missingCogsCount: 0,
      adSpend: 1000,
      currentRoas: 1.5,
      shippingTotals: {
        orders: 2,
        shippingRevenue: 5,
        shippingCost: 10,
        shippingImpact: -5,
      },
    } as any);

    // Meta + totals
    expect(out.shop).toBe("test-shop");
    expect(out.meta.currency).toBe("EUR");
    expect(out.meta.periodDays).toBe(30);

    // totals computed from orders
    expect(out.totals.orders).toBe(2);
    expect(out.totals.grossSales).toBe(300);
    expect(out.totals.refunds).toBe(10);
    expect(out.totals.netAfterRefunds).toBe(290);
    expect(out.totals.cogs).toBe(140);
    expect(out.totals.paymentFees).toBe(11);
    expect(out.totals.contributionMargin).toBe(139);

    // breakEvenRoas = net / cm (if cm > 0)
    expect(out.totals.breakEvenRoas).toBeCloseTo(290 / 139, 2);

    // ProfitKillers worst/best orders use profitAfterAds when present
    expect(out.profitKillers.worstOrders[0].id).toBe("o1");
    expect(out.profitKillers.bestOrders[0].id).toBe("o2");

    // worst/best products use profitAfterAds when present
    expect(out.profitKillers.worstProducts[0].variantId).toBe(11);
    expect(out.profitKillers.bestProducts[0].variantId).toBe(22);

    // Insights include shipping subsidy (real implementation) + our two mocks
    // shippingSubsidy only when impact < 0
    const types = (out.insights ?? []).map((x: any) => x.type);
    expect(types).toContain("shippingSubsidy");
    expect(types).toContain("marginDrift");
    expect(types).toContain("breakEvenRisk");

    // Ad intelligence should exist (we passed both)
    expect(out.adIntelligence).not.toBeNull();
    expect(out.adIntelligence.status).toBe("BURNING_CASH");

    // unified ranking is from mock (support both output shapes)
    const rankedTop = getRankedTop(out);
    expect(Array.isArray(rankedTop)).toBe(true);
    expect(rankedTop.length).toBeGreaterThan(0);
    expect(rankedTop[0].type).toBe("MOCK");

    // impactSimulation uses mocked buildImpactSimulation => should also carry MOCK
    expect(out.impactSimulation[0].type).toBe("MOCK");

    // actions must be present and limited
    expect(Array.isArray(out.actions)).toBe(true);
    expect(out.actions.length).toBeGreaterThan(0);
    expect(out.actions.length).toBeLessThanOrEqual(7);
  });

  it("gibt KEIN shippingSubsidy insight zurück wenn shippingImpact >= 0 oder shippingTotals fehlt", () => {
    const baseParams: any = {
      shop: "x",
      days: 7,
      orders: [
        {
          id: "o1",
          currency: "EUR",
          createdAt: "2026-02-01T10:00:00Z",
          grossSales: 100,
          refunds: 0,
          netAfterRefunds: 100,
          cogs: 10,
          paymentFees: 3,
          contributionMargin: 87,
          contributionMarginPct: 87,
        },
      ],
      products: [],
      missingCogsCount: 0,
    };

    const out1 = buildProfitKillersInsights({
      ...baseParams,
      shippingTotals: { orders: 1, shippingRevenue: 5, shippingCost: 5, shippingImpact: 0 },
    });

    const types1 = (out1.insights ?? []).map((x: any) => x.type);
    expect(types1).not.toContain("shippingSubsidy");

    const out2 = buildProfitKillersInsights({
      ...baseParams,
      shippingTotals: undefined,
    });

    const types2 = (out2.insights ?? []).map((x: any) => x.type);
    expect(types2).not.toContain("shippingSubsidy");
  });

  it("setzt breakEvenRoas auf null wenn contributionMargin <= 0", () => {
    const out = buildProfitKillersInsights({
      shop: "x",
      days: 7,
      orders: [
        {
          id: "o1",
          currency: "EUR",
          createdAt: "2026-02-01T10:00:00Z",
          grossSales: 100,
          refunds: 0,
          netAfterRefunds: 100,
          cogs: 200,
          paymentFees: 5,
          contributionMargin: -105,
          contributionMarginPct: -105,
        },
      ],
      products: [],
      missingCogsCount: 0,
    } as any);

    expect(out.totals.breakEvenRoas).toBeNull();
  });
});