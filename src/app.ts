import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import env from "@fastify/env";

import { registerAppFrontendRoutes } from "./routes/appFrontend.route.js";
import { registerShopifyRoutes } from "./routes/shopify.js";

export async function buildApp() {
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

        DATA_DIR: { type: "string", default: "data" },

        SHOPIFY_API_KEY: { type: "string", default: "" },
        SHOPIFY_API_SECRET: { type: "string", default: "" },
        APP_URL: { type: "string", default: "" },
        SHOPIFY_SCOPES: { type: "string", default: "read_orders,read_products" },
        SHOPIFY_API_VERSION: { type: "string", default: "2026-01" },

        SHOPIFY_STORE_DOMAIN: { type: "string", default: "" },
        SHOPIFY_ADMIN_TOKEN: { type: "string", default: "" },

        BILLING_TEST_MODE: { type: "boolean", default: true },
        BILLING_TRIAL_DAYS: { type: "number", default: 7 },

        BILLING_BYPASS: { type: "boolean", default: false },
        BILLING_BYPASS_PLAN: { type: "string", default: "pro" },

        PAYMENT_FEE_PERCENT: { type: "number", default: 0.029 },
        PAYMENT_FEE_FIXED: { type: "number", default: 0.3 },
        DEFAULT_SHIPPING_COST: { type: "number", default: 5 },
      },
    },
  });

  await app.register(cors, { origin: true, credentials: true });
  await app.register(helmet, {
    contentSecurityPolicy: false,
    frameguard: false,
  });

  app.get("/health", async () => {
    return { ok: true, service: "backend", ts: new Date().toISOString() };
  });

  await registerAppFrontendRoutes(app);
  await registerShopifyRoutes(app);

  app.get("/__debug/routes", async () => {
    // @ts-ignore
    return app.printRoutes();
  });

  await app.register(async (scoped) => {
    await scoped.register(rateLimit, { max: 200, timeWindow: "1 minute" });
  });

  return app;
}