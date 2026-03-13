import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import type { ShopifyCtx } from "./ctx.js";
import { buildApp } from "../../app.js";
import { authHeadersForShop } from "./testEmbeddedAuth.js";

const shop = "test-shop.myshopify.com";

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
  getUpdatedAtSync: vi.fn(() => null),
  getStateSync: vi.fn((_actionId: string) => null),
  list: vi.fn(async () => []),
  upsert: vi.fn(async ({ actionId, status, note, dueDate, dismissedReason }: any) => ({
    actionId,
    status: status ?? "OPEN",
    note: note ?? null,
    dueDate: dueDate ?? null,
    dismissedReason: dismissedReason ?? null,
    updatedAt: "2026-03-08T00:00:00.000Z",
  })),
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

describe("actionsState.route branches", () => {
  let app: any;

  beforeAll(async () => {
    process.env.PORT = "3001";
    process.env.NODE_ENV = "test";
    process.env.SHOPIFY_STORE_DOMAIN = shop;
    process.env.SHOPIFY_ADMIN_TOKEN = "test_token";
    process.env.SHOPIFY_API_KEY = "test_api_key";
    process.env.SHOPIFY_API_SECRET = "test_api_secret";
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/actions/state returns 401 without session token", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/actions/state?shop=${shop}`,
    });

    expect(res.statusCode).toBe(401);
  });

  it("GET /api/actions/state returns 403 for shop mismatch", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/actions/state?shop=other-shop.myshopify.com`,
      headers: authHeadersForShop(shop),
    });

    expect(res.statusCode).toBe(403);
  });

  it("GET /api/actions/state returns empty list", async () => {
    actionPlanStateStore.list.mockResolvedValueOnce([]);
    actionPlanStateStore.getUpdatedAtSync.mockReturnValueOnce(null);

    const res = await app.inject({
      method: "GET",
      url: `/api/actions/state?shop=${shop}`,
      headers: authHeadersForShop(shop),
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();

    expect(json.shop).toBe(shop);
    expect(json.updatedAt).toBeNull();
    expect(json.states).toEqual([]);
  });

  it("PATCH /api/actions/state rejects missing actionId", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/actions/state?shop=${shop}`,
      payload: { status: "DONE" },
      headers: authHeadersForShop(shop),
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("actionId is required");
  });

  it("PATCH /api/actions/state upserts valid record and normalizes values", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/actions/state?shop=${shop}`,
      payload: {
        actionId: "fix-refunds",
        status: "done",
        note: "done now",
        dueDate: "2026-03-31",
        dismissedReason: null,
      },
      headers: authHeadersForShop(shop),
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();

    expect(actionPlanStateStore.upsert).toHaveBeenCalled();
    expect(json.ok).toBe(true);
    expect(json.shop).toBe(shop);
    expect(json.record.actionId).toBe("fix-refunds");
    expect(json.record.status).toBe("DONE");
    expect(json.record.note).toBe("done now");
    expect(json.record.dueDate).toBe("2026-03-31");
  });
});