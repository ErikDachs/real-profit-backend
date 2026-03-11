import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";
import fetch from "node-fetch";

import {
  verifyShopifyQueryHmac,
  buildAuthorizeUrl,
  exchangeCodeForAccessToken,
  randomState,
  ShopifyOAuthError,
} from "./oauth.js";

vi.mock("node-fetch", () => ({
  default: vi.fn(),
}));

const mockedFetch = vi.mocked(fetch);

const API_SECRET = "test_secret";
const API_KEY = "test_key";

function buildHmac(query: Record<string, string>, secret: string): string {
  const message = Object.keys(query)
    .sort()
    .map((k) => `${k}=${query[k]}`)
    .join("&");

  return crypto.createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

describe("verifyShopifyQueryHmac", () => {
  it("returns true for valid HMAC", () => {
    const query: Record<string, string> = {
      shop: "test-shop.myshopify.com",
      timestamp: "123",
      state: "abc",
    };

    const hmac = buildHmac(query, API_SECRET);

    const result = verifyShopifyQueryHmac({
      query: { ...query, hmac },
      apiSecret: API_SECRET,
    });

    expect(result).toBe(true);
  });

  it("returns false if hmac is missing", () => {
    const result = verifyShopifyQueryHmac({
      query: { shop: "test-shop.myshopify.com" },
      apiSecret: API_SECRET,
    });

    expect(result).toBe(false);
  });

  it("ignores signature when calculating HMAC", () => {
    const queryWithSignature: Record<string, string> = {
      shop: "test-shop.myshopify.com",
      timestamp: "123",
      signature: "ignored",
    };

    const baseQuery: Record<string, string> = {
      shop: "test-shop.myshopify.com",
      timestamp: "123",
    };

    const hmac = buildHmac(baseQuery, API_SECRET);

    const result = verifyShopifyQueryHmac({
      query: { ...queryWithSignature, hmac },
      apiSecret: API_SECRET,
    });

    expect(result).toBe(true);
  });

  it("ignores null and undefined values", () => {
    const hmac = buildHmac(
      {
        shop: "test-shop.myshopify.com",
        timestamp: "123",
      },
      API_SECRET
    );

    const result = verifyShopifyQueryHmac({
      query: {
        shop: "test-shop.myshopify.com",
        timestamp: "123",
        state: undefined,
        host: null,
        hmac,
      },
      apiSecret: API_SECRET,
    });

    expect(result).toBe(true);
  });

  it("returns false when HMAC does not match", () => {
    const result = verifyShopifyQueryHmac({
      query: {
        shop: "test-shop.myshopify.com",
        timestamp: "123",
        hmac: "deadbeef",
      },
      apiSecret: API_SECRET,
    });

    expect(result).toBe(false);
  });
});

describe("buildAuthorizeUrl", () => {
  it("builds correct Shopify authorize URL", () => {
    const url = buildAuthorizeUrl({
      shop: "test-shop.myshopify.com",
      apiKey: API_KEY,
      scopes: "read_orders,read_products",
      redirectUri: "https://app.example.com/api/shopify/oauth/callback",
      state: "xyz123",
    });

    const parsed = new URL(url);

    expect(parsed.origin).toBe("https://test-shop.myshopify.com");
    expect(parsed.pathname).toBe("/admin/oauth/authorize");
    expect(parsed.searchParams.get("client_id")).toBe(API_KEY);
    expect(parsed.searchParams.get("scope")).toBe("read_orders,read_products");
    expect(parsed.searchParams.get("redirect_uri")).toBe(
      "https://app.example.com/api/shopify/oauth/callback"
    );
    expect(parsed.searchParams.get("state")).toBe("xyz123");
  });

  it("normalizes uppercase shop domain to lowercase", () => {
    const url = buildAuthorizeUrl({
      shop: "TEST-SHOP.MYSHOPIFY.COM",
      apiKey: API_KEY,
      scopes: "read_orders",
      redirectUri: "https://app.example.com/callback",
      state: "state123",
    });

    expect(url.startsWith("https://test-shop.myshopify.com/")).toBe(true);
  });

  it("throws INVALID_SHOP for invalid shop domain", () => {
    expect(() =>
      buildAuthorizeUrl({
        shop: "evil.com",
        apiKey: API_KEY,
        scopes: "read_orders",
        redirectUri: "https://app.example.com/callback",
        state: "xyz",
      })
    ).toThrow(ShopifyOAuthError);

    try {
      buildAuthorizeUrl({
        shop: "evil.com",
        apiKey: API_KEY,
        scopes: "read_orders",
        redirectUri: "https://app.example.com/callback",
        state: "xyz",
      });
    } catch (e) {
      expect(e).toBeInstanceOf(ShopifyOAuthError);
      expect((e as ShopifyOAuthError).code).toBe("INVALID_SHOP");
      expect((e as ShopifyOAuthError).status).toBe(400);
    }
  });
});

describe("exchangeCodeForAccessToken", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws INVALID_SHOP when shop domain is invalid", async () => {
    await expect(
      exchangeCodeForAccessToken({
        shop: "evil.com",
        apiKey: API_KEY,
        apiSecret: API_SECRET,
        code: "abc",
      })
    ).rejects.toMatchObject({
      code: "INVALID_SHOP",
      status: 400,
    });
  });

  it("throws MISSING_PARAM when code is empty", async () => {
    await expect(
      exchangeCodeForAccessToken({
        shop: "test-shop.myshopify.com",
        apiKey: API_KEY,
        apiSecret: API_SECRET,
        code: "",
      })
    ).rejects.toMatchObject({
      code: "MISSING_PARAM",
      status: 400,
    });
  });

  it("throws TOKEN_EXCHANGE_FAILED when Shopify returns non-200", async () => {
    mockedFetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => "bad request",
    } as any);

    await expect(
      exchangeCodeForAccessToken({
        shop: "test-shop.myshopify.com",
        apiKey: API_KEY,
        apiSecret: API_SECRET,
        code: "abc",
      })
    ).rejects.toMatchObject({
      code: "TOKEN_EXCHANGE_FAILED",
      status: 400,
    });

    expect(mockedFetch).toHaveBeenCalledTimes(1);
    expect(mockedFetch).toHaveBeenCalledWith(
      "https://test-shop.myshopify.com/admin/oauth/access_token",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: expect.stringContaining("client_id=test_key"),
      })
    );
  });

  it("throws TOKEN_EXCHANGE_FAILED when response is non-JSON", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      text: async () => "not-json",
    } as any);

    await expect(
      exchangeCodeForAccessToken({
        shop: "test-shop.myshopify.com",
        apiKey: API_KEY,
        apiSecret: API_SECRET,
        code: "abc",
      })
    ).rejects.toMatchObject({
      code: "TOKEN_EXCHANGE_FAILED",
      status: 502,
    });
  });

  it("throws TOKEN_EXCHANGE_FAILED when access_token is missing", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ scope: "read_orders" }),
    } as any);

    await expect(
      exchangeCodeForAccessToken({
        shop: "test-shop.myshopify.com",
        apiKey: API_KEY,
        apiSecret: API_SECRET,
        code: "abc",
      })
    ).rejects.toMatchObject({
      code: "TOKEN_EXCHANGE_FAILED",
      status: 502,
    });
  });

  it("returns access token and optional scope on success", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          access_token: "token123",
          scope: "read_orders,read_products",
        }),
    } as any);

    const result = await exchangeCodeForAccessToken({
      shop: "test-shop.myshopify.com",
      apiKey: API_KEY,
      apiSecret: API_SECRET,
      code: "abc",
    });

    expect(result).toEqual({
      access_token: "token123",
      scope: "read_orders,read_products",
    });
  });

  it("returns access token with undefined scope when scope is absent", async () => {
    mockedFetch.mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          access_token: "token123",
        }),
    } as any);

    const result = await exchangeCodeForAccessToken({
      shop: "test-shop.myshopify.com",
      apiKey: API_KEY,
      apiSecret: API_SECRET,
      code: "abc",
    });

    expect(result).toEqual({
      access_token: "token123",
      scope: undefined,
    });
  });
});

describe("randomState", () => {
  it("returns a hex string of expected default length", () => {
    const state = randomState();

    expect(state).toMatch(/^[a-f0-9]+$/);
    expect(state.length).toBe(48);
  });

  it("respects custom byte length", () => {
    const state = randomState(8);
    expect(state).toMatch(/^[a-f0-9]+$/);
    expect(state.length).toBe(16);
  });

  it("returns different values across calls", () => {
    const a = randomState();
    const b = randomState();

    expect(a).not.toBe(b);
  });
});