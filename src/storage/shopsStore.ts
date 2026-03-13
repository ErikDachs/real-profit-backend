import fs from "node:fs/promises";
import path from "node:path";

export type ShopDomain = string;
export type StoredPlanKey = "starter" | "pro" | "scale";

export type ShopBillingRecord = {
  plan: StoredPlanKey;
  subscriptionId: string | null;
  status: string | null;
  currentPeriodEnd: string | null;
  subscriptionName: string | null;
  test: boolean;
  trialDays: number;
  updatedAt: string;
};

export type ShopTokenRecord = {
  shop: ShopDomain;

  accessToken: string | null;
  scope: string | null;

  installedAt: string | null;
  updatedAt: string;

  uninstalledAt: string | null;
  billing?: ShopBillingRecord | null;
};

export type PendingOAuthState = {
  state: string;
  expiresAt: string;
};

type FileShapeV1 = {
  version: 1;
  updatedAt: string;
  shops: Record<
    string,
    {
      accessToken: string | null;
      scope: string | null;
      installedAt: string | null;
      updatedAt: string;
      uninstalledAt: string | null;
      pendingOAuth?: PendingOAuthState | null;
      billing?: {
        plan: StoredPlanKey;
        subscriptionId: string | null;
        status: string | null;
        currentPeriodEnd: string | null;
        subscriptionName: string | null;
        test: boolean;
        trialDays: number;
        updatedAt: string;
      } | null;
    }
  >;
};

export class ShopsStoreError extends Error {
  constructor(
    message: string,
    public code:
      | "INVALID_SHOP_DOMAIN"
      | "NOT_FOUND"
      | "TOKEN_MISSING"
      | "STATE_MISSING"
      | "STATE_MISMATCH"
      | "STATE_EXPIRED"
      | "IO_ERROR",
    public status: number
  ) {
    super(message);
  }
}

export function normalizeShopDomain(input: any): string {
  const raw = String(input ?? "").trim().toLowerCase();
  if (!raw) return "";

  let s = raw.replace(/^https?:\/\//, "");
  s = s.split("?")[0]!.split("#")[0]!;
  s = s.split("/")[0]!;
  s = s.replace(/\.$/, "").trim();

  return s;
}

export function isValidShopDomain(shop: any): shop is ShopDomain {
  if (!shop || typeof shop !== "string") return false;
  const s = normalizeShopDomain(shop);
  return /^[a-z0-9][a-z0-9-]*[a-z0-9]\.myshopify\.com$/.test(s) || /^[a-z0-9]\.myshopify\.com$/.test(s);
}

function isValidPlanKey(value: any): value is StoredPlanKey {
  return value === "starter" || value === "pro" || value === "scale";
}

function nowIso() {
  return new Date().toISOString();
}

function clampStr(x: any, max = 4000): string | null {
  if (x === undefined || x === null) return null;
  const s = String(x).trim();
  if (!s) return null;
  return s.length > max ? s.slice(0, max) : s;
}

function maskToken(token: string | null): string {
  if (!token) return "";
  const t = String(token);
  if (t.length <= 10) return "***";
  return `${t.slice(0, 4)}…${t.slice(-4)}`;
}

function normalizeBilling(input: any): ShopBillingRecord | null {
  if (!input || typeof input !== "object") return null;
  if (!isValidPlanKey(input.plan)) return null;

  return {
    plan: input.plan,
    subscriptionId: clampStr(input.subscriptionId, 300) ?? null,
    status: clampStr(input.status, 100) ?? null,
    currentPeriodEnd: clampStr(input.currentPeriodEnd, 100) ?? null,
    subscriptionName: clampStr(input.subscriptionName, 200) ?? null,
    test: Boolean(input.test),
    trialDays: Number.isFinite(Number(input.trialDays)) ? Math.max(0, Number(input.trialDays)) : 0,
    updatedAt: clampStr(input.updatedAt, 100) ?? nowIso(),
  };
}

export class ShopsStore {
  private loaded = false;
  private file: FileShapeV1 | null = null;
  private lastMtimeMs: number | null = null;

  constructor(private params?: { dataDir?: string; filePath?: string }) {}

  private filePath() {
    if (this.params?.filePath) return this.params.filePath;
    const dir = this.params?.dataDir ?? path.join(process.cwd(), "data");
    return path.join(dir, "shops.json");
  }

  private getFileOrInit(): FileShapeV1 {
    if (this.file) return this.file;
    this.file = { version: 1, updatedAt: nowIso(), shops: {} };
    return this.file;
  }

  private async loadFromDisk(): Promise<void> {
    const fp = this.filePath();

    try {
      const raw = await fs.readFile(fp, "utf-8");
      const parsed = JSON.parse(raw);

      if (!parsed || typeof parsed !== "object" || parsed.version !== 1) {
        this.file = { version: 1, updatedAt: nowIso(), shops: {} };
        return;
      }

      const shopsRaw = parsed.shops && typeof parsed.shops === "object" ? parsed.shops : {};
      const shops: FileShapeV1["shops"] = {};

      for (const [shopKeyRaw, rec] of Object.entries(shopsRaw)) {
        const shopKey = normalizeShopDomain(shopKeyRaw);
        if (!isValidShopDomain(shopKey)) continue;

        const r: any = rec ?? {};
        shops[shopKey] = {
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
          billing: normalizeBilling(r.billing),
        };
      }

      this.file = {
        version: 1,
        updatedAt: String(parsed.updatedAt ?? nowIso()),
        shops,
      };

      try {
        const st = await fs.stat(fp);
        this.lastMtimeMs = st.mtimeMs;
      } catch {
        //
      }
    } catch {
      this.file = { version: 1, updatedAt: nowIso(), shops: {} };
      this.lastMtimeMs = null;
    }
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    await this.loadFromDisk();
  }

  private async refreshIfChanged(): Promise<void> {
    await this.ensureLoaded();
    const fp = this.filePath();

    try {
      const st = await fs.stat(fp);
      const mt = st.mtimeMs;
      if (this.lastMtimeMs === null) {
        this.lastMtimeMs = mt;
        return;
      }
      if (mt !== this.lastMtimeMs) {
        await this.loadFromDisk();
      }
    } catch {
      //
    }
  }

  private async persist(): Promise<void> {
    const fp = this.filePath();
    await fs.mkdir(path.dirname(fp), { recursive: true });

    const payload: FileShapeV1 = this.getFileOrInit();
    payload.updatedAt = nowIso();

    const tmp = `${fp}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(payload, null, 2), "utf-8");
    await fs.rename(tmp, fp);

    try {
      const st = await fs.stat(fp);
      this.lastMtimeMs = st.mtimeMs;
    } catch {
      //
    }
  }

  async get(shop: ShopDomain): Promise<ShopTokenRecord | null> {
    await this.refreshIfChanged();

    const s = normalizeShopDomain(shop);
    if (!isValidShopDomain(s)) {
      throw new ShopsStoreError("Invalid shop domain", "INVALID_SHOP_DOMAIN", 400);
    }

    const r = this.file?.shops?.[s];
    if (!r) return null;

    return {
      shop: s,
      accessToken: r.accessToken ?? null,
      scope: r.scope ?? null,
      installedAt: r.installedAt ?? null,
      updatedAt: r.updatedAt ?? nowIso(),
      uninstalledAt: r.uninstalledAt ?? null,
      billing: normalizeBilling(r.billing),
    };
  }

  async upsertToken(params: { shop: ShopDomain; accessToken: string; scope?: string | null }): Promise<ShopTokenRecord> {
    await this.refreshIfChanged();

    const shop = normalizeShopDomain(params.shop);
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
      billing: normalizeBilling(prev?.billing),
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
      billing: normalizeBilling(rec.billing),
    };
  }

  async upsertBilling(params: {
    shop: ShopDomain;
    plan: StoredPlanKey;
    subscriptionId?: string | null;
    status?: string | null;
    currentPeriodEnd?: string | null;
    subscriptionName?: string | null;
    test?: boolean;
    trialDays?: number;
  }): Promise<ShopBillingRecord> {
    await this.refreshIfChanged();

    const shop = normalizeShopDomain(params.shop);
    if (!isValidShopDomain(shop)) {
      throw new ShopsStoreError("Invalid shop domain", "INVALID_SHOP_DOMAIN", 400);
    }
    if (!isValidPlanKey(params.plan)) {
      throw new ShopsStoreError("Invalid billing plan", "IO_ERROR", 400);
    }

    const file = this.getFileOrInit();
    const prev = file.shops[shop];

    const billing: ShopBillingRecord = {
      plan: params.plan,
      subscriptionId: clampStr(params.subscriptionId, 300) ?? null,
      status: clampStr(params.status, 100) ?? null,
      currentPeriodEnd: clampStr(params.currentPeriodEnd, 100) ?? null,
      subscriptionName: clampStr(params.subscriptionName, 200) ?? null,
      test: Boolean(params.test),
      trialDays: Number.isFinite(Number(params.trialDays)) ? Math.max(0, Number(params.trialDays)) : 0,
      updatedAt: nowIso(),
    };

    file.shops[shop] = {
      accessToken: prev?.accessToken ?? null,
      scope: prev?.scope ?? null,
      installedAt: prev?.installedAt ?? null,
      updatedAt: nowIso(),
      uninstalledAt: prev?.uninstalledAt ?? null,
      pendingOAuth: prev?.pendingOAuth ?? null,
      billing,
    };

    await this.persist();
    return billing;
  }

  async clearBilling(shopInput: ShopDomain): Promise<void> {
    await this.refreshIfChanged();

    const shop = normalizeShopDomain(shopInput);
    if (!isValidShopDomain(shop)) {
      throw new ShopsStoreError("Invalid shop domain", "INVALID_SHOP_DOMAIN", 400);
    }

    const file = this.getFileOrInit();
    const prev = file.shops[shop];
    if (!prev) return;

    file.shops[shop] = {
      ...prev,
      billing: null,
      updatedAt: nowIso(),
    };

    await this.persist();
  }

  async clearToken(params: { shop: ShopDomain; reason?: "UNINSTALLED" | "MANUAL" }): Promise<void> {
    await this.refreshIfChanged();

    const shop = normalizeShopDomain(params.shop);
    if (!isValidShopDomain(shop)) {
      throw new ShopsStoreError("Invalid shop domain", "INVALID_SHOP_DOMAIN", 400);
    }

    const file = this.getFileOrInit();
    const prev = file.shops[shop];

    file.shops[shop] = {
      accessToken: null,
      scope: prev?.scope ?? null,
      installedAt: prev?.installedAt ?? null,
      updatedAt: nowIso(),
      uninstalledAt: params.reason === "UNINSTALLED" ? nowIso() : prev?.uninstalledAt ?? null,
      pendingOAuth: null,
      billing: normalizeBilling(prev?.billing),
    };

    await this.persist();
  }

  async setPendingOAuthState(params: { shop: ShopDomain; state: string; ttlSeconds: number }): Promise<void> {
    await this.refreshIfChanged();

    const shop = normalizeShopDomain(params.shop);
    if (!isValidShopDomain(shop)) throw new ShopsStoreError("Invalid shop domain", "INVALID_SHOP_DOMAIN", 400);

    const state = String(params.state || "").trim();
    if (!state) throw new ShopsStoreError("state is required", "STATE_MISSING", 400);

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
      billing: normalizeBilling(prev?.billing),
    };

    await this.persist();
  }

  async consumePendingOAuthState(params: { shop: ShopDomain; state: string }): Promise<void> {
    await this.refreshIfChanged();

    const shop = normalizeShopDomain(params.shop);
    if (!isValidShopDomain(shop)) throw new ShopsStoreError("Invalid shop domain", "INVALID_SHOP_DOMAIN", 400);

    const inputState = String(params.state || "").trim();
    if (!inputState) throw new ShopsStoreError("state is required", "STATE_MISSING", 400);

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

    file.shops[shop] = {
      ...(rec ?? {
        accessToken: null,
        scope: null,
        installedAt: null,
        updatedAt: nowIso(),
        uninstalledAt: null,
        pendingOAuth: null,
        billing: null,
      }),
      pendingOAuth: null,
      updatedAt: nowIso(),
    };

    await this.persist();
  }

  async getAccessTokenOrThrow(shop: ShopDomain): Promise<string> {
    await this.refreshIfChanged();

    const s = normalizeShopDomain(shop);
    if (!isValidShopDomain(s)) throw new ShopsStoreError("Invalid shop domain", "INVALID_SHOP_DOMAIN", 400);

    const rec = await this.get(s);
    const token = rec?.accessToken ?? null;
    if (!token) {
      throw new ShopsStoreError(`Missing token for shop: ${s}`, "TOKEN_MISSING", 401);
    }
    return token;
  }

  async list(): Promise<ShopTokenRecord[]> {
    await this.refreshIfChanged();
    const file = this.getFileOrInit();
    return Object.keys(file.shops).map((shop) => ({
      shop,
      accessToken: file.shops[shop]?.accessToken ?? null,
      scope: file.shops[shop]?.scope ?? null,
      installedAt: file.shops[shop]?.installedAt ?? null,
      updatedAt: file.shops[shop]?.updatedAt ?? nowIso(),
      uninstalledAt: file.shops[shop]?.uninstalledAt ?? null,
      billing: normalizeBilling(file.shops[shop]?.billing),
    }));
  }

  async listMasked(): Promise<
    Array<Omit<ShopTokenRecord, "accessToken"> & { accessTokenMasked: string }>
  > {
    const rows = await this.list();
    return rows.map((r) => ({
      shop: r.shop,
      scope: r.scope,
      installedAt: r.installedAt,
      updatedAt: r.updatedAt,
      uninstalledAt: r.uninstalledAt,
      billing: r.billing ?? null,
      accessTokenMasked: maskToken(r.accessToken),
    }));
  }
}