import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import type { ShopifyCtx } from "./ctx.js";
import { buildApp } from "../../app.js";

import { CogsOverridesStore } from "../../storage/cogsOverridesStore.js";
import { CostModelOverridesStore } from "../../storage/costModelOverridesStore.js";
import { ActionPlanStateStore } from "../../storage/actionPlanStateStore.js";
import { CogsService } from "../../domain/cogs.js";
import { authedInject } from "./testEmbeddedAuth.js";

const shopA = "shop-a.myshopify.com";
const shopB = "shop-b.myshopify.com";

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
];

function makeCtx(): ShopifyCtx {
  const cogsStoreByShop = new Map<string, CogsOverridesStore>();
  const cogsServiceByShop = new Map<string, CogsService>();
  const costStoreByShop = new Map<string, CostModelOverridesStore>();
  const actionStoreByShop = new Map<string, ActionPlanStateStore>();

  async function getCogsStore(shop: string) {
    const hit = cogsStoreByShop.get(shop);
    if (hit) {
      await hit.ensureFresh();
      return hit;
    }
    const store = new CogsOverridesStore({ shop, dataDir });
    await store.ensureLoaded();
    cogsStoreByShop.set(shop, store);
    return store;
  }

  async function getCogsService(shop: string) {
    const hit = cogsServiceByShop.get(shop);
    if (hit) {
      const store = await getCogsStore(shop);
      await store.ensureFresh();
      return hit;
    }
    const store = await getCogsStore(shop);
    const svc = new CogsService(store);
    cogsServiceByShop.set(shop, svc);
    return svc;
  }

  async function getCostStore(shop: string) {
    const hit = costStoreByShop.get(shop);
    if (hit) {
      await hit.ensureFresh();
      return hit;
    }
    const store = new CostModelOverridesStore({ shop, dataDir });
    await store.ensureLoaded();
    costStoreByShop.set(shop, store);
    return store;
  }

  async function getActionStore(shop: string) {
    const hit = actionStoreByShop.get(shop);
    if (hit) {
      await hit.ensureFresh();
      return hit;
    }
    const store = new ActionPlanStateStore({ shop, dataDir });
    await store.ensureLoaded();
    actionStoreByShop.set(shop, store);
    return store;
  }

  const legacyCogsStore = new CogsOverridesStore({ shop: shopA, dataDir });
  const legacyCostStore = new CostModelOverridesStore({ shop: shopA, dataDir });
  const legacyActionStore = new ActionPlanStateStore({ shop: shopA, dataDir });

  return {
    shop: shopA,
    shopify: { get: async () => ({}) } as any,

    shopsStore: {
      ensureLoaded: async () => {},
      getAccessTokenOrThrow: async (_shop: string) => "test_token",
    } as any,

    createShopifyForShop: async (_shop: string) => ({ get: async () => ({}) } as any),
    fetchOrdersForShop: async (_shop: string, _days: number) => fakeOrders as any,
    fetchOrderByIdForShop: async (_shop: string, _orderId: string) => fakeOrders[0] as any,

    getCogsOverridesStoreForShop: async (shop: string) => getCogsStore(shop),
    getCogsServiceForShop: async (shop: string) => getCogsService(shop),
    getCostModelOverridesStoreForShop: async (shop: string) => getCostStore(shop),
    getActionPlanStateStoreForShop: async (shop: string) => getActionStore(shop),

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
      meta: { fingerprint: "test-fingerprint" },
    } as any,
  };
}

vi.mock("./ctx.js", () => {
  return {
    createShopifyCtx: async () => makeCtx(),
  };
});

describe("multi-shop isolation via HTTP routes", () => {
  let app: any;

  beforeAll(async () => {
    dataDir = await mkdtemp(path.join(tmpdir(), "rp-multishop-http-"));

    process.env.PORT = "3001";
    process.env.NODE_ENV = "test";
    process.env.DATA_DIR = dataDir;
    process.env.SHOPIFY_STORE_DOMAIN = shopA;
    process.env.SHOPIFY_ADMIN_TOKEN = "legacy_token";
    process.env.SHOPIFY_API_KEY = "test_api_key";
    process.env.SHOPIFY_API_SECRET = "test_api_secret";

    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns 401 for protected merchant routes without session token", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/cogs/overrides?shop=${shopA}`,
    });

    expect(res.statusCode).toBe(401);
    expect(res.headers["x-shopify-retry-invalid-session-request"]).toBe("1");

    const json = res.json();
    expect(json.error).toBe("Unauthorized");
  });

  it("returns 403 when requested shop does not match authenticated shop", async () => {
    const res = await authedInject(app, {
      method: "GET",
      url: `/api/cogs/overrides?shop=${shopB}`,
      shop: shopA,
    });

    expect(res.statusCode).toBe(403);

    const json = res.json();
    expect(json.error).toBe("Forbidden");
    expect(json.details).toContain("does not match authenticated shop");
  });

  it("isolates COGS overrides between shops", async () => {
    const putA = await authedInject(app, {
      method: "PUT",
      url: `/api/cogs/overrides?shop=${shopA}`,
      shop: shopA,
      payload: { variantId: 10, unitCost: 12.34, ignoreCogs: false },
    });
    expect(putA.statusCode).toBe(200);

    const putB = await authedInject(app, {
      method: "PUT",
      url: `/api/cogs/overrides?shop=${shopB}`,
      shop: shopB,
      payload: { variantId: 10, unitCost: 99.99, ignoreCogs: true },
    });
    expect(putB.statusCode).toBe(200);

    const getA = await authedInject(app, {
      method: "GET",
      url: `/api/cogs/overrides?shop=${shopA}`,
      shop: shopA,
    });
    const getB = await authedInject(app, {
      method: "GET",
      url: `/api/cogs/overrides?shop=${shopB}`,
      shop: shopB,
    });

    expect(getA.statusCode).toBe(200);
    expect(getB.statusCode).toBe(200);

    const a = getA.json();
    const b = getB.json();

    expect(a.shop).toBe(shopA);
    expect(b.shop).toBe(shopB);

    expect(a.overrides).toHaveLength(1);
    expect(b.overrides).toHaveLength(1);

    expect(a.overrides[0].unitCost).toBe(12.34);
    expect(a.overrides[0].ignoreCogs).toBe(false);

    expect(b.overrides[0].unitCost).toBe(99.99);
    expect(b.overrides[0].ignoreCogs).toBe(true);
  });

  it("isolates cost-model overrides between shops", async () => {
    const patchA = await authedInject(app, {
      method: "PATCH",
      url: `/api/cost-model?shop=${shopA}`,
      shop: shopA,
      payload: { feePercent: 0.05, shippingCostPerOrder: 7 },
    });
    expect(patchA.statusCode).toBe(200);

    const patchB = await authedInject(app, {
      method: "PATCH",
      url: `/api/cost-model?shop=${shopB}`,
      shop: shopB,
      payload: { feePercent: 0.02, shippingCostPerOrder: 3 },
    });
    expect(patchB.statusCode).toBe(200);

    const getA = await authedInject(app, {
      method: "GET",
      url: `/api/cost-model?shop=${shopA}`,
      shop: shopA,
    });
    const getB = await authedInject(app, {
      method: "GET",
      url: `/api/cost-model?shop=${shopB}`,
      shop: shopB,
    });

    expect(getA.statusCode).toBe(200);
    expect(getB.statusCode).toBe(200);

    const a = getA.json();
    const b = getB.json();

    expect(a.shop).toBe(shopA);
    expect(b.shop).toBe(shopB);

    expect(a.persistedOverrides.payment.feePercent).toBe(0.05);
    expect(a.persistedOverrides.shipping.costPerOrder).toBe(7);

    expect(b.persistedOverrides.payment.feePercent).toBe(0.02);
    expect(b.persistedOverrides.shipping.costPerOrder).toBe(3);
  });

  it("isolates action state between shops", async () => {
    const patchA = await authedInject(app, {
      method: "PATCH",
      url: `/api/actions/state?shop=${shopA}`,
      shop: shopA,
      payload: {
        actionId: "fix-refunds",
        status: "IN_PROGRESS",
        note: "A-only",
      },
    });
    expect(patchA.statusCode).toBe(200);

    const patchB = await authedInject(app, {
      method: "PATCH",
      url: `/api/actions/state?shop=${shopB}`,
      shop: shopB,
      payload: {
        actionId: "fix-refunds",
        status: "DONE",
        note: "B-only",
      },
    });
    expect(patchB.statusCode).toBe(200);

    const getA = await authedInject(app, {
      method: "GET",
      url: `/api/actions/state?shop=${shopA}`,
      shop: shopA,
    });
    const getB = await authedInject(app, {
      method: "GET",
      url: `/api/actions/state?shop=${shopB}`,
      shop: shopB,
    });

    expect(getA.statusCode).toBe(200);
    expect(getB.statusCode).toBe(200);

    const a = getA.json();
    const b = getB.json();

    expect(a.shop).toBe(shopA);
    expect(b.shop).toBe(shopB);

    expect(a.states).toHaveLength(1);
    expect(b.states).toHaveLength(1);

    expect(a.states[0].status).toBe("IN_PROGRESS");
    expect(a.states[0].note).toBe("A-only");

    expect(b.states[0].status).toBe("DONE");
    expect(b.states[0].note).toBe("B-only");
  });

  it("creates separate physical files per shop", async () => {
    const files = await fs.readdir(dataDir);

    expect(files).toContain(`cogsOverrides.${shopA}.json`);
    expect(files).toContain(`cogsOverrides.${shopB}.json`);

    expect(files).toContain(`costModelOverrides.${shopA}.json`);
    expect(files).toContain(`costModelOverrides.${shopB}.json`);

    expect(files).toContain(`actionPlanState.${shopA}.json`);
    expect(files).toContain(`actionPlanState.${shopB}.json`);
  });

  it("accepts canonicalized shop input when it normalizes to the authenticated shop", async () => {
    const res = await authedInject(app, {
      method: "GET",
      url: `/api/cogs/overrides?shop=${encodeURIComponent("HTTPS://SHOP-A.MYSHOPIFY.COM/")}`,
      shop: shopA,
    });

    expect(res.statusCode).toBe(200);

    const json = res.json();
    expect(json.shop).toBe(shopA);
    expect(json.overrides).toHaveLength(1);
    expect(json.overrides[0].unitCost).toBe(12.34);
  });
});