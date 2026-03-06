// src/app.ts
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import env from "@fastify/env";
import { registerShopifyRoutes } from "./routes/shopify.js";
export async function buildApp() {
    // logger: in prod nicht blind sein. Keine PII loggen — aber errors brauchst du.
    const app = Fastify({
        logger: {
            level: process.env.NODE_ENV === "production" ? "info" : "debug",
        },
    });
    await app.register(env, {
        dotenv: true,
        schema: {
            type: "object",
            required: ["PORT"],
            properties: {
                PORT: { type: "number", default: 3001 },
                NODE_ENV: { type: "string", default: "development" },
                // ✅ central data dir for JSON stores (tests can override)
                DATA_DIR: { type: "string", default: "data" },
                // ✅ Variante C (OAuth app)
                SHOPIFY_API_KEY: { type: "string", default: "" },
                SHOPIFY_API_SECRET: { type: "string", default: "" },
                APP_URL: { type: "string", default: "" },
                SHOPIFY_SCOPES: { type: "string", default: "read_orders,read_products" },
                // legacy single-shop mode (optional)
                SHOPIFY_STORE_DOMAIN: { type: "string", default: "" },
                SHOPIFY_ADMIN_TOKEN: { type: "string", default: "" },
                PAYMENT_FEE_PERCENT: { type: "number", default: 0.029 },
                PAYMENT_FEE_FIXED: { type: "number", default: 0.3 },
                DEFAULT_SHIPPING_COST: { type: "number", default: 5 },
            },
        },
    });
    await app.register(cors, { origin: true, credentials: true });
    await app.register(helmet);
    // Health should never be rate-limited hard
    app.get("/health", async () => {
        return { ok: true, service: "backend", ts: new Date().toISOString() };
    });
    // ✅ Register Shopify routes FIRST (includes OAuth + Webhooks).
    // We do NOT want rate-limit to block Shopify webhooks.
    await registerShopifyRoutes(app);
    app.get("/__debug/routes", async () => {
        // @ts-ignore
        return app.printRoutes();
    });
    // ✅ Rate-limit only the remaining “normal” API traffic if you add any non-shopify routes later.
    // If right now *everything* is under /api/shopify, this stays harmless.
    await app.register(async (scoped) => {
        await scoped.register(rateLimit, { max: 200, timeWindow: "1 minute" });
        // If you later add non-shopify routes, register them here.
    });
    return app;
}
