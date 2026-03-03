import { createShopifyClient } from "../../integrations/shopify/client.js";
import { CogsService } from "../../domain/cogs.js";
import { CogsOverridesStore } from "../../storage/cogsOverridesStore.js";
import { ShopsStore } from "../../storage/shopsStore.js";
import { resolveCostProfileFromConfig } from "../../domain/costModel/resolve.js";
// ✅ persistence stores
import { CostModelOverridesStore } from "../../storage/costModelOverridesStore.js";
import { ActionPlanStateStore } from "../../storage/actionPlanStateStore.js";
export async function createShopifyCtx(app) {
    // Legacy envs (keep tests green)
    const legacyShop = String(app.config.SHOPIFY_STORE_DOMAIN || "").trim().toLowerCase();
    const legacyToken = String(app.config.SHOPIFY_ADMIN_TOKEN || "").trim();
    // ✅ New store for OAuth tokens
    const shopsStore = new ShopsStore();
    await shopsStore.ensureLoaded();
    async function createShopifyForShop(shop) {
        const token = await shopsStore.getAccessTokenOrThrow(shop);
        return createShopifyClient({ shopDomain: shop, accessToken: token });
    }
    async function fetchOrdersForShop(shop, days) {
        const shopify = await createShopifyForShop(shop);
        const since = new Date(Date.now() - Number(days) * 24 * 60 * 60 * 1000).toISOString();
        const ordersPath = `/admin/api/2024-01/orders.json` +
            `?status=any&limit=250&created_at_min=${encodeURIComponent(since)}`;
        const json = await shopify.get(ordersPath);
        return (json.orders ?? []);
    }
    async function fetchOrderByIdForShop(shop, orderId) {
        const shopify = await createShopifyForShop(shop);
        const path = `/admin/api/2024-01/orders/${encodeURIComponent(orderId)}.json?status=any`;
        const json = await shopify.get(path);
        if (!json?.order) {
            const err = new Error(`Order not found: ${orderId}`);
            err.status = 404;
            throw err;
        }
        return json.order;
    }
    // Legacy single-shop client (existing routes)
    const shopify = legacyShop && legacyToken
        ? createShopifyClient({ shopDomain: legacyShop, accessToken: legacyToken })
        : // fallback: if you set legacyShop but token is now in shopsStore
            legacyShop
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
    async function fetchOrders(days) {
        if (!legacyShop) {
            const err = new Error("SHOPIFY_STORE_DOMAIN missing (legacy single-shop mode). Use ?shop=... + OAuth token store.");
            err.status = 400;
            throw err;
        }
        return fetchOrdersForShop(legacyShop, days);
    }
    async function fetchOrderById(orderId) {
        if (!legacyShop) {
            const err = new Error("SHOPIFY_STORE_DOMAIN missing (legacy single-shop mode). Use ?shop=... + OAuth token store.");
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
