import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import type { ShopifyCtx } from "./ctx.js";
import { buildApp } from "../../app.js";

const shop = "test-shop.myshopify.com";

const costModelOverridesStore = {
  ensureLoaded: async () => {},
  ensureFresh: async () => {},
  getOverridesSync: vi.fn(() => undefined),
  getUpdatedAtSync: vi.fn(() => undefined),
  setOverrides: vi.fn(async (_overrides: any) => {}),
  clear: vi.fn(async () => {}),
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
  list: async () => [],
  upsert: async ({ variantId, unitCost, ignoreCogs }: any) => ({
    variantId,
    unitCost: unitCost ?? null,
    ignoreCogs: !!ignoreCogs,
  }),
  isIgnoredSync: (_variantId: number) => false,
  getUnitCostSync: (_variantId: number) => undefined,
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

describe("costModel.route branches", () => {
  let app: any;

  beforeAll(async () => {
    process.env.PORT = "3001";
    process.env.SHOPIFY_STORE_DOMAIN = shop;
    process.env.SHOPIFY_ADMIN_TOKEN = "test_token";
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/cost-model returns 400 for invalid shop", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/cost-model?shop=evil.com",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("shop is required (valid *.myshopify.com)");
  });

  it("GET /api/cost-model returns persisted state when available", async () => {
    costModelOverridesStore.getOverridesSync.mockReturnValueOnce({
      payment: { feePercent: 0.05 },
    });

    costModelOverridesStore.getUpdatedAtSync.mockReturnValueOnce("2026-03-08T00:00:00.000Z");

    const res = await app.inject({
      method: "GET",
      url: `/api/cost-model?shop=${shop}`,
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();

    expect(json.shop).toBe(shop);
    expect(json.persistedOverrides.payment.feePercent).toBe(0.05);
    expect(json.persistedUpdatedAt).toBe("2026-03-08T00:00:00.000Z");
    expect(json.resolvedProfile.meta.fingerprint).toBeTruthy();
  });

  it("PUT /api/cost-model returns 400 when no valid overrides provided", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/cost-model?shop=${shop}`,
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("No valid overrides provided");
  });

  it("PUT /api/cost-model replaces persisted overrides", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/cost-model?shop=${shop}`,
      payload: {
        feePercent: 0.07,
        feeFixed: 0.5,
        shippingCostPerOrder: 8,
        includeShippingCost: true,
      },
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();

    expect(costModelOverridesStore.setOverrides).toHaveBeenCalled();
    expect(json.ok).toBe(true);
    expect(json.persistedOverrides.payment.feePercent).toBe(0.07);
    expect(json.persistedOverrides.payment.feeFixed).toBe(0.5);
    expect(json.persistedOverrides.shipping.costPerOrder).toBe(8);
  });

  it("PATCH /api/cost-model returns 400 when no valid patch provided", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/cost-model?shop=${shop}`,
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("No valid overrides provided");
  });

  it("PATCH /api/cost-model merges patch into current overrides", async () => {
    costModelOverridesStore.getOverridesSync.mockReturnValueOnce({
      payment: { feePercent: 0.03 },
      shipping: { costPerOrder: 5 },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/cost-model?shop=${shop}`,
      payload: {
        feeFixed: 0.99,
        shippingCostPerOrder: 9,
      },
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();

    expect(costModelOverridesStore.setOverrides).toHaveBeenCalled();
    expect(json.ok).toBe(true);
    expect(json.persistedOverrides.payment.feePercent).toBe(0.03);
    expect(json.persistedOverrides.payment.feeFixed).toBe(0.99);
    expect(json.persistedOverrides.shipping.costPerOrder).toBe(9);
  });

  it("DELETE /api/cost-model clears persisted overrides", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/cost-model?shop=${shop}`,
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();

    expect(costModelOverridesStore.clear).toHaveBeenCalled();
    expect(json.ok).toBe(true);
    expect(json.persistedOverrides).toBeNull();
    expect(json.persistedUpdatedAt).toBeNull();
  });
});