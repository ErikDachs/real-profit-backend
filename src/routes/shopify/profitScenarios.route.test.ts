import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

const {
  buildOrdersSummaryMock,
  resolveCostProfileMock,
  costOverridesFromAnyMock,
  buildProfitScenarioResultMock,
} = vi.hoisted(() => ({
  buildOrdersSummaryMock: vi.fn(),
  resolveCostProfileMock: vi.fn(),
  costOverridesFromAnyMock: vi.fn(),
  buildProfitScenarioResultMock: vi.fn(),
}));

vi.mock("../../domain/profit.js", () => ({
  buildOrdersSummary: buildOrdersSummaryMock,
}));

vi.mock("../../domain/costModel/resolve.js", () => ({
  resolveCostProfile: resolveCostProfileMock,
  costOverridesFromAny: costOverridesFromAnyMock,
}));

vi.mock("../../domain/simulations/profitScenarioSimulation.js", () => ({
  buildProfitScenarioResult: buildProfitScenarioResultMock,
}));

import { registerProfitScenariosRoute } from "./profitScenarios.route.js";
import { authHeadersForShop } from "./testEmbeddedAuth.js";

function makeCtx(overrides?: Partial<any>) {
  const costModelOverridesStore = {
    ensureLoaded: vi.fn().mockResolvedValue(undefined),
    getOverridesSync: vi.fn().mockReturnValue(undefined),
    getUpdatedAtSync: vi.fn().mockReturnValue("2026-01-01T00:00:00.000Z"),
  };

  const cogsService = {
    computeUnitCostsByVariant: vi.fn().mockResolvedValue(
      new Map<number, number | undefined>([
        [101, 12.5],
        [202, 7.25],
      ])
    ),
  };

  return {
    shop: "main-shop.myshopify.com",
    shopify: { get: vi.fn() },

    fetchOrders: vi.fn().mockResolvedValue([
      {
        id: "o1",
        line_items: [
          { variant_id: 101 },
          { variant_id: 0 },
          { variant_id: 202 },
        ],
      },
    ]),

    fetchOrdersForShop: vi.fn().mockResolvedValue([
      {
        id: "o2",
        line_items: [{ variant_id: 303 }],
      },
    ]),

    createShopifyForShop: vi.fn().mockResolvedValue({ get: vi.fn() }),

    cogsService,
    getCogsServiceForShop: vi.fn().mockResolvedValue({
      computeUnitCostsByVariant: vi.fn().mockResolvedValue(
        new Map<number, number | undefined>([[303, 9.99]])
      ),
    }),

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

  registerProfitScenariosRoute(app, ctx);
  return app;
}

describe("profitScenarios.route", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    costOverridesFromAnyMock.mockReturnValue(undefined);

    resolveCostProfileMock.mockImplementation(({ overrides }: any) => {
      const feePercent = Number(overrides?.payment?.feePercent ?? 0.03);
      const feeFixed = Number(overrides?.payment?.feeFixed ?? 0.3);
      const shippingOff = overrides?.flags?.includeShippingCost === false;

      if (shippingOff) {
        return {
          meta: { fingerprint: "fp_simulated" },
          payment: { feePercent: 0.03, feeFixed: 0.3 },
          shipping: { costPerOrder: 0 },
          flags: { includeShippingCost: false },
        };
      }

      if (feePercent === 0.024 && feeFixed === 0.24) {
        return {
          meta: { fingerprint: "fp_simulated" },
          payment: { feePercent: 0.024, feeFixed: 0.24 },
          shipping: { costPerOrder: 8 },
        };
      }

      return {
        meta: { fingerprint: "fp_baseline" },
        payment: { feePercent: 0.03, feeFixed: 0.3 },
        shipping: { costPerOrder: 8 },
      };
    });

    buildOrdersSummaryMock
      .mockResolvedValueOnce({
        profitAfterFees: 100,
        profitAfterShipping: 90,
        paymentFees: 10,
        shippingCost: 8,
        contributionMargin: 120,
        contributionMarginPct: 40,
        breakEvenRoas: 1.5,
        profitMarginAfterShippingPct: 30,
      })
      .mockResolvedValueOnce({
        profitAfterFees: 112,
        profitAfterShipping: 102,
        paymentFees: 8,
        shippingCost: 8,
        contributionMargin: 132,
        contributionMarginPct: 44,
        breakEvenRoas: 1.3,
        profitMarginAfterShippingPct: 34,
      });

    buildProfitScenarioResultMock.mockReturnValue({
      baseline: { some: "baseline" },
      simulated: { some: "simulated" },
      delta: {
        profitLiftAfterFees: 12,
        profitLiftAfterShipping: 12,
        paymentFeesChange: -2,
        shippingCostChange: 0,
        contributionMarginChange: 12,
        contributionMarginPctChange: 4,
        breakEvenRoasChange: -0.2,
        profitAfterShippingChange: 12,
        profitMarginAfterShippingPctChange: 4,
        profitAfterShippingPctChange: 13.33,
      },
    });
  });

  it("returns 401 without embedded auth token", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);

    const res = await app.inject({
      method: "GET",
      url: "/api/simulations/profit-scenarios?shop=main-shop.myshopify.com&scenario=fees_-20",
    });

    expect(res.statusCode).toBe(401);
    expect(ctx.fetchOrders).not.toHaveBeenCalled();
  });

  it("returns 400 when scenario is missing", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);

    const res = await app.inject({
      method: "GET",
      url: "/api/simulations/profit-scenarios?shop=main-shop.myshopify.com",
      headers: authHeadersForShop("main-shop.myshopify.com", undefined, { app }),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: "Missing scenario",
      details:
        "Provide ?scenario=fees_-20 | fees_-10 | fees_-30 | ship_-25 | ship_-50 | ship_-75 | ship_off",
    });

    expect(ctx.fetchOrders).not.toHaveBeenCalled();
    expect(buildOrdersSummaryMock).not.toHaveBeenCalled();
  });

  it("returns 401 when shop is missing because auth now happens first", async () => {
    const ctx = makeCtx({ shop: "" });
    const app = await buildApp(ctx);

    const res = await app.inject({
      method: "GET",
      url: "/api/simulations/profit-scenarios?scenario=fees_-20",
    });

    expect(res.statusCode).toBe(401);
    expect(ctx.fetchOrders).not.toHaveBeenCalled();
  });

  it("returns 400 for unknown scenario", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);

    const res = await app.inject({
      method: "GET",
      url: "/api/simulations/profit-scenarios?shop=main-shop.myshopify.com&scenario=not_real",
      headers: authHeadersForShop("main-shop.myshopify.com", undefined, { app }),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: "Unknown scenario",
      details: "Valid: fees_-10 | fees_-20 | fees_-30 | ship_-25 | ship_-50 | ship_-75 | ship_off",
    });

    expect(ctx.fetchOrders).toHaveBeenCalledWith(30);
    expect(buildOrdersSummaryMock).not.toHaveBeenCalled();
  });

  it("uses same-shop path and returns successful scenario result", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);

    const res = await app.inject({
      method: "GET",
      url: "/api/simulations/profit-scenarios?shop=main-shop.myshopify.com&scenario=fees_-20&days=14&adSpend=123.456",
      headers: authHeadersForShop("main-shop.myshopify.com", undefined, { app }),
    });

    expect(res.statusCode).toBe(200);

    expect(ctx.fetchOrders).toHaveBeenCalledWith(14);
    expect(ctx.fetchOrdersForShop).not.toHaveBeenCalled();
    expect(ctx.createShopifyForShop).not.toHaveBeenCalled();
    expect(ctx.getCogsServiceForShop).not.toHaveBeenCalled();
    expect(ctx.getCostModelOverridesStoreForShop).not.toHaveBeenCalled();

    expect(ctx.cogsService.computeUnitCostsByVariant).toHaveBeenCalledWith(
      ctx.shopify.get,
      [101, 202]
    );

    expect(ctx.costModelOverridesStore.ensureLoaded).toHaveBeenCalledTimes(1);
    expect(costOverridesFromAnyMock).toHaveBeenCalledTimes(1);
    expect(resolveCostProfileMock).toHaveBeenCalledTimes(2);
    expect(buildOrdersSummaryMock).toHaveBeenCalledTimes(2);
    expect(buildProfitScenarioResultMock).toHaveBeenCalledTimes(1);

    const calls = buildOrdersSummaryMock.mock.calls.map((args) => args[0]);

    expect(calls).toHaveLength(2);

    for (const call of calls) {
      expect(call).toEqual(
        expect.objectContaining({
          shop: "main-shop.myshopify.com",
          days: 14,
          adSpend: 123.46,
          orders: expect.any(Array),
          cogsService: ctx.cogsService,
          shopifyGET: ctx.shopify.get,
          unitCostByVariant: expect.any(Map),
        })
      );
    }

    const fingerprints = calls.map((call) => call.costProfile?.meta?.fingerprint).sort();

    expect(fingerprints).toEqual(["fp_baseline", "fp_simulated"]);

    expect(res.json()).toEqual({
      shop: "main-shop.myshopify.com",
      scenario: "fees_-20",
      baseline: { some: "baseline" },
      simulated: { some: "simulated" },
      delta: {
        profitLiftAfterFees: 12,
        profitLiftAfterShipping: 12,
        paymentFeesChange: -2,
        shippingCostChange: 0,
        contributionMarginChange: 12,
        contributionMarginPctChange: 4,
        breakEvenRoasChange: -0.2,
        profitAfterShippingChange: 12,
        profitMarginAfterShippingPctChange: 4,
        profitAfterShippingPctChange: 13.33,
      },
      costModel: {
        baselineFingerprint: "fp_baseline",
        simulatedFingerprint: "fp_simulated",
        persistedUpdatedAt: "2026-01-01T00:00:00.000Z",
      },
    });
  });

  it("uses multi-shop path when authenticated shop differs from ctx.shop", async () => {
    const foreignShopify = { get: vi.fn() };
    const foreignCostModelStore = {
      ensureLoaded: vi.fn().mockResolvedValue(undefined),
      getOverridesSync: vi.fn().mockReturnValue(undefined),
      getUpdatedAtSync: vi.fn().mockReturnValue("2026-02-01T00:00:00.000Z"),
    };
    const foreignCogsService = {
      computeUnitCostsByVariant: vi.fn().mockResolvedValue(
        new Map<number, number | undefined>([[303, 9.99]])
      ),
    };

    const ctx = makeCtx({
      createShopifyForShop: vi.fn().mockResolvedValue(foreignShopify),
      getCogsServiceForShop: vi.fn().mockResolvedValue(foreignCogsService),
      getCostModelOverridesStoreForShop: vi.fn().mockResolvedValue(foreignCostModelStore),
    });

    resolveCostProfileMock.mockReset();
    resolveCostProfileMock.mockImplementation(({ overrides }: any) => {
      const shippingOff = overrides?.flags?.includeShippingCost === false;

      if (shippingOff) {
        return {
          meta: { fingerprint: "fp_sim_foreign" },
          payment: { feePercent: 0.03, feeFixed: 0.3 },
          shipping: { costPerOrder: 0 },
          flags: { includeShippingCost: false },
        };
      }

      return {
        meta: { fingerprint: "fp_baseline_foreign" },
        payment: { feePercent: 0.03, feeFixed: 0.3 },
        shipping: { costPerOrder: 8 },
      };
    });

    const app = await buildApp(ctx);

    const res = await app.inject({
      method: "GET",
      url: "/api/simulations/profit-scenarios?shop=other-shop.myshopify.com&scenario=ship_off&days=7",
      headers: authHeadersForShop("other-shop.myshopify.com", undefined, { app }),
    });

    expect(res.statusCode).toBe(200);

    expect(ctx.fetchOrders).not.toHaveBeenCalled();
    expect(ctx.fetchOrdersForShop).toHaveBeenCalledWith("other-shop.myshopify.com", 7);
    expect(ctx.createShopifyForShop).toHaveBeenCalledWith("other-shop.myshopify.com");
    expect(ctx.getCogsServiceForShop).toHaveBeenCalledWith("other-shop.myshopify.com");
    expect(ctx.getCostModelOverridesStoreForShop).toHaveBeenCalledWith("other-shop.myshopify.com");

    expect(foreignCogsService.computeUnitCostsByVariant).toHaveBeenCalledWith(
      foreignShopify.get,
      [303]
    );

    expect(res.json().shop).toBe("other-shop.myshopify.com");
    expect(res.json().scenario).toBe("ship_off");
    expect(res.json().costModel).toEqual({
      baselineFingerprint: "fp_baseline_foreign",
      simulatedFingerprint: "fp_sim_foreign",
      persistedUpdatedAt: "2026-02-01T00:00:00.000Z",
    });
  });

  it("returns 403 for authenticated shop mismatch", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);

    const res = await app.inject({
      method: "GET",
      url: "/api/simulations/profit-scenarios?shop=other-shop.myshopify.com&scenario=fees_-20",
      headers: authHeadersForShop("main-shop.myshopify.com", undefined, { app }),
    });

    expect(res.statusCode).toBe(403);
    expect(ctx.fetchOrders).not.toHaveBeenCalled();
  });

  it("propagates explicit downstream status", async () => {
    const ctx = makeCtx();
    ctx.fetchOrders.mockRejectedValue(
      Object.assign(new Error("Forbidden shop access"), { status: 403 })
    );

    const app = await buildApp(ctx);

    const res = await app.inject({
      method: "GET",
      url: "/api/simulations/profit-scenarios?shop=main-shop.myshopify.com&scenario=fees_-20",
      headers: authHeadersForShop("main-shop.myshopify.com", undefined, { app }),
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: "Unexpected error",
      details: "Forbidden shop access",
    });
  });
});