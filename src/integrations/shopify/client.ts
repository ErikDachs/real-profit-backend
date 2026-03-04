// src/integrations/shopify/client.ts
import fetch from "node-fetch";

export type ShopifyClient = {
  get: (path: string) => Promise<any>;
  post: (path: string, body: any) => Promise<any>;
};

type ShopifyApiError = Error & {
  status?: number;
  shopifyRequestId?: string;
  url?: string;
};

function safeSnippet(text: string, maxLen = 200): string {
  // Keep only a short snippet; strip newlines to avoid log spam.
  const s = String(text || "").replace(/\s+/g, " ").trim();
  return s.length > maxLen ? s.slice(0, maxLen) + "…" : s;
}

async function parseJsonOrNull(res: any): Promise<any | null> {
  // Shopify usually returns JSON, but errors may be HTML/plaintext.
  try {
    const text = await res.text();
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

    if (!res.ok) {
      // Phase 1/PCD: never throw full response bodies (can contain PII).
      const requestId = res.headers.get("x-request-id") || undefined;

      let bodySnippet: string | undefined;
      try {
        const text = await res.text();
        bodySnippet = safeSnippet(text);
      } catch {
        bodySnippet = undefined;
      }

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

    // Prefer JSON, but stay resilient.
    const json = await parseJsonOrNull(res);
    return json ?? {};
  }

  return {
    get(path: string) {
      return request("GET", path);
    },
    post(path: string, body: any) {
      return request("POST", path, body);
    },
  };
}