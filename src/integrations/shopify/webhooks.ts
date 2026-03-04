// src/integrations/shopify/webhooks.ts
import { createShopifyClient } from "./client.js";
import { isValidShopDomain, normalizeShopDomain } from "../../storage/shopsStore.js";

export type RegisterWebhooksAfterInstallParams = {
  shop: string;
  accessToken: string;
  apiVersion: string; // e.g. "2024-01"
  appUrl: string; // e.g. "https://real-profit-backend.onrender.com"
};

/**
 * Ruthless reality:
 * - Shopify REST /webhooks.json does NOT reliably allow subscribing to GDPR/PCD compliance topics
 *   like customers/redact, customers/data_request, shop/redact in all contexts.
 * - Your endpoint must handle them (you already do), but registration may be done via
 *   Shopify Partner Dashboard / app configuration / compliance setup.
 *
 * What we DO register via REST after install:
 * - app/uninstalled  (reliably supported)
 */
type AutoTopic = "app/uninstalled";

const AUTO_TOPICS: AutoTopic[] = ["app/uninstalled"];

function stripTrailingSlash(s: string) {
  return String(s || "").replace(/\/$/, "");
}

function buildWebhookAddress(appUrl: string) {
  return `${stripTrailingSlash(appUrl)}/api/shopify/webhooks`;
}

function stableKey(topic: string, address: string) {
  return `${topic}@@${address}`;
}

function coerceArray(x: any): any[] {
  return Array.isArray(x) ? x : [];
}

function normalizeAddress(address: string): string {
  return stripTrailingSlash(String(address || "").trim());
}

function normalizeTopic(topic: string): string {
  return String(topic || "").trim().toLowerCase();
}

function looksLikeAlreadyExistsError(e: any): boolean {
  const status = Number(e?.status);
  const msg = String(e?.message || "").toLowerCase();
  // Shopify can respond with 422 for duplicates.
  if (status === 422) return true;
  if (msg.includes("already been taken")) return true;
  if (msg.includes("has already been taken")) return true;
  return false;
}

export async function registerWebhooksAfterInstall(
  params: RegisterWebhooksAfterInstallParams
): Promise<{
  ok: true;
  address: string;
  created: AutoTopic[];
  alreadyPresent: AutoTopic[];
  skippedComplianceTopics: Array<"customers/data_request" | "customers/redact" | "shop/redact">;
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
    const err: any = new Error("APP_URL must be https in production");
    err.status = 400;
    throw err;
  }

  const shopify = createShopifyClient({ shopDomain: shop, accessToken });

  // Fetch existing (idempotent)
  const existingRes = await shopify.get(`/admin/api/${apiVersion}/webhooks.json?limit=250`);
  const existing = coerceArray(existingRes?.webhooks);

  const existingKeys = new Set<string>();
  for (const w of existing) {
    const t = normalizeTopic(w?.topic);
    const a = normalizeAddress(w?.address);
    if (t && a) existingKeys.add(stableKey(t, a));
  }

  const created: AutoTopic[] = [];
  const alreadyPresent: AutoTopic[] = [];

  for (const topic of AUTO_TOPICS) {
    const key = stableKey(topic, normalizeAddress(address));

    if (existingKeys.has(key)) {
      alreadyPresent.push(topic);
      continue;
    }

    try {
      await shopify.post(`/admin/api/${apiVersion}/webhooks.json`, {
        webhook: { topic, address, format: "json" },
      });
      created.push(topic);
      existingKeys.add(key);
    } catch (e: any) {
      if (looksLikeAlreadyExistsError(e)) {
        alreadyPresent.push(topic);
        existingKeys.add(key);
        continue;
      }
      throw e;
    }
  }

  return {
    ok: true,
    address,
    created,
    alreadyPresent,
    skippedComplianceTopics: ["customers/data_request", "customers/redact", "shop/redact"],
  };
}