import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";
import crypto from "node:crypto";

const clearTokenMock = vi.fn();
const costModelClearMock = vi.fn();
const cogsClearAllMock = vi.fn();
const actionClearAllMock = vi.fn();
const dedupeHasMock = vi.fn();
const dedupePutMock = vi.fn();

vi.mock("../../storage/shopsStore.js", async () => {
  const actual = await vi.importActual<typeof import("../../storage/shopsStore.js")>(
    "../../storage/shopsStore.js"
  );

  class MockShopsStore {
    async clearToken(params: any) {
      return clearTokenMock(params);
    }
  }

  return {
    ...actual,
    ShopsStore: MockShopsStore,
  };
});

vi.mock("../../storage/costModelOverridesStore.js", () => {
  class MockCostModelOverridesStore {
    constructor(_: any) {}
    async clear() {
      return costModelClearMock();
    }
  }

  return { CostModelOverridesStore: MockCostModelOverridesStore };
});

vi.mock("../../storage/cogsOverridesStore.js", () => {
  class MockCogsOverridesStore {
    constructor(_: any) {}
    async clearAll() {
      return cogsClearAllMock();
    }
  }

  return { CogsOverridesStore: MockCogsOverridesStore };
});

vi.mock("../../storage/actionPlanStateStore.js", () => {
  class MockActionPlanStateStore {
    constructor(_: any) {}
    async clearAll() {
      return actionClearAllMock();
    }
  }

  return { ActionPlanStateStore: MockActionPlanStateStore };
});

vi.mock("../../storage/webhookDedupeStore.js", () => {
  class MockWebhookDedupeStore {
    constructor(_: any) {}
    async has(eventId: string) {
      return dedupeHasMock(eventId);
    }
    async put(eventId: string, ttlDays: number) {
      return dedupePutMock(eventId, ttlDays);
    }
  }

  return { WebhookDedupeStore: MockWebhookDedupeStore };
});

import {
  registerShopifyWebhooksRoutes,
  verifyWebhookHmac,
} from "./webhooks.route.js";

function signHmacBase64(secret: string, rawBody: Buffer) {
  return crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
}

async function buildApp() {
  const app = Fastify({ logger: false });
  await registerShopifyWebhooksRoutes(app);
  return app;
}

describe("webhooks.route branches", () => {
  const secret = "test_secret";
  const shop = "profit-engine-test.myshopify.com";
  const body = Buffer.from(JSON.stringify({ ok: true }), "utf8");

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SHOPIFY_API_SECRET = secret;
    process.env.DATA_DIR = "/tmp/test-data";

    dedupeHasMock.mockResolvedValue(false);
    dedupePutMock.mockResolvedValue(undefined);
    clearTokenMock.mockResolvedValue(undefined);
    costModelClearMock.mockResolvedValue(undefined);
    cogsClearAllMock.mockResolvedValue(undefined);
    actionClearAllMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    delete process.env.SHOPIFY_API_SECRET;
    delete process.env.DATA_DIR;
  });

  it("verifyWebhookHmac returns true for valid signature", () => {
    const hmac = signHmacBase64(secret, body);

    expect(
      verifyWebhookHmac({
        rawBody: body,
        hmacHeader: hmac,
        secret,
      })
    ).toBe(true);
  });

  it("verifyWebhookHmac returns false for invalid signature", () => {
    expect(
      verifyWebhookHmac({
        rawBody: body,
        hmacHeader: "invalid",
        secret,
      })
    ).toBe(false);
  });

  it("verifyWebhookHmac returns false when secret is missing", () => {
    const hmac = signHmacBase64(secret, body);

    expect(
      verifyWebhookHmac({
        rawBody: body,
        hmacHeader: hmac,
        secret: "",
      })
    ).toBe(false);
  });

  it("returns 401 when required headers are missing", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/shopify/webhooks",
      headers: {
        "content-type": "application/json",
      },
      payload: body,
    });

    expect(res.statusCode).toBe(401);
    expect(clearTokenMock).not.toHaveBeenCalled();
  });

  it("returns 200 noop for unsupported topic", async () => {
    const app = await buildApp();
    const hmac = signHmacBase64(secret, body);

    const res = await app.inject({
      method: "POST",
      url: "/api/shopify/webhooks",
      headers: {
        "content-type": "application/json",
        "x-shopify-topic": "orders/create",
        "x-shopify-shop-domain": shop,
        "x-shopify-hmac-sha256": hmac,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(clearTokenMock).not.toHaveBeenCalled();
    expect(dedupeHasMock).not.toHaveBeenCalled();
  });

  it("returns 401 for invalid HMAC on supported topic", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "POST",
      url: "/api/shopify/webhooks",
      headers: {
        "content-type": "application/json",
        "x-shopify-topic": "shop/redact",
        "x-shopify-shop-domain": shop,
        "x-shopify-hmac-sha256": "bad",
      },
      payload: body,
    });

    expect(res.statusCode).toBe(401);
    expect(clearTokenMock).not.toHaveBeenCalled();
  });

  it("returns 200 for invalid normalized shop after valid HMAC", async () => {
    const app = await buildApp();
    const hmac = signHmacBase64(secret, body);

    const res = await app.inject({
      method: "POST",
      url: "/api/shopify/webhooks",
      headers: {
        "content-type": "application/json",
        "x-shopify-topic": "shop/redact",
        "x-shopify-shop-domain": "evil.com",
        "x-shopify-hmac-sha256": hmac,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(clearTokenMock).not.toHaveBeenCalled();
  });

  it("returns 200 early when dedupe store reports already seen event", async () => {
    const app = await buildApp();
    const hmac = signHmacBase64(secret, body);
    dedupeHasMock.mockResolvedValue(true);

    const res = await app.inject({
      method: "POST",
      url: "/api/shopify/webhooks",
      headers: {
        "content-type": "application/json",
        "x-shopify-topic": "shop/redact",
        "x-shopify-shop-domain": shop,
        "x-shopify-hmac-sha256": hmac,
        "x-shopify-event-id": "evt_seen_1",
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(dedupeHasMock).toHaveBeenCalledWith("evt_seen_1");
    expect(dedupePutMock).not.toHaveBeenCalled();
    expect(clearTokenMock).not.toHaveBeenCalled();
  });

  it("fails open when dedupe store throws and still processes webhook", async () => {
    const app = await buildApp();
    const hmac = signHmacBase64(secret, body);
    dedupeHasMock.mockRejectedValue(new Error("dedupe down"));

    const res = await app.inject({
      method: "POST",
      url: "/api/shopify/webhooks",
      headers: {
        "content-type": "application/json",
        "x-shopify-topic": "app/uninstalled",
        "x-shopify-shop-domain": shop,
        "x-shopify-hmac-sha256": hmac,
        "x-shopify-event-id": "evt_2",
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(clearTokenMock).toHaveBeenCalledWith({
      shop,
      reason: "UNINSTALLED",
    });
    expect(costModelClearMock).toHaveBeenCalledTimes(1);
    expect(cogsClearAllMock).toHaveBeenCalledTimes(1);
    expect(actionClearAllMock).toHaveBeenCalledTimes(1);
  });

  it("stores unseen event id before processing", async () => {
    const app = await buildApp();
    const hmac = signHmacBase64(secret, body);

    const res = await app.inject({
      method: "POST",
      url: "/api/shopify/webhooks",
      headers: {
        "content-type": "application/json",
        "x-shopify-topic": "shop/redact",
        "x-shopify-shop-domain": shop,
        "x-shopify-hmac-sha256": hmac,
        "x-shopify-event-id": "evt_new_1",
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(dedupeHasMock).toHaveBeenCalledWith("evt_new_1");
    expect(dedupePutMock).toHaveBeenCalledWith("evt_new_1", 30);
    expect(clearTokenMock).toHaveBeenCalledWith({
      shop,
      reason: "UNINSTALLED",
    });
  });

  it("returns 500 when cleanup processing throws", async () => {
    const app = await buildApp();
    const hmac = signHmacBase64(secret, body);
    costModelClearMock.mockRejectedValue(new Error("disk failure"));

    const res = await app.inject({
      method: "POST",
      url: "/api/shopify/webhooks",
      headers: {
        "content-type": "application/json",
        "x-shopify-topic": "shop/redact",
        "x-shopify-shop-domain": shop,
        "x-shopify-hmac-sha256": hmac,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(500);
  });

  it("customers/data_request is ack-only and does not clear stores", async () => {
    const app = await buildApp();
    const hmac = signHmacBase64(secret, body);

    const res = await app.inject({
      method: "POST",
      url: "/api/shopify/webhooks",
      headers: {
        "content-type": "application/json",
        "x-shopify-topic": "customers/data_request",
        "x-shopify-shop-domain": shop,
        "x-shopify-hmac-sha256": hmac,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(clearTokenMock).not.toHaveBeenCalled();
    expect(costModelClearMock).not.toHaveBeenCalled();
    expect(cogsClearAllMock).not.toHaveBeenCalled();
    expect(actionClearAllMock).not.toHaveBeenCalled();
  });

  it("legacy /shop/redact path behaves like canonical endpoint", async () => {
    const app = await buildApp();
    const hmac = signHmacBase64(secret, body);

    const res = await app.inject({
      method: "POST",
      url: "/shop/redact",
      headers: {
        "content-type": "application/json",
        "x-shopify-topic": "shop/redact",
        "x-shopify-shop-domain": shop,
        "x-shopify-hmac-sha256": hmac,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(clearTokenMock).toHaveBeenCalledWith({
      shop,
      reason: "UNINSTALLED",
    });
  });

  it("returns 413 when webhook body exceeds max size", async () => {
    const app = await buildApp();
    const largeBody = Buffer.alloc(1024 * 1024 + 1, 1);
    const hmac = signHmacBase64(secret, largeBody);

    const res = await app.inject({
      method: "POST",
      url: "/api/shopify/webhooks",
      headers: {
        "content-type": "application/octet-stream",
        "x-shopify-topic": "shop/redact",
        "x-shopify-shop-domain": shop,
        "x-shopify-hmac-sha256": hmac,
      },
      payload: largeBody,
    });

    expect(res.statusCode).toBe(413);
  });
});