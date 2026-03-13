import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

const {
  precomputeUnitCostsForOrdersMock,
  effectiveCostOverridesMock,
  resolveCostProfileMock,
  buildOrdersSummaryMock,
  computeProfitHealthFromSummaryMock,
  calculateOrderProfitMock,
  allocateFixedCostsForOrdersMock,
  allocateAdSpendForOrdersMock,
  computeProfitAfterAdsMock,
  buildProfitKillersInsightsMock,
  buildActionPlanMock,
} = vi.hoisted(() => ({
  precomputeUnitCostsForOrdersMock: vi.fn(),
  effectiveCostOverridesMock: vi.fn(),
  resolveCostProfileMock: vi.fn(),
  buildOrdersSummaryMock: vi.fn(),
  computeProfitHealthFromSummaryMock: vi.fn(),
  calculateOrderProfitMock: vi.fn(),
  allocateFixedCostsForOrdersMock: vi.fn(),
  allocateAdSpendForOrdersMock: vi.fn(),
  computeProfitAfterAdsMock: vi.fn(),
  buildProfitKillersInsightsMock: vi.fn(),
  buildActionPlanMock: vi.fn(),
}));

vi.mock("./helpers.js", async () => {
  const actual = await vi.importActual<typeof import("./helpers.js")>("./helpers.js");
  return {
    ...actual,
    precomputeUnitCostsForOrders: precomputeUnitCostsForOrdersMock,
    effectiveCostOverrides: effectiveCostOverridesMock,
  };
});

vi.mock("../../domain/costModel/resolve.js", () => ({
  resolveCostProfile: resolveCostProfileMock,
}));

vi.mock("../../domain/profit/ordersSummary.js", () => ({
  buildOrdersSummary: buildOrdersSummaryMock,
}));

vi.mock("../../domain/health/profitHealth.js", () => ({
  computeProfitHealthFromSummary: computeProfitHealthFromSummaryMock,
}));

vi.mock("../../domain/profit.js", () => ({
  calculateOrderProfit: calculateOrderProfitMock,
  allocateFixedCostsForOrders: allocateFixedCostsForOrdersMock,
}));

vi.mock("../../domain/profit/ads.js", () => ({
  allocateAdSpendForOrders: allocateAdSpendForOrdersMock,
  computeProfitAfterAds: computeProfitAfterAdsMock,
}));

vi.mock("../../domain/insights/profitKillers.js", () => ({
  buildProfitKillersInsights: buildProfitKillersInsightsMock,
}));

vi.mock("../../domain/actions/buildActionPlan.js", () => ({
  buildActionPlan: buildActionPlanMock,
}));

import { registerDashboardOverviewRoute } from "./dashboardOverview.route.js";
import { authHeadersForShop } from "./testEmbeddedAuth.js";

function makeCtx(overrides?: Partial<any>) {
  const cogsOverridesStore = {
    isIgnoredSync: vi.fn().mockReturnValue(false),
  };

  const costModelOverridesStore = {
    getOverridesSync: vi.fn().mockReturnValue({ persisted: true }),
    getUpdatedAtSync: vi.fn().mockReturnValue("2026-03-01T00:00:00.000Z"),
  };

  const cogsService = {
    computeUnitCostsByVariant: vi.fn(),
  };

  return {
    shop: "main-shop.myshopify.com",
    shopify: { get: vi.fn() },

    fetchOrders: vi.fn().mockResolvedValue([
      {
        id: "o1",
        name: "#1001",
        created_at: "2026-03-05T10:00:00.000Z",
        currency: "USD",
      },
    ]),

    fetchOrdersForShop: vi.fn().mockResolvedValue({
      orders: [
        {
          id: "o2",
          name: "#2001",
          created_at: "2026-03-06T10:00:00.000Z",
          currency: "EUR",
        },
      ],
    }),

    createShopifyForShop: vi.fn().mockResolvedValue({ get: vi.fn() }),

    cogsOverridesStore,
    getCogsOverridesStoreForShop: vi.fn().mockResolvedValue(cogsOverridesStore),

    cogsService,
    getCogsServiceForShop: vi.fn().mockResolvedValue(cogsService),

    costModelOverridesStore,
    getCostModelOverridesStoreForShop: vi.fn().mockResolvedValue(costModelOverridesStore),

    ...overrides,
  };
}

async function buildApp(ctx: any) {
  const app = Fastify({ logger: false });
  (app as any).config = {
    DATA_DIR: "/tmp/test-data",
    SHOPIFY_API_KEY: "test_api_key",
    SHOPIFY_API_SECRET: "test_api_secret",
  };

  registerDashboardOverviewRoute(app, ctx);
  return app;
}

describe("dashboardOverview.route", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    precomputeUnitCostsForOrdersMock.mockResolvedValue(new Map([[101, 12.5]]));
    effectiveCostOverridesMock.mockReturnValue({ merged: true });

    resolveCostProfileMock.mockReturnValue({
      meta: { fingerprint: "fp_dashboard" },
      ads: { allocationMode: "BY_NET_SALES" },
      fixedCosts: { daysInMonth: 30, allocationMode: "PER_ORDER" },
      derived: { fixedCostsMonthlyTotal: 300 },
      payment: { feePercent: 0.03, feeFixed: 0.3 },
      shipping: { costPerOrder: 8 },
      flags: { includeShippingCost: true },
    });

    buildOrdersSummaryMock.mockResolvedValue({
      count: 1,
      grossSales: 120,
      refunds: 10,
      netAfterRefunds: 110,
      cogs: 25,
      paymentFees: 4,
      contributionMarginPct: 73.64,
      breakEvenRoas: 1.4,
      shippingRevenue: 6,
      shippingCost: 8,
      shippingImpact: -2,
      missingCogsCount: 1,
      currency: "USD",
    });

    computeProfitHealthFromSummaryMock.mockReturnValue({
      score: 78,
      status: "OK",
      drivers: [],
    });

    calculateOrderProfitMock.mockResolvedValue({
      grossSales: 120,
      refunds: 10,
      netAfterRefunds: 110,
      cogs: 25,
      paymentFees: 4,
      contributionMargin: 81,
      contributionMarginPct: 73.64,
      shippingRevenue: 6,
      shippingCost: 8,
      shippingImpact: -2,
      profitAfterShipping: 79,
      profitAfterFees: 81,
    });

    allocateAdSpendForOrdersMock.mockImplementation(({ rows }: any) =>
      rows.map((r: any) => ({ ...r, allocatedAdSpend: 12.34 }))
    );

    computeProfitAfterAdsMock
      .mockReturnValueOnce(68.66)
      .mockReturnValueOnce(66.66)
      .mockReturnValueOnce(81)
      .mockReturnValueOnce(79);

    allocateFixedCostsForOrdersMock.mockImplementation(({ rows }: any) =>
      rows.map((r: any) => ({
        ...r,
        fixedCostAllocated: 10,
      }))
    );

    buildProfitKillersInsightsMock.mockReturnValue({
      insights: [
        { type: "shippingSubsidy", value: 1 },
        { type: "marginDrift", value: 2 },
        { type: "breakEvenRisk", value: 3 },
      ],
      opportunities: {
        top: [{ type: "HIGH_FEES", title: "High fees", currency: "USD", days: 30 }],
        all: [{ type: "HIGH_FEES", title: "High fees", currency: "USD", days: 30 }],
      },
    });

    buildActionPlanMock.mockReturnValue({
      actions: [{ code: "FIX_FEES", label: "Fix fees" }],
      meta: { generatedAtIso: "2026-03-10T00:00:00.000Z" },
    });
  });

  it("returns 401 without embedded auth token", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);

    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/overview?shop=main-shop.myshopify.com",
    });

    expect(res.statusCode).toBe(401);
    expect(ctx.fetchOrders).not.toHaveBeenCalled();
    expect(buildOrdersSummaryMock).not.toHaveBeenCalled();
  });

  it("uses same-shop path with adSpend > 0 and returns overview payload", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);

    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/overview?shop=main-shop.myshopify.com&days=30&adSpend=12.34&currentRoas=1.8&actionsLimit=5",
      headers: authHeadersForShop("main-shop.myshopify.com", undefined, { app }),
    });

    expect(res.statusCode).toBe(200);

    expect(ctx.fetchOrders).toHaveBeenCalledWith(30);
    expect(ctx.fetchOrdersForShop).not.toHaveBeenCalled();
    expect(ctx.createShopifyForShop).not.toHaveBeenCalled();
    expect(ctx.getCogsOverridesStoreForShop).not.toHaveBeenCalled();
    expect(ctx.getCogsServiceForShop).not.toHaveBeenCalled();
    expect(ctx.getCostModelOverridesStoreForShop).not.toHaveBeenCalled();

    expect(effectiveCostOverridesMock).toHaveBeenCalledWith({
      persisted: { persisted: true },
      input: expect.any(Object),
    });

    expect(precomputeUnitCostsForOrdersMock).toHaveBeenCalledWith({
      orders: [
        {
          id: "o1",
          name: "#1001",
          created_at: "2026-03-05T10:00:00.000Z",
          currency: "USD",
        },
      ],
      cogsService: ctx.cogsService,
      shopifyGET: ctx.shopify.get,
    });

    expect(buildOrdersSummaryMock).toHaveBeenCalledWith(
      expect.objectContaining({
        shop: "main-shop.myshopify.com",
        days: 30,
        adSpend: 12.34,
        orders: expect.any(Array),
        costProfile: expect.objectContaining({
          meta: { fingerprint: "fp_dashboard" },
        }),
        cogsService: ctx.cogsService,
        shopifyGET: ctx.shopify.get,
        unitCostByVariant: expect.any(Map),
        isIgnoredVariant: expect.any(Function),
      })
    );

    expect(calculateOrderProfitMock).toHaveBeenCalledTimes(1);
    expect(allocateAdSpendForOrdersMock).toHaveBeenCalledTimes(1);
    expect(allocateFixedCostsForOrdersMock).toHaveBeenCalledTimes(1);
    expect(buildProfitKillersInsightsMock).toHaveBeenCalledTimes(1);
    expect(buildActionPlanMock).toHaveBeenCalledTimes(1);

    expect(res.json()).toEqual({
      shop: "main-shop.myshopify.com",
      meta: {
        currency: "USD",
        periodDays: 30,
        periodLabel: "Last 30 days",
        costModelFingerprint: "fp_dashboard",
        costModelPersistedUpdatedAt: "2026-03-01T00:00:00.000Z",
      },
      totals: {
        count: 1,
        grossSales: 120,
        refunds: 10,
        netAfterRefunds: 110,
        cogs: 25,
        paymentFees: 4,
        contributionMarginPct: 73.64,
        breakEvenRoas: 1.4,
        shippingRevenue: 6,
        shippingCost: 8,
        shippingImpact: -2,
        missingCogsCount: 1,
        currency: "USD",
      },
      health: {
        score: 78,
        status: "OK",
        drivers: [],
      },
      insights: {
        profitKillers: {
          insights: [
            { type: "shippingSubsidy", value: 1 },
            { type: "marginDrift", value: 2 },
            { type: "breakEvenRisk", value: 3 },
          ],
          opportunities: {
            top: [{ type: "HIGH_FEES", title: "High fees", currency: "USD", days: 30 }],
            all: [{ type: "HIGH_FEES", title: "High fees", currency: "USD", days: 30 }],
          },
        },
        shippingSubsidy: { type: "shippingSubsidy", value: 1 },
        marginDrift: { type: "marginDrift", value: 2 },
        breakEvenRisk: { type: "breakEvenRisk", value: 3 },
      },
      actions: {
        actions: [{ code: "FIX_FEES", label: "Fix fees" }],
        meta: { generatedAtIso: "2026-03-10T00:00:00.000Z" },
      },
      opportunities: {
        top: [{ type: "HIGH_FEES", title: "High fees", currency: "USD", days: 30 }],
        all: [{ type: "HIGH_FEES", title: "High fees", currency: "USD", days: 30 }],
      },
      debug: {
        insightErrors: [],
      },
    });
  });

  it("uses raw.orders fallback and multi-shop branch when authenticated shop differs", async () => {
    const foreignShopify = { get: vi.fn() };
    const foreignCogsOverridesStore = {
      isIgnoredSync: vi.fn().mockReturnValue(false),
    };
    const foreignCostModelOverridesStore = {
      getOverridesSync: vi.fn().mockReturnValue(undefined),
      getUpdatedAtSync: vi.fn().mockReturnValue("2026-04-01T00:00:00.000Z"),
    };
    const foreignCogsService = { computeUnitCostsByVariant: vi.fn() };

    const ctx = makeCtx({
      createShopifyForShop: vi.fn().mockResolvedValue(foreignShopify),
      getCogsOverridesStoreForShop: vi.fn().mockResolvedValue(foreignCogsOverridesStore),
      getCogsServiceForShop: vi.fn().mockResolvedValue(foreignCogsService),
      getCostModelOverridesStoreForShop: vi.fn().mockResolvedValue(foreignCostModelOverridesStore),
    });

    computeProfitAfterAdsMock.mockReset().mockReturnValue(79);
    allocateAdSpendForOrdersMock.mockClear();

    const app = await buildApp(ctx);

    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/overview?shop=other-shop.myshopify.com&days=14&adSpend=0",
      headers: authHeadersForShop("other-shop.myshopify.com", undefined, { app }),
    });

    expect(res.statusCode).toBe(200);

    expect(ctx.fetchOrders).not.toHaveBeenCalled();
    expect(ctx.fetchOrdersForShop).toHaveBeenCalledWith("other-shop.myshopify.com", 14);
    expect(ctx.createShopifyForShop).toHaveBeenCalledWith("other-shop.myshopify.com");
    expect(ctx.getCogsOverridesStoreForShop).toHaveBeenCalledWith("other-shop.myshopify.com");
    expect(ctx.getCogsServiceForShop).toHaveBeenCalledWith("other-shop.myshopify.com");
    expect(ctx.getCostModelOverridesStoreForShop).toHaveBeenCalledWith("other-shop.myshopify.com");

    expect(allocateAdSpendForOrdersMock).not.toHaveBeenCalled();

    expect(res.json().shop).toBe("other-shop.myshopify.com");
    expect(res.json().meta.periodDays).toBe(14);
  });

  it("captures profit killers errors via safeCall and still returns response", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);

    buildProfitKillersInsightsMock.mockImplementation(() => {
      throw new Error("profit killers exploded");
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/overview?shop=main-shop.myshopify.com&adSpend=0",
      headers: authHeadersForShop("main-shop.myshopify.com", undefined, { app }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().insights).toEqual({
      profitKillers: null,
      shippingSubsidy: null,
      marginDrift: null,
      breakEvenRisk: null,
    });
    expect(res.json().opportunities).toEqual({ top: [], all: [] });
    expect(res.json().debug).toEqual({
      insightErrors: ["[profitKillers] profit killers exploded"],
    });
  });

  it("falls back currency from orders when summary currency is missing", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);

    buildOrdersSummaryMock.mockResolvedValue({
      count: 1,
      grossSales: 120,
      refunds: 10,
      netAfterRefunds: 110,
      cogs: 25,
      paymentFees: 4,
      contributionMarginPct: 73.64,
      breakEvenRoas: 1.4,
      shippingRevenue: 6,
      shippingCost: 8,
      shippingImpact: -2,
      missingCogsCount: 1,
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/overview?shop=main-shop.myshopify.com",
      headers: authHeadersForShop("main-shop.myshopify.com", undefined, { app }),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().meta.currency).toBe("USD");
  });

  it("returns 403 for authenticated shop mismatch", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);

    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/overview?shop=other-shop.myshopify.com",
      headers: authHeadersForShop("main-shop.myshopify.com", undefined, { app }),
    });

    expect(res.statusCode).toBe(403);
    expect(ctx.fetchOrders).not.toHaveBeenCalled();
  });

  it("returns 500 on unexpected downstream error", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);

    ctx.fetchOrders.mockRejectedValue(new Error("shopify timeout"));

    const res = await app.inject({
      method: "GET",
      url: "/api/dashboard/overview?shop=main-shop.myshopify.com",
      headers: authHeadersForShop("main-shop.myshopify.com", undefined, { app }),
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      error: "Unexpected error",
      details: "shopify timeout",
    });
  });
});