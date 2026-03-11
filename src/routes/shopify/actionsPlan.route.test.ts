import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

const {
  calculateOrderProfitMock,
  buildProductsProfitMock,
  allocateFixedCostsForOrdersMock,
  buildDailyProfitMock,
  precomputeUnitCostsForOrdersMock,
  effectiveCostOverridesMock,
  enrichOrdersWithAdsMock,
  enrichProductsWithAdsMock,
  buildProfitKillersInsightsMock,
  buildOpportunityDeepDiveMock,
  buildActionPlanMock,
  resolveCostProfileMock,
  runOpportunityScenarioSimulationsMock,
} = vi.hoisted(() => ({
  calculateOrderProfitMock: vi.fn(),
  buildProductsProfitMock: vi.fn(),
  allocateFixedCostsForOrdersMock: vi.fn(),
  buildDailyProfitMock: vi.fn(),
  precomputeUnitCostsForOrdersMock: vi.fn(),
  effectiveCostOverridesMock: vi.fn(),
  enrichOrdersWithAdsMock: vi.fn(),
  enrichProductsWithAdsMock: vi.fn(),
  buildProfitKillersInsightsMock: vi.fn(),
  buildOpportunityDeepDiveMock: vi.fn(),
  buildActionPlanMock: vi.fn(),
  resolveCostProfileMock: vi.fn(),
  runOpportunityScenarioSimulationsMock: vi.fn(),
}));

vi.mock("../../domain/profit.js", () => ({
  calculateOrderProfit: calculateOrderProfitMock,
  buildProductsProfit: buildProductsProfitMock,
  allocateFixedCostsForOrders: allocateFixedCostsForOrdersMock,
}));

vi.mock("../../domain/profitDaily.js", () => ({
  buildDailyProfit: buildDailyProfitMock,
}));

vi.mock("./helpers.js", async () => {
  const actual = await vi.importActual<typeof import("./helpers.js")>("./helpers.js");
  return {
    ...actual,
    precomputeUnitCostsForOrders: precomputeUnitCostsForOrdersMock,
    effectiveCostOverrides: effectiveCostOverridesMock,
  };
});

vi.mock("../../domain/insights/adsAllocation.js", () => ({
  enrichOrdersWithAds: enrichOrdersWithAdsMock,
  enrichProductsWithAds: enrichProductsWithAdsMock,
}));

vi.mock("../../domain/insights.js", () => ({
  buildProfitKillersInsights: buildProfitKillersInsightsMock,
}));

vi.mock("../../domain/opportunities/deepDive.js", () => ({
  buildOpportunityDeepDive: buildOpportunityDeepDiveMock,
}));

vi.mock("../../domain/actions.js", () => ({
  buildActionPlan: buildActionPlanMock,
}));

vi.mock("../../domain/costModel/resolve.js", () => ({
  resolveCostProfile: resolveCostProfileMock,
}));

vi.mock("../../domain/simulations/runScenarioPresets.js", () => ({
  runOpportunityScenarioSimulations: runOpportunityScenarioSimulationsMock,
}));

import { registerActionsPlanRoute } from "./actionsPlan.route.js";

function makeCtx(overrides?: Partial<any>) {
  const costModelOverridesStore = {
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
    getOverridesSync: vi.fn().mockReturnValue(undefined),
    getUpdatedAtSync: vi.fn().mockReturnValue("2026-01-01T00:00:00.000Z"),
  };

  const actionPlanStateStore = {
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
    getStateSync: vi.fn().mockReturnValue(null),
    getUpdatedAtSync: vi.fn().mockReturnValue("2026-01-02T00:00:00.000Z"),
  };

  return {
    shop: "main-shop.myshopify.com",
    shopify: { get: vi.fn() },

    fetchOrders: vi.fn().mockResolvedValue([
      { id: "o1", name: "#1001", created_at: "2026-01-10T00:00:00.000Z", currency: "USD" },
    ]),
    fetchOrdersForShop: vi.fn().mockResolvedValue([
      { id: "o2", name: "#2001", created_at: "2026-01-11T00:00:00.000Z", currency: "USD" },
    ]),
    createShopifyForShop: vi.fn().mockResolvedValue({ get: vi.fn() }),

    cogsService: { computeUnitCostsByVariant: vi.fn() },
    getCogsServiceForShop: vi.fn().mockResolvedValue({ computeUnitCostsByVariant: vi.fn() }),

    costModelOverridesStore,
    getCostModelOverridesStoreForShop: vi.fn().mockResolvedValue(costModelOverridesStore),

    actionPlanStateStore,
    getActionPlanStateStoreForShop: vi.fn().mockResolvedValue(actionPlanStateStore),

    ...overrides,
  };
}

async function buildApp(ctx: any) {
  const app = Fastify({ logger: false });
  (app as any).config = {
    DATA_DIR: "/tmp/test-data",
  };

  registerActionsPlanRoute(app, ctx);
  return app;
}

describe("actionsPlan.route", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    resolveCostProfileMock.mockReturnValue({
      meta: { fingerprint: "fp_123" },
      derived: { fixedCostsMonthlyTotal: 300 },
      fixedCosts: { daysInMonth: 30, allocationMode: "PER_ORDER" },
    });

    effectiveCostOverridesMock.mockReturnValue(undefined);
    precomputeUnitCostsForOrdersMock.mockResolvedValue(new Map());

    calculateOrderProfitMock.mockResolvedValue({
      grossSales: 100,
      refunds: 0,
      netAfterRefunds: 100,
      cogs: 20,
      paymentFees: 5,
      contributionMargin: 75,
      contributionMarginPct: 75,
      shippingRevenue: 10,
      shippingCost: 4,
      shippingImpact: 6,
      profitAfterShipping: 81,
      adSpendBreakEven: 81,
      breakEvenRoas: 1.23,
    });

    buildDailyProfitMock.mockReturnValue({
      totals: {
        orders: 1,
        shippingRevenue: 10,
        shippingCost: 4,
        shippingImpact: 6,
      },
    });

    buildProductsProfitMock.mockResolvedValue({
      products: [{ productId: "p1", netSales: 100, profitAfterFees: 70 }],
      highlights: { missingCogsCount: 0 },
    });

    enrichOrdersWithAdsMock.mockImplementation(({ orders }: any) =>
      orders.map((o: any) => ({
        ...o,
        adSpendAllocated: 0,
        profitAfterAds: o.contributionMargin,
        profitAfterAdsAndShipping: o.profitAfterShipping,
      }))
    );

    enrichProductsWithAdsMock.mockImplementation(({ products }: any) => products);

    allocateFixedCostsForOrdersMock.mockImplementation(({ rows }: any) =>
      rows.map((r: any) => ({
        ...r,
        fixedCostAllocated: 10,
        profitAfterAdsAndShipping: r.profitAfterAdsAndShipping ?? 81,
      }))
    );

    buildProfitKillersInsightsMock.mockReturnValue({
      meta: { currency: "USD" },
      unifiedOpportunitiesAll: [
        {
          type: "SHIPPING",
          code: "FIX_SHIPPING_SUBSIDY",
          estimatedMonthlyLoss: 400,
        },
      ],
      unifiedOpportunitiesTop5: [
        {
          type: "SHIPPING",
          code: "FIX_SHIPPING_SUBSIDY",
          estimatedMonthlyLoss: 400,
        },
      ],
      opportunities: [{ type: "SHIPPING" }],
      insights: [{ type: "shippingSubsidy" }],
    });

    runOpportunityScenarioSimulationsMock.mockResolvedValue({
      baselineSummary: { contributionMargin: 1000 },
      simulationsByOpportunity: [
        {
          type: "SHIPPING",
          scenarios: [{ key: "test", estimatedLift: 50 }],
        },
      ],
    });

    buildOpportunityDeepDiveMock.mockReturnValue({
      deepDives: [
        {
          type: "SHIPPING",
          concentration: null,
          drivers: [],
          worstOrders: [],
        },
      ],
    });

    buildActionPlanMock.mockReturnValue({
      shop: "main-shop.myshopify.com",
      days: 30,
      currency: "USD",
      actions: [
        {
          code: "FIX_SHIPPING_SUBSIDY",
          label: "Fix shipping subsidy",
          effort: "LOW",
          confidence: "HIGH",
          estimatedMonthlyGain: 400,
          priorityScore: 88,
          opportunityType: "SHIPPING",
          why: "Shipping losses are concentrated",
          checklist: [],
        },
      ],
      meta: {
        generatedAtIso: "2026-01-01T00:00:00.000Z",
      },
    });
  });

  it("returns 400 when shop is missing and ctx.shop fallback is empty", async () => {
    const ctx = makeCtx({ shop: "" });
    const app = await buildApp(ctx);

    const res = await app.inject({
      method: "GET",
      url: "/api/actions/plan",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: "shop is required (valid *.myshopify.com)",
    });

    expect(ctx.fetchOrders).not.toHaveBeenCalled();
    expect(ctx.fetchOrdersForShop).not.toHaveBeenCalled();
  });

  it("uses same-shop ctx path when requested shop matches ctx.shop", async () => {
    const ctx = makeCtx();

    ctx.actionPlanStateStore.getStateSync.mockReturnValue({
      actionId: "persisted",
      status: "DONE",
      note: "already handled",
      dueDate: null,
      dismissedReason: null,
      updatedAt: "2026-01-05T00:00:00.000Z",
    });

    const app = await buildApp(ctx);

    const res = await app.inject({
      method: "GET",
      url: "/api/actions/plan?shop=main-shop.myshopify.com&days=30&limit=5",
    });

    expect(res.statusCode).toBe(200);

    expect(ctx.fetchOrders).toHaveBeenCalledWith(30);
    expect(ctx.fetchOrdersForShop).not.toHaveBeenCalled();
    expect(ctx.createShopifyForShop).not.toHaveBeenCalled();
    expect(ctx.getCogsServiceForShop).not.toHaveBeenCalled();
    expect(ctx.getCostModelOverridesStoreForShop).not.toHaveBeenCalled();
    expect(ctx.getActionPlanStateStoreForShop).not.toHaveBeenCalled();

    const json = res.json();

    expect(json.actions).toHaveLength(1);
    expect(json.actions[0].actionId).toMatch(/^act_[a-f0-9]{8}$/);
    expect(json.actions[0].state).toEqual({
      actionId: "persisted",
      status: "DONE",
      note: "already handled",
      dueDate: null,
      dismissedReason: null,
      updatedAt: "2026-01-05T00:00:00.000Z",
    });

    expect(json.meta.costModel).toEqual({
      fingerprint: "fp_123",
      persistedUpdatedAt: "2026-01-01T00:00:00.000Z",
    });

    expect(json.meta.fixedCosts).toEqual({
      monthlyTotal: 300,
      allocatedInPeriod: 300,
      allocationMode: "PER_ORDER",
      daysInMonth: 30,
    });

    expect(json.meta.actionState).toEqual({
      persistedUpdatedAt: "2026-01-02T00:00:00.000Z",
    });

    expect(json.scenarioSimulations).toEqual({
      baselineSummary: { contributionMargin: 1000 },
      byOpportunity: [
        {
          type: "SHIPPING",
          scenarios: [{ key: "test", estimatedLift: 50 }],
        },
      ],
    });
  });

  it("uses multi-shop branch when requested shop differs from ctx.shop", async () => {
    const ctx = makeCtx();
    const foreignShopify = { get: vi.fn() };

    ctx.createShopifyForShop.mockResolvedValue(foreignShopify);

    const foreignCostModelStore = {
      ensureLoaded: vi.fn().mockResolvedValue(undefined),
      getOverridesSync: vi.fn().mockReturnValue(undefined),
      getUpdatedAtSync: vi.fn().mockReturnValue("2026-02-01T00:00:00.000Z"),
    };

    const foreignActionStateStore = {
      ensureLoaded: vi.fn().mockResolvedValue(undefined),
      getStateSync: vi.fn().mockReturnValue(null),
      getUpdatedAtSync: vi.fn().mockReturnValue("2026-02-02T00:00:00.000Z"),
    };

    ctx.getCogsServiceForShop.mockResolvedValue({ computeUnitCostsByVariant: vi.fn() });
    ctx.getCostModelOverridesStoreForShop.mockResolvedValue(foreignCostModelStore);
    ctx.getActionPlanStateStoreForShop.mockResolvedValue(foreignActionStateStore);

    const app = await buildApp(ctx);

    const res = await app.inject({
      method: "GET",
      url: "/api/actions/plan?shop=other-shop.myshopify.com&days=14",
    });

    expect(res.statusCode).toBe(200);

    expect(ctx.fetchOrders).not.toHaveBeenCalled();
    expect(ctx.fetchOrdersForShop).toHaveBeenCalledWith("other-shop.myshopify.com", 14);
    expect(ctx.createShopifyForShop).toHaveBeenCalledWith("other-shop.myshopify.com");
    expect(ctx.getCogsServiceForShop).toHaveBeenCalledWith("other-shop.myshopify.com");
    expect(ctx.getCostModelOverridesStoreForShop).toHaveBeenCalledWith("other-shop.myshopify.com");
    expect(ctx.getActionPlanStateStoreForShop).toHaveBeenCalledWith("other-shop.myshopify.com");
  });

  it("skips scenario simulation when no top opportunities exist", async () => {
    const ctx = makeCtx();

    buildProfitKillersInsightsMock.mockReturnValue({
      meta: { currency: "USD" },
      unifiedOpportunitiesAll: [],
      unifiedOpportunitiesTop5: [],
      opportunities: [],
      insights: [],
    });

    buildOpportunityDeepDiveMock.mockReturnValue({
      deepDives: [],
    });

    buildActionPlanMock.mockReturnValue({
      shop: "main-shop.myshopify.com",
      days: 30,
      currency: "USD",
      actions: [],
      meta: { generatedAtIso: "2026-01-01T00:00:00.000Z" },
    });

    const app = await buildApp(ctx);

    const res = await app.inject({
      method: "GET",
      url: "/api/actions/plan?shop=main-shop.myshopify.com",
    });

    expect(res.statusCode).toBe(200);
    expect(runOpportunityScenarioSimulationsMock).not.toHaveBeenCalled();

    const json = res.json();
    expect(json.scenarioSimulations).toEqual({
      baselineSummary: null,
      byOpportunity: [],
    });
  });

  it("propagates explicit error status from downstream failure", async () => {
    const ctx = makeCtx();

    ctx.fetchOrders.mockRejectedValue(
      Object.assign(new Error("Forbidden shop access"), { status: 403 })
    );

    const app = await buildApp(ctx);

    const res = await app.inject({
      method: "GET",
      url: "/api/actions/plan?shop=main-shop.myshopify.com",
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: "Unexpected error",
      details: "Forbidden shop access",
    });
  });
});