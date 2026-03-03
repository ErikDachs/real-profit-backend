// src/types/fastify-env.d.ts
import "fastify";

declare module "fastify" {
  interface FastifyInstance {
    config: {
      PORT: number;
      NODE_ENV: string;

      // ✅ NEW
      DATA_DIR: string;

      // Variante C
      SHOPIFY_API_KEY: string;
      SHOPIFY_API_SECRET: string;
      APP_URL: string;
      SHOPIFY_SCOPES: string;

      // legacy single-shop (optional)
      SHOPIFY_STORE_DOMAIN: string;
      SHOPIFY_ADMIN_TOKEN: string;

      PAYMENT_FEE_PERCENT: number;
      PAYMENT_FEE_FIXED: number;
      DEFAULT_SHIPPING_COST: number;
    };
  }
}