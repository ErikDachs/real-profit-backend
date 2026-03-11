import { describe, expect, it } from "vitest";
import { buildOpportunityDeepDive } from "./buildOpportunityDeepDive.js";

describe("buildOpportunityDeepDive", () => {
  const opportunities = [
    {
      type: "HIGH_FEES",
      title: "High fees",
      summary: "Fees are too high",
      estimatedMonthlyLoss: 300,
      currency: "USD",
      days: 30,
      meta: { source: "fees" },
      actions: [{ label: "Negotiate fees", code: "NEGOTIATE_FEES" }],
    },
    {
      type: "SHIPPING_SUBSIDY",
      title: "Shipping subsidy",
      summary: "Shipping loses money",
      estimatedMonthlyLoss: 500,
      currency: "USD",
      days: 30,
      meta: { source: "shipping" },
      actions: [{ label: "Raise shipping rates", code: "RAISE_SHIPPING" }],
    },
    {
      type: "LOW_MARGIN",
      title: "Low margin",
      summary: "Margins are too low",
      estimatedMonthlyLoss: 200,
      currency: "USD",
      days: 30,
    },
    {
      type: "NEGATIVE_CM",
      title: "Negative CM",
      summary: "Some products lose money",
      estimatedMonthlyLoss: 450,
      currency: "USD",
      days: 30,
    },
    {
      type: "MISSING_COGS",
      title: "Missing COGS",
      summary: "Costs are missing",
      estimatedMonthlyLoss: 150,
      currency: "USD",
      days: 30,
    },
    {
      type: "HIGH_REFUNDS",
      title: "High refunds",
      summary: "Refunds are elevated",
      estimatedMonthlyLoss: 999,
      currency: "USD",
      days: 30,
    },
  ] as any;

  const orders = [
    {
      id: "o1",
      name: "#1001",
      createdAt: "2026-03-01T10:00:00.000Z",
      grossSales: 100,
      refunds: 20,
      netAfterRefunds: 80,
      cogs: 20,
      paymentFees: 10,
      contributionMargin: 50,
      contributionMarginPct: 50,
      shippingRevenue: 2,
      shippingCost: 8,
      shippingImpact: -6,
      profitAfterShipping: 44,
      allocatedAdSpend: 5,
      profitAfterAds: 39,
      profitAfterAdsAndShipping: 33,
    },
    {
      id: "o2",
      name: "#1002",
      createdAt: "2026-03-02T10:00:00.000Z",
      grossSales: 150,
      refunds: 5,
      netAfterRefunds: 145,
      cogs: 30,
      paymentFees: 30,
      contributionMargin: 85,
      contributionMarginPct: 56.67,
      shippingRevenue: 5,
      shippingCost: 15,
      shippingImpact: -10,
      profitAfterShipping: 75,
      allocatedAdSpend: 10,
      profitAfterAds: 60,
      profitAfterAdsAndShipping: 50,
    },
    {
      id: "o3",
      name: "#1003",
      createdAt: "2026-03-03T10:00:00.000Z",
      grossSales: 200,
      refunds: 0,
      netAfterRefunds: 200,
      cogs: 70,
      paymentFees: 5,
      contributionMargin: 125,
      contributionMarginPct: 62.5,
      shippingRevenue: 10,
      shippingCost: 8,
      shippingImpact: 2,
      profitAfterShipping: 127,
      allocatedAdSpend: 20,
      profitAfterAds: 105,
      profitAfterAdsAndShipping: 107,
    },
  ] as any;

  const products = [
    {
      productId: 1,
      variantId: 101,
      title: "Product A",
      sku: "SKU-A",
      variantTitle: "Red",
      paymentFeesAllocated: 30,
      refundsAllocated: 10,
      grossSales: 100,
      netSales: 90,
      qty: 2,
      hasMissingCogs: true,
      profitAfterAds: -10,
      profitAfterFees: -10,
      marginPct: -11.11,
      allocatedAdSpend: 5,
    },
    {
      productId: 2,
      variantId: 202,
      title: "Product B",
      sku: "SKU-B",
      variantTitle: "Blue",
      paymentFeesAllocated: 10,
      refundsAllocated: 5,
      grossSales: 80,
      netSales: 75,
      qty: 1,
      hasMissingCogs: false,
      profitAfterAds: 3,
      profitAfterFees: 3,
      marginPct: 4,
      allocatedAdSpend: 2,
    },
    {
      productId: 3,
      variantId: 303,
      title: "Product C",
      sku: "SKU-C",
      variantTitle: "Green",
      paymentFeesAllocated: 2,
      refundsAllocated: 0,
      grossSales: 50,
      netSales: 50,
      qty: 1,
      hasMissingCogs: true,
      profitAfterAds: 20,
      profitAfterFees: 20,
      marginPct: 40,
      allocatedAdSpend: 0,
    },
  ] as any;

  it("builds deep dives for top 5 opportunities and sorts by estimated monthly loss descending", () => {
    const simulationByType = new Map<any, any>([
      ["HIGH_FEES", { scenarios: [{ key: "fees_-20" }] }],
      ["SHIPPING_SUBSIDY", { scenarios: [{ key: "ship_-50" }] }],
    ]);

    const result = buildOpportunityDeepDive({
      shop: "test-shop.myshopify.com",
      days: 30,
      currency: "USD",
      opportunities,
      orders,
      products,
      simulationByType,
      limit: 10,
    });

    expect(result.shop).toBe("test-shop.myshopify.com");
    expect(result.days).toBe(30);
    expect(result.currency).toBe("USD");

    // top 5 from opportunities input only; HIGH_REFUNDS is 6th and must be ignored
    expect(result.deepDives).toHaveLength(5);

    expect(result.deepDives.map((d) => d.type)).toEqual([
      "SHIPPING_SUBSIDY",
      "NEGATIVE_CM",
      "HIGH_FEES",
      "LOW_MARGIN",
      "MISSING_COGS",
    ]);

    expect(result.deepDives[0].baseline).toEqual({
      lossInPeriod: 500,
      estimatedMonthlyLoss: 500,
      estimatedAnnualLoss: 6000,
    });

    expect(result.deepDives[1].baseline).toEqual({
      lossInPeriod: 450,
      estimatedMonthlyLoss: 450,
      estimatedAnnualLoss: 5400,
    });

    expect(result.deepDives[2].baseline).toEqual({
      lossInPeriod: 300,
      estimatedMonthlyLoss: 300,
      estimatedAnnualLoss: 3600,
    });
  });

  it("builds only the requested type when params.type is provided", () => {
    const result = buildOpportunityDeepDive({
      shop: "test-shop.myshopify.com",
      days: 30,
      currency: "USD",
      opportunities,
      orders,
      products,
      type: "HIGH_FEES",
      limit: 10,
    });

    expect(result.deepDives).toHaveLength(1);
    expect(result.deepDives[0].type).toBe("HIGH_FEES");
    expect(result.deepDives[0].title).toBe("High fees");
    expect(result.deepDives[0].summary).toBe("Fees are too high");
  });

  it("skips requested type when opportunity is not found", () => {
    const result = buildOpportunityDeepDive({
      shop: "test-shop.myshopify.com",
      days: 30,
      currency: "USD",
      opportunities: opportunities.filter((o: any) => o.type !== "HIGH_FEES"),
      orders,
      products,
      type: "HIGH_FEES",
      limit: 10,
    });

    expect(result.deepDives).toEqual([]);
  });

  it("clamps driver limit to minimum 3 before passing to drivers and worstOrders", () => {
    const result = buildOpportunityDeepDive({
      shop: "test-shop.myshopify.com",
      days: 30,
      currency: "USD",
      opportunities: [
        {
          type: "HIGH_FEES",
          title: "High fees",
          summary: "Fees are too high",
          estimatedMonthlyLoss: 300,
          currency: "USD",
          days: 30,
        },
      ] as any,
      orders,
      products,
      limit: 1,
    });

    expect(result.deepDives).toHaveLength(1);

    // HIGH_FEES driver has 3 products available, so min clamp to 3 should allow all 3
    expect(result.deepDives[0].drivers).toHaveLength(3);

    // worstOrders caps with Math.min(10, limit), but limit is clamped to >=3 first
    expect(result.deepDives[0].worstOrders).toHaveLength(3);
  });

  it("clamps limit to maximum 50", () => {
    const manyProducts = Array.from({ length: 60 }, (_, i) => ({
      productId: i + 1,
      variantId: 1000 + i,
      title: `Product ${i + 1}`,
      paymentFeesAllocated: i + 1,
      netSales: 100,
      qty: 1,
    }));

    const result = buildOpportunityDeepDive({
      shop: "test-shop.myshopify.com",
      days: 30,
      currency: "USD",
      opportunities: [
        {
          type: "HIGH_FEES",
          title: "High fees",
          summary: "Fees are too high",
          estimatedMonthlyLoss: 300,
          currency: "USD",
          days: 30,
        },
      ] as any,
      orders,
      products: manyProducts as any,
      limit: 999,
    });

    expect(result.deepDives).toHaveLength(1);
    expect(result.deepDives[0].drivers).toHaveLength(50);
    expect(result.deepDives[0].worstOrders).toHaveLength(3);
  });

  it("passes through meta, actions and matching simulation", () => {
    const simulationByType = new Map<any, any>([
      ["HIGH_FEES", { scenarios: [{ key: "fees_-10" }, { key: "fees_-20" }] }],
    ]);

    const result = buildOpportunityDeepDive({
      shop: "test-shop.myshopify.com",
      days: 30,
      currency: "USD",
      opportunities,
      orders,
      products,
      type: "HIGH_FEES",
      simulationByType,
      limit: 10,
    });

    const dd = result.deepDives[0];

    expect(dd.meta).toEqual({ source: "fees" });
    expect(dd.actions).toEqual([{ label: "Negotiate fees", code: "NEGOTIATE_FEES" }]);
    expect(dd.simulation).toEqual({
      scenarios: [{ key: "fees_-10" }, { key: "fees_-20" }],
    });
  });

  it("computes concentration shares from built drivers", () => {
    const result = buildOpportunityDeepDive({
      shop: "test-shop.myshopify.com",
      days: 30,
      currency: "USD",
      opportunities,
      orders,
      products,
      type: "HIGH_FEES",
      limit: 10,
    });

    const dd = result.deepDives[0];

    expect(dd.drivers.map((d) => d.variantId)).toEqual([101, 202, 303]);

    // impacts: 30, 10, 2 => total 42
    expect(dd.concentration.top1SharePct).toBeCloseTo(71.43, 2);
    expect(dd.concentration.top3SharePct).toBe(100);
    expect(dd.concentration.top5SharePct).toBe(100);
  });

  it("builds worstOrders using opportunity type specific ranking", () => {
    const result = buildOpportunityDeepDive({
      shop: "test-shop.myshopify.com",
      days: 30,
      currency: "USD",
      opportunities,
      orders,
      products,
      type: "SHIPPING_SUBSIDY",
      limit: 10,
    });

    const worstOrders = result.deepDives[0].worstOrders ?? [];
    expect(worstOrders.map((o) => o.id)).toEqual(["o2", "o1", "o3"]);
  });

  it("uses opportunity-specific currency/days from selected opportunity", () => {
    const result = buildOpportunityDeepDive({
      shop: "test-shop.myshopify.com",
      days: 999,
      currency: "EUR",
      opportunities: [
        {
          type: "HIGH_FEES",
          title: "High fees",
          summary: "Fees are too high",
          estimatedMonthlyLoss: 300,
          currency: "USD",
          days: 45,
        },
      ] as any,
      orders,
      products,
      type: "HIGH_FEES",
      limit: 10,
    });

    expect(result.deepDives[0].currency).toBe("USD");
    expect(result.deepDives[0].days).toBe(45);
    expect(result.deepDives[0].baseline.lossInPeriod).toBe(450);
  });
});