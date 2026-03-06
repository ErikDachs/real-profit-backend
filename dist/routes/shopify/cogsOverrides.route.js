import { buildProductsProfit } from "../../domain/profit.js";
import { parseDays, parseOverrideBody, parseShop } from "./helpers.js";
export function registerCogsOverridesRoutes(app, ctx) {
    // List overrides for a shop
    app.get("/api/cogs/overrides", async (req, reply) => {
        try {
            const q = req.query;
            const shop = parseShop(q, ctx.shop);
            if (!shop)
                return reply.status(400).send({ error: "shop is required (valid *.myshopify.com)" });
            const store = shop === ctx.shop ? ctx.cogsOverridesStore : await ctx.getCogsOverridesStoreForShop(shop);
            const overrides = await store.list();
            return reply.send({ shop, overrides });
        }
        catch (err) {
            return reply.status(500).send({ error: "Unexpected error", details: String(err?.message ?? err) });
        }
    });
    // Upsert override for a shop
    app.put("/api/cogs/overrides", async (req, reply) => {
        try {
            const q = req.query;
            const shop = parseShop(q, ctx.shop);
            if (!shop)
                return reply.status(400).send({ error: "shop is required (valid *.myshopify.com)" });
            const body = (req.body ?? {});
            const parsed = parseOverrideBody(body);
            if (!parsed.ok)
                return reply.status(parsed.status).send({ error: parsed.error });
            const store = shop === ctx.shop ? ctx.cogsOverridesStore : await ctx.getCogsOverridesStoreForShop(shop);
            const rec = await store.upsert({
                variantId: parsed.variantId,
                unitCost: parsed.unitCost,
                ignoreCogs: parsed.ignoreCogs,
            });
            return reply.send({ ok: true, shop, override: rec });
        }
        catch (err) {
            return reply.status(500).send({ error: "Unexpected error", details: String(err?.message ?? err) });
        }
    });
    // Missing COGS for a shop
    app.get("/api/cogs/missing", async (req, reply) => {
        try {
            const q = req.query;
            const shop = parseShop(q, ctx.shop);
            if (!shop)
                return reply.status(400).send({ error: "shop is required (valid *.myshopify.com)" });
            const daysNum = parseDays(q, 30);
            const orders = shop === ctx.shop ? await ctx.fetchOrders(daysNum) : await ctx.fetchOrdersForShop(shop, daysNum);
            const shopifyClient = shop === ctx.shop ? ctx.shopify : await ctx.createShopifyForShop(shop);
            const cogsService = shop === ctx.shop ? ctx.cogsService : await ctx.getCogsServiceForShop(shop);
            const store = shop === ctx.shop ? ctx.cogsOverridesStore : await ctx.getCogsOverridesStoreForShop(shop);
            const result = await buildProductsProfit({
                shop,
                days: daysNum,
                orders,
                costProfile: ctx.costProfile,
                cogsService,
                shopifyGET: shopifyClient.get,
            });
            const rawMissing = (result?.highlights?.missingCogs ?? []);
            const missing = rawMissing
                .filter((x) => !store.isIgnoredSync(Number(x.variantId)))
                .map((x) => ({
                ...x,
                unitCostOverride: store.getUnitCostSync(Number(x.variantId)) ?? null,
                ignoreCogs: store.isIgnoredSync(Number(x.variantId)),
            }));
            return reply.send({ shop, days: daysNum, count: missing.length, missing });
        }
        catch (err) {
            const status = err?.status && Number.isFinite(err.status) ? err.status : 500;
            return reply.status(status).send({ error: "Unexpected error", details: String(err?.message ?? err) });
        }
    });
}
