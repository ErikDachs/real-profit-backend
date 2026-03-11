import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

const {
  calculateOrderProfitMock,
  buildProductsProfitMock,
  buildOrdersSummaryMock,
  buildDailyProfitMock,
  buildProfitKillersInsightsMock,
  precomputeUnitCostsForOrdersMock,
  effectiveCostOverridesMock,
  resolveCostProfileMock,
  enrichOrdersWithAdsMock,
  enrichProductsWithAdsMock,
  runOpportunityScenarioSimulationsMock,
} = vi.hoisted(() => ({
  calculateOrderProfitMock: vi.fn(),
  buildProductsProfitMock: vi.fn(),
  buildOrdersSummaryMock: vi.fn(),
  buildDailyProfitMock: vi.fn(),
  buildProfitKillersInsightsMock: vi.fn(),
  precomputeUnitCostsForOrdersMock: vi.fn(),
  effectiveCostOverridesMock: vi.fn(),
  resolveCostProfileMock: vi.fn(),
  enrichOrdersWithAdsMock: vi.fn(),
  enrichProductsWithAdsMock: vi.fn(),
  runOpportunityScenarioSimulationsMock: vi.fn(),
}));

vi.mock("../../domain/profit.js", () => ({
  calculateOrderProfit: calculateOrderProfitMock,
  buildProductsProfit: buildProductsProfitMock,
}));

vi.mock("../../domain/profit/ordersSummary.js", () => ({
  buildOrdersSummary: buildOrdersSummaryMock,
}));

vi.mock("../../domain/profitDaily.js", () => ({
  buildDailyProfit: buildDailyProfitMock,
}));

vi.mock("../../domain/insights.js", () => ({
  buildProfitKillersInsights: buildProfitKillersInsightsMock,
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

vi.mock("../../domain/insights/adsAllocation.js", () => ({
  enrichOrdersWithAds: enrichOrdersWithAdsMock,
  enrichProductsWithAds: enrichProductsWithAdsMock,
}));

vi.mock("../../domain/simulations/runScenarioPresets.js", () => ({
  runOpportunityScenarioSimulations: runOpportunityScenarioSimulationsMock,
}));

import { registerProfitKillersRoute } from "./profitKillers.route.js";

function makeCtx(overrides?: Partial<any>) {
  const cogsOverridesStore = {
    isIgnoredSync: vi.fn().mockReturnValue(false),
  };

  const costModelOverridesStore = {
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
    getOverridesSync: vi.fn().mockReturnValue({ persisted: true }),
    getUpdatedAtSync: vi.fn().mockReturnValue("2026-03-01T00:00:00.000Z"),
  };

  const cogsService = {};

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

  registerProfitKillersRoute(app, ctx);
  return app;
}

describe("profitKillers.route", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    precomputeUnitCostsForOrdersMock.mockResolvedValue(new Map([[101, 12.5]]));

    effectiveCostOverridesMock.mockReturnValue({ merged: true });

    resolveCostProfileMock.mockReturnValue({
      meta: { fingerprint: "fp_profit_killers" },
      ads: { allocationMode: "BY_NET_SALES" },
    });

    buildOrdersSummaryMock.mockResolvedValue({
      missingCogsCount: 2,
    });

    calculateOrderProfitMock
      .mockResolvedValueOnce({
        grossSales: 100,
        refunds: 10,
        netAfterRefunds: 90,
        cogs: 20,
        paymentFees: 5,
        contributionMargin: 65,
        contributionMarginPct: 72.22,
        isGiftCardOnlyOrder: false,
        giftCardNetSalesExcluded: 0,
        shippingRevenue: 4,
        shippingCost: 8,
        shippingImpact: -4,
        profitAfterShipping: 61,
        adSpendBreakEven: 61,
        breakEvenRoas: 1.48,
      })
      .mockResolvedValueOnce({
        grossSales: 50,
        refunds: 0,
        netAfterRefunds: 50,
        cogs: 5,
        paymentFees: 2,
        contributionMargin: 43,
        contributionMarginPct: 86,
        isGiftCardOnlyOrder: false,
        giftCardNetSalesExcluded: 0,
        shippingRevenue: 0,
        shippingCost: 3,
        shippingImpact: -3,
        profitAfterShipping: 40,
        adSpendBreakEven: 40,
        breakEvenRoas: 1.25,
      });

    buildDailyProfitMock.mockReturnValue({
      totals: {
        orders: 2,
        shippingRevenue: 4,
        shippingCost: 11,
        shippingImpact: -7,
      },
    });

    buildProductsProfitMock.mockResolvedValue({
      products: [
        {
          productId: 1,
          variantId: 101,
          title: "Product A",
          netSales: 90,
          profitAfterFees: 65,
        },
      ],
    });

    enrichOrdersWithAdsMock.mockImplementation(({ orders }: any) =>
      orders.map((o: any) => ({ ...o, enrichedOrder: true }))
    );

    enrichProductsWithAdsMock.mockImplementation(({ products }: any) =>
      products.map((p: any) => ({ ...p, enrichedProduct: true }))
    );

    buildProfitKillersInsightsMock.mockReturnValue({
      insights: [{ type: "shippingSubsidy" }],
      opportunities: {
        top: [{ type: "HIGH_FEES", title: "High fees", currency: "USD", days: 30 }],
        all: [{ type: "HIGH_FEES", title: "High fees", currency: "USD", days: 30 }],
      },
    });

    runOpportunityScenarioSimulationsMock.mockResolvedValue({
      baselineSummary: { baseline: true },
      simulationsByOpportunity: [{ type: "HIGH_FEES", scenarios: [] }],
    });
  });

  it("returns 400 when shop is missing and ctx fallback is empty", async () => {
    const ctx = makeCtx({ shop: "" });
    const app = await buildApp(ctx);

    const res = await app.inject({
      method: "GET",
      url: "/api/insights/profit-killers",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: "shop is required (valid *.myshopify.com)",
    });

    expect(ctx.fetchOrders).not.toHaveBeenCalled();
    expect(buildProfitKillersInsightsMock).not.toHaveBeenCalled();
  });

  it("uses same-shop path and returns insights with scenario simulations", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);

    const res = await app.inject({
      method: "GET",
      url: "/api/insights/profit-killers?shop=main-shop.myshopify.com&days=14&limit=7&adSpend=12.345&currentRoas=1.9",
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

    expect(precomputeUnitCostsForOrdersMock).toHaveBeenCalledWith({
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
      cogsService: ctx.cogsService,
      shopifyGET: ctx.shopify.get,
    });

    expect(buildOrdersSummaryMock).toHaveBeenCalledWith({
      shop: "main-shop.myshopify.com",
      days: 14,
      adSpend: 12.35,
      orders: expect.any(Array),
      costProfile: expect.objectContaining({
        meta: { fingerprint: "fp_profit_killers" },
      }),
      cogsService: ctx.cogsService,
      shopifyGET: ctx.shopify.get,
      unitCostByVariant: expect.any(Map),
      isIgnoredVariant: expect.any(Function),
    });

    expect(calculateOrderProfitMock).toHaveBeenCalledTimes(2);

    expect(buildDailyProfitMock).toHaveBeenCalledWith({
      shop: "main-shop.myshopify.com",
      days: 14,
      orderProfits: [
        {
          createdAt: "2026-03-01T10:00:00.000Z",
          grossSales: 100,
          refunds: 10,
          netAfterRefunds: 90,
          cogs: 20,
          paymentFees: 5,
          profitAfterFees: 65,
          contributionMargin: 65,
          shippingRevenue: 4,
          shippingCost: 8,
          profitAfterShipping: 61,
        },
        {
          createdAt: "2026-03-02T10:00:00.000Z",
          grossSales: 50,
          refunds: 0,
          netAfterRefunds: 50,
          cogs: 5,
          paymentFees: 2,
          profitAfterFees: 43,
          contributionMargin: 43,
          shippingRevenue: 0,
          shippingCost: 3,
          profitAfterShipping: 40,
        },
      ],
    });

    expect(buildProductsProfitMock).toHaveBeenCalledWith({
      shop: "main-shop.myshopify.com",
      days: 14,
      orders: expect.any(Array),
      costProfile: expect.objectContaining({
        meta: { fingerprint: "fp_profit_killers" },
      }),
      cogsService: ctx.cogsService,
      shopifyGET: ctx.shopify.get,
    });

    expect(enrichOrdersWithAdsMock).toHaveBeenCalledWith({
      orders: expect.any(Array),
      totalAdSpend: 12.35,
      weight: expect.any(Function),
      baseProfit: expect.any(Function),
      profitAfterShipping: expect.any(Function),
    });

    expect(enrichProductsWithAdsMock).toHaveBeenCalledWith({
      products: [
        {
          productId: 1,
          variantId: 101,
          title: "Product A",
          netSales: 90,
          profitAfterFees: 65,
        },
      ],
      totalAdSpend: 12.35,
      weight: expect.any(Function),
      baseProfit: expect.any(Function),
    });

    expect(buildProfitKillersInsightsMock).toHaveBeenCalledWith({
      shop: "main-shop.myshopify.com",
      days: 14,
      orders: expect.any(Array),
      products: expect.any(Array),
      missingCogsCount: 2,
      limit: 7,
      adSpend: 12.35,
      currentRoas: 1.9,
      shippingTotals: {
        orders: 2,
        shippingRevenue: 4,
        shippingCost: 11,
        shippingImpact: -7,
      },
    });

    expect(runOpportunityScenarioSimulationsMock).toHaveBeenCalledWith({
      shop: "main-shop.myshopify.com",
      days: 14,
      adSpend: 12.35,
      orders: expect.any(Array),
      baseCostProfile: expect.objectContaining({
        meta: { fingerprint: "fp_profit_killers" },
      }),
      config: expect.any(Object),
      baseOverrides: { merged: true },
      cogsService: ctx.cogsService,
      shopifyGET: ctx.shopify.get,
      unitCostByVariant: expect.any(Map),
      opportunities: [{ type: "HIGH_FEES", title: "High fees", currency: "USD", days: 30 }],
    });

    expect(res.json()).toEqual({
      insights: [{ type: "shippingSubsidy" }],
      opportunities: {
        top: [{ type: "HIGH_FEES", title: "High fees", currency: "USD", days: 30 }],
        all: [{ type: "HIGH_FEES", title: "High fees", currency: "USD", days: 30 }],
      },
      scenarioSimulations: {
        baselineSummary: { baseline: true },
        byOpportunity: [{ type: "HIGH_FEES", scenarios: [] }],
      },
      costModel: {
        fingerprint: "fp_profit_killers",
        persistedUpdatedAt: "2026-03-01T00:00:00.000Z",
      },
    });
  });

  it("uses multi-shop path and skips scenario simulations when no top opportunities exist", async () => {
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
      fetchOrdersForShop: vi.fn().mockResolvedValue([
        {
          id: "f1",
          name: "#2001",
          created_at: "2026-03-03T10:00:00.000Z",
          currency: "EUR",
        },
      ]),
      createShopifyForShop: vi.fn().mockResolvedValue(foreignShopify),
      getCogsOverridesStoreForShop: vi.fn().mockResolvedValue(foreignCogsOverridesStore),
      getCogsServiceForShop: vi.fn().mockResolvedValue(foreignCogsService),
      getCostModelOverridesStoreForShop: vi.fn().mockResolvedValue(foreignCostModelOverridesStore),
    });

    calculateOrderProfitMock.mockReset();
    calculateOrderProfitMock.mockResolvedValue({
      grossSales: 200,
      refunds: 0,
      netAfterRefunds: 200,
      cogs: 50,
      paymentFees: 8,
      contributionMargin: 142,
      contributionMarginPct: 71,
      isGiftCardOnlyOrder: false,
      giftCardNetSalesExcluded: 0,
      shippingRevenue: 10,
      shippingCost: 5,
      shippingImpact: 5,
      profitAfterShipping: 147,
      adSpendBreakEven: 147,
      breakEvenRoas: 1.36,
    });

    buildOrdersSummaryMock.mockResolvedValue({
      missingCogsCount: 0,
    });

    buildDailyProfitMock.mockReturnValue({
      totals: {
        orders: 1,
        shippingRevenue: 10,
        shippingCost: 5,
        shippingImpact: 5,
      },
    });

    buildProductsProfitMock.mockResolvedValue({
      products: [],
    });

    buildProfitKillersInsightsMock.mockReturnValue({
      insights: [{ type: "marginDrift" }],
      opportunities: {
        top: [],
        all: [],
      },
    });

    resolveCostProfileMock.mockReturnValue({
      meta: { fingerprint: "fp_foreign_profit_killers" },
      ads: { allocationMode: "BY_NET_SALES" },
    });

    const app = await buildApp(ctx);

    const res = await app.inject({
      method: "GET",
      url: "/api/insights/profit-killers?shop=other-shop.myshopify.com&days=7&limit=3",
    });

    expect(res.statusCode).toBe(200);

    expect(ctx.fetchOrders).not.toHaveBeenCalled();
    expect(ctx.fetchOrdersForShop).toHaveBeenCalledWith("other-shop.myshopify.com", 7);
    expect(ctx.createShopifyForShop).toHaveBeenCalledWith("other-shop.myshopify.com");
    expect(ctx.getCogsOverridesStoreForShop).toHaveBeenCalledWith("other-shop.myshopify.com");
    expect(ctx.getCogsServiceForShop).toHaveBeenCalledWith("other-shop.myshopify.com");
    expect(ctx.getCostModelOverridesStoreForShop).toHaveBeenCalledWith("other-shop.myshopify.com");

    expect(runOpportunityScenarioSimulationsMock).not.toHaveBeenCalled();

    expect(res.json()).toEqual({
      insights: [{ type: "marginDrift" }],
      opportunities: {
        top: [],
        all: [],
      },
      scenarioSimulations: {
        baselineSummary: null,
        byOpportunity: [],
      },
      costModel: {
        fingerprint: "fp_foreign_profit_killers",
        persistedUpdatedAt: "2026-04-01T00:00:00.000Z",
      },
    });
  });

  it("propagates explicit downstream status", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);

    ctx.fetchOrders.mockRejectedValue(
      Object.assign(new Error("Forbidden shop access"), { status: 403 })
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/insights/profit-killers?shop=main-shop.myshopify.com",
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: "Unexpected error",
      details: "Forbidden shop access",
    });
  });
});