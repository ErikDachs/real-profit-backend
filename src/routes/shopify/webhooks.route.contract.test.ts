// src/routes/shopify/webhooks.route.contract.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Fastify from "fastify";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { registerShopifyWebhooksRoutes } from "./webhooks.route.js";
import { ShopsStore } from "../../storage/shopsStore.js";
import { CostModelOverridesStore } from "../../storage/costModelOverridesStore.js";
import { CogsOverridesStore } from "../../storage/cogsOverridesStore.js";
import { ActionPlanStateStore } from "../../storage/actionPlanStateStore.js";

function signHmacBase64(secret: string, rawBody: Buffer) {
  return crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
}

async function fileExists(fp: string): Promise<boolean> {
  try {
    await fs.stat(fp);
    return true;
  } catch {
    return false;
  }
}

describe("Shopify Phase-2 webhooks (PCD) – contract", () => {
  const secret = "test_secret";
  const shop = "profit-engine-test.myshopify.com";
  const body = Buffer.from(JSON.stringify({ test: true }), "utf8");

  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "real-profit-webhooks-"));
    process.env.DATA_DIR = tmpDir;
    process.env.SHOPIFY_API_SECRET = secret;

    // Seed stores with data
    const shopsStore = new ShopsStore({ dataDir: tmpDir });
    await shopsStore.upsertToken({ shop, accessToken: "TOKEN_123", scope: "read_orders" });

    const cm = new CostModelOverridesStore({ shop, dataDir: tmpDir });
    await cm.setOverrides({} as any);

    const cogs = new CogsOverridesStore({ shop, dataDir: tmpDir });
    await cogs.upsert({ variantId: 123, unitCost: 9.99, ignoreCogs: false });

    const action = new ActionPlanStateStore({ shop, dataDir: tmpDir });
    await action.upsert({ actionId: "A1", status: "OPEN", note: "hello" });
  });

  afterEach(async () => {
    // cleanup
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    delete process.env.DATA_DIR;
    delete process.env.SHOPIFY_API_SECRET;
  });

  async function buildApp() {
    const app = Fastify({ logger: false });
    await registerShopifyWebhooksRoutes(app);
    return app;
  }

  it("401 on invalid HMAC", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/shopify/webhooks",
      headers: {
        "content-type": "application/json",
        "x-shopify-topic": "shop/redact",
        "x-shopify-shop-domain": shop,
        "x-shopify-hmac-sha256": "invalid",
      },
      payload: body,
    });

    expect(res.statusCode).toBe(401);

    // Files should still exist
    expect(await fileExists(path.join(tmpDir, `costModelOverrides.${shop}.json`))).toBe(true);
    expect(await fileExists(path.join(tmpDir, `cogsOverrides.${shop}.json`))).toBe(true);
    expect(await fileExists(path.join(tmpDir, `actionPlanState.${shop}.json`))).toBe(true);
  });

  it("shop/redact deletes shop-scoped data (idempotent) and tombstones token", async () => {
    const app = await buildApp();

    const hmac = signHmacBase64(secret, body);

    const headers = {
      "content-type": "application/json",
      "x-shopify-topic": "shop/redact",
      "x-shopify-shop-domain": shop,
      "x-shopify-hmac-sha256": hmac,
      "x-shopify-event-id": "evt_abc_123",
    };

    const res1 = await app.inject({
      method: "POST",
      url: "/api/shopify/webhooks",
      headers,
      payload: body,
    });

    expect(res1.statusCode).toBe(200);

    // Files deleted
    expect(await fileExists(path.join(tmpDir, `costModelOverrides.${shop}.json`))).toBe(false);
    expect(await fileExists(path.join(tmpDir, `cogsOverrides.${shop}.json`))).toBe(false);
    expect(await fileExists(path.join(tmpDir, `actionPlanState.${shop}.json`))).toBe(false);

    // Token tombstoned
    const shopsStore = new ShopsStore({ dataDir: tmpDir });
    const rec = await shopsStore.get(shop);
    expect(rec?.accessToken ?? null).toBe(null);

    // Second call (duplicate) must be 200 and must not crash
    const res2 = await app.inject({
      method: "POST",
      url: "/api/shopify/webhooks",
      headers,
      payload: body,
    });

    expect(res2.statusCode).toBe(200);
  });

  it("app/uninstalled deletes shop-scoped data (idempotent)", async () => {
    const app = await buildApp();

    const hmac = signHmacBase64(secret, body);

    const headers = {
      "content-type": "application/json",
      "x-shopify-topic": "app/uninstalled",
      "x-shopify-shop-domain": shop,
      "x-shopify-hmac-sha256": hmac,
    };

    const res = await app.inject({
      method: "POST",
      url: "/api/shopify/webhooks",
      headers,
      payload: body,
    });

    expect(res.statusCode).toBe(200);

    expect(await fileExists(path.join(tmpDir, `costModelOverrides.${shop}.json`))).toBe(false);
    expect(await fileExists(path.join(tmpDir, `cogsOverrides.${shop}.json`))).toBe(false);
    expect(await fileExists(path.join(tmpDir, `actionPlanState.${shop}.json`))).toBe(false);

    const shopsStore = new ShopsStore({ dataDir: tmpDir });
    const rec = await shopsStore.get(shop);
    expect(rec?.accessToken ?? null).toBe(null);
  });

  it("customers/redact is ack-only (no store deletion)", async () => {
    const app = await buildApp();

    const hmac = signHmacBase64(secret, body);

    const res = await app.inject({
      method: "POST",
      url: "/api/shopify/webhooks",
      headers: {
        "content-type": "application/json",
        "x-shopify-topic": "customers/redact",
        "x-shopify-shop-domain": shop,
        "x-shopify-hmac-sha256": hmac,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);

    // Should still exist (you don't store customer PII; don't delete whole shop state on customers/redact)
    expect(await fileExists(path.join(tmpDir, `costModelOverrides.${shop}.json`))).toBe(true);
    expect(await fileExists(path.join(tmpDir, `cogsOverrides.${shop}.json`))).toBe(true);
    expect(await fileExists(path.join(tmpDir, `actionPlanState.${shop}.json`))).toBe(true);
  });
});