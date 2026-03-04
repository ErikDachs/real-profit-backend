// src/integrations/shopify/client.ts
import fetch from "node-fetch";

export type ShopifyClient = {
  get: (path: string) => Promise<any>;
  post: (path: string, body: any) => Promise<any>;

  /**
   * GraphQL helper (Admin API)
   * - path should be: /admin/api/{version}/graphql.json
   * - returns data (throws if GraphQL errors present)
   */
  graphql: <T = any>(path: string, query: string, variables?: Record<string, any>) => Promise<T>;
};

type ShopifyApiError = Error & {
  status?: number;
  shopifyRequestId?: string;
  url?: string;
};

function safeSnippet(text: string, maxLen = 200): string {
  const s = String(text || "").replace(/\s+/g, " ").trim();
  return s.length > maxLen ? s.slice(0, maxLen) + "…" : s;
}

async function readTextSafe(res: any): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

async function parseJsonOrNullFromText(text: string): Promise<any | null> {
  try {
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function createShopifyClient(params: {
  shopDomain: string;
  accessToken: string;
}): ShopifyClient {
  const { shopDomain, accessToken } = params;

  async function request(method: "GET" | "POST", path: string, body?: any) {
    const url = `https://${shopDomain}${path}`;

    const res = await fetch(url, {
      method,
      headers: {
        "X-Shopify-Access-Token": accessToken,
        "Content-Type": "application/json",
      },
      body: method === "POST" ? JSON.stringify(body ?? {}) : undefined,
    });

    const text = await readTextSafe(res);

    if (!res.ok) {
      // Phase 1/PCD: never throw full response bodies (can contain PII).
      const requestId = res.headers.get("x-request-id") || undefined;
      const bodySnippet = text ? safeSnippet(text) : undefined;

      const msgParts = [
        `Shopify API error ${res.status}`,
        requestId ? `requestId=${requestId}` : null,
        bodySnippet ? `body=${bodySnippet}` : null,
      ].filter(Boolean);

      const err = new Error(msgParts.join(" | ")) as ShopifyApiError;
      err.status = res.status;
      err.shopifyRequestId = requestId;
      err.url = url;
      throw err;
    }

    const json = await parseJsonOrNullFromText(text);
    return json ?? {};
  }

  async function graphql<T = any>(path: string, query: string, variables?: Record<string, any>): Promise<T> {
    const payload = { query, variables: variables ?? {} };

    const json = await request("POST", path, payload);

    // Shopify GraphQL can return { data, errors }
    if (json?.errors && Array.isArray(json.errors) && json.errors.length > 0) {
      // Keep error payload small (no PII expected here, but stay safe)
      const snippet = safeSnippet(JSON.stringify(json.errors));
      const err = new Error(`Shopify GraphQL error | errors=${snippet}`) as ShopifyApiError;
      err.status = 502;
      err.url = `https://${shopDomain}${path}`;
      throw err;
    }

    return (json?.data ?? {}) as T;
  }

  return {
    get(path: string) {
      return request("GET", path);
    },
    post(path: string, body: any) {
      return request("POST", path, body);
    },
    graphql,
  };
}