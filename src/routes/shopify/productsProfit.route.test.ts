import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

const {
  buildProductsProfitMock,
  effectiveCostOverridesMock,
  resolveCostProfileMock,
} = vi.hoisted(() => ({
  buildProductsProfitMock: vi.fn(),
  effectiveCostOverridesMock: vi.fn(),
  resolveCostProfileMock: vi.fn(),
}));

vi.mock("../../domain/profit.js", () => ({
  buildProductsProfit: buildProductsProfitMock,
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

import { registerProductsProfitRoute } from "./productsProfit.route.js";

function makeCtx(overrides?: Partial<any>) {
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

  registerProductsProfitRoute(app, ctx);
  return app;
}

describe("productsProfit.route", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    effectiveCostOverridesMock.mockReturnValue({ merged: true });

    resolveCostProfileMock.mockReturnValue({
      meta: { fingerprint: "fp_products_profit" },
    });

    buildProductsProfitMock.mockResolvedValue({
      shop: "main-shop.myshopify.com",
      days: 30,
      products: [
        {
          productId: 1,
          variantId: 101,
          title: "Product A",
          netSales: 90,
          profitAfterFees: 65,
        },
      ],
      highlights: {
        missingCogsCount: 1,
      },
    });
  });

  it("returns 400 when shop is missing and ctx fallback is empty", async () => {
    const ctx = makeCtx({ shop: "" });
    const app = await buildApp(ctx);

    const res = await app.inject({
      method: "GET",
      url: "/api/orders/products/profit",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: "shop is required (valid *.myshopify.com)",
    });

    expect(ctx.fetchOrders).not.toHaveBeenCalled();
    expect(buildProductsProfitMock).not.toHaveBeenCalled();
  });

  it("uses same-shop path and passes adSpend as undefined when adSpend is 0", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);

    const res = await app.inject({
      method: "GET",
      url: "/api/orders/products/profit?shop=main-shop.myshopify.com&days=14&adSpend=0",
    });

    expect(res.statusCode).toBe(200);

    expect(ctx.fetchOrders).toHaveBeenCalledWith(14);
    expect(ctx.fetchOrdersForShop).not.toHaveBeenCalled();
    expect(ctx.createShopifyForShop).not.toHaveBeenCalled();
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

    expect(buildProductsProfitMock).toHaveBeenCalledWith({
      shop: "main-shop.myshopify.com",
      days: 14,
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
        meta: { fingerprint: "fp_products_profit" },
      },
      cogsService: ctx.cogsService,
      shopifyGET: ctx.shopify.get,
      adSpend: undefined,
    });

    expect(res.json()).toEqual({
      shop: "main-shop.myshopify.com",
      days: 30,
      products: [
        {
          productId: 1,
          variantId: 101,
          title: "Product A",
          netSales: 90,
          profitAfterFees: 65,
        },
      ],
      highlights: {
        missingCogsCount: 1,
      },
      costModel: {
        fingerprint: "fp_products_profit",
        persistedUpdatedAt: "2026-03-01T00:00:00.000Z",
      },
    });
  });

  it("uses same-shop path and passes rounded adSpend when adSpend > 0", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);

    await app.inject({
      method: "GET",
      url: "/api/orders/products/profit?shop=main-shop.myshopify.com&days=14&adSpend=12.345",
    });

    expect(buildProductsProfitMock).toHaveBeenCalledWith({
      shop: "main-shop.myshopify.com",
      days: 14,
      orders: expect.any(Array),
      costProfile: {
        meta: { fingerprint: "fp_products_profit" },
      },
      cogsService: ctx.cogsService,
      shopifyGET: ctx.shopify.get,
      adSpend: 12.35,
    });
  });

  it("uses multi-shop path when requested shop differs from ctx.shop", async () => {
    const foreignShopify = { get: vi.fn() };
    const foreignCostModelOverridesStore = {
      ensureLoaded: vi.fn().mockResolvedValue(undefined),
      getOverridesSync: vi.fn().mockReturnValue(undefined),
      getUpdatedAtSync: vi.fn().mockReturnValue("2026-04-01T00:00:00.000Z"),
    };
    const foreignCogsService = {};

    const ctx = makeCtx({
      createShopifyForShop: vi.fn().mockResolvedValue(foreignShopify),
      getCogsServiceForShop: vi.fn().mockResolvedValue(foreignCogsService),
      getCostModelOverridesStoreForShop: vi.fn().mockResolvedValue(foreignCostModelOverridesStore),
    });

    resolveCostProfileMock.mockReturnValue({
      meta: { fingerprint: "fp_foreign_products_profit" },
    });

    buildProductsProfitMock.mockResolvedValue({
      shop: "other-shop.myshopify.com",
      days: 7,
      products: [],
      highlights: {},
    });

    const app = await buildApp(ctx);

    const res = await app.inject({
      method: "GET",
      url: "/api/orders/products/profit?shop=other-shop.myshopify.com&days=7",
    });

    expect(res.statusCode).toBe(200);

    expect(ctx.fetchOrders).not.toHaveBeenCalled();
    expect(ctx.fetchOrdersForShop).toHaveBeenCalledWith("other-shop.myshopify.com", 7);
    expect(ctx.createShopifyForShop).toHaveBeenCalledWith("other-shop.myshopify.com");
    expect(ctx.getCogsServiceForShop).toHaveBeenCalledWith("other-shop.myshopify.com");
    expect(ctx.getCostModelOverridesStoreForShop).toHaveBeenCalledWith("other-shop.myshopify.com");

    expect(buildProductsProfitMock).toHaveBeenCalledWith({
      shop: "other-shop.myshopify.com",
      days: 7,
      orders: [
        {
          id: "f1",
          name: "#2001",
          created_at: "2026-03-03T10:00:00.000Z",
          currency: "EUR",
        },
      ],
      costProfile: {
        meta: { fingerprint: "fp_foreign_products_profit" },
      },
      cogsService: foreignCogsService,
      shopifyGET: foreignShopify.get,
      adSpend: undefined,
    });

    expect(res.json()).toEqual({
      shop: "other-shop.myshopify.com",
      days: 7,
      products: [],
      highlights: {},
      costModel: {
        fingerprint: "fp_foreign_products_profit",
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
      url: "/api/orders/products/profit?shop=main-shop.myshopify.com",
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({
      error: "Unexpected error",
      details: "Forbidden shop access",
    });
  });
});