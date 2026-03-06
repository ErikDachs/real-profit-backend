// src/integrations/shopify/webhooks.ts
import { createShopifyClient } from "./client.js";
import { isValidShopDomain, normalizeShopDomain } from "../../storage/shopsStore.js";
const AUTO_TOPICS = ["app/uninstalled"];
function stripTrailingSlash(s) {
    return String(s || "").replace(/\/$/, "");
}
function buildWebhookAddress(appUrl) {
    return `${stripTrailingSlash(appUrl)}/api/shopify/webhooks`;
}
function stableKey(topic, address) {
    return `${topic}@@${address}`;
}
function coerceArray(x) {
    return Array.isArray(x) ? x : [];
}
function normalizeAddress(address) {
    return stripTrailingSlash(String(address || "").trim());
}
function normalizeTopic(topic) {
    return String(topic || "").trim().toLowerCase();
}
function looksLikeAlreadyExistsError(e) {
    const status = Number(e?.status);
    const msg = String(e?.message || "").toLowerCase();
    // Shopify can respond with 422 for duplicates.
    if (status === 422)
        return true;
    if (msg.includes("already been taken"))
        return true;
    if (msg.includes("has already been taken"))
        return true;
    return false;
}
export async function registerWebhooksAfterInstall(params) {
    const shop = normalizeShopDomain(params.shop);
    if (!isValidShopDomain(shop)) {
        const err = new Error("Invalid shop domain");
        err.status = 400;
        throw err;
    }
    const accessToken = String(params.accessToken || "").trim();
    if (!accessToken) {
        const err = new Error("Missing accessToken");
        err.status = 400;
        throw err;
    }
    const apiVersion = String(params.apiVersion || "").trim();
    if (!apiVersion) {
        const err = new Error("Missing apiVersion");
        err.status = 400;
        throw err;
    }
    const address = buildWebhookAddress(params.appUrl);
    if (!/^https:\/\//i.test(address)) {
        const err = new Error("APP_URL must be https in production");
        err.status = 400;
        throw err;
    }
    const shopify = createShopifyClient({ shopDomain: shop, accessToken });
    // Fetch existing (idempotent)
    const existingRes = await shopify.get(`/admin/api/${apiVersion}/webhooks.json?limit=250`);
    const existing = coerceArray(existingRes?.webhooks);
    const existingKeys = new Set();
    for (const w of existing) {
        const t = normalizeTopic(w?.topic);
        const a = normalizeAddress(w?.address);
        if (t && a)
            existingKeys.add(stableKey(t, a));
    }
    const created = [];
    const alreadyPresent = [];
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
        }
        catch (e) {
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
