import { describe, expect, it } from "vitest";
import { pickWorstOrders } from "./deepDive.worstOrders.js";

describe("pickWorstOrders", () => {
  const baseOrders = [
    {
      id: "o1",
      name: "#1001",
      createdAt: "2026-03-01T10:00:00.000Z",
      grossSales: 100,
      refunds: 30,
      netAfterRefunds: 70,
      cogs: 20,
      paymentFees: 5,
      contributionMargin: 45,
      contributionMarginPct: 45,
      shippingRevenue: 4,
      shippingCost: 10,
      shippingImpact: -6,
      profitAfterShipping: 39,
      allocatedAdSpend: 10,
      profitAfterAds: 35,
      profitAfterAdsAndShipping: 29,
    },
    {
      id: "o2",
      name: "#1002",
      createdAt: "2026-03-02T10:00:00.000Z",
      grossSales: 150,
      refunds: 5,
      netAfterRefunds: 145,
      cogs: 40,
      paymentFees: 8,
      contributionMargin: 97,
      contributionMarginPct: 64.67,
      shippingRevenue: 8,
      shippingCost: 10,
      shippingImpact: -2,
      profitAfterShipping: 95,
      allocatedAdSpend: 20,
      profitAfterAds: 77,
      profitAfterAdsAndShipping: 75,
    },
    {
      id: "o3",
      name: "#1003",
      createdAt: "2026-03-03T10:00:00.000Z",
      grossSales: 80,
      refunds: 0,
      netAfterRefunds: 80,
      cogs: 30,
      paymentFees: 4,
      contributionMargin: 46,
      contributionMarginPct: 57.5,
      shippingRevenue: 0,
      shippingCost: 0,
      profitAfterShipping: 46,
      profitAfterAds: 10,
      profitAfterAdsAndShipping: 10,
    },
    {
      id: "gift",
      name: "#GIFT",
      createdAt: "2026-03-04T10:00:00.000Z",
      grossSales: 999,
      refunds: 0,
      netAfterRefunds: 999,
      cogs: 0,
      paymentFees: 0,
      contributionMargin: 999,
      contributionMarginPct: 100,
      isGiftCardOnlyOrder: true,
      profitAfterAds: -999,
    },
  ] as any[];

  it("sorts HIGH_REFUNDS by refunds descending and excludes gift card only orders", () => {
    const result = pickWorstOrders({
      orders: baseOrders,
      type: "HIGH_REFUNDS",
      limit: 3,
    });

    expect(result.map((x) => x.id)).toEqual(["o1", "o2", "o3"]);
    expect(result.every((x) => x.id !== "gift")).toBe(true);
  });

  it("sorts HIGH_FEES by payment fees descending", () => {
    const result = pickWorstOrders({
      orders: baseOrders,
      type: "HIGH_FEES",
      limit: 3,
    });

    expect(result.map((x) => x.id)).toEqual(["o2", "o1", "o3"]);
  });

  it("sorts SHIPPING_SUBSIDY by most negative shipping impact first", () => {
    const result = pickWorstOrders({
      orders: baseOrders,
      type: "SHIPPING_SUBSIDY",
      limit: 3,
    });

    expect(result.map((x) => x.id)).toEqual(["o1", "o2", "o3"]);
  });

  it("falls back to shippingRevenue - shippingCost when shippingImpact is missing", () => {
    const result = pickWorstOrders({
      orders: [
        {
          id: "a",
          name: "#A",
          grossSales: 100,
          refunds: 0,
          netAfterRefunds: 100,
          cogs: 20,
          paymentFees: 5,
          contributionMargin: 75,
          contributionMarginPct: 75,
          shippingRevenue: 2,
          shippingCost: 12,
        },
        {
          id: "b",
          name: "#B",
          grossSales: 100,
          refunds: 0,
          netAfterRefunds: 100,
          cogs: 20,
          paymentFees: 5,
          contributionMargin: 75,
          contributionMarginPct: 75,
          shippingRevenue: 4,
          shippingCost: 8,
        },
      ] as any,
      type: "SHIPPING_SUBSIDY",
      limit: 2,
    });

    expect(result.map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("uses profitAfterAds as default ranking metric for non-special opportunity types", () => {
    const result = pickWorstOrders({
      orders: baseOrders,
      type: "LOW_MARGIN",
      limit: 3,
    });

    expect(result.map((x) => x.id)).toEqual(["o3", "o1", "o2"]);
  });

  it("falls back to contributionMargin when profitAfterAds is missing", () => {
    const result = pickWorstOrders({
      orders: [
        {
          id: "a",
          name: "#A",
          grossSales: 100,
          refunds: 0,
          netAfterRefunds: 100,
          cogs: 50,
          paymentFees: 5,
          contributionMargin: 45,
          contributionMarginPct: 45,
        },
        {
          id: "b",
          name: "#B",
          grossSales: 100,
          refunds: 0,
          netAfterRefunds: 100,
          cogs: 20,
          paymentFees: 5,
          contributionMargin: 75,
          contributionMarginPct: 75,
        },
      ] as any,
      type: "NEGATIVE_CM",
      limit: 2,
    });

    expect(result.map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("respects the limit", () => {
    const result = pickWorstOrders({
      orders: baseOrders,
      type: "HIGH_REFUNDS",
      limit: 2,
    });

    expect(result).toHaveLength(2);
    expect(result.map((x) => x.id)).toEqual(["o1", "o2"]);
  });

  it("rounds numeric output fields and preserves optional fields when present", () => {
    const result = pickWorstOrders({
      orders: [
        {
          id: "r1",
          name: "#R1",
          createdAt: "2026-03-05T10:00:00.000Z",
          grossSales: 100.555,
          refunds: 10.111,
          netAfterRefunds: 90.444,
          cogs: 20.555,
          paymentFees: 3.456,
          contributionMargin: 66.433,
          contributionMarginPct: 66.433,
          shippingRevenue: 5.555,
          shippingCost: 7.777,
          shippingImpact: -2.222,
          profitAfterShipping: 64.211,
          allocatedAdSpend: 12.345,
          profitAfterAds: 54.321,
          profitAfterAdsAndShipping: 51.999,
        },
      ] as any,
      type: "HIGH_FEES",
      limit: 1,
    });

    expect(result).toEqual([
      {
        id: "r1",
        name: "#R1",
        createdAt: "2026-03-05T10:00:00.000Z",
        grossSales: 100.56,
        refunds: 10.11,
        netAfterRefunds: 90.44,
        cogs: 20.56,
        paymentFees: 3.46,
        contributionMargin: 66.43,
        contributionMarginPct: 66.43,
        shippingRevenue: 5.56,
        shippingCost: 7.78,
        shippingImpact: -2.22,
        profitAfterShipping: 64.21,
        allocatedAdSpend: 12.35,
        profitAfterAds: 54.32,
        profitAfterAdsAndShipping: 52,
      },
    ]);
  });

  it("omits optional fields when they are undefined", () => {
    const result = pickWorstOrders({
      orders: [
        {
          id: "minimal",
          grossSales: 50,
          refunds: 0,
          netAfterRefunds: 50,
          cogs: 10,
          paymentFees: 2,
          contributionMargin: 38,
          contributionMarginPct: 76,
        },
      ] as any,
      type: "LOW_MARGIN",
      limit: 1,
    });

    expect(result).toEqual([
      {
        id: "minimal",
        name: null,
        createdAt: null,
        grossSales: 50,
        refunds: 0,
        netAfterRefunds: 50,
        cogs: 10,
        paymentFees: 2,
        contributionMargin: 38,
        contributionMarginPct: 76,
        shippingRevenue: undefined,
        shippingCost: undefined,
        shippingImpact: undefined,
        profitAfterShipping: undefined,
        allocatedAdSpend: undefined,
        profitAfterAds: undefined,
        profitAfterAdsAndShipping: undefined,
      },
    ]);
  });
});