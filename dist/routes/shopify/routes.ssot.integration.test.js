import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
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
const fakeCtx = {
    shop: "test-shop.myshopify.com",
    // shopify client factory is now per-shop in ctx, but some code may still use ctx.shopify directly
    shopify: { get: async (_path) => ({}) },
    // ✅ NEW: shopsStore required by ShopifyCtx
    shopsStore: {
        ensureLoaded: async () => { },
        getByShopDomainSync: (_shopDomain) => ({
            shopDomain: "test-shop.myshopify.com",
            accessToken: "test_token",
            installedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        }),
        upsert: async (_row) => { },
        deleteByShopDomain: async (_shopDomain) => { },
    },
    // ✅ NEW: createShopifyForShop required by ShopifyCtx
    createShopifyForShop: async (_shopDomain) => {
        return { get: async (_path) => ({}) };
    },
    // ✅ NEW: per-shop getters required by ShopifyCtx
    getCogsOverridesStoreForShop: async (_shopDomain) => fakeCtx.cogsOverridesStore,
    getCogsServiceForShop: async (_shopDomain) => fakeCtx.cogsService,
    cogsOverridesStore: {
        ensureLoaded: async () => { },
        list: async () => [],
        upsert: async ({ variantId, unitCost, ignoreCogs }) => ({
            variantId,
            unitCost: unitCost ?? null,
            ignoreCogs: !!ignoreCogs,
        }),
        isIgnoredSync: (_variantId) => false,
        getUnitCostSync: (_variantId) => undefined,
    },
    cogsService: {
        computeUnitCostsByVariant: async (_shopifyGET, variantIds) => {
            const m = new Map();
            for (const id of variantIds)
                m.set(id, 10); // unit cost = 10
            return m;
        },
        computeCogsByVariant: async () => new Map(),
        computeCogsForVariants: async () => 0,
        isIgnoredVariantSync: (_variantId) => false,
    },
    costModelOverridesStore: {
        ensureLoaded: async () => { },
        getOverridesSync: () => undefined,
        getUpdatedAtSync: () => undefined,
        setOverrides: async (_overrides) => { },
        clear: async () => { },
    },
    actionPlanStateStore: {
        ensureLoaded: async () => { },
        getUpdatedAtSync: () => null,
        getStateSync: (_actionId) => null,
        list: async () => [],
        upsert: async ({ actionId, status, note, dueDate, dismissedReason }) => ({
            actionId,
            status: status ?? "OPEN",
            note: note ?? null,
            dueDate: dueDate ?? null,
            dismissedReason: dismissedReason ?? null,
            updatedAt: new Date().toISOString(),
        }),
        clear: async (_actionId) => { },
    },
    // ✅ NEW: fetchOrdersForShop / fetchOrderByIdForShop required by ShopifyCtx
    fetchOrdersForShop: async (_shop, _days) => fakeOrders,
    fetchOrderByIdForShop: async (_shop, _orderId) => fakeOrders[0],
    // (optional legacy aliases — harmless, but can help if some code still calls old names)
    fetchOrders: async (_days) => fakeOrders,
    fetchOrderById: async (_orderId) => fakeOrders[0],
    // (may exist in ctx type)
    costProfile: {
        payment: { feePercent: 0.029, feeFixed: 0.3 },
        shipping: { costPerOrder: 5 },
        ads: { allocationMode: "BY_NET_SALES" },
        fixedCosts: { allocationMode: "PER_ORDER", daysInMonth: 30, monthlyItems: [] },
        derived: { fixedCostsMonthlyTotal: 0 },
        flags: { includeShippingCost: true },
    },
};
// mock ctx factory only
vi.mock("./ctx", () => {
    return {
        createShopifyCtx: async () => fakeCtx,
    };
});
describe("SSOT integration (routes)", () => {
    let app;
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
