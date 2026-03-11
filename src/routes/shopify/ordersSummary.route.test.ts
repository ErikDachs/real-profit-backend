import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

const {
  buildOrdersSummaryMock,
  computeProfitHealthFromSummaryMock,
  effectiveCostOverridesMock,
  resolveCostProfileMock,
} = vi.hoisted(() => ({
  buildOrdersSummaryMock: vi.fn(),
  computeProfitHealthFromSummaryMock: vi.fn(),
  effectiveCostOverridesMock: vi.fn(),
  resolveCostProfileMock: vi.fn(),
}));

vi.mock("../../domain/profit.js", () => ({
  buildOrdersSummary: buildOrdersSummaryMock,
}));

vi.mock("../../domain/health/profitHealth.js", () => ({
  computeProfitHealthFromSummary: computeProfitHealthFromSummaryMock,
}));

vi.mock("./helpers.js", async () => {
  const actual = await vi.importActual<typeof import("./helpers.js")>("./helpers.js");
  return {
    ...actual,
    effectiveCostOverrides: effectiveCostOverridesMock,
  };
});

vi.mock("../../domain/costModel/resolve.js", () => ({
  resolveCostProfile: resolveCostProfileMock,
}));

import { registerOrdersSummaryRoute } from "./ordersSummary.route.js";

function makeCtx(overrides?: Partial<any>) {
  const cogsOverridesStore = {
    isIgnoredSync: vi.fn().mockReturnValue(false),
  };

  const costModelOverridesStore = {
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
    getOverridesSync: vi.fn().mockReturnValue({ persisted: true }),
    getUpdatedAtSync: vi.fn().mockReturnValue("2026-03-01T00:00:00.000Z"),
  };

  const cogsService = {
    computeUnitCostsByVariant: vi.fn(),
  };

  const sameShopOrders = [
    {
      id: "o1",
      name: "#1001",
      created_at: "2026-03-01T10:00:00.000Z",
      currency: "USD",
    },
    {
      id: "o2",
      name: "#1002",
      created_at: "2026-03-02T10:00:00.000Z",
      currency: "USD",
    },
  ];

  const foreignOrders = [
    {
      id: "f1",
      name: "#2001",
      created_at: "2026-03-03T10:00:00.000Z",
      currency: "EUR",
    },
  ];

  return {
    shop: "main-shop.myshopify.com",
    shopify: { get: vi.fn() },

    fetchOrders: vi.fn().mockResolvedValue(sameShopOrders),
    fetchOrdersForShop: vi.fn().mockResolvedValue(foreignOrders),
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
  };

  registerOrdersSummaryRoute(app, ctx);
  return app;
}

describe("ordersSummary.route", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    effectiveCostOverridesMock.mockReturnValue({ merged: true });

    resolveCostProfileMock.mockReturnValue({
      meta: { fingerprint: "fp_orders_summary" },
    });

    buildOrdersSummaryMock.mockResolvedValue({
      shop: "main-shop.myshopify.com",
      days: 30,
      count: 2,
      grossSales: 150,
      refunds: 10,
      netAfterRefunds: 140,
      cogs: 40,
      paymentFees: 6,
      contributionMargin: 94,
      contributionMarginPct: 67.14,
      breakEvenRoas: 1.49,
      adSpend: 12.35,
      shippingRevenue: 5,
      shippingCost: 8,
      missingCogsCount: 1,
      fixedCostsAllocatedInPeriod: 100,
    });

    computeProfitHealthFromSummaryMock.mockReturnValue({
      score: 81,
      status: "OK",
      drivers: [],
    });
  });

  it("returns 400 when shop is missing and ctx fallback is empty", async () => {
    const ctx = makeCtx({ shop: "" });
    const app = await buildApp(ctx);

    const res = await app.inject({
      method: "GET",
      url: "/api/orders/summary",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: "shop is required (valid *.myshopify.com)",
    });

    expect(ctx.fetchOrders).not.toHaveBeenCalled();
    expect(buildOrdersSummaryMock).not.toHaveBeenCalled();
    expect(computeProfitHealthFromSummaryMock).not.toHaveBeenCalled();
  });

  it("uses same-shop path and returns summary with health and cost model", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);

    const res = await app.inject({
      method: "GET",
      url: "/api/orders/summary?shop=main-shop.myshopify.com&days=14&adSpend=12.345",
    });

    expect(res.statusCode).toBe(200);

    expect(ctx.fetchOrders).toHaveBeenCalledWith(14);
    expect(ctx.fetchOrdersForShop).not.toHaveBeenCalled();
    expect(ctx.createShopifyForShop).not.toHaveBeenCalled();
    expect(ctx.getCogsOverridesStoreForShop).not.toHaveBeenCalled();
    expect(ctx.getCogsServiceForShop).not.toHaveBeenCalled();
    expect(ctx.getCostModelOverridesStoreForShop).not.toHaveBeenCalled();

    expect(ctx.costModelOverridesStore.ensureLoaded).toHaveBeenCalledTimes(1);

    expect(effectiveCostOverridesMock).toHaveBeenCalledWith({
      persisted: { persisted: true },
      input: expect.any(Object),
    });

    expect(resolveCostProfileMock).toHaveBeenCalledWith({
      config: expect.any(Object),
      overrides: { merged: true },
    });

    expect(buildOrdersSummaryMock).toHaveBeenCalledWith({
      shop: "main-shop.myshopify.com",
      days: 14,
      adSpend: 12.35,
      orders: [
        {
          id: "o1",
          name: "#1001",
          created_at: "2026-03-01T10:00:00.000Z",
          currency: "USD",
        },
        {
          id: "o2",
          name: "#1002",
          created_at: "2026-03-02T10:00:00.000Z",
          currency: "USD",
        },
      ],
      costProfile: {
        meta: { fingerprint: "fp_orders_summary" },
      },
      cogsService: ctx.cogsService,
      shopifyGET: ctx.shopify.get,
      isIgnoredVariant: expect.any(Function),
    });

    expect(computeProfitHealthFromSummaryMock).toHaveBeenCalledWith({
      grossSales: 150,
      refunds: 10,
      netAfterRefunds: 140,
      cogs: 40,
      paymentFees: 6,
      contributionMarginPct: 67.14,
      ordersCount: 2,
      breakEvenRoas: 1.49,
      adSpend: 12.35,
      shippingRevenue: 5,
      shippingCost: 8,
      missingCogsCount: 1,
      fixedCostsAllocatedInPeriod: 100,
    });

    expect(res.json()).toEqual({
      shop: "main-shop.myshopify.com",
      days: 30,
      count: 2,
      grossSales: 150,
      refunds: 10,
      netAfterRefunds: 140,
      cogs: 40,
      paymentFees: 6,
      contributionMargin: 94,
      contributionMarginPct: 67.14,
      breakEvenRoas: 1.49,
      adSpend: 12.35,
      shippingRevenue: 5,
      shippingCost: 8,
      missingCogsCount: 1,
      fixedCostsAllocatedInPeriod: 100,
      health: {
        score: 81,
        status: "OK",
        drivers: [],
      },
      costModel: {
        fingerprint: "fp_orders_summary",
        persistedUpdatedAt: "2026-03-01T00:00:00.000Z",
      },
    });
  });

  it("uses multi-shop path when requested shop differs from ctx.shop", async () => {
    const foreignShopify = { get: vi.fn() };
    const foreignCogsOverridesStore = {
      isIgnoredSync: vi.fn().mockReturnValue(false),
    };
    const foreignCostModelOverridesStore = {
      ensureLoaded: vi.fn().mockResolvedValue(undefined),
      getOverridesSync: vi.fn().mockReturnValue(undefined),
      getUpdatedAtSync: vi.fn().mockReturnValue("2026-04-01T00:00:00.000Z"),
    };
    const foreignCogsService = {};

    const ctx = makeCtx({
      createShopifyForShop: vi.fn().mockResolvedValue(foreignShopify),
      getCogsOverridesStoreForShop: vi.fn().mockResolvedValue(foreignCogsOverridesStore),
      getCogsServiceForShop: vi.fn().mockResolvedValue(foreignCogsService),
      getCostModelOverridesStoreForShop: vi.fn().mockResolvedValue(foreignCostModelOverridesStore),
    });

    buildOrdersSummaryMock.mockResolvedValue({
      shop: "other-shop.myshopify.com",
      days: 7,
      count: 1,
      grossSales: 200,
      refunds: 0,
      netAfterRefunds: 200,
      cogs: 50,
      paymentFees: 8,
      contributionMargin: 142,
      contributionMarginPct: 71,
      breakEvenRoas: 1.41,
      adSpend: 0,
      shippingRevenue: 10,
      shippingCost: 5,
      missingCogsCount: 0,
      fixedCostsAllocatedInPeriod: 70,
    });

    resolveCostProfileMock.mockReturnValue({
      meta: { fingerprint: "fp_foreign_summary" },
    });

    const app = await buildApp(ctx);

    const res = await app.inject({
      method: "GET",
      url: "/api/orders/summary?shop=other-shop.myshopify.com&days=7",
    });

    expect(res.statusCode).toBe(200);

    expect(ctx.fetchOrders).not.toHaveBeenCalled();
    expect(ctx.fetchOrdersForShop).toHaveBeenCalledWith("other-shop.myshopify.com", 7);
    expect(ctx.createShopifyForShop).toHaveBeenCalledWith("other-shop.myshopify.com");
    expect(ctx.getCogsOverridesStoreForShop).toHaveBeenCalledWith("other-shop.myshopify.com");
    expect(ctx.getCogsServiceForShop).toHaveBeenCalledWith("other-shop.myshopify.com");
    expect(ctx.getCostModelOverridesStoreForShop).toHaveBeenCalledWith("other-shop.myshopify.com");

    expect(buildOrdersSummaryMock).toHaveBeenCalledWith({
      shop: "other-shop.myshopify.com",
      days: 7,
      adSpend: 0,
      orders: [
        {
          id: "f1",
          name: "#2001",
          created_at: "2026-03-03T10:00:00.000Z",
          currency: "EUR",
        },
      ],
      costProfile: {
        meta: { fingerprint: "fp_foreign_summary" },
      },
      cogsService: foreignCogsService,
      shopifyGET: foreignShopify.get,
      isIgnoredVariant: expect.any(Function),
    });

    expect(res.json().costModel).toEqual({
      fingerprint: "fp_foreign_summary",
      persistedUpdatedAt: "2026-04-01T00:00:00.000Z",
    });
  });

  it("passes ignored variant callback through to buildOrdersSummary", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);

    await app.inject({
      method: "GET",
      url: "/api/orders/summary?shop=main-shop.myshopify.com",
    });

    const arg = buildOrdersSummaryMock.mock.calls[0][0];
    expect(arg.isIgnoredVariant(123)).toBe(false);
    expect(ctx.cogsOverridesStore.isIgnoredSync).toHaveBeenCalledWith(123);
  });

  it("propagates explicit downstream status", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);

    ctx.fetchOrders.mockRejectedValue(
      Object.assign(new Error("Forbidden shop access"), { status: 403 })
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/orders/summary?shop=main-shop.myshopify.com",
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: "Unexpected error",
      details: "Forbidden shop access",
    });
  });
});