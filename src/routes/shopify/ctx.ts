// src/routes/shopify/ctx.ts
import { FastifyInstance } from "fastify";
import { createShopifyClient } from "../../integrations/shopify/client.js";
import { fetchOrdersGraphql, fetchOrderByIdGraphql } from "../../integrations/shopify/ordersGraphql.js";

import { CogsService } from "../../domain/cogs.js";
import { CogsOverridesStore } from "../../storage/cogsOverridesStore.js";
import { ShopsStore, normalizeShopDomain, isValidShopDomain } from "../../storage/shopsStore.js";

// ✅ Cost model
import type { CostProfile } from "../../domain/costModel/types.js";
import { resolveCostProfileFromConfig } from "../../domain/costModel/resolve.js";

// ✅ persistence stores
import { CostModelOverridesStore } from "../../storage/costModelOverridesStore.js";
import { ActionPlanStateStore } from "../../storage/actionPlanStateStore.js";

export type ShopifyCtx = {
  shop: string;
  shopify: ReturnType<typeof createShopifyClient>;

  shopsStore: ShopsStore;
  createShopifyForShop: (shop: string) => Promise<ReturnType<typeof createShopifyClient>>;
  fetchOrdersForShop: (shop: string, days: number) => Promise<any[]>;
  fetchOrderByIdForShop: (shop: string, orderId: string) => Promise<any>;

  getCogsOverridesStoreForShop: (shop: string) => Promise<CogsOverridesStore>;
  getCogsServiceForShop: (shop: string) => Promise<CogsService>;
  getCostModelOverridesStoreForShop: (shop: string) => Promise<CostModelOverridesStore>;
  getActionPlanStateStoreForShop: (shop: string) => Promise<ActionPlanStateStore>;

  cogsOverridesStore: CogsOverridesStore;
  cogsService: CogsService;
  costModelOverridesStore: CostModelOverridesStore;
  actionPlanStateStore: ActionPlanStateStore;

  fetchOrders: (days: number) => Promise<any[]>;
  fetchOrderById: (orderId: string) => Promise<any>;

  costProfile: CostProfile;
};

function redactOrderPII(order: any): any {
  if (!order || typeof order !== "object") return order;

  const clone: any = { ...order };

  delete clone.customer;
  delete clone.email;
  delete clone.phone;

  delete clone.billing_address;
  delete clone.shipping_address;

  delete clone.client_details;
  delete clone.browser_ip;

  delete clone.note;
  delete clone.note_attributes;

  delete clone.landing_site;
  delete clone.landing_site_ref;

  delete clone.contact_email;

  return clone;
}

function makeDisabledCogsOverridesStore(): CogsOverridesStore {
  return {
    ensureLoaded: async () => {},
    ensureFresh: async () => {},
    list: async () => [],
    upsert: async () => {
      throw Object.assign(new Error("Legacy single-shop COGS store disabled: SHOPIFY_STORE_DOMAIN missing"), { status: 400 });
    },
    clearAll: async () => {},
    getUnitCostSync: () => undefined,
    isIgnoredSync: () => false,
  } as any;
}

function makeDisabledCostModelOverridesStore(): CostModelOverridesStore {
  return {
    ensureLoaded: async () => {},
    ensureFresh: async () => {},
    getOverridesSync: () => undefined,
    getUpdatedAtSync: () => undefined,
    setOverrides: async () => {
      throw Object.assign(new Error("Legacy single-shop cost model store disabled: SHOPIFY_STORE_DOMAIN missing"), { status: 400 });
    },
    clear: async () => {},
  } as any;
}

function makeDisabledActionPlanStateStore(): ActionPlanStateStore {
  return {
    ensureLoaded: async () => {},
    ensureFresh: async () => {},
    getUpdatedAtSync: () => null,
    getStateSync: () => null,
    list: async () => [],
    upsert: async () => {
      throw Object.assign(new Error("Legacy single-shop action state store disabled: SHOPIFY_STORE_DOMAIN missing"), { status: 400 });
    },
    clear: async () => {},
    clearAll: async () => {},
  } as any;
}

export async function createShopifyCtx(app: FastifyInstance): Promise<ShopifyCtx> {
  const legacyShop = normalizeShopDomain(app.config.SHOPIFY_STORE_DOMAIN || "");
  const legacyToken = String(app.config.SHOPIFY_ADMIN_TOKEN || "").trim();

  const shopsStore = new ShopsStore({ dataDir: app.config.DATA_DIR });
  await shopsStore.ensureLoaded();

  const apiVersion = String((app.config as any).SHOPIFY_API_VERSION || "2024-01");

  const cogsOverridesByShop = new Map<string, CogsOverridesStore>();
  const cogsServiceByShop = new Map<string, CogsService>();
  const costModelOverridesByShop = new Map<string, CostModelOverridesStore>();
  const actionPlanStateByShop = new Map<string, ActionPlanStateStore>();

  async function getCogsOverridesStoreForShop(shopInput: string) {
    const shop = normalizeShopDomain(shopInput);
    if (!isValidShopDomain(shop)) {
      throw Object.assign(new Error("Invalid shop domain"), { status: 400 });
    }

    const hit = cogsOverridesByShop.get(shop);
    if (hit) {
      await (hit as any).ensureFresh?.();
      return hit;
    }

    const store = new CogsOverridesStore({ shop, dataDir: app.config.DATA_DIR });
    await store.ensureLoaded();
    cogsOverridesByShop.set(shop, store);
    return store;
  }

  async function getCogsServiceForShop(shopInput: string) {
    const shop = normalizeShopDomain(shopInput);
    if (!isValidShopDomain(shop)) {
      throw Object.assign(new Error("Invalid shop domain"), { status: 400 });
    }

    const hit = cogsServiceByShop.get(shop);
    if (hit) {
      const overrides = await getCogsOverridesStoreForShop(shop);
      await (overrides as any).ensureFresh?.();
      return hit;
    }

    const overrides = await getCogsOverridesStoreForShop(shop);
    const service = new CogsService(overrides);
    cogsServiceByShop.set(shop, service);
    return service;
  }

  async function getCostModelOverridesStoreForShop(shopInput: string) {
    const shop = normalizeShopDomain(shopInput);
    if (!isValidShopDomain(shop)) {
      throw Object.assign(new Error("Invalid shop domain"), { status: 400 });
    }

    const hit = costModelOverridesByShop.get(shop);
    if (hit) {
      await (hit as any).ensureFresh?.();
      return hit;
    }

    const store = new CostModelOverridesStore({ shop, dataDir: app.config.DATA_DIR });
    await store.ensureLoaded();
    costModelOverridesByShop.set(shop, store);
    return store;
  }

  async function getActionPlanStateStoreForShop(shopInput: string) {
    const shop = normalizeShopDomain(shopInput);
    if (!isValidShopDomain(shop)) {
      throw Object.assign(new Error("Invalid shop domain"), { status: 400 });
    }

    const hit = actionPlanStateByShop.get(shop);
    if (hit) {
      await (hit as any).ensureFresh?.();
      return hit;
    }

    const store = new ActionPlanStateStore({ shop, dataDir: app.config.DATA_DIR });
    await store.ensureLoaded();
    actionPlanStateByShop.set(shop, store);
    return store;
  }

  async function createShopifyForShop(shopInput: string) {
    const shop = normalizeShopDomain(shopInput);
    if (!isValidShopDomain(shop)) {
      throw Object.assign(new Error("Invalid shop domain"), { status: 400 });
    }

    const token = await shopsStore.getAccessTokenOrThrow(shop);
    return createShopifyClient({ shopDomain: shop, accessToken: token });
  }

  async function fetchOrdersForShop(shopInput: string, days: number) {
    const shop = normalizeShopDomain(shopInput);
    if (!isValidShopDomain(shop)) {
      throw Object.assign(new Error("Invalid shop domain"), { status: 400 });
    }

    const token = await shopsStore.getAccessTokenOrThrow(shop);

    const orders = await fetchOrdersGraphql({
      shop,
      accessToken: token,
      days,
      apiVersion,
    });

    return orders.map(redactOrderPII);
  }

  async function fetchOrderByIdForShop(shopInput: string, orderId: string) {
    const shop = normalizeShopDomain(shopInput);
    if (!isValidShopDomain(shop)) {
      throw Object.assign(new Error("Invalid shop domain"), { status: 400 });
    }

    const token = await shopsStore.getAccessTokenOrThrow(shop);

    const order = await fetchOrderByIdGraphql({
      shop,
      accessToken: token,
      orderId,
      apiVersion,
    });

    if (!order) {
      const err: any = new Error(`Order not found: ${orderId}`);
      err.status = 404;
      throw err;
    }

    return redactOrderPII(order);
  }

  const shopify =
    legacyShop && legacyToken
      ? createShopifyClient({ shopDomain: legacyShop, accessToken: legacyToken })
      : legacyShop
        ? createShopifyClient({
            shopDomain: legacyShop,
            accessToken: await shopsStore.getAccessTokenOrThrow(legacyShop),
          })
        : createShopifyClient({
            shopDomain: "example.myshopify.com",
            accessToken: "missing_token",
          });

  const costProfile = resolveCostProfileFromConfig(app.config);

  const cogsOverridesStore = legacyShop
    ? new CogsOverridesStore({
        shop: legacyShop,
        dataDir: app.config.DATA_DIR,
      })
    : makeDisabledCogsOverridesStore();

  await cogsOverridesStore.ensureLoaded();

  const cogsService = legacyShop
    ? new CogsService(cogsOverridesStore)
    : (new CogsService(cogsOverridesStore as any) as CogsService);

  const costModelOverridesStore = legacyShop
    ? new CostModelOverridesStore({
        shop: legacyShop,
        dataDir: app.config.DATA_DIR,
      })
    : makeDisabledCostModelOverridesStore();

  await costModelOverridesStore.ensureLoaded();

  const actionPlanStateStore = legacyShop
    ? new ActionPlanStateStore({
        shop: legacyShop,
        dataDir: app.config.DATA_DIR,
      })
    : makeDisabledActionPlanStateStore();

  await actionPlanStateStore.ensureLoaded();

  async function fetchOrders(days: number) {
    if (!legacyShop) {
      const err: any = new Error(
        "SHOPIFY_STORE_DOMAIN missing (legacy single-shop mode). Use ?shop=... + OAuth token store."
      );
      err.status = 400;
      throw err;
    }
    return fetchOrdersForShop(legacyShop, days);
  }

  async function fetchOrderById(orderId: string) {
    if (!legacyShop) {
      const err: any = new Error(
        "SHOPIFY_STORE_DOMAIN missing (legacy single-shop mode). Use ?shop=... + OAuth token store."
      );
      err.status = 400;
      throw err;
    }
    return fetchOrderByIdForShop(legacyShop, orderId);
  }

  return {
    shop: legacyShop,
    shopify,

    shopsStore,
    createShopifyForShop,
    fetchOrdersForShop,
    fetchOrderByIdForShop,

    getCogsOverridesStoreForShop,
    getCogsServiceForShop,
    getCostModelOverridesStoreForShop,
    getActionPlanStateStoreForShop,

    cogsOverridesStore,
    cogsService,
    costModelOverridesStore,
    actionPlanStateStore,

    fetchOrders,
    fetchOrderById,

    costProfile,
  };
}