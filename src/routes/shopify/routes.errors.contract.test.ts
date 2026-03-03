import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { ShopifyCtx } from "../shopify/ctx";

function mkErr(status: number, message = "boom") {
  const e: any = new Error(message);
  e.status = status;
  return e;
}

const baseCtx: ShopifyCtx = {
  shop: "test-shop.myshopify.com",
  shopify: {
    get: async () => ({}),
  } as any,

  // ✅ NEW required fields (multi-shop / OAuth world)
  shopsStore: {
    ensureLoaded: async () => {},
    getAccessTokenOrThrow: async (_shop: string) => "test_token",
  } as any,

  createShopifyForShop: async (_shop: string) =>
    ({
      get: async () => ({}),
    } as any),

  fetchOrdersForShop: async (_shop: string, _days: number) => [],
  fetchOrderByIdForShop: async (_shop: string, _orderId: string) => ({}),

  actionPlanStateStore: {
    ensureLoaded: async () => {},
    getAll: async () => [],
    getByCode: async (_code: string) => null,
    upsert: async (_item: any) => {},
    clear: async () => {},
  } as any,

  cogsOverridesStore: {
    ensureLoaded: async () => {},
    list: async () => [],
    upsert: async ({ variantId, unitCost, ignoreCogs }: any) => ({
      variantId,
      unitCost: unitCost ?? null,
      ignoreCogs: !!ignoreCogs,
    }),
    isIgnoredSync: () => false,
    getUnitCostSync: () => undefined,
  } as any,

  cogsService: {
    computeUnitCostsByVariant: async () => new Map(),
    computeCogsByVariant: async () => new Map(),
    computeCogsForVariants: async () => 0,
  } as any,

  costModelOverridesStore: {
    ensureLoaded: async () => {},
    getOverridesSync: () => undefined,
    getUpdatedAtSync: () => undefined,
    setOverrides: async (_overrides: any) => {},
    clear: async () => {},
  } as any,

  // legacy single-shop helpers (still used by current routes)
  fetchOrders: async () => [],
  fetchOrderById: async (_orderId: string) => ({}),

  costProfile: {
    payment: { feePercent: 0.029, feeFixed: 0.3 },
    shipping: { costPerOrder: 5 },
    ads: { allocationMode: "BY_NET_SALES" },
    flags: { includeShippingCost: true },
  } as any,
};

vi.mock("../shopify/ctx", () => {
  return {
    createShopifyCtx: async () => baseCtx,
  };
});

// minimal mocks so routes can run without doing real work
vi.mock("../../domain/profit", () => ({
  buildOrdersSummary: async () => ({ shop: baseCtx.shop, days: 30, count: 0, grossSales: 0, refunds: 0, netAfterRefunds: 0, cogs: 0, paymentFees: 0, contributionMargin: 0, contributionMarginPct: 0, adSpendBreakEven: 0, breakEvenRoas: null, profitAfterFees: 0, profitMarginAfterFeesPct: 0, adSpend: 0, profitAfterAds: 0, profitMarginAfterAdsPct: 0, targetRoasFor10PctProfit: null, targetRoasFor10PctProfitAfterShipping: null }),
  buildProductsProfit: async () => ({ shop: baseCtx.shop, days: 30, orderCount: 0, totals: { totalNetSales: 0, paymentFeesTotal: 0, uniqueVariants: 0 }, highlights: { topWinners: [], topLosers: [], missingCogsCount: 0, missingCogs: [] }, products: [] }),
  calculateOrderProfit: async () => ({ orderId: "x", grossSales: 0, refunds: 0, netAfterRefunds: 0, cogs: 0, paymentFees: 0, contributionMargin: 0, contributionMarginPct: 0, shippingRevenue: 0, shippingCost: 0, shippingImpact: 0, profitAfterShipping: 0, profitMarginAfterShippingPct: 0, adSpendBreakEven: 0, breakEvenRoas: null, profitAfterFees: 0, marginAfterFeesPct: 0 }),
}));

vi.mock("../../domain/profitDaily", () => ({
  buildDailyProfit: () => ({ shop: baseCtx.shop, days: 30, totals: { orders: 0, grossSales: 0, refunds: 0, netAfterRefunds: 0, shippingRevenue: 0, shippingCost: 0, shippingImpact: 0, cogs: 0, paymentFees: 0, contributionMargin: 0, contributionMarginPct: 0, adSpendBreakEven: 0, breakEvenRoas: null, profitAfterShipping: 0, profitMarginAfterShippingPct: 0, allocatedAdSpend: 0, profitAfterAds: 0, profitMarginAfterAdsPct: 0, profitAfterAdsAndShipping: 0, profitMarginAfterAdsAndShippingPct: 0, profitAfterFees: 0 }, daily: [] }),
}));

vi.mock("../../domain/health/profitHealth", () => ({
  computeProfitHealthFromSummary: () => ({
    score: 0,
    grade: "F",
    components: {
      contributionMarginPct: 0,
      refundRate: 0,
      feeRate: 0,
      cogsRate: 0,
    },
    drivers: [],
    ratios: {
      contributionMarginPct: 0,
      refundRatePct: null,
      feeRatePct: null,
      cogsRatePct: null,
      shippingSubsidyLoss: null,
      shippingSubsidyPct: null,
      missingCogsRatePct: null,
      roas: null,
      breakEvenRoas: null,
    },
  }),
}));

vi.mock("../../domain/insights", () => ({
  buildProfitKillersInsights: () => ({ shop: baseCtx.shop, days: 30, meta: { currency: "EUR", periodDays: 30, periodLabel: "Last 30 days" }, totals: { currency: "EUR", orders: 0, grossSales: 0, refunds: 0, netAfterRefunds: 0, cogs: 0, paymentFees: 0, contributionMargin: 0, contributionMarginPct: 0, adSpendBreakEven: 0, breakEvenRoas: null }, highlights: { missingCogsCount: 0 }, insights: [], opportunities: { all: [], top: [] }, adIntelligence: null, profitKillers: { worstOrders: [], bestOrders: [], worstProducts: [], bestProducts: [] }, unifiedOpportunitiesTop5: [], unifiedOpportunitiesAll: [], impactSimulation: [], actions: [] }),
}));

vi.mock("../../domain/opportunities/deepDive", () => ({
  buildOpportunityDeepDive: () => ({ shop: baseCtx.shop, days: 30, currency: "EUR", type: null, top: [], drivers: [] }),
}));

import { buildApp } from "../../app";

describe("Route error contracts", () => {
  let app: any;

  beforeAll(async () => {
    process.env.PORT = "3001";
    process.env.SHOPIFY_STORE_DOMAIN = "test-shop.myshopify.com";
    process.env.SHOPIFY_ADMIN_TOKEN = "test_token";
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("propagates ctx.fetchOrders error.status (401)", async () => {
    const spy = vi.spyOn(baseCtx, "fetchOrders").mockRejectedValueOnce(mkErr(401, "Unauthorized"));

    const res = await app.inject({ method: "GET", url: "/api/orders/summary?days=30" });
    expect(res.statusCode).toBe(401);

    const json = res.json();
    expect(json).toHaveProperty("error");
    expect(json).toHaveProperty("details");

    spy.mockRestore();
  });

  it("propagates ctx.fetchOrders error.status (429 rate limited)", async () => {
    const spy = vi.spyOn(baseCtx, "fetchOrders").mockRejectedValueOnce(mkErr(429, "Too Many Requests"));

    const res = await app.inject({ method: "GET", url: "/api/orders/profit?days=30" });
    expect(res.statusCode).toBe(429);

    const json = res.json();
    expect(json.error).toBe("Unexpected error");

    spy.mockRestore();
  });

  it("falls back to 500 when error.status is missing", async () => {
    const spy = vi.spyOn(baseCtx, "fetchOrders").mockRejectedValueOnce(new Error("No status"));

    const res = await app.inject({ method: "GET", url: "/api/orders/daily-profit?days=30" });
    expect(res.statusCode).toBe(500);

    const json = res.json();
    expect(json).toHaveProperty("error");
    expect(json).toHaveProperty("details");

    spy.mockRestore();
  });

  it("PUT /api/cogs/overrides returns 400 with error contract when variantId invalid", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/cogs/overrides",
      payload: { variantId: -1, unitCost: 10 },
    });

    expect(res.statusCode).toBe(400);
    const json = res.json();
    expect(json).toHaveProperty("error");
  });
});