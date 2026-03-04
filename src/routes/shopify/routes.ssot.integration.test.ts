import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { ShopifyCtx } from "./ctx.js";
import { buildApp } from "../../app.js";

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

// ---- fake ctx (real domain, no domain mocks)
const fakeCtx: ShopifyCtx = {
  shop: "test-shop.myshopify.com",

  // shopify client factory is now per-shop in ctx, but some code may still use ctx.shopify directly
  shopify: { get: async (_path: string) => ({}) } as any,

  // ✅ NEW: shopsStore required by ShopifyCtx
  shopsStore: {
    ensureLoaded: async () => {},
    getByShopDomainSync: (_shopDomain: string) => ({
      shopDomain: "test-shop.myshopify.com",
      accessToken: "test_token",
      installedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }),
    upsert: async (_row: any) => {},
    deleteByShopDomain: async (_shopDomain: string) => {},
  } as any,

  // ✅ NEW: createShopifyForShop required by ShopifyCtx
  createShopifyForShop: async (_shopDomain: string) => {
    return { get: async (_path: string) => ({}) } as any;
  },
  // ✅ NEW: per-shop getters required by ShopifyCtx
  getCogsOverridesStoreForShop: async (_shopDomain: string) => fakeCtx.cogsOverridesStore,
  getCogsServiceForShop: async (_shopDomain: string) => fakeCtx.cogsService,
  cogsOverridesStore: {
    ensureLoaded: async () => {},
    list: async () => [],
    upsert: async ({ variantId, unitCost, ignoreCogs }: any) => ({
      variantId,
      unitCost: unitCost ?? null,
      ignoreCogs: !!ignoreCogs,
    }),
    isIgnoredSync: (_variantId: number) => false,
    getUnitCostSync: (_variantId: number) => undefined,
  } as any,

  cogsService: {
    computeUnitCostsByVariant: async (_shopifyGET: any, variantIds: number[]) => {
      const m = new Map<number, number>();
      for (const id of variantIds) m.set(id, 10); // unit cost = 10
      return m;
    },
    computeCogsByVariant: async () => new Map(),
    computeCogsForVariants: async () => 0,
    isIgnoredVariantSync: (_variantId: number) => false,
  } as any,

  costModelOverridesStore: {
    ensureLoaded: async () => {},
    getOverridesSync: () => undefined,
    getUpdatedAtSync: () => undefined,
    setOverrides: async (_overrides: any) => {},
    clear: async () => {},
  } as any,

  actionPlanStateStore: {
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
  } as any,

  // ✅ NEW: fetchOrdersForShop / fetchOrderByIdForShop required by ShopifyCtx
  fetchOrdersForShop: async (_shop: string, _days: number) => fakeOrders,
fetchOrderByIdForShop: async (_shop: string, _orderId: string) => fakeOrders[0],

  // (optional legacy aliases — harmless, but can help if some code still calls old names)
  fetchOrders: async (_days: number) => fakeOrders as any,
  fetchOrderById: async (_orderId: string) => fakeOrders[0] as any,

  // (may exist in ctx type)
  costProfile: {
    payment: { feePercent: 0.029, feeFixed: 0.3 },
    shipping: { costPerOrder: 5 },
    ads: { allocationMode: "BY_NET_SALES" },
    fixedCosts: { allocationMode: "PER_ORDER", daysInMonth: 30, monthlyItems: [] },
    derived: { fixedCostsMonthlyTotal: 0 },
    flags: { includeShippingCost: true },
  } as any,
};

// mock ctx factory only
vi.mock("./ctx", () => {
  return {
    createShopifyCtx: async () => fakeCtx,
  };
});

describe("SSOT integration (routes)", () => {
  let app: any;

  beforeAll(async () => {
    process.env.PORT = "3001";
    process.env.SHOPIFY_STORE_DOMAIN = "test-shop.myshopify.com";
    process.env.SHOPIFY_ADMIN_TOKEN = "test_token";
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /api/orders/profit includes operatingProfit and is consistent", async () => {
    const res = await app.inject({ method: "GET", url: "/api/orders/profit?days=30&adSpend=0" });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(Array.isArray(json.orders)).toBe(true);

    const row = json.orders[0];
    expect(row).toHaveProperty("profitAfterAds");
    expect(row).toHaveProperty("profitAfterFixedCosts");
    expect(row).toHaveProperty("operatingProfit");

    // SSOT invariants
    expect(row.operatingProfit).toBe(row.profitAfterFixedCosts);
  });

  it("GET /api/orders/daily-profit has deterministic structure and health exists", async () => {
    const res = await app.inject({ method: "GET", url: "/api/orders/daily-profit?days=30&adSpend=0" });
    expect(res.statusCode).toBe(200);
    const json = res.json();

    expect(json).toHaveProperty("totals");
    expect(json).toHaveProperty("health");
    expect(Array.isArray(json.daily)).toBe(true);

    expect(json.health).toHaveProperty("score");
  });
});