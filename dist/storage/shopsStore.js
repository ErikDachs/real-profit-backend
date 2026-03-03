// src/storage/shopsStore.ts
import fs from "node:fs/promises";
import path from "node:path";
export class ShopsStoreError extends Error {
    code;
    status;
    constructor(message, code, status) {
        super(message);
        this.code = code;
        this.status = status;
    }
}
export function isValidShopDomain(shop) {
    if (!shop || typeof shop !== "string")
        return false;
    const s = shop.trim().toLowerCase();
    // Shopify shop domain format: <subdomain>.myshopify.com
    // keep it strict to avoid SSRF / weird hosts.
    // Subdomain: letters/numbers/hyphen, must start/end with alnum.
    return /^[a-z0-9][a-z0-9-]*[a-z0-9]\.myshopify\.com$/.test(s) || /^[a-z0-9]\.myshopify\.com$/.test(s);
}
function nowIso() {
    return new Date().toISOString();
}
function clampStr(x, max = 4000) {
    if (x === undefined || x === null)
        return null;
    const s = String(x).trim();
    if (!s)
        return null;
    return s.length > max ? s.slice(0, max) : s;
}
export class ShopsStore {
    params;
    loaded = false;
    file = null;
    constructor(params) {
        this.params = params;
    }
    filePath() {
        if (this.params?.filePath)
            return this.params.filePath;
        const dir = this.params?.dataDir ?? path.join(process.cwd(), "data");
        return path.join(dir, "shops.json");
    }
    async ensureLoaded() {
        if (this.loaded)
            return;
        this.loaded = true;
        try {
            const raw = await fs.readFile(this.filePath(), "utf-8");
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== "object" || parsed.version !== 1) {
                this.file = null;
                return;
            }
            const shopsRaw = parsed.shops && typeof parsed.shops === "object" ? parsed.shops : {};
            const shops = {};
            for (const [shop, rec] of Object.entries(shopsRaw)) {
                if (!isValidShopDomain(shop))
                    continue;
                const r = rec ?? {};
                shops[shop] = {
                    accessToken: clampStr(r.accessToken, 8000),
                    scope: clampStr(r.scope, 2000),
                    installedAt: clampStr(r.installedAt, 100) ?? null,
                    updatedAt: clampStr(r.updatedAt, 100) ?? nowIso(),
                    uninstalledAt: clampStr(r.uninstalledAt, 100) ?? null,
                    pendingOAuth: r.pendingOAuth
                        ? {
                            state: String(r.pendingOAuth?.state ?? ""),
                            expiresAt: String(r.pendingOAuth?.expiresAt ?? ""),
                        }
                        : null,
                };
            }
            this.file = {
                version: 1,
                updatedAt: String(parsed.updatedAt ?? nowIso()),
                shops,
            };
        }
        catch {
            this.file = null;
        }
    }
    async persist() {
        const fp = this.filePath();
        await fs.mkdir(path.dirname(fp), { recursive: true });
        const payload = this.file ?? {
            version: 1,
            updatedAt: nowIso(),
            shops: {},
        };
        payload.updatedAt = nowIso();
        const tmp = `${fp}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(payload, null, 2), "utf-8");
        await fs.rename(tmp, fp);
    }
    getFileOrInit() {
        if (this.file)
            return this.file;
        this.file = { version: 1, updatedAt: nowIso(), shops: {} };
        return this.file;
    }
    async get(shop) {
        await this.ensureLoaded();
        if (!isValidShopDomain(shop)) {
            throw new ShopsStoreError("Invalid shop domain", "INVALID_SHOP_DOMAIN", 400);
        }
        const file = this.file;
        const r = file?.shops?.[shop];
        if (!r)
            return null;
        return {
            shop,
            accessToken: r.accessToken ?? null,
            scope: r.scope ?? null,
            installedAt: r.installedAt ?? null,
            updatedAt: r.updatedAt ?? nowIso(),
            uninstalledAt: r.uninstalledAt ?? null,
        };
    }
    async upsertToken(params) {
        await this.ensureLoaded();
        const shop = (params.shop || "").trim().toLowerCase();
        if (!isValidShopDomain(shop)) {
            throw new ShopsStoreError("Invalid shop domain", "INVALID_SHOP_DOMAIN", 400);
        }
        const token = String(params.accessToken || "").trim();
        if (!token) {
            throw new ShopsStoreError("accessToken is required", "TOKEN_MISSING", 400);
        }
        const scope = clampStr(params.scope, 2000);
        const file = this.getFileOrInit();
        const prev = file.shops[shop];
        const installedAt = prev?.installedAt ?? nowIso();
        const rec = {
            accessToken: token,
            scope,
            installedAt,
            updatedAt: nowIso(),
            uninstalledAt: null,
            pendingOAuth: null,
        };
        file.shops[shop] = rec;
        await this.persist();
        return {
            shop,
            accessToken: rec.accessToken,
            scope: rec.scope,
            installedAt: rec.installedAt,
            updatedAt: rec.updatedAt,
            uninstalledAt: rec.uninstalledAt,
        };
    }
    async clearToken(params) {
        await this.ensureLoaded();
        const shop = (params.shop || "").trim().toLowerCase();
        if (!isValidShopDomain(shop)) {
            throw new ShopsStoreError("Invalid shop domain", "INVALID_SHOP_DOMAIN", 400);
        }
        const file = this.getFileOrInit();
        const prev = file.shops[shop];
        // if record doesn't exist, still create a tombstone (helps idempotency on uninstall)
        file.shops[shop] = {
            accessToken: null,
            scope: prev?.scope ?? null,
            installedAt: prev?.installedAt ?? null,
            updatedAt: nowIso(),
            uninstalledAt: params.reason === "UNINSTALLED" ? nowIso() : prev?.uninstalledAt ?? null,
            pendingOAuth: null,
        };
        await this.persist();
    }
    async setPendingOAuthState(params) {
        await this.ensureLoaded();
        const shop = (params.shop || "").trim().toLowerCase();
        if (!isValidShopDomain(shop))
            throw new ShopsStoreError("Invalid shop domain", "INVALID_SHOP_DOMAIN", 400);
        const state = String(params.state || "").trim();
        if (!state)
            throw new ShopsStoreError("state is required", "STATE_MISSING", 400);
        const expiresAt = new Date(Date.now() + params.ttlSeconds * 1000).toISOString();
        const file = this.getFileOrInit();
        const prev = file.shops[shop];
        file.shops[shop] = {
            accessToken: prev?.accessToken ?? null,
            scope: prev?.scope ?? null,
            installedAt: prev?.installedAt ?? null,
            updatedAt: nowIso(),
            uninstalledAt: prev?.uninstalledAt ?? null,
            pendingOAuth: { state, expiresAt },
        };
        await this.persist();
    }
    async consumePendingOAuthState(params) {
        await this.ensureLoaded();
        const shop = (params.shop || "").trim().toLowerCase();
        if (!isValidShopDomain(shop))
            throw new ShopsStoreError("Invalid shop domain", "INVALID_SHOP_DOMAIN", 400);
        const inputState = String(params.state || "").trim();
        if (!inputState)
            throw new ShopsStoreError("state is required", "STATE_MISSING", 400);
        const file = this.getFileOrInit();
        const rec = file.shops[shop];
        const pending = rec?.pendingOAuth;
        if (!pending?.state || !pending?.expiresAt) {
            throw new ShopsStoreError("OAuth state missing", "STATE_MISSING", 400);
        }
        if (pending.state !== inputState) {
            throw new ShopsStoreError("OAuth state mismatch", "STATE_MISMATCH", 400);
        }
        const exp = Date.parse(pending.expiresAt);
        if (!Number.isFinite(exp) || exp < Date.now()) {
            throw new ShopsStoreError("OAuth state expired", "STATE_EXPIRED", 400);
        }
        // consume
        file.shops[shop] = {
            ...(rec ?? {
                accessToken: null,
                scope: null,
                installedAt: null,
                updatedAt: nowIso(),
                uninstalledAt: null,
                pendingOAuth: null,
            }),
            pendingOAuth: null,
            updatedAt: nowIso(),
        };
        await this.persist();
    }
    async getAccessTokenOrThrow(shop) {
        await this.ensureLoaded();
        if (!isValidShopDomain(shop))
            throw new ShopsStoreError("Invalid shop domain", "INVALID_SHOP_DOMAIN", 400);
        const rec = await this.get(shop);
        const token = rec?.accessToken ?? null;
        if (!token) {
            throw new ShopsStoreError(`Missing token for shop: ${shop}`, "TOKEN_MISSING", 401);
        }
        return token;
    }
}
