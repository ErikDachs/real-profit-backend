import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

const {
  calculateOrderProfitMock,
  allocateFixedCostsForOrdersMock,
  allocateAdSpendForOrdersMock,
  computeProfitAfterAdsMock,
  precomputeUnitCostsForOrdersMock,
  effectiveCostOverridesMock,
  resolveCostProfileMock,
} = vi.hoisted(() => ({
  calculateOrderProfitMock: vi.fn(),
  allocateFixedCostsForOrdersMock: vi.fn(),
  allocateAdSpendForOrdersMock: vi.fn(),
  computeProfitAfterAdsMock: vi.fn(),
  precomputeUnitCostsForOrdersMock: vi.fn(),
  effectiveCostOverridesMock: vi.fn(),
  resolveCostProfileMock: vi.fn(),
}));

vi.mock("../../domain/profit.js", () => ({
  calculateOrderProfit: calculateOrderProfitMock,
  allocateFixedCostsForOrders: allocateFixedCostsForOrdersMock,
}));

vi.mock("../../domain/profit/ads.js", () => ({
  allocateAdSpendForOrders: allocateAdSpendForOrdersMock,
  computeProfitAfterAds: computeProfitAfterAdsMock,
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

import { registerOrdersProfitRoute } from "./ordersProfit.route.js";

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
      id: "gift",
      name: "#GIFT",
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

  registerOrdersProfitRoute(app, ctx);
  return app;
}

describe("ordersProfit.route", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    precomputeUnitCostsForOrdersMock.mockResolvedValue(new Map([[101, 12.5]]));
    effectiveCostOverridesMock.mockReturnValue({ merged: true });

    resolveCostProfileMock.mockReturnValue({
      meta: { fingerprint: "fp_orders_profit" },
      ads: { allocationMode: "PER_ORDER" },
      fixedCosts: { daysInMonth: 30, allocationMode: "PER_ORDER" },
      derived: { fixedCostsMonthlyTotal: 300 },
    });

    calculateOrderProfitMock
      .mockResolvedValueOnce({
        orderId: "o1",
        isGiftCardOnlyOrder: false,
        giftCardNetSalesExcluded: 0,
        grossSales: 100,
        refunds: 10,
        netAfterRefunds: 90,
        cogs: 20,
        paymentFees: 5,
        contributionMargin: 65,
        contributionMarginPct: 72.22,
        hasMissingCogs: false,
        missingCogsVariantIds: [],
        shippingRevenue: 4,
        shippingCost: 8,
        shippingImpact: -4,
        profitAfterShipping: 61,
        profitMarginAfterShippingPct: 67.78,
        adSpendBreakEven: 61,
        breakEvenRoas: 1.48,
        profitAfterFees: 65,
        marginAfterFeesPct: 72.22,
      })
      .mockResolvedValueOnce({
        orderId: "gift",
        isGiftCardOnlyOrder: true,
        giftCardNetSalesExcluded: 50,
        grossSales: 50,
        refunds: 0,
        netAfterRefunds: 50,
        cogs: 0,
        paymentFees: 0,
        contributionMargin: 50,
        contributionMarginPct: 100,
        hasMissingCogs: false,
        missingCogsVariantIds: [],
        shippingRevenue: 0,
        shippingCost: 0,
        shippingImpact: 0,
        profitAfterShipping: 50,
        profitMarginAfterShippingPct: 100,
        adSpendBreakEven: 50,
        breakEvenRoas: null,
        profitAfterFees: 50,
        marginAfterFeesPct: 100,
      });

    allocateAdSpendForOrdersMock.mockImplementation(({ rows }: any) =>
      rows.map((r: any) => ({
        ...r,
        allocatedAdSpend: 10,
      }))
    );

    computeProfitAfterAdsMock
      .mockReturnValueOnce(55)
      .mockReturnValueOnce(51)
      .mockReturnValueOnce(65)
      .mockReturnValueOnce(61);

    allocateFixedCostsForOrdersMock.mockImplementation(({ rows }: any) =>
      rows.map((r: any) => ({
        ...r,
        fixedCostAllocated: 10,
      }))
    );
  });

  it("returns 400 when shop is missing and ctx fallback is empty", async () => {
    const ctx = makeCtx({ shop: "" });
    const app = await buildApp(ctx);

    const res = await app.inject({
      method: "GET",
      url: "/api/orders/profit",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: "shop is required (valid *.myshopify.com)",
    });

    expect(ctx.fetchOrders).not.toHaveBeenCalled();
    expect(calculateOrderProfitMock).not.toHaveBeenCalled();
  });

  it("uses same-shop path with adSpend = 0 and fixed costs PER_ORDER", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);

    const res = await app.inject({
      method: "GET",
      url: "/api/orders/profit?shop=main-shop.myshopify.com&days=30&adSpend=0",
    });

    expect(res.statusCode).toBe(200);

    expect(ctx.fetchOrders).toHaveBeenCalledWith(30);
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

    expect(precomputeUnitCostsForOrdersMock).toHaveBeenCalledWith({
      orders: expect.any(Array),
      cogsService: ctx.cogsService,
      shopifyGET: ctx.shopify.get,
    });

    expect(calculateOrderProfitMock).toHaveBeenCalledTimes(2);
    expect(allocateAdSpendForOrdersMock).not.toHaveBeenCalled();
    expect(allocateFixedCostsForOrdersMock).toHaveBeenCalledTimes(1);

    const json = res.json();

    expect(json.shop).toBe("main-shop.myshopify.com");
    expect(json.days).toBe(30);
    expect(json.count).toBe(2);
    expect(json.adSpend).toBe(0);
    expect(json.fixedCosts).toEqual({
      monthlyTotal: 300,
      allocatedInPeriod: 300,
      allocationMode: "PER_ORDER",
      daysInMonth: 30,
    });
    expect(json.costModel).toEqual({
      fingerprint: "fp_orders_profit",
      persistedUpdatedAt: "2026-03-01T00:00:00.000Z",
    });

    // sorted ascending by profitAfterFixedCosts / fallback chain
// sorted ascending by final profit metric
expect(json.orders.map((o: any) => o.id)).toEqual(["gift", "o1"]);

const gift = json.orders.find((o: any) => o.id === "gift");
const o1 = json.orders.find((o: any) => o.id === "o1");

expect(gift).toMatchObject({
  id: "gift",
  allocatedAdSpend: 0,
  profitAfterAds: 50,
  profitAfterAdsAndShipping: 50,
  fixedCostAllocated: 0,
  profitAfterFixedCosts: 50,
  operatingProfit: 50,
});

expect(o1).toMatchObject({
  id: "o1",
  allocatedAdSpend: 0,
  profitAfterAds: 65,
  profitAfterAdsAndShipping: 61,
  fixedCostAllocated: 10,
  profitAfterFixedCosts: 51,
  operatingProfit: 51,
});
  });

  it("uses ad allocation in PER_ORDER mode only for operational rows", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);

    const res = await app.inject({
      method: "GET",
      url: "/api/orders/profit?shop=main-shop.myshopify.com&days=30&adSpend=20",
    });

    expect(res.statusCode).toBe(200);

    expect(allocateAdSpendForOrdersMock).toHaveBeenCalledTimes(1);
    expect(allocateAdSpendForOrdersMock).toHaveBeenCalledWith({
      rows: [
        expect.objectContaining({
          id: "o1",
          isGiftCardOnlyOrder: false,
        }),
      ],
      adSpend: 20,
      mode: "PER_ORDER",
    });

    const json = res.json();

    const o1 = json.orders.find((x: any) => x.id === "o1");
    const gift = json.orders.find((x: any) => x.id === "gift");

    expect(o1).toMatchObject({
      allocatedAdSpend: 10,
      profitAfterAds: 55,
      profitAfterAdsAndShipping: 51,
      fixedCostAllocated: 10,
      profitAfterFixedCosts: 41,
      operatingProfit: 41,
    });

    expect(gift).toMatchObject({
      allocatedAdSpend: 0,
      profitAfterAds: 50,
      profitAfterAdsAndShipping: 50,
      fixedCostAllocated: 0,
      profitAfterFixedCosts: 50,
      operatingProfit: 50,
    });
  });

  it("uses multi-shop branch and non-PER_ORDER ad mode across all rows", async () => {
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

    resolveCostProfileMock.mockReturnValue({
      meta: { fingerprint: "fp_foreign" },
      ads: { allocationMode: "BY_NET_SALES" },
      fixedCosts: { daysInMonth: 30, allocationMode: "BY_NET_SALES" },
      derived: { fixedCostsMonthlyTotal: 300 },
    });

    calculateOrderProfitMock.mockReset();
    calculateOrderProfitMock.mockResolvedValue({
      orderId: "f1",
      isGiftCardOnlyOrder: false,
      giftCardNetSalesExcluded: 0,
      grossSales: 200,
      refunds: 0,
      netAfterRefunds: 200,
      cogs: 40,
      paymentFees: 8,
      contributionMargin: 152,
      contributionMarginPct: 76,
      hasMissingCogs: false,
      missingCogsVariantIds: [],
      shippingRevenue: 10,
      shippingCost: 5,
      shippingImpact: 5,
      profitAfterShipping: 157,
      profitMarginAfterShippingPct: 78.5,
      adSpendBreakEven: 157,
      breakEvenRoas: 1.27,
      profitAfterFees: 152,
      marginAfterFeesPct: 76,
    });

    computeProfitAfterAdsMock.mockReset();
    computeProfitAfterAdsMock
      .mockReturnValueOnce(140)
      .mockReturnValueOnce(145);

    allocateFixedCostsForOrdersMock.mockReset();
    allocateFixedCostsForOrdersMock.mockImplementation(({ rows }: any) =>
      rows.map((r: any) => ({
        ...r,
        fixedCostAllocated: 20,
      }))
    );

    const app = await buildApp(ctx);

    const res = await app.inject({
      method: "GET",
      url: "/api/orders/profit?shop=other-shop.myshopify.com&days=14&adSpend=12.5",
    });

    expect(res.statusCode).toBe(200);

    expect(ctx.fetchOrders).not.toHaveBeenCalled();
    expect(ctx.fetchOrdersForShop).toHaveBeenCalledWith("other-shop.myshopify.com", 14);
    expect(ctx.createShopifyForShop).toHaveBeenCalledWith("other-shop.myshopify.com");
    expect(ctx.getCogsOverridesStoreForShop).toHaveBeenCalledWith("other-shop.myshopify.com");
    expect(ctx.getCogsServiceForShop).toHaveBeenCalledWith("other-shop.myshopify.com");
    expect(ctx.getCostModelOverridesStoreForShop).toHaveBeenCalledWith("other-shop.myshopify.com");

    expect(allocateAdSpendForOrdersMock).toHaveBeenCalledWith({
      rows: [
        expect.objectContaining({
          id: "f1",
        }),
      ],
      adSpend: 12.5,
      mode: "BY_NET_SALES",
    });

    const json = res.json();
    expect(json.shop).toBe("other-shop.myshopify.com");
    expect(json.days).toBe(14);
    expect(json.adSpend).toBe(12.5);
    expect(json.fixedCosts).toEqual({
      monthlyTotal: 300,
      allocatedInPeriod: 140,
      allocationMode: "BY_NET_SALES",
      daysInMonth: 30,
    });
    expect(json.costModel).toEqual({
      fingerprint: "fp_foreign",
      persistedUpdatedAt: "2026-04-01T00:00:00.000Z",
    });
    expect(json.orders[0]).toMatchObject({
      id: "f1",
      allocatedAdSpend: 10,
      profitAfterAds: 140,
      profitAfterAdsAndShipping: 145,
      fixedCostAllocated: 20,
      profitAfterFixedCosts: 125,
      operatingProfit: 125,
    });
  });

  it("uses BY_DAYS fixed cost mode without allocation engine", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);

    resolveCostProfileMock.mockReturnValue({
      meta: { fingerprint: "fp_by_days" },
      ads: { allocationMode: "PER_ORDER" },
      fixedCosts: { daysInMonth: 30, allocationMode: "BY_DAYS" },
      derived: { fixedCostsMonthlyTotal: 300 },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/orders/profit?shop=main-shop.myshopify.com&days=15&adSpend=0",
    });

    expect(res.statusCode).toBe(200);
    expect(allocateFixedCostsForOrdersMock).not.toHaveBeenCalled();

    const json = res.json();
    expect(json.fixedCosts).toEqual({
      monthlyTotal: 300,
      allocatedInPeriod: 150,
      allocationMode: "BY_DAYS",
      daysInMonth: 30,
    });

    expect(json.orders[0]).toHaveProperty("fixedCostAllocated");
    expect(json.orders[0]).toHaveProperty("profitAfterFixedCosts");
    expect(json.orders[0]).toHaveProperty("operatingProfit");
  });

  it("propagates explicit downstream status", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);

    ctx.fetchOrders.mockRejectedValue(
      Object.assign(new Error("Forbidden shop access"), { status: 403 })
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/orders/profit?shop=main-shop.myshopify.com",
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: "Unexpected error",
      details: "Forbidden shop access",
    });
  });
});