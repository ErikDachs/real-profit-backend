// src/routes/shopify/oauth.route.contract.test.ts
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "../../app";
import fs from "node:fs/promises";
import path from "node:path";

describe("OAuth route contracts", () => {
  let app: any;
  const dataDir = path.join(process.cwd(), ".vitest-data");

  beforeAll(async () => {
    // clean
    await fs.rm(dataDir, { recursive: true, force: true });

    process.env.PORT = "3001";
    process.env.NODE_ENV = "test";

    // ✅ ensure shopsStore writes somewhere safe
    process.env.DATA_DIR = dataDir;

    // OAuth envs
    process.env.SHOPIFY_API_KEY = "test_key";
    process.env.SHOPIFY_API_SECRET = "test_secret";
    process.env.APP_URL = "http://localhost:3001";
    process.env.SHOPIFY_SCOPES = "read_orders,read_products";

    // legacy envs (optional)
    process.env.SHOPIFY_STORE_DOMAIN = "test-shop.myshopify.com";
    process.env.SHOPIFY_ADMIN_TOKEN = "test_token";

    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  it("GET /api/shopify/oauth/install redirects (302) for valid shop", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/shopify/oauth/install?shop=test-shop.myshopify.com",
    });

    expect(res.statusCode).toBe(302);
    const loc = res.headers["location"];
    expect(typeof loc).toBe("string");
    expect(loc).toContain("https://test-shop.myshopify.com/admin/oauth/authorize");
    expect(loc).toContain("client_id=test_key");
    expect(loc).toContain("scope=read_orders%2Cread_products");
    expect(loc).toContain("redirect_uri=http%3A%2F%2Flocalhost%3A3001%2Fapi%2Fshopify%2Foauth%2Fcallback");
    expect(loc).toContain("state=");
  });

  it("GET /api/shopify/oauth/install returns 400 for invalid shop", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/shopify/oauth/install?shop=evil.com",
    });

    expect(res.statusCode).toBe(400);
    const json = res.json();
    expect(json).toHaveProperty("error");
  });
});