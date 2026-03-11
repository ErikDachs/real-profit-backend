import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

const {
  verifyHmacMock,
  exchangeTokenMock,
  buildAuthUrlMock,
  randomStateMock,
  registerWebhooksAfterInstallMock,
  ensureLoadedMock,
  setPendingOAuthStateMock,
  consumePendingOAuthStateMock,
  upsertTokenMock,
  listMaskedMock,
} = vi.hoisted(() => ({
  verifyHmacMock: vi.fn(),
  exchangeTokenMock: vi.fn(),
  buildAuthUrlMock: vi.fn(),
  randomStateMock: vi.fn(),
  registerWebhooksAfterInstallMock: vi.fn(),
  ensureLoadedMock: vi.fn(),
  setPendingOAuthStateMock: vi.fn(),
  consumePendingOAuthStateMock: vi.fn(),
  upsertTokenMock: vi.fn(),
  listMaskedMock: vi.fn(),
}));

vi.mock("../../integrations/shopify/oauth.js", async () => {
  const actual = await vi.importActual<typeof import("../../integrations/shopify/oauth.js")>(
    "../../integrations/shopify/oauth.js"
  );

  return {
    ...actual,
    verifyShopifyQueryHmac: verifyHmacMock,
    exchangeCodeForAccessToken: exchangeTokenMock,
    buildAuthorizeUrl: buildAuthUrlMock,
    randomState: randomStateMock,
  };
});

vi.mock("../../integrations/shopify/webhooks.js", () => ({
  registerWebhooksAfterInstall: registerWebhooksAfterInstallMock,
}));

vi.mock("../../storage/shopsStore.js", async () => {
  const actual = await vi.importActual<typeof import("../../storage/shopsStore.js")>(
    "../../storage/shopsStore.js"
  );

  class MockShopsStore {
    async ensureLoaded() {
      return ensureLoadedMock();
    }

    async setPendingOAuthState(params: any) {
      return setPendingOAuthStateMock(params);
    }

    async consumePendingOAuthState(params: any) {
      return consumePendingOAuthStateMock(params);
    }

    async upsertToken(params: any) {
      return upsertTokenMock(params);
    }

    async listMasked() {
      return listMaskedMock();
    }
  }

  return {
    ...actual,
    ShopsStore: MockShopsStore,
  };
});

import { registerShopifyOAuthRoutes } from "./oauth.route.js";
import { ShopsStoreError } from "../../storage/shopsStore.js";

async function buildApp() {
  const app = Fastify({ logger: false });

  (app as any).config = {
    DATA_DIR: "/tmp/test-data",
    SHOPIFY_API_KEY: "test_key",
    SHOPIFY_API_SECRET: "test_secret",
    SHOPIFY_SCOPES: "read_orders,read_products",
    APP_URL: "https://example.com",
  };

  await registerShopifyOAuthRoutes(app);
  return app;
}

describe("shopify oauth route", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    randomStateMock.mockReturnValue("state123");
    buildAuthUrlMock.mockReturnValue("https://shopify.example/authorize");
    verifyHmacMock.mockReturnValue(true);

    ensureLoadedMock.mockResolvedValue(undefined);
    setPendingOAuthStateMock.mockResolvedValue(undefined);
    consumePendingOAuthStateMock.mockResolvedValue(undefined);
    upsertTokenMock.mockResolvedValue(undefined);
    listMaskedMock.mockResolvedValue([]);

    exchangeTokenMock.mockResolvedValue({
      access_token: "token123",
      scope: "read_orders,read_products",
    });

    registerWebhooksAfterInstallMock.mockResolvedValue({
      ok: true,
      address: "https://example.com/api/shopify/webhooks",
      created: ["app/uninstalled"],
      alreadyPresent: [],
      skippedComplianceTopics: ["customers/data_request", "customers/redact", "shop/redact"],
    });
  });

  it("redirects install to authorize url for valid shop", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/api/shopify/oauth/install?shop=test-shop.myshopify.com",
    });

    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("https://shopify.example/authorize");

    expect(setPendingOAuthStateMock).toHaveBeenCalledWith({
      shop: "test-shop.myshopify.com",
      state: "state123",
      ttlSeconds: 10 * 60,
    });

    expect(buildAuthUrlMock).toHaveBeenCalledWith({
      shop: "test-shop.myshopify.com",
      apiKey: "test_key",
      scopes: "read_orders,read_products",
      redirectUri: "https://example.com/api/shopify/oauth/callback",
      state: "state123",
    });
  });

  it("returns 400 for invalid install shop", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/api/shopify/oauth/install?shop=evil.com",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: "Invalid shop domain",
      code: "INVALID_SHOP",
    });

    expect(setPendingOAuthStateMock).not.toHaveBeenCalled();
    expect(buildAuthUrlMock).not.toHaveBeenCalled();
  });

  it("returns 401 on install when optional hmac is present but invalid", async () => {
    const app = await buildApp();
    verifyHmacMock.mockReturnValue(false);

    const res = await app.inject({
      method: "GET",
      url: "/api/shopify/oauth/install?shop=test-shop.myshopify.com&hmac=bad&timestamp=123",
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: "Invalid HMAC",
      code: "HMAC_INVALID",
    });

    expect(setPendingOAuthStateMock).not.toHaveBeenCalled();
  });

  it("returns 400 on callback when code is missing", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/api/shopify/oauth/callback?shop=test-shop.myshopify.com&state=state123&hmac=abc",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: "Missing code",
      code: "MISSING_PARAM",
    });

    expect(exchangeTokenMock).not.toHaveBeenCalled();
  });

  it("returns 400 on callback when state is missing", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/api/shopify/oauth/callback?shop=test-shop.myshopify.com&code=abc&hmac=good",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: "Missing state",
      code: "MISSING_PARAM",
    });

    expect(exchangeTokenMock).not.toHaveBeenCalled();
  });

  it("returns 401 on callback when hmac is invalid", async () => {
    const app = await buildApp();
    verifyHmacMock.mockReturnValue(false);

    const res = await app.inject({
      method: "GET",
      url: "/api/shopify/oauth/callback?shop=test-shop.myshopify.com&code=abc&state=state123&hmac=bad",
    });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: "Invalid HMAC",
      code: "HMAC_INVALID",
    });

    expect(consumePendingOAuthStateMock).not.toHaveBeenCalled();
    expect(exchangeTokenMock).not.toHaveBeenCalled();
  });

  it("completes callback flow successfully", async () => {
    const app = await buildApp();

    const res = await app.inject({
      method: "GET",
      url: "/api/shopify/oauth/callback?shop=test-shop.myshopify.com&code=abc123&state=state123&hmac=good",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      shop: "test-shop.myshopify.com",
      scope: "read_orders,read_products",
      webhooks: {
        ok: true,
        address: "https://example.com/api/shopify/webhooks",
        created: ["app/uninstalled"],
        alreadyPresent: [],
        skippedComplianceTopics: ["customers/data_request", "customers/redact", "shop/redact"],
      },
      next: "/api/orders/profit?shop=test-shop.myshopify.com&days=30",
    });

    expect(consumePendingOAuthStateMock).toHaveBeenCalledWith({
      shop: "test-shop.myshopify.com",
      state: "state123",
    });

    expect(exchangeTokenMock).toHaveBeenCalledWith({
      shop: "test-shop.myshopify.com",
      apiKey: "test_key",
      apiSecret: "test_secret",
      code: "abc123",
    });

    expect(upsertTokenMock).toHaveBeenCalledWith({
      shop: "test-shop.myshopify.com",
      accessToken: "token123",
      scope: "read_orders,read_products",
    });

    expect(registerWebhooksAfterInstallMock).toHaveBeenCalledWith({
      shop: "test-shop.myshopify.com",
      accessToken: "token123",
      apiVersion: "2024-01",
      appUrl: "https://example.com",
    });
  });

  it("returns mapped ShopsStoreError from callback", async () => {
    const app = await buildApp();

    consumePendingOAuthStateMock.mockRejectedValue(
      new ShopsStoreError("OAuth state mismatch", "STATE_MISMATCH", 400)
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/shopify/oauth/callback?shop=test-shop.myshopify.com&code=abc123&state=wrong&hmac=good",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: "OAuth state mismatch",
      code: "STATE_MISMATCH",
    });

    expect(exchangeTokenMock).not.toHaveBeenCalled();
  });

  it("returns 500 when token exchange fails with generic error", async () => {
    const app = await buildApp();
    exchangeTokenMock.mockRejectedValue(new Error("shopify down"));

    const res = await app.inject({
      method: "GET",
      url: "/api/shopify/oauth/callback?shop=test-shop.myshopify.com&code=abc123&state=state123&hmac=good",
    });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      error: "shopify down",
      code: "UNKNOWN",
    });
  });

  it("returns debug shops list", async () => {
    const app = await buildApp();

    listMaskedMock.mockResolvedValue([
      {
        shop: "test-shop.myshopify.com",
        scope: "read_orders",
        installedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        uninstalledAt: null,
        accessTokenMasked: "tok…1234",
      },
    ]);

    const res = await app.inject({
      method: "GET",
      url: "/api/shopify/debug/shops",
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      ok: true,
      count: 1,
      shops: [
        {
          shop: "test-shop.myshopify.com",
          scope: "read_orders",
          installedAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          uninstalledAt: null,
          accessTokenMasked: "tok…1234",
        },
      ],
    });
  });
});