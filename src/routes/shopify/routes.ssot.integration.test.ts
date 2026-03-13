import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { ShopifyCtx } from "./ctx.js";
import { buildApp } from "../../app.js";
import { authedInject } from "./testEmbeddedAuth.js";

// ---- fake orders
const fakeOrders = [
  {
    id: 111,
    name: "#111",
    created_at: "2026-02-01T10:00:00Z",
    currency: "EUR",
    total_price: "100.00",
    total_shipping_price_set: { shop_money: { amount: "5.00" } },
    line_items: [{ product_id: 1, variant_id: 10, quantity: 1, price: "100.00", title: "P1", sku: "SKU1" }],
    refunds: [],
    shipping_lines: [{ price: "5.00" }],
  },
];

const costModelOverridesStore = {
  ensureLoaded: async () => {},
  getOverridesSync: () => undefined,
  getUpdatedAtSync: () => undefined,
  setOverrides: async (_overrides: any) => {},
  clear: async () => {},
} as any;

const actionPlanStateStore = {
  ensureLoaded: async () => {},
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
  computeUnitCostsByVariant: async (_shopifyGET: any, variantIds: number[]) => {
    const m = new Map<number, number>();
    for (const id of variantIds) m.set(id, 10);
    return m;
  },
  computeCogsByVariant: async () => new Map(),
  computeCogsForVariants: async () => 0,
  isIgnoredVariantSync: (_variantId: number) => false,
} as any;

// ---- fake ctx (real domain, no domain mocks)
const fakeCtx: ShopifyCtx = {
  shop: "test-shop.myshopify.com",

  shopify: { get: async (_path: string) => ({}) } as any,

  shopsStore: {
    ensureLoaded: async () => {},
    getAccessTokenOrThrow: async (_shop: string) => "test_token",
  } as any,

  createShopifyForShop: async (_shopDomain: string) => {
    return { get: async (_path: string) => ({}) } as any;
  },

  fetchOrdersForShop: async (_shop: string, _days: number) => fakeOrders,
  fetchOrderByIdForShop: async (_shop: string, _orderId: string) => fakeOrders[0],

  getCogsOverridesStoreForShop: async (_shopDomain: string) => cogsOverridesStore,
  getCogsServiceForShop: async (_shopDomain: string) => cogsService,
  getCostModelOverridesStoreForShop: async (_shopDomain: string) => costModelOverridesStore,
  getActionPlanStateStoreForShop: async (_shopDomain: string) => actionPlanStateStore,

  cogsOverridesStore,
  cogsService,
  costModelOverridesStore,
  actionPlanStateStore,

  fetchOrders: async (_days: number) => fakeOrders as any,
  fetchOrderById: async (_orderId: string) => fakeOrders[0] as any,

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
    createShopifyCtx: async () => fakeCtx,
  };
});

describe("SSOT integration (routes)", () => {
  let app: any;
  const shop = "test-shop.myshopify.com";

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

  it("GET /api/orders/profit returns 401 without embedded session token", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/orders/profit?shop=${shop}&days=30&adSpend=0`,
    });

    expect(res.statusCode).toBe(401);
    expect(res.headers["x-shopify-retry-invalid-session-request"]).toBe("1");
  });

  it("GET /api/orders/profit includes operatingProfit and is consistent when authenticated", async () => {
    const res = await authedInject(app, {
      method: "GET",
      url: `/api/orders/profit?shop=${shop}&days=30&adSpend=0`,
      shop,
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(Array.isArray(json.orders)).toBe(true);

    const row = json.orders[0];
    expect(row).toHaveProperty("profitAfterAds");
    expect(row).toHaveProperty("profitAfterFixedCosts");
    expect(row).toHaveProperty("operatingProfit");

    expect(row.operatingProfit).toBe(row.profitAfterFixedCosts);
  });

  it("GET /api/orders/daily-profit has deterministic structure and health exists when authenticated", async () => {
    const res = await authedInject(app, {
      method: "GET",
      url: `/api/orders/daily-profit?shop=${shop}&days=30&adSpend=0`,
      shop,
    });

    expect(res.statusCode).toBe(200);
    const json = res.json();

    expect(json).toHaveProperty("totals");
    expect(json).toHaveProperty("health");
    expect(Array.isArray(json.daily)).toBe(true);

    expect(json.health).toHaveProperty("score");
  });
});