import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import type { ShopifyCtx } from "./ctx.js";
import { buildApp } from "../../app.js";

const shop = "test-shop.myshopify.com";

const buildProductsProfitMock = vi.fn();

vi.mock("../../domain/profit.js", () => {
  return {
    buildProductsProfit: (...args: any[]) => buildProductsProfitMock(...args),
    buildOrdersSummary: async () => ({}),
    calculateOrderProfit: async () => ({}),
    allocateFixedCostsForOrders: ({ rows }: any) => rows ?? [],
  };
});

const costModelOverridesStore = {
  ensureLoaded: async () => {},
  ensureFresh: async () => {},
  getOverridesSync: () => undefined,
  getUpdatedAtSync: () => undefined,
  setOverrides: async (_overrides: any) => {},
  clear: async () => {},
} as any;

const actionPlanStateStore = {
  ensureLoaded: async () => {},
  ensureFresh: async () => {},
  getUpdatedAtSync: () => null,
  getStateSync: (_actionId: string) => null,
  list: async () => [],
  upsert: async ({ actionId, status, note, dueDate, dismissedReason }: any) => ({
    actionId,
    status: status ?? "OPEN",
    note: note ?? null,
    dueDate: dueDate ?? null,
    dismissedReason: dismissedReason ?? null,
    updatedAt: new Date().toISOString(),
  }),
  clear: async (_actionId: string) => {},
  clearAll: async () => {},
} as any;

const cogsOverridesStore = {
  ensureLoaded: async () => {},
  ensureFresh: async () => {},
  list: vi.fn(async () => []),
  upsert: vi.fn(async ({ variantId, unitCost, ignoreCogs }: any) => ({
    variantId,
    unitCost: unitCost ?? null,
    ignoreCogs: !!ignoreCogs,
    updatedAt: "2026-03-08T00:00:00.000Z",
  })),
  isIgnoredSync: vi.fn((_variantId: number) => false),
  getUnitCostSync: vi.fn((_variantId: number) => undefined),
} as any;

const cogsService = {
  computeUnitCostsByVariant: async () => new Map(),
  computeCogsByVariant: async () => new Map(),
  computeCogsForVariants: async () => 0,
} as any;

const baseCtx: ShopifyCtx = {
  shop,
  shopify: { get: async () => ({}) } as any,

  shopsStore: {
    ensureLoaded: async () => {},
    getAccessTokenOrThrow: async (_shop: string) => "test_token",
  } as any,

  createShopifyForShop: async (_shop: string) => ({ get: async () => ({}) } as any),
  fetchOrdersForShop: async (_shop: string, _days: number) => [],
  fetchOrderByIdForShop: async (_shop: string, _orderId: string) => ({}),

  getCogsOverridesStoreForShop: async (_shop: string) => cogsOverridesStore,
  getCogsServiceForShop: async (_shop: string) => cogsService,
  getCostModelOverridesStoreForShop: async (_shop: string) => costModelOverridesStore,
  getActionPlanStateStoreForShop: async (_shop: string) => actionPlanStateStore,

  cogsOverridesStore,
  cogsService,
  costModelOverridesStore,
  actionPlanStateStore,

  fetchOrders: async () => [],
  fetchOrderById: async (_orderId: string) => ({}),

  costProfile: {
    payment: { feePercent: 0.029, feeFixed: 0.3 },
    shipping: { costPerOrder: 5 },
    ads: { allocationMode: "BY_NET_SALES" },
    fixedCosts: { allocationMode: "PER_ORDER", daysInMonth: 30, monthlyItems: [] },
    derived: { fixedCostsMonthlyTotal: 0 },
    flags: { includeShippingCost: true },
  } as any,
};

vi.mock("./ctx.js", () => {
  return {
    createShopifyCtx: async () => baseCtx,
  };
});

describe("cogsOverrides.route branches", () => {
  let app: any;

  beforeAll(async () => {
    process.env.PORT = "3001";
    process.env.SHOPIFY_STORE_DOMAIN = shop;
    process.env.SHOPIFY_ADMIN_TOKEN = "test_token";

    buildProductsProfitMock.mockResolvedValue({
      highlights: {
        missingCogs: [
          { variantId: 10, sku: "SKU-10" },
          { variantId: 20, sku: "SKU-20" },
        ],
      },
    });

    cogsOverridesStore.isIgnoredSync.mockImplementation((variantId: number) => variantId === 20);
    cogsOverridesStore.getUnitCostSync.mockImplementation((variantId: number) =>
      variantId === 10 ? 12.34 : undefined
    );

    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/cogs/overrides returns 400 for invalid shop", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/cogs/overrides?shop=evil.com",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("shop is required (valid *.myshopify.com)");
  });

  it("GET /api/cogs/overrides returns list", async () => {
    cogsOverridesStore.list.mockResolvedValueOnce([
      { variantId: 10, unitCost: 12.34, ignoreCogs: false, updatedAt: "2026-03-08T00:00:00.000Z" },
    ]);

    const res = await app.inject({
      method: "GET",
      url: `/api/cogs/overrides?shop=${shop}`,
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();

    expect(json.shop).toBe(shop);
    expect(json.overrides).toHaveLength(1);
    expect(json.overrides[0].variantId).toBe(10);
  });

  it("PUT /api/cogs/overrides rejects invalid payload", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/cogs/overrides?shop=${shop}`,
      payload: { variantId: 0, unitCost: 12.34 },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("variantId must be a positive number");
  });

  it("PUT /api/cogs/overrides stores valid override", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/cogs/overrides?shop=${shop}`,
      payload: { variantId: 123, unitCost: 9.99, ignoreCogs: true },
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();

    expect(cogsOverridesStore.upsert).toHaveBeenCalled();
    expect(json.ok).toBe(true);
    expect(json.override.variantId).toBe(123);
    expect(json.override.unitCost).toBe(9.99);
    expect(json.override.ignoreCogs).toBe(true);
  });

  it("GET /api/cogs/missing filters ignored variants and enriches remaining rows", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/cogs/missing?shop=${shop}&days=30`,
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();

    expect(json.shop).toBe(shop);
    expect(json.days).toBe(30);
    expect(json.count).toBe(1);
    expect(json.missing).toHaveLength(1);
    expect(json.missing[0].variantId).toBe(10);
    expect(json.missing[0].unitCostOverride).toBe(12.34);
    expect(json.missing[0].ignoreCogs).toBe(false);
  });
});