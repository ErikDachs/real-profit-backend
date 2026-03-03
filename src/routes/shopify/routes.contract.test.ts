import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { ShopifyCtx } from "../shopify/ctx";

// ---------- Mock: createShopifyCtx (keine echten Shopify Calls, kein File IO)
const fakeOrders = [
  {
    id: 111,
    name: "#111",
    created_at: "2026-02-01T10:00:00Z",
    currency: "EUR",
    total_price: "100.00",
    total_shipping_price_set: { shop_money: { amount: "5.00" } },
    line_items: [
      { product_id: 1, variant_id: 10, quantity: 1, price: "100.00", title: "P1", sku: "SKU1" },
    ],
    refunds: [],
    shipping_lines: [{ price: "5.00" }],
  },
];

const fakeCtx: ShopifyCtx = {
  shop: "test-shop.myshopify.com",

  // legacy single-shop client used by existing routes
  shopify: { get: async (_path: string) => ({}) } as any,

  // ✅ new multi-shop helpers required by ShopifyCtx type
  shopsStore: {
    ensureLoaded: async () => {},
    getAccessTokenOrThrow: async (_shop: string) => "test_token",
  } as any,

  createShopifyForShop: async (_shop: string) => ({ get: async (_path: string) => ({}) } as any),
  fetchOrdersForShop: async (_shop: string, _days: number) => fakeOrders,
  fetchOrderByIdForShop: async (_shop: string, _orderId: string) => fakeOrders[0],

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
      for (const id of variantIds) m.set(id, 10);
      return m;
    },
    computeCogsByVariant: async () => new Map(),
    computeCogsForVariants: async () => 0,
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

  // legacy methods used by existing routes
  fetchOrders: async (_days: number) => fakeOrders,
  fetchOrderById: async (_orderId: string) => fakeOrders[0],

  costProfile: {
    payment: { feePercent: 0.029, feeFixed: 0.3 },
    shipping: { costPerOrder: 5 },
    ads: { allocationMode: "BY_NET_SALES" },
    flags: { includeShippingCost: true },
  } as any,
};

vi.mock("../shopify/ctx", () => {
  return {
    createShopifyCtx: async () => fakeCtx,
  };
});

// ---------- Mock: Domain outputs (wir testen Route-Contracts, nicht Domain-Math nochmal)
vi.mock("../../domain/profit", () => {
  return {
    buildOrdersSummary: async () => ({
      shop: fakeCtx.shop,
      days: 30,
      count: 1,
      grossSales: 100,
      refunds: 0,
      netAfterRefunds: 100,
      shippingRevenue: 5,
      shippingCost: 5,
      shippingImpact: 0,
      cogs: 10,
      grossProfit: 90,
      grossMarginPct: 90,
      paymentFees: 3.2,
      contributionMargin: 86.8,
      contributionMarginPct: 86.8,
      adSpendBreakEven: 86.8,
      breakEvenRoas: 1.15,
      profitAfterShipping: 81.8,
      profitMarginAfterShippingPct: 81.8,
      profitAfterFees: 86.8,
      profitMarginAfterFeesPct: 86.8,
      adSpend: 0,
      profitAfterAds: 86.8,
      profitMarginAfterAdsPct: 86.8,
      profitAfterAdsAndShipping: 81.8,
      profitMarginAfterAdsAndShippingPct: 81.8,
      targetRoasFor10PctProfit: 1.3,
      targetRoasFor10PctProfitAfterShipping: 1.35,
    }),
    buildProductsProfit: async () => ({
      shop: fakeCtx.shop,
      days: 30,
      orderCount: 1,
      totals: {
        totalNetSales: 100,
        paymentFeesTotal: 3.2,
        uniqueVariants: 1,
      },
      highlights: {
        topWinners: [],
        topLosers: [],
        missingCogsCount: 0,
        missingCogs: [],
      },
      products: [
        {
          productId: 1,
          variantId: 10,
          title: "P1",
          variantTitle: null,
          sku: "SKU1",
          qty: 1,
          grossSales: 100,
          refundsAllocated: 0,
          netSales: 100,
          cogs: 10,
          paymentFeesAllocated: 3.2,
          profitAfterFees: 86.8,
          marginPct: 86.8,
        },
      ],
    }),
    calculateOrderProfit: async () => ({
      orderId: "111",
      grossSales: 100,
      refunds: 0,
      netAfterRefunds: 100,
      cogs: 10,
      paymentFees: 3.2,
      contributionMargin: 86.8,
      contributionMarginPct: 86.8,
      shippingRevenue: 5,
      shippingCost: 5,
      shippingImpact: 0,
      profitAfterShipping: 81.8,
      profitMarginAfterShippingPct: 81.8,
      adSpendBreakEven: 86.8,
      breakEvenRoas: 1.15,
      profitAfterFees: 86.8,
      marginAfterFeesPct: 86.8,
    }),
    allocateFixedCostsForOrders: ({ rows }: any) => {
  return (rows ?? []).map((r: any) => ({ ...r, fixedCostAllocated: 0 }));
},
  };
});

vi.mock("../../domain/profitDaily", () => {
  return {
    buildDailyProfit: () => ({
      shop: fakeCtx.shop,
      days: 30,
      totals: {
        orders: 1,
        grossSales: 100,
        refunds: 0,
        netAfterRefunds: 100,
        shippingRevenue: 5,
        shippingCost: 5,
        shippingImpact: 0,
        cogs: 10,
        paymentFees: 3.2,
        contributionMargin: 86.8,
        contributionMarginPct: 86.8,
        adSpendBreakEven: 86.8,
        breakEvenRoas: 1.15,
        profitAfterShipping: 81.8,
        profitMarginAfterShippingPct: 81.8,
        allocatedAdSpend: 0,
        profitAfterAds: 86.8,
        profitMarginAfterAdsPct: 86.8,
        profitAfterAdsAndShipping: 81.8,
        profitMarginAfterAdsAndShippingPct: 81.8,
        profitAfterFees: 86.8,
      },
      daily: [
        {
          day: "2026-02-01",
          orders: 1,
          grossSales: 100,
          refunds: 0,
          netAfterRefunds: 100,
          shippingRevenue: 5,
          shippingCost: 5,
          shippingImpact: 0,
          cogs: 10,
          paymentFees: 3.2,
          contributionMargin: 86.8,
          contributionMarginPct: 86.8,
          profitAfterShipping: 81.8,
          profitMarginAfterShippingPct: 81.8,
          profitAfterFees: 86.8,
          allocatedAdSpend: 0,
          profitAfterAds: 86.8,
          profitMarginAfterAdsPct: 86.8,
          profitAfterAdsAndShipping: 81.8,
          profitMarginAfterAdsAndShippingPct: 81.8,
          adSpendBreakEven: 86.8,
          breakEvenRoas: 1.15,
        },
      ],
    }),
  };
});

vi.mock("../../domain/insights", () => {
  return {
    buildProfitKillersInsights: () => ({
      shop: fakeCtx.shop,
      days: 30,
      meta: { currency: "EUR", periodDays: 30, periodLabel: "Last 30 days" },
      totals: {
        currency: "EUR",
        orders: 1,
        grossSales: 100,
        refunds: 0,
        netAfterRefunds: 100,
        cogs: 10,
        paymentFees: 3.2,
        contributionMargin: 86.8,
        contributionMarginPct: 86.8,
        adSpendBreakEven: 86.8,
        breakEvenRoas: 1.15,
      },
      highlights: { missingCogsCount: 0 },
      insights: [],
      opportunities: { all: [], top: [] },
      adIntelligence: null,
      profitKillers: { worstOrders: [], bestOrders: [], worstProducts: [], bestProducts: [] },
      unifiedOpportunitiesTop5: [],
      unifiedOpportunitiesAll: [],
      impactSimulation: [],
      actions: [],
    }),
  };
});

vi.mock("../../domain/opportunities/deepDive", () => {
  return {
    buildOpportunityDeepDive: () => ({
      shop: fakeCtx.shop,
      days: 30,
      currency: "EUR",
      deepDives: [], // ✅ WICHTIG: actionsPlan.route.ts erwartet deepDivePack.deepDives
      meta: {},
    }),
  };
});

// health calc is not critical to contracts; keep real or mock (mocking keeps tests stable)
vi.mock("../../domain/health/profitHealth", () => {
  return {
    computeProfitHealthFromSummary: () => ({
      score: 80,
      grade: "B",
      components: {
        contributionMarginPct: 80,
        refundRate: 80,
        feeRate: 80,
        cogsRate: 80,
      },
      drivers: [],
      ratios: {
        contributionMarginPct: 0,
        refundRatePct: null,
        feeRatePct: null,
        cogsRatePct: null,
        shippingSubsidyLoss: null,
        shippingSubsidyPct: null,
        missingCogsRatePct: null,
        roas: null,
        breakEvenRoas: null,
      },
    }),
  };
});

// ---------- IMPORTANT: buildApp import AFTER mocks
import { buildApp } from "../../app";

describe("Route contracts (shopify routes)", () => {
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

  it("GET /health", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.ok).toBe(true);
    expect(json.service).toBe("backend");
    expect(typeof json.ts).toBe("string");
  });

  it("GET /api/orders/summary contract", async () => {
    const res = await app.inject({ method: "GET", url: "/api/orders/summary?days=30&adSpend=0" });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.shop).toBe(fakeCtx.shop);
    expect(typeof json.grossSales).toBe("number");
    expect(json).toHaveProperty("health");
    expect(json.health).toHaveProperty("score");
  });

  it("GET /api/orders/profit contract", async () => {
    const res = await app.inject({ method: "GET", url: "/api/orders/profit?days=30" });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.shop).toBe(fakeCtx.shop);
    expect(json.days).toBe(30);
    expect(Array.isArray(json.orders)).toBe(true);
    expect(json.orders.length).toBeGreaterThan(0);

    const row = json.orders[0];
    expect(row).toHaveProperty("id");
    expect(row).toHaveProperty("grossSales");
    expect(row).toHaveProperty("netAfterRefunds");
    expect(row).toHaveProperty("contributionMargin");
    expect(row).toHaveProperty("breakEvenRoas");
  });

  it("GET /api/orders/daily-profit contract", async () => {
    const res = await app.inject({ method: "GET", url: "/api/orders/daily-profit?days=30" });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.shop).toBe(fakeCtx.shop);
    expect(json).toHaveProperty("totals");
    expect(json.totals).toHaveProperty("grossSales");
    expect(Array.isArray(json.daily)).toBe(true);
    expect(json).toHaveProperty("health");
  });

  it("GET /api/orders/products/profit contract", async () => {
    const res = await app.inject({ method: "GET", url: "/api/orders/products/profit?days=30" });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.shop).toBe(fakeCtx.shop);
    expect(Array.isArray(json.products)).toBe(true);
    if (json.products.length > 0) {
      const p = json.products[0];
      expect(p).toHaveProperty("productId");
      expect(p).toHaveProperty("variantId");
      expect(p).toHaveProperty("netSales");
      expect(p).toHaveProperty("profitAfterFees");
    }
  });

  it("GET /api/insights/profit-killers contract", async () => {
    const res = await app.inject({ method: "GET", url: "/api/insights/profit-killers?days=30&limit=10" });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.shop).toBe(fakeCtx.shop);
    expect(json).toHaveProperty("totals");
    expect(json).toHaveProperty("profitKillers");
    expect(Array.isArray(json.actions)).toBe(true);
  });

  it("GET /api/opportunities/deep-dive contract", async () => {
    const res = await app.inject({ method: "GET", url: "/api/opportunities/deep-dive?days=30&limit=10" });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.shop).toBe(fakeCtx.shop);
    expect(json).toHaveProperty("meta");
    expect(json.meta).toHaveProperty("adSpend");
  });

  it("GET /api/cogs/overrides contract", async () => {
    const res = await app.inject({ method: "GET", url: "/api/cogs/overrides" });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(Array.isArray(json.overrides)).toBe(true);
  });

  it("PUT /api/cogs/overrides validates body (400 on missing/invalid variantId)", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/cogs/overrides",
      payload: { variantId: 0, unitCost: 12.34 },
    });
    expect(res.statusCode).toBe(400);
    const json = res.json();
    expect(json).toHaveProperty("error");
  });

  it("PUT /api/cogs/overrides ok contract", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/cogs/overrides",
      payload: { variantId: 123, unitCost: 12.34, ignoreCogs: false },
    });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json.ok).toBe(true);
    expect(json.override.variantId).toBe(123);
  });

  it("GET /api/cogs/missing contract", async () => {
    const res = await app.inject({ method: "GET", url: "/api/cogs/missing?days=30" });
    expect(res.statusCode).toBe(200);
    const json = res.json();
    expect(json).toHaveProperty("days");
    expect(json).toHaveProperty("count");
    expect(Array.isArray(json.missing)).toBe(true);
  });
});