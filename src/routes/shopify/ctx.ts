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
  // legacy single-shop (keeps existing routes/tests working)
  shop: string;
  shopify: ReturnType<typeof createShopifyClient>;

  // ✅ token store + helpers for multi-shop (Variante C)
  shopsStore: ShopsStore;
  createShopifyForShop: (shop: string) => Promise<ReturnType<typeof createShopifyClient>>;
  fetchOrdersForShop: (shop: string, days: number) => Promise<any[]>;
  fetchOrderByIdForShop: (shop: string, orderId: string) => Promise<any>;

  /**
   * ✅ PCD-safe multi-shop COGS:
   * - each shop gets its own overrides store and its own cogs service (cache isolation)
   */
  getCogsOverridesStoreForShop: (shop: string) => Promise<CogsOverridesStore>;
  getCogsServiceForShop: (shop: string) => Promise<CogsService>;

  // legacy single-shop instances (existing routes use these)
  cogsOverridesStore: CogsOverridesStore;
  cogsService: CogsService;

  // legacy single-shop methods
  fetchOrders: (days: number) => Promise<any[]>;
  fetchOrderById: (orderId: string) => Promise<any>;

  // base-from-config (deterministic)
  costProfile: CostProfile;

  // persisted overrides (used by routes)
  costModelOverridesStore: CostModelOverridesStore;

  actionPlanStateStore: ActionPlanStateStore;
};

function redactOrderPII(order: any): any {
  // Defense-in-depth. GraphQL fetch omits customer fields, but keep this anyway.
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

export async function createShopifyCtx(app: FastifyInstance): Promise<ShopifyCtx> {
  const legacyShop = normalizeShopDomain(app.config.SHOPIFY_STORE_DOMAIN || "");
  const legacyToken = String(app.config.SHOPIFY_ADMIN_TOKEN || "").trim();

  const shopsStore = new ShopsStore({ dataDir: app.config.DATA_DIR });
  await shopsStore.ensureLoaded();

 const apiVersion = String((app.config as any).SHOPIFY_API_VERSION || "2024-01");

  // -----------------------------
  // ✅ Multi-shop COGS isolation
  // -----------------------------
  const cogsOverridesByShop = new Map<string, CogsOverridesStore>();
  const cogsServiceByShop = new Map<string, CogsService>();

  async function getCogsOverridesStoreForShop(shopInput: string) {
    const shop = normalizeShopDomain(shopInput);
    if (!isValidShopDomain(shop)) throw Object.assign(new Error("Invalid shop domain"), { status: 400 });

    const hit = cogsOverridesByShop.get(shop);
    if (hit) return hit;

    const store = new CogsOverridesStore({ shop, dataDir: app.config.DATA_DIR });
    await store.ensureLoaded();
    cogsOverridesByShop.set(shop, store);
    return store;
  }

  async function getCogsServiceForShop(shopInput: string) {
    const shop = normalizeShopDomain(shopInput);
    if (!isValidShopDomain(shop)) throw Object.assign(new Error("Invalid shop domain"), { status: 400 });

    const hit = cogsServiceByShop.get(shop);
    if (hit) return hit;

    const overrides = await getCogsOverridesStoreForShop(shop);
    const service = new CogsService(overrides);
    cogsServiceByShop.set(shop, service);
    return service;
  }

  async function createShopifyForShop(shopInput: string) {
    const shop = normalizeShopDomain(shopInput);
    if (!isValidShopDomain(shop)) throw Object.assign(new Error("Invalid shop domain"), { status: 400 });

    const token = await shopsStore.getAccessTokenOrThrow(shop); // refresh-safe internally
    return createShopifyClient({ shopDomain: shop, accessToken: token });
  }

  async function fetchOrdersForShop(shopInput: string, days: number) {
    const shop = normalizeShopDomain(shopInput);
    if (!isValidShopDomain(shop)) throw Object.assign(new Error("Invalid shop domain"), { status: 400 });

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
    if (!isValidShopDomain(shop)) throw Object.assign(new Error("Invalid shop domain"), { status: 400 });

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

  // Legacy single-shop client
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

  // ✅ Legacy stores become shop-scoped too (safe default)
  const legacyShopKey = legacyShop || "unknown.myshopify.com";

  const cogsOverridesStore = new CogsOverridesStore({ shop: legacyShopKey, dataDir: app.config.DATA_DIR });
  await cogsOverridesStore.ensureLoaded();
  const cogsService = new CogsService(cogsOverridesStore);

  const costProfile = resolveCostProfileFromConfig(app.config);

  const costModelOverridesStore = new CostModelOverridesStore({ shop: legacyShopKey, dataDir: app.config.DATA_DIR });
  await costModelOverridesStore.ensureLoaded();

  const actionPlanStateStore = new ActionPlanStateStore({ shop: legacyShopKey, dataDir: app.config.DATA_DIR });
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

    cogsOverridesStore,
    cogsService,

    fetchOrders,
    fetchOrderById,

    costProfile,
    costModelOverridesStore,
    actionPlanStateStore,
  };
}