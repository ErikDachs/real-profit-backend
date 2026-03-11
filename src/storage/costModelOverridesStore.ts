// src/storage/costModelOverridesStore.ts
import fs from "node:fs/promises";
import path from "node:path";
import type { CostProfileOverrides } from "../domain/costModel/types.js";
import { isValidShopDomain, normalizeShopDomain } from "./shopsStore.js";

type Persisted = {
  shop: string;
  updatedAt: string;
  overrides: CostProfileOverrides;
};

export class CostModelOverridesStore {
  private loaded = false;
  private persisted: Persisted | null = null;
  private lastMtimeMs: number | null = null;

  constructor(private params: { shop: string; dataDir?: string }) {
    const shop = normalizeShopDomain(params.shop);
    if (!isValidShopDomain(shop)) {
      throw new Error(`Invalid shop domain for CostModelOverridesStore: ${String(params.shop)}`);
    }
    this.params.shop = shop;
  }

  private filePath() {
    const dir = this.params.dataDir ?? path.join(process.cwd(), "data");
    return path.join(dir, `costModelOverrides.${this.params.shop}.json`);
  }

  private async readMtime(): Promise<number | null> {
    try {
      const st = await fs.stat(this.filePath());
      return st.mtimeMs;
    } catch {
      return null;
    }
  }

  private async loadFromDisk() {
    try {
      const raw = await fs.readFile(this.filePath(), "utf-8");
      const parsed = JSON.parse(raw);

      if (!parsed || typeof parsed !== "object" || !parsed.overrides) {
        this.persisted = null;
        this.loaded = true;
        this.lastMtimeMs = await this.readMtime();
        return;
      }

      this.persisted = {
        shop: normalizeShopDomain(parsed.shop ?? this.params.shop),
        updatedAt: String(parsed.updatedAt ?? new Date().toISOString()),
        overrides: parsed.overrides as CostProfileOverrides,
      };

      this.loaded = true;
      this.lastMtimeMs = await this.readMtime();
    } catch {
      this.persisted = null;
      this.loaded = true;
      this.lastMtimeMs = await this.readMtime();
    }
  }

  async ensureLoaded() {
    if (this.loaded) return;
    await this.loadFromDisk();
  }

  async ensureFresh() {
    await this.ensureLoaded();

    const mt = await this.readMtime();

    if (this.lastMtimeMs === null && mt === null) return;
    if (this.lastMtimeMs === null && mt !== null) {
      await this.loadFromDisk();
      return;
    }
    if (this.lastMtimeMs !== null && mt === null) {
      this.persisted = null;
      this.lastMtimeMs = null;
      return;
    }
    if (mt !== this.lastMtimeMs) {
      await this.loadFromDisk();
    }
  }

  getOverridesSync(): CostProfileOverrides | undefined {
    return this.persisted?.overrides;
  }

  getUpdatedAtSync(): string | undefined {
    return this.persisted?.updatedAt;
  }

  async setOverrides(overrides: CostProfileOverrides) {
    await this.ensureFresh();

    const payload: Persisted = {
      shop: this.params.shop,
      updatedAt: new Date().toISOString(),
      overrides,
    };

    this.persisted = payload;

    const fp = this.filePath();
    await fs.mkdir(path.dirname(fp), { recursive: true });

    const tmp = `${fp}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(payload, null, 2), "utf-8");
    await fs.rename(tmp, fp);

    this.lastMtimeMs = await this.readMtime();
  }

  async clear() {
    await this.ensureFresh();
    this.persisted = null;

    try {
      await fs.unlink(this.filePath());
    } catch {
      // ignore
    }

    this.lastMtimeMs = await this.readMtime();
  }
}