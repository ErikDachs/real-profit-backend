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

  async ensureLoaded() {
    if (this.loaded) return;
    this.loaded = true;

    try {
      const raw = await fs.readFile(this.filePath(), "utf-8");
      const parsed = JSON.parse(raw);

      if (!parsed || typeof parsed !== "object" || !parsed.overrides) {
        this.persisted = null;
        return;
      }

      this.persisted = {
        shop: String(parsed.shop ?? this.params.shop),
        updatedAt: String(parsed.updatedAt ?? new Date().toISOString()),
        overrides: parsed.overrides as CostProfileOverrides,
      };
    } catch {
      this.persisted = null;
    }
  }

  getOverridesSync(): CostProfileOverrides | undefined {
    return this.persisted?.overrides;
  }

  getUpdatedAtSync(): string | undefined {
    return this.persisted?.updatedAt;
  }

  async setOverrides(overrides: CostProfileOverrides) {
    await this.ensureLoaded();

    const payload: Persisted = {
      shop: this.params.shop,
      updatedAt: new Date().toISOString(),
      overrides,
    };

    this.persisted = payload;

    const fp = this.filePath();
    await fs.mkdir(path.dirname(fp), { recursive: true });
    await fs.writeFile(fp, JSON.stringify(payload, null, 2), "utf-8");
  }

  async clear() {
    await this.ensureLoaded();
    this.persisted = null;

    try {
      await fs.unlink(this.filePath());
    } catch {
      // ignore
    }
  }
}