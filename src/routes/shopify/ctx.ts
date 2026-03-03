// src/routes/shopify/ctx.ts
import { FastifyInstance } from "fastify";
import { createShopifyClient } from "../../integrations/shopify/client.js";
import { CogsService } from "../../domain/cogs.js";
import { CogsOverridesStore } from "../../storage/cogsOverridesStore.js";
import { ShopsStore } from "../../storage/shopsStore.js";

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

  // ✅ NEW: token store + helpers for multi-shop (Variante C)
  shopsStore: ShopsStore;
  createShopifyForShop: (shop: string) => Promise<ReturnType<typeof createShopifyClient>>;
  fetchOrdersForShop: (shop: string, days: number) => Promise<any[]>;
  fetchOrderByIdForShop: (shop: string, orderId: string) => Promise<any>;

  cogsOverridesStore: CogsOverridesStore;
  cogsService: CogsService;

  // legacy single-shop methods (existing routes call these)
  fetchOrders: (days: number) => Promise<any[]>;
  fetchOrderById: (orderId: string) => Promise<any>;

  // base-from-config (deterministic)
  costProfile: CostProfile;

  // persisted overrides (used by routes)
  costModelOverridesStore: CostModelOverridesStore;

  actionPlanStateStore: ActionPlanStateStore;
};

export async function createShopifyCtx(app: FastifyInstance): Promise<ShopifyCtx> {
  // Legacy envs (keep tests green)
  const legacyShop = String(app.config.SHOPIFY_STORE_DOMAIN || "").trim().toLowerCase();
  const legacyToken = String(app.config.SHOPIFY_ADMIN_TOKEN || "").trim();

  // ✅ New store for OAuth tokens (MUST match oauth.route.ts DATA_DIR)
  const shopsStore = new ShopsStore({ dataDir: app.config.DATA_DIR });
  await shopsStore.ensureLoaded();

  async function createShopifyForShop(shop: string) {
    const token = await shopsStore.getAccessTokenOrThrow(shop);
    return createShopifyClient({ shopDomain: shop, accessToken: token });
  }

  async function fetchOrdersForShop(shop: string, days: number) {
    const shopify = await createShopifyForShop(shop);

    const since = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000).toISOString();
    const ordersPath =
      `/admin/api/2024-01/orders.json` +
      `?status=any&limit=250&created_at_min=${encodeURIComponent(since)}`;

    const json = await shopify.get(ordersPath);
    return (json.orders ?? []) as any[];
  }

  async function fetchOrderByIdForShop(shop: string, orderId: string) {
    const shopify = await createShopifyForShop(shop);

    const path = `/admin/api/2024-01/orders/${encodeURIComponent(orderId)}.json?status=any`;
    const json = await shopify.get(path);
    if (!json?.order) {
      const err: any = new Error(`Order not found: ${orderId}`);
      err.status = 404;
      throw err;
    }
    return json.order as any;
  }

  // Legacy single-shop client (existing routes)
  const shopify =
    legacyShop && legacyToken
      ? createShopifyClient({ shopDomain: legacyShop, accessToken: legacyToken })
      : legacyShop
        ? createShopifyClient({
            shopDomain: legacyShop,
            accessToken: await shopsStore.getAccessTokenOrThrow(legacyShop),
          })
        : // dummy placeholder to avoid crash on boot; routes will error if used
          createShopifyClient({
            shopDomain: "example.myshopify.com",
            accessToken: "missing_token",
          });

  // MVP persistence for manual COGS overrides + ignore flag
  const cogsOverridesStore = new CogsOverridesStore();
  await cogsOverridesStore.ensureLoaded();
  const cogsService = new CogsService(cogsOverridesStore);

  // base profile from config (no meta)
  const costProfile = resolveCostProfileFromConfig(app.config);

  // persisted cost model overrides (fee/shipping/flags/ads mode + fixed costs)
  const costModelOverridesStore = new CostModelOverridesStore({ shop: legacyShop || "unknown.myshopify.com" });
  await costModelOverridesStore.ensureLoaded();

  // persisted action plan state (status/notes)
  const actionPlanStateStore = new ActionPlanStateStore({ shop: legacyShop || "unknown.myshopify.com" });
  await actionPlanStateStore.ensureLoaded();

  // legacy methods used by your existing routes
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

    cogsOverridesStore,
    cogsService,

    fetchOrders,
    fetchOrderById,

    costProfile,
    costModelOverridesStore,
    actionPlanStateStore,
  };
}
