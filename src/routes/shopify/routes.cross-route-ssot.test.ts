import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { ShopifyCtx } from "./ctx.js";
import { buildApp } from "../../app.js";

import { CogsOverridesStore } from "../../storage/cogsOverridesStore.js";
import { CostModelOverridesStore } from "../../storage/costModelOverridesStore.js";
import { ActionPlanStateStore } from "../../storage/actionPlanStateStore.js";
import { CogsService } from "../../domain/cogs.js";

const shop = "ssot-shop.myshopify.com";
let dataDir = "";

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
  {
    id: 222,
    name: "#222",
    created_at: "2026-02-02T10:00:00Z",
    currency: "EUR",
    total_price: "200.00",
    total_shipping_price_set: { shop_money: { amount: "0.00" } },
    line_items: [
      { product_id: 2, variant_id: 20, quantity: 1, price: "200.00", title: "P2", sku: "SKU2" },
    ],
    refunds: [],
    shipping_lines: [],
  },
];

function makeCtx(): ShopifyCtx {
  const legacyCogsStore = new CogsOverridesStore({ shop, dataDir });
  const legacyCostStore = new CostModelOverridesStore({ shop, dataDir });
  const legacyActionStore = new ActionPlanStateStore({ shop, dataDir });

  return {
    shop,
    shopify: { get: async (_path: string) => ({}) } as any,

    shopsStore: {
      ensureLoaded: async () => {},
      getAccessTokenOrThrow: async (_shop: string) => "test_token",
    } as any,

    createShopifyForShop: async (_shop: string) => ({ get: async (_path: string) => ({}) } as any),
    fetchOrdersForShop: async (_shop: string, _days: number) => fakeOrders as any,
    fetchOrderByIdForShop: async (_shop: string, _orderId: string) => fakeOrders[0] as any,

    getCogsOverridesStoreForShop: async (_shop: string) => legacyCogsStore,
    getCogsServiceForShop: async (_shop: string) => new CogsService(legacyCogsStore as any),
    getCostModelOverridesStoreForShop: async (_shop: string) => legacyCostStore,
    getActionPlanStateStoreForShop: async (_shop: string) => legacyActionStore,

    cogsOverridesStore: legacyCogsStore as any,
    cogsService: new CogsService(legacyCogsStore as any),
    costModelOverridesStore: legacyCostStore as any,
    actionPlanStateStore: legacyActionStore as any,

    fetchOrders: async (_days: number) => fakeOrders as any,
    fetchOrderById: async (_orderId: string) => fakeOrders[0] as any,

    costProfile: {
      payment: { feePercent: 0.029, feeFixed: 0.3 },
      shipping: { costPerOrder: 5 },
      ads: { allocationMode: "BY_NET_SALES" },
      fixedCosts: { allocationMode: "PER_ORDER", daysInMonth: 30, monthlyItems: [] },
      derived: { fixedCostsMonthlyTotal: 0 },
      flags: { includeShippingCost: true },
      meta: { fingerprint: "ctx-fingerprint" },
    } as any,
  };
}

vi.mock("./ctx.js", () => {
  return {
    createShopifyCtx: async () => makeCtx(),
  };
});

function roundish(n: any) {
  return Number(Number(n ?? 0).toFixed(2));
}

describe("cross-route SSOT consistency", () => {
  let app: any;

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "rp-ssot-routes-"));

    process.env.PORT = "3001";
    process.env.NODE_ENV = "test";
    process.env.DATA_DIR = dataDir;
    process.env.SHOPIFY_STORE_DOMAIN = shop;
    process.env.SHOPIFY_ADMIN_TOKEN = "legacy_token";

    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("keeps summary, daily totals, and dashboard totals aligned for core metrics", async () => {
    const summaryRes = await app.inject({
      method: "GET",
      url: `/api/orders/summary?shop=${shop}&days=30&adSpend=0`,
    });
    const dailyRes = await app.inject({
      method: "GET",
      url: `/api/orders/daily-profit?shop=${shop}&days=30&adSpend=0`,
    });
    const dashRes = await app.inject({
      method: "GET",
      url: `/api/dashboard/overview?shop=${shop}&days=30&adSpend=0`,
    });

    expect(summaryRes.statusCode).toBe(200);
    expect(dailyRes.statusCode).toBe(200);
    expect(dashRes.statusCode).toBe(200);

    const summary = summaryRes.json();
    const daily = dailyRes.json();
    const dash = dashRes.json();

    const summaryTotals = {
      grossSales: roundish(summary.grossSales),
      refunds: roundish(summary.refunds),
      netAfterRefunds: roundish(summary.netAfterRefunds),
      cogs: roundish(summary.cogs),
      paymentFees: roundish(summary.paymentFees),
      shippingRevenue: roundish(summary.shippingRevenue),
      shippingCost: roundish(summary.shippingCost),
      contributionMargin: roundish(summary.contributionMargin),
    };

    const dailyTotals = {
      grossSales: roundish(daily.totals.grossSales),
      refunds: roundish(daily.totals.refunds),
      netAfterRefunds: roundish(daily.totals.netAfterRefunds),
      cogs: roundish(daily.totals.cogs),
      paymentFees: roundish(daily.totals.paymentFees),
      shippingRevenue: roundish(daily.totals.shippingRevenue),
      shippingCost: roundish(daily.totals.shippingCost),
      contributionMargin: roundish(daily.totals.contributionMargin),
    };

    const dashboardTotals = {
      grossSales: roundish(dash.totals.grossSales),
      refunds: roundish(dash.totals.refunds),
      netAfterRefunds: roundish(dash.totals.netAfterRefunds),
      cogs: roundish(dash.totals.cogs),
      paymentFees: roundish(dash.totals.paymentFees),
      shippingRevenue: roundish(dash.totals.shippingRevenue),
      shippingCost: roundish(dash.totals.shippingCost),
      contributionMargin: roundish(dash.totals.contributionMargin),
    };

    expect(dailyTotals).toEqual(summaryTotals);
    expect(dashboardTotals).toEqual(summaryTotals);
  });

  it("keeps cost model fingerprint aligned across endpoints for same input", async () => {
    const summaryRes = await app.inject({
      method: "GET",
      url: `/api/orders/summary?shop=${shop}&days=30&adSpend=0`,
    });
    const dailyRes = await app.inject({
      method: "GET",
      url: `/api/orders/daily-profit?shop=${shop}&days=30&adSpend=0`,
    });
    const ordersProfitRes = await app.inject({
      method: "GET",
      url: `/api/orders/profit?shop=${shop}&days=30&adSpend=0`,
    });
    const dashRes = await app.inject({
      method: "GET",
      url: `/api/dashboard/overview?shop=${shop}&days=30&adSpend=0`,
    });

    const summary = summaryRes.json();
    const daily = dailyRes.json();
    const ordersProfit = ordersProfitRes.json();
    const dash = dashRes.json();

    const fpSummary = summary.costModel?.fingerprint ?? null;
    const fpDaily = daily.costModel?.fingerprint ?? null;
    const fpOrders = ordersProfit.costModel?.fingerprint ?? null;
    const fpDash = dash.meta?.costModelFingerprint ?? null;

    expect(fpSummary).toBeTruthy();
    expect(fpDaily).toBeTruthy();
    expect(fpOrders).toBeTruthy();
    expect(fpDash).toBeTruthy();

    expect(fpDaily).toBe(fpSummary);
    expect(fpOrders).toBe(fpSummary);
    expect(fpDash).toBe(fpSummary);
  });

  it("keeps orders count aligned between summary and daily totals", async () => {
    const summaryRes = await app.inject({
      method: "GET",
      url: `/api/orders/summary?shop=${shop}&days=30`,
    });
    const dailyRes = await app.inject({
      method: "GET",
      url: `/api/orders/daily-profit?shop=${shop}&days=30`,
    });

    const summary = summaryRes.json();
    const daily = dailyRes.json();

    expect(Number(summary.count)).toBe(Number(daily.totals.orders));
  });
});