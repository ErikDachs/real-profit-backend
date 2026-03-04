// src/integrations/shopify/webhooks.ts
import { createShopifyClient } from "./client.js";
import { isValidShopDomain, normalizeShopDomain } from "../../storage/shopsStore.js";

export type RegisterPcdWebhooksParams = {
  shop: string;
  accessToken: string;
  apiVersion: string; // e.g. "2024-01"
  appUrl: string; // e.g. "https://real-profit-backend.onrender.com"
};

type PcdTopic = "app/uninstalled" | "shop/redact" | "customers/redact" | "customers/data_request";

const PCD_TOPICS: PcdTopic[] = [
  "app/uninstalled",
  "customers/redact",
  "customers/data_request",
];

function stripTrailingSlash(s: string) {
  return String(s || "").replace(/\/$/, "");
}

function buildWebhookAddress(appUrl: string) {
  // Must match your route exactly.
  return `${stripTrailingSlash(appUrl)}/api/shopify/webhooks`;
}

function stableKey(topic: string, address: string) {
  return `${topic}@@${address}`;
}

function coerceArray(x: any): any[] {
  return Array.isArray(x) ? x : [];
}

function normalizeAddress(address: string): string {
  // Shopify stores the address as given, but normalize obvious slash variants.
  // We avoid over-normalizing (query strings etc.).
  return stripTrailingSlash(String(address || "").trim());
}

function normalizeTopic(topic: string): string {
  return String(topic || "").trim().toLowerCase();
}

function looksLikeAlreadyExistsError(e: any): boolean {
  const status = Number(e?.status);
  const msg = String(e?.message || "").toLowerCase();

  // Shopify can respond with 422 for duplicates.
  // We treat duplicates as success for idempotency.
  if (status === 422) return true;
  if (msg.includes("already been taken")) return true;
  if (msg.includes("has already been taken")) return true;
  return false;
}

export async function registerPcdWebhooks(params: RegisterPcdWebhooksParams): Promise<{
  ok: true;
  address: string;
  created: PcdTopic[];
  alreadyPresent: PcdTopic[];
}> {
  const shop = normalizeShopDomain(params.shop);
  if (!isValidShopDomain(shop)) {
    const err: any = new Error("Invalid shop domain");
    err.status = 400;
    throw err;
  }

  const accessToken = String(params.accessToken || "").trim();
  if (!accessToken) {
    const err: any = new Error("Missing accessToken");
    err.status = 400;
    throw err;
  }

  const apiVersion = String(params.apiVersion || "").trim();
  if (!apiVersion) {
    const err: any = new Error("Missing apiVersion");
    err.status = 400;
    throw err;
  }

  const address = buildWebhookAddress(params.appUrl);
  if (!/^https:\/\//i.test(address)) {
    // Ruthless guardrail: never register non-https webhook addresses.
    const err: any = new Error("APP_URL must be https in production");
    err.status = 400;
    throw err;
  }

  const shopify = createShopifyClient({ shopDomain: shop, accessToken });

  // 1) Fetch existing webhooks (idempotency without relying on error text).
  // Shopify REST: GET /admin/api/{version}/webhooks.json
  const existingRes = await shopify.get(`/admin/api/${apiVersion}/webhooks.json?limit=250`);
  const existing = coerceArray(existingRes?.webhooks);

  const existingKeys = new Set<string>();
  for (const w of existing) {
    const t = normalizeTopic(w?.topic);
    const a = normalizeAddress(w?.address);
    if (t && a) existingKeys.add(stableKey(t, a));
  }

  const created: PcdTopic[] = [];
  const alreadyPresent: PcdTopic[] = [];

  // 2) Create missing ones (duplicate-tolerant anyway).
  for (const topic of PCD_TOPICS) {
    const key = stableKey(topic, normalizeAddress(address));

    if (existingKeys.has(key)) {
      alreadyPresent.push(topic);
      continue;
    }

    try {
      await shopify.post(`/admin/api/${apiVersion}/webhooks.json`, {
        webhook: {
          topic,
          address,
          format: "json",
        },
      });
      created.push(topic);
      existingKeys.add(key);
    } catch (e: any) {
      if (looksLikeAlreadyExistsError(e)) {
        // Treat as success for idempotency.
        alreadyPresent.push(topic);
        existingKeys.add(key);
        continue;
      }
      // Hard fail: if webhook registration fails, you are NOT compliant-by-default.
      throw e;
    }
  }

  return { ok: true, address, created, alreadyPresent };
}