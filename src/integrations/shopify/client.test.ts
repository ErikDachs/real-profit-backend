import { beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.fn();

vi.mock("node-fetch", () => {
  return {
    default: (...args: any[]) => fetchMock(...args),
  };
});

import { createShopifyClient } from "./client.js";

function makeResponse(params: {
  ok: boolean;
  status: number;
  text?: string;
  requestId?: string | null;
  textThrows?: boolean;
}) {
  return {
    ok: params.ok,
    status: params.status,
    headers: {
      get: (key: string) => {
        if (key.toLowerCase() === "x-request-id") return params.requestId ?? null;
        return null;
      },
    },
    text: params.textThrows
      ? vi.fn(async () => {
          throw new Error("text failed");
        })
      : vi.fn(async () => params.text ?? ""),
  };
}

describe("createShopifyClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET returns parsed JSON on success", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        ok: true,
        status: 200,
        text: JSON.stringify({ ok: true, value: 123 }),
      })
    );

    const client = createShopifyClient({
      shopDomain: "test-shop.myshopify.com",
      accessToken: "token_123",
    });

    const out = await client.get("/admin/api/2024-01/orders.json");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://test-shop.myshopify.com/admin/api/2024-01/orders.json",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          "X-Shopify-Access-Token": "token_123",
          "Content-Type": "application/json",
        }),
      })
    );

    expect(out).toEqual({ ok: true, value: 123 });
  });

  it("POST returns empty object when body is not valid JSON", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        ok: true,
        status: 200,
        text: "not-json",
      })
    );

    const client = createShopifyClient({
      shopDomain: "test-shop.myshopify.com",
      accessToken: "token_123",
    });

    const out = await client.post("/admin/api/2024-01/test.json", { a: 1 });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://test-shop.myshopify.com/admin/api/2024-01/test.json",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ a: 1 }),
      })
    );

    expect(out).toEqual({});
  });

  it("throws structured error for non-ok response and includes request id + snippet", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        ok: false,
        status: 401,
        requestId: "req-401",
        text: '{"error":"unauthorized"}',
      })
    );

    const client = createShopifyClient({
      shopDomain: "test-shop.myshopify.com",
      accessToken: "bad_token",
    });

    await expect(client.get("/admin/api/2024-01/orders.json")).rejects.toMatchObject({
      status: 401,
      shopifyRequestId: "req-401",
      url: "https://test-shop.myshopify.com/admin/api/2024-01/orders.json",
    });
  });

  it("still throws structured error when response text cannot be read", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        ok: false,
        status: 429,
        requestId: "req-429",
        textThrows: true,
      })
    );

    const client = createShopifyClient({
      shopDomain: "test-shop.myshopify.com",
      accessToken: "token_123",
    });

    await expect(client.get("/admin/api/2024-01/orders.json")).rejects.toMatchObject({
      status: 429,
      shopifyRequestId: "req-429",
      url: "https://test-shop.myshopify.com/admin/api/2024-01/orders.json",
    });
  });

  it("graphql returns data when response contains data and no errors", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        ok: true,
        status: 200,
        text: JSON.stringify({
          data: {
            orders: {
              edges: [],
            },
          },
        }),
      })
    );

    const client = createShopifyClient({
      shopDomain: "test-shop.myshopify.com",
      accessToken: "token_123",
    });

    const out = await client.graphql(
      "/admin/api/2024-01/graphql.json",
      "query Test { shop { id } }",
      { x: 1 }
    );

    expect(out).toEqual({
      orders: {
        edges: [],
      },
    });
  });

  it("graphql throws 403 with PCD code when Shopify blocks protected customer data", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        ok: true,
        status: 200,
        text: JSON.stringify({
          errors: [
            {
              message:
                "This app is not approved to access the Order object. See https://shopify.dev/docs/apps/launch/protected-customer-data for protected customer data requirements.",
            },
          ],
        }),
      })
    );

    const client = createShopifyClient({
      shopDomain: "test-shop.myshopify.com",
      accessToken: "token_123",
    });

    await expect(
      client.graphql("/admin/api/2024-01/graphql.json", "query Test { orders { edges { node { id } } } }")
    ).rejects.toMatchObject({
      status: 403,
      code: "SHOPIFY_PCD_NOT_APPROVED",
      url: "https://test-shop.myshopify.com/admin/api/2024-01/graphql.json",
    });
  });

  it("graphql throws 502 with generic graphql error code for non-PCD graphql errors", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        ok: true,
        status: 200,
        text: JSON.stringify({
          errors: [
            {
              message: "Field 'foo' doesn't exist on type 'Order'",
            },
          ],
        }),
      })
    );

    const client = createShopifyClient({
      shopDomain: "test-shop.myshopify.com",
      accessToken: "token_123",
    });

    await expect(
      client.graphql("/admin/api/2024-01/graphql.json", "query Test { orders { foo } }")
    ).rejects.toMatchObject({
      status: 502,
      code: "SHOPIFY_GRAPHQL_ERROR",
      url: "https://test-shop.myshopify.com/admin/api/2024-01/graphql.json",
    });
  });

  it("graphql returns empty object when success response has no data field", async () => {
    fetchMock.mockResolvedValueOnce(
      makeResponse({
        ok: true,
        status: 200,
        text: JSON.stringify({}),
      })
    );

    const client = createShopifyClient({
      shopDomain: "test-shop.myshopify.com",
      accessToken: "token_123",
    });

    const out = await client.graphql("/admin/api/2024-01/graphql.json", "query Test { shop { id } }");

    expect(out).toEqual({});
  });
});