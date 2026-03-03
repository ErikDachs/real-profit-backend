// src/app.ts
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import env from "@fastify/env";
import { registerShopifyRoutes } from "./routes/shopify.js";

export async function buildApp() {
  const app = Fastify({ logger: false });

  await app.register(env, {
    dotenv: true,
    schema: {
      type: "object",
      required: ["PORT"],
      properties: {
        PORT: { type: "number", default: 3001 },
        NODE_ENV: { type: "string", default: "development" },

        // ✅ NEW: central data dir for JSON stores (tests can override)
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
  await app.register(rateLimit, { max: 200, timeWindow: "1 minute" });

  app.get("/health", async () => {
    return { ok: true, service: "backend", ts: new Date().toISOString() };
  });

  await registerShopifyRoutes(app);

  return app;
}
