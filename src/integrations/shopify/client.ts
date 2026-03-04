// src/integrations/shopify/client.ts
import fetch from "node-fetch";

export type ShopifyClient = {
  get: (path: string) => Promise<any>;
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

export function createShopifyClient(params: {
  shopDomain: string;
  accessToken: string;
}): ShopifyClient {
  const { shopDomain, accessToken } = params;

  return {
    async get(path: string) {
      const url = `https://${shopDomain}${path}`;
      const res = await fetch(url, {
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
      });

      if (!res.ok) {
        // Phase 1: never throw full response bodies (can contain PII).
        const requestId = res.headers.get("x-request-id") || undefined;

        // Read body only to extract a small snippet for debugging,
        // but keep it short and non-PII-ish. If parsing fails, ignore.
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

      return res.json() as Promise<any>;
    },
  };
}