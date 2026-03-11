import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const fetchOrdersGraphqlMock = vi.fn();
const fetchOrderByIdGraphqlMock = vi.fn();
const createShopifyClientMock = vi.fn();

vi.mock("../../integrations/shopify/ordersGraphql.js", () => {
  return {
    fetchOrdersGraphql: (...args: any[]) => fetchOrdersGraphqlMock(...args),
    fetchOrderByIdGraphql: (...args: any[]) => fetchOrderByIdGraphqlMock(...args),
  };
});

vi.mock("../../integrations/shopify/client.js", () => {
  return {
    createShopifyClient: (...args: any[]) => createShopifyClientMock(...args),
  };
});

import { createShopifyCtx } from "./ctx.js";
import { ShopsStore } from "../../storage/shopsStore.js";
import { CogsOverridesStore } from "../../storage/cogsOverridesStore.js";
import { CostModelOverridesStore } from "../../storage/costModelOverridesStore.js";
import { ActionPlanStateStore } from "../../storage/actionPlanStateStore.js";

function makeApp(config: Record<string, any>): FastifyInstance {
  return {
    config,
  } as any;
}

describe("createShopifyCtx", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    createShopifyClientMock.mockImplementation(({ shopDomain, accessToken }: any) => ({
      get: vi.fn(async (_path: string) => ({ ok: true, shopDomain, accessToken })),
      post: vi.fn(async (_path: string, _body: any) => ({ ok: true, shopDomain, accessToken })),
      graphql: vi.fn(async () => ({})),
    }));

    fetchOrdersGraphqlMock.mockResolvedValue([]);
    fetchOrderByIdGraphqlMock.mockResolvedValue(null);
  });

  it("builds legacy context from configured SHOPIFY_STORE_DOMAIN + SHOPIFY_ADMIN_TOKEN", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "rp-ctx-legacy-"));

    const app = makeApp({
      DATA_DIR: dataDir,
      SHOPIFY_STORE_DOMAIN: "TEST-SHOP.MYSHOPIFY.COM",
      SHOPIFY_ADMIN_TOKEN: "legacy_token",
      SHOPIFY_API_VERSION: "2024-01",
      PAYMENT_FEE_PERCENT: 0.029,
      PAYMENT_FEE_FIXED: 0.3,
      DEFAULT_SHIPPING_COST: 5,
    });

    const ctx = await createShopifyCtx(app);

    expect(ctx.shop).toBe("test-shop.myshopify.com");
    expect(createShopifyClientMock).toHaveBeenCalled();

    expect(ctx.cogsOverridesStore).toBeTruthy();
    expect(ctx.cogsService).toBeTruthy();
    expect(ctx.costModelOverridesStore).toBeTruthy();
    expect(ctx.actionPlanStateStore).toBeTruthy();
  });

  it("uses shopsStore token when legacy shop exists but admin token is missing", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "rp-ctx-shopsstore-"));

    const shopsStore = new ShopsStore({ dataDir });
    await shopsStore.ensureLoaded();
    await shopsStore.upsertToken({
      shop: "token-shop.myshopify.com",
      accessToken: "oauth_token",
      scope: "read_orders",
    });

    const app = makeApp({
      DATA_DIR: dataDir,
      SHOPIFY_STORE_DOMAIN: "token-shop.myshopify.com",
      SHOPIFY_ADMIN_TOKEN: "",
      SHOPIFY_API_VERSION: "2024-01",
      PAYMENT_FEE_PERCENT: 0.029,
      PAYMENT_FEE_FIXED: 0.3,
      DEFAULT_SHIPPING_COST: 5,
    });

    const ctx = await createShopifyCtx(app);

    expect(ctx.shop).toBe("token-shop.myshopify.com");
    expect(createShopifyClientMock).toHaveBeenCalledWith({
      shopDomain: "token-shop.myshopify.com",
      accessToken: "oauth_token",
    });
  });

  it("createShopifyForShop throws 400 for invalid shop domain", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "rp-ctx-invalid-create-"));

    const app = makeApp({
      DATA_DIR: dataDir,
      SHOPIFY_STORE_DOMAIN: "",
      SHOPIFY_ADMIN_TOKEN: "",
      SHOPIFY_API_VERSION: "2024-01",
      PAYMENT_FEE_PERCENT: 0.029,
      PAYMENT_FEE_FIXED: 0.3,
      DEFAULT_SHIPPING_COST: 5,
    });

    const ctx = await createShopifyCtx(app);

    await expect(ctx.createShopifyForShop("https://evil.com")).rejects.toMatchObject({
      status: 400,
      message: "Invalid shop domain",
    });
  });

  it("fetchOrdersForShop throws 400 for invalid shop domain", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "rp-ctx-invalid-orders-"));

    const app = makeApp({
      DATA_DIR: dataDir,
      SHOPIFY_STORE_DOMAIN: "",
      SHOPIFY_ADMIN_TOKEN: "",
      SHOPIFY_API_VERSION: "2024-01",
      PAYMENT_FEE_PERCENT: 0.029,
      PAYMENT_FEE_FIXED: 0.3,
      DEFAULT_SHIPPING_COST: 5,
    });

    const ctx = await createShopifyCtx(app);

    await expect(ctx.fetchOrdersForShop("not-a-shop.com", 30)).rejects.toMatchObject({
      status: 400,
      message: "Invalid shop domain",
    });
  });

  it("fetchOrderByIdForShop throws 400 for invalid shop domain", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "rp-ctx-invalid-order-"));

    const app = makeApp({
      DATA_DIR: dataDir,
      SHOPIFY_STORE_DOMAIN: "",
      SHOPIFY_ADMIN_TOKEN: "",
      SHOPIFY_API_VERSION: "2024-01",
      PAYMENT_FEE_PERCENT: 0.029,
      PAYMENT_FEE_FIXED: 0.3,
      DEFAULT_SHIPPING_COST: 5,
    });

    const ctx = await createShopifyCtx(app);

    await expect(ctx.fetchOrderByIdForShop("abc", "123")).rejects.toMatchObject({
      status: 400,
      message: "Invalid shop domain",
    });
  });

  it("fetchOrdersForShop uses token store and redacts PII", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "rp-ctx-fetch-orders-"));

    const shopsStore = new ShopsStore({ dataDir });
    await shopsStore.ensureLoaded();
    await shopsStore.upsertToken({
      shop: "orders-shop.myshopify.com",
      accessToken: "orders_token",
      scope: "read_orders",
    });

    fetchOrdersGraphqlMock.mockResolvedValue([
      {
        id: 1,
        name: "#1",
        customer: { id: 999 },
        email: "test@example.com",
        phone: "123",
        billing_address: { city: "A" },
        shipping_address: { city: "B" },
        client_details: { browser_ip: "1.2.3.4" },
        browser_ip: "1.2.3.4",
        note: "secret",
        note_attributes: [{ name: "x", value: "y" }],
        landing_site: "/from-ad",
        landing_site_ref: "campaign",
        contact_email: "x@example.com",
        currency: "EUR",
      },
    ]);

    const app = makeApp({
      DATA_DIR: dataDir,
      SHOPIFY_STORE_DOMAIN: "",
      SHOPIFY_ADMIN_TOKEN: "",
      SHOPIFY_API_VERSION: "2024-01",
      PAYMENT_FEE_PERCENT: 0.029,
      PAYMENT_FEE_FIXED: 0.3,
      DEFAULT_SHIPPING_COST: 5,
    });

    const ctx = await createShopifyCtx(app);
    const orders = await ctx.fetchOrdersForShop("ORDERS-SHOP.MYSHOPIFY.COM", 30);

    expect(fetchOrdersGraphqlMock).toHaveBeenCalledWith({
      shop: "orders-shop.myshopify.com",
      accessToken: "orders_token",
      days: 30,
      apiVersion: "2024-01",
    });

    expect(orders).toHaveLength(1);
    expect(orders[0].customer).toBeUndefined();
    expect(orders[0].email).toBeUndefined();
    expect(orders[0].phone).toBeUndefined();
    expect(orders[0].billing_address).toBeUndefined();
    expect(orders[0].shipping_address).toBeUndefined();
    expect(orders[0].client_details).toBeUndefined();
    expect(orders[0].browser_ip).toBeUndefined();
    expect(orders[0].note).toBeUndefined();
    expect(orders[0].note_attributes).toBeUndefined();
    expect(orders[0].landing_site).toBeUndefined();
    expect(orders[0].landing_site_ref).toBeUndefined();
    expect(orders[0].contact_email).toBeUndefined();
    expect(orders[0].currency).toBe("EUR");
  });

  it("fetchOrderByIdForShop returns redacted order", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "rp-ctx-fetch-order-id-"));

    const shopsStore = new ShopsStore({ dataDir });
    await shopsStore.ensureLoaded();
    await shopsStore.upsertToken({
      shop: "orderid-shop.myshopify.com",
      accessToken: "orderid_token",
      scope: "read_orders",
    });

    fetchOrderByIdGraphqlMock.mockResolvedValue({
      id: 123,
      name: "#123",
      customer: { id: 99 },
      email: "private@example.com",
      shipping_address: { city: "Berlin" },
      note: "sensitive",
    });

    const app = makeApp({
      DATA_DIR: dataDir,
      SHOPIFY_STORE_DOMAIN: "",
      SHOPIFY_ADMIN_TOKEN: "",
      SHOPIFY_API_VERSION: "2024-01",
      PAYMENT_FEE_PERCENT: 0.029,
      PAYMENT_FEE_FIXED: 0.3,
      DEFAULT_SHIPPING_COST: 5,
    });

    const ctx = await createShopifyCtx(app);
    const order = await ctx.fetchOrderByIdForShop("orderid-shop.myshopify.com", "123");

    expect(fetchOrderByIdGraphqlMock).toHaveBeenCalledWith({
      shop: "orderid-shop.myshopify.com",
      accessToken: "orderid_token",
      orderId: "123",
      apiVersion: "2024-01",
    });

    expect(order.customer).toBeUndefined();
    expect(order.email).toBeUndefined();
    expect(order.shipping_address).toBeUndefined();
    expect(order.note).toBeUndefined();
    expect(order.id).toBe(123);
  });

  it("fetchOrderByIdForShop throws 404 when order not found", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "rp-ctx-order-404-"));

    const shopsStore = new ShopsStore({ dataDir });
    await shopsStore.ensureLoaded();
    await shopsStore.upsertToken({
      shop: "missing-order.myshopify.com",
      accessToken: "missing_token",
      scope: "read_orders",
    });

    fetchOrderByIdGraphqlMock.mockResolvedValue(null);

    const app = makeApp({
      DATA_DIR: dataDir,
      SHOPIFY_STORE_DOMAIN: "",
      SHOPIFY_ADMIN_TOKEN: "",
      SHOPIFY_API_VERSION: "2024-01",
      PAYMENT_FEE_PERCENT: 0.029,
      PAYMENT_FEE_FIXED: 0.3,
      DEFAULT_SHIPPING_COST: 5,
    });

    const ctx = await createShopifyCtx(app);

    await expect(ctx.fetchOrderByIdForShop("missing-order.myshopify.com", "999")).rejects.toMatchObject({
      status: 404,
      message: "Order not found: 999",
    });
  });

  it("fetchOrders legacy path throws 400 when SHOPIFY_STORE_DOMAIN missing", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "rp-ctx-legacy-disabled-orders-"));

    const app = makeApp({
      DATA_DIR: dataDir,
      SHOPIFY_STORE_DOMAIN: "",
      SHOPIFY_ADMIN_TOKEN: "",
      SHOPIFY_API_VERSION: "2024-01",
      PAYMENT_FEE_PERCENT: 0.029,
      PAYMENT_FEE_FIXED: 0.3,
      DEFAULT_SHIPPING_COST: 5,
    });

    const ctx = await createShopifyCtx(app);

    await expect(ctx.fetchOrders(30)).rejects.toMatchObject({
      status: 400,
      message: "SHOPIFY_STORE_DOMAIN missing (legacy single-shop mode). Use ?shop=... + OAuth token store.",
    });
  });

  it("fetchOrderById legacy path throws 400 when SHOPIFY_STORE_DOMAIN missing", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "rp-ctx-legacy-disabled-orderid-"));

    const app = makeApp({
      DATA_DIR: dataDir,
      SHOPIFY_STORE_DOMAIN: "",
      SHOPIFY_ADMIN_TOKEN: "",
      SHOPIFY_API_VERSION: "2024-01",
      PAYMENT_FEE_PERCENT: 0.029,
      PAYMENT_FEE_FIXED: 0.3,
      DEFAULT_SHIPPING_COST: 5,
    });

    const ctx = await createShopifyCtx(app);

    await expect(ctx.fetchOrderById("123")).rejects.toMatchObject({
      status: 400,
      message: "SHOPIFY_STORE_DOMAIN missing (legacy single-shop mode). Use ?shop=... + OAuth token store.",
    });
  });

  it("getCogsOverridesStoreForShop caches by normalized shop and refreshes same instance", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "rp-ctx-cogs-cache-"));

    const app = makeApp({
      DATA_DIR: dataDir,
      SHOPIFY_STORE_DOMAIN: "",
      SHOPIFY_ADMIN_TOKEN: "",
      SHOPIFY_API_VERSION: "2024-01",
      PAYMENT_FEE_PERCENT: 0.029,
      PAYMENT_FEE_FIXED: 0.3,
      DEFAULT_SHIPPING_COST: 5,
    });

    const ctx = await createShopifyCtx(app);

    const a = await ctx.getCogsOverridesStoreForShop("CACHE-SHOP.MYSHOPIFY.COM");
    await a.upsert({ variantId: 10, unitCost: 12.34 });

    const b = await ctx.getCogsOverridesStoreForShop("https://cache-shop.myshopify.com/");
    expect(a).toBe(b);

    const external = new CogsOverridesStore({
      shop: "cache-shop.myshopify.com",
      dataDir,
    });
    await external.upsert({ variantId: 20, unitCost: 99.99 });

    const c = await ctx.getCogsOverridesStoreForShop("cache-shop.myshopify.com");
    expect(c).toBe(a);

    const rows = await c.list();
    expect(rows.map((x) => x.variantId).sort((x, y) => x - y)).toEqual([10, 20]);
  });

  it("getCostModelOverridesStoreForShop caches by normalized shop and refreshes same instance", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "rp-ctx-cost-cache-"));

    const app = makeApp({
      DATA_DIR: dataDir,
      SHOPIFY_STORE_DOMAIN: "",
      SHOPIFY_ADMIN_TOKEN: "",
      SHOPIFY_API_VERSION: "2024-01",
      PAYMENT_FEE_PERCENT: 0.029,
      PAYMENT_FEE_FIXED: 0.3,
      DEFAULT_SHIPPING_COST: 5,
    });

    const ctx = await createShopifyCtx(app);

    const a = await ctx.getCostModelOverridesStoreForShop("COST-CACHE.MYSHOPIFY.COM");
    await a.setOverrides({
      payment: { feePercent: 0.05 },
    } as any);

    const b = await ctx.getCostModelOverridesStoreForShop("https://cost-cache.myshopify.com/");
    expect(a).toBe(b);

    const external = new CostModelOverridesStore({
      shop: "cost-cache.myshopify.com",
      dataDir,
    });
    await external.setOverrides({
      payment: { feePercent: 0.02, feeFixed: 0.99 },
      shipping: { costPerOrder: 7 },
    } as any);

    const c = await ctx.getCostModelOverridesStoreForShop("cost-cache.myshopify.com");
    expect(c).toBe(a);

    const out = c.getOverridesSync() as any;
    expect(out.payment.feePercent).toBe(0.02);
    expect(out.payment.feeFixed).toBe(0.99);
    expect(out.shipping.costPerOrder).toBe(7);
  });

  it("getActionPlanStateStoreForShop caches by normalized shop and refreshes same instance", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "rp-ctx-action-cache-"));

    const app = makeApp({
      DATA_DIR: dataDir,
      SHOPIFY_STORE_DOMAIN: "",
      SHOPIFY_ADMIN_TOKEN: "",
      SHOPIFY_API_VERSION: "2024-01",
      PAYMENT_FEE_PERCENT: 0.029,
      PAYMENT_FEE_FIXED: 0.3,
      DEFAULT_SHIPPING_COST: 5,
    });

    const ctx = await createShopifyCtx(app);

    const a = await ctx.getActionPlanStateStoreForShop("ACTION-CACHE.MYSHOPIFY.COM");
    await a.upsert({
      actionId: "fix-cogs",
      status: "OPEN",
    });

    const b = await ctx.getActionPlanStateStoreForShop("https://action-cache.myshopify.com/");
    expect(a).toBe(b);

    const external = new ActionPlanStateStore({
      shop: "action-cache.myshopify.com",
      dataDir,
    });
    await external.upsert({
      actionId: "fix-refunds",
      status: "DONE",
      note: "externally updated",
    });

    const c = await ctx.getActionPlanStateStoreForShop("action-cache.myshopify.com");
    expect(c).toBe(a);

    const rows = await c.list();
    expect(rows).toHaveLength(2);
    expect(rows.map((x) => x.actionId).sort()).toEqual(["fix-cogs", "fix-refunds"]);
  });

  it("getCogsServiceForShop caches per normalized shop", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "rp-ctx-cogs-service-cache-"));

    const app = makeApp({
      DATA_DIR: dataDir,
      SHOPIFY_STORE_DOMAIN: "",
      SHOPIFY_ADMIN_TOKEN: "",
      SHOPIFY_API_VERSION: "2024-01",
      PAYMENT_FEE_PERCENT: 0.029,
      PAYMENT_FEE_FIXED: 0.3,
      DEFAULT_SHIPPING_COST: 5,
    });

    const ctx = await createShopifyCtx(app);

    const a = await ctx.getCogsServiceForShop("SERVICE-CACHE.MYSHOPIFY.COM");
    const b = await ctx.getCogsServiceForShop("https://service-cache.myshopify.com/");
    expect(a).toBe(b);
  });

  it("propagates token missing as 401 from createShopifyForShop", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "rp-ctx-token-missing-"));

    const app = makeApp({
      DATA_DIR: dataDir,
      SHOPIFY_STORE_DOMAIN: "",
      SHOPIFY_ADMIN_TOKEN: "",
      SHOPIFY_API_VERSION: "2024-01",
      PAYMENT_FEE_PERCENT: 0.029,
      PAYMENT_FEE_FIXED: 0.3,
      DEFAULT_SHIPPING_COST: 5,
    });

    const ctx = await createShopifyCtx(app);

    await expect(ctx.createShopifyForShop("missing-token.myshopify.com")).rejects.toMatchObject({
      status: 401,
    });
  });
});