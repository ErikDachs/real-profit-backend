// src/integrations/shopify/oauth.ts
import crypto from "node:crypto";
import fetch from "node-fetch";
import { isValidShopDomain } from "../../storage/shopsStore";

export class ShopifyOAuthError extends Error {
  constructor(
    message: string,
    public code: "INVALID_SHOP" | "HMAC_INVALID" | "MISSING_PARAM" | "TOKEN_EXCHANGE_FAILED",
    public status: number
  ) {
    super(message);
  }
}

function timingSafeEqualStr(a: string, b: string) {
  const aa = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (aa.length !== bb.length) return false;
  return crypto.timingSafeEqual(aa, bb);
}

/**
 * Shopify OAuth HMAC verification for query params:
 * - remove `hmac` and `signature`
 * - sort keys alpha
 * - join `k=v` with &
 * - compute HMAC-SHA256 hex using client secret
 */
export function verifyShopifyQueryHmac(params: {
  query: Record<string, any>;
  apiSecret: string;
}): boolean {
  const { query, apiSecret } = params;
  const hmac = String(query?.hmac ?? "");
  if (!hmac) return false;

  const filtered: Record<string, string> = {};
  for (const [k, v] of Object.entries(query ?? {})) {
    if (k === "hmac" || k === "signature") continue;
    if (v === undefined || v === null) continue;
    filtered[k] = String(v);
  }

  const message = Object.keys(filtered)
    .sort()
    .map((k) => `${k}=${filtered[k]}`)
    .join("&");

  const digest = crypto.createHmac("sha256", apiSecret).update(message, "utf8").digest("hex");
  return timingSafeEqualStr(digest, hmac);
}

export function buildAuthorizeUrl(params: {
  shop: string;
  apiKey: string;
  scopes: string; // comma-separated
  redirectUri: string;
  state: string;
}): string {
  const shop = String(params.shop || "").trim().toLowerCase();
  if (!isValidShopDomain(shop)) {
    throw new ShopifyOAuthError("Invalid shop domain", "INVALID_SHOP", 400);
  }

  const qs = new URLSearchParams();
  qs.set("client_id", params.apiKey);
  qs.set("scope", params.scopes);
  qs.set("redirect_uri", params.redirectUri);
  qs.set("state", params.state);

  // offline token (default). If you later want online tokens:
  // qs.append("grant_options[]", "per-user");

  return `https://${shop}/admin/oauth/authorize?${qs.toString()}`;
}

export async function exchangeCodeForAccessToken(params: {
  shop: string;
  apiKey: string;
  apiSecret: string;
  code: string;
}): Promise<{ access_token: string; scope?: string }> {
  const shop = String(params.shop || "").trim().toLowerCase();
  if (!isValidShopDomain(shop)) throw new ShopifyOAuthError("Invalid shop domain", "INVALID_SHOP", 400);

  const code = String(params.code || "").trim();
  if (!code) throw new ShopifyOAuthError("Missing code", "MISSING_PARAM", 400);

  const url = `https://${shop}/admin/oauth/access_token`;

  // Use x-www-form-urlencoded for maximum compatibility
  const body = new URLSearchParams();
  body.set("client_id", params.apiKey);
  body.set("client_secret", params.apiSecret);
  body.set("code", code);

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new ShopifyOAuthError(
      `Token exchange failed (${res.status}): ${text}`,
      "TOKEN_EXCHANGE_FAILED",
      res.status
    );
  }

  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ShopifyOAuthError("Token exchange returned non-JSON", "TOKEN_EXCHANGE_FAILED", 502);
  }

  const token = String(json?.access_token ?? "").trim();
  if (!token) throw new ShopifyOAuthError("Missing access_token in response", "TOKEN_EXCHANGE_FAILED", 502);

  return { access_token: token, scope: json?.scope ? String(json.scope) : undefined };
}

export function randomState(bytes = 24): string {
  return crypto.randomBytes(bytes).toString("hex");
}