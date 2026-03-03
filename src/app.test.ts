import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { buildApp } from "./app.js";

describe("app contracts", () => {
  let app: any;

  beforeAll(async () => {
    // Env required by @fastify/env (auch in tests)
    process.env.PORT = "3001";
    process.env.SHOPIFY_STORE_DOMAIN = "example.myshopify.com";
    process.env.SHOPIFY_ADMIN_TOKEN = "test_token";

    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
  });

  it("GET /health returns ok=true", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);

    const json = res.json();
    expect(json.ok).toBe(true);
    expect(json.service).toBe("backend");
    expect(typeof json.ts).toBe("string");
  });
});
