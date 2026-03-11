// src/storage/cogsOverridesStore.ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { isValidShopDomain, normalizeShopDomain } from "./shopsStore.js";

export type CogsOverrideRecord = {
  variantId: number;
  unitCost?: number;
  ignoreCogs?: boolean;
  updatedAt: string;
};

type FileShapeV1 = {
  version: 1;
  updatedAt: string;
  overrides: Record<string, { unitCost: number; updatedAt: string }>;
};

type FileShapeV2 = {
  version: 2;
  updatedAt: string;
  overrides: Record<
    string,
    {
      unitCost?: number;
      ignoreCogs?: boolean;
      updatedAt: string;
    }
  >;
};

type StoreParams =
  | { filePath?: string }
  | { shop: string; dataDir?: string; filePath?: never };

function nowIso() {
  return new Date().toISOString();
}

export class CogsOverridesStore {
  private filePath: string;
  private loaded = false;
  private overrides = new Map<number, CogsOverrideRecord>();
  private lastMtimeMs: number | null = null;

  constructor(params?: StoreParams) {
    const defaultLegacyPath = path.join(process.cwd(), "data", "cogs-overrides.json");

    if (params && "shop" in params) {
      const shop = normalizeShopDomain(params.shop);
      if (!isValidShopDomain(shop)) {
        throw new Error(`Invalid shop domain for CogsOverridesStore: ${String(params.shop)}`);
      }

      const dir = params.dataDir ?? path.join(process.cwd(), "data");
      this.filePath = path.join(dir, `cogsOverrides.${shop}.json`);
    } else {
      this.filePath = (params as any)?.filePath ?? defaultLegacyPath;
    }
  }

  private async readMtime(): Promise<number | null> {
    try {
      const st = await fs.stat(this.filePath);
      return st.mtimeMs;
    } catch {
      return null;
    }
  }

  private resetInMemory() {
    this.overrides = new Map<number, CogsOverrideRecord>();
  }

  private async loadFromDisk(): Promise<void> {
    this.resetInMemory();

    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const json = JSON.parse(raw) as FileShapeV1 | FileShapeV2;

      if ((json as any)?.version === 1) {
        const v1 = json as FileShapeV1;

        for (const [k, v] of Object.entries(v1.overrides ?? {})) {
          const variantId = Number(k);
          const unitCost = Number((v as any)?.unitCost ?? NaN);
          const updatedAt = String((v as any)?.updatedAt ?? "");

          if (!Number.isFinite(variantId) || variantId <= 0) continue;
          if (!Number.isFinite(unitCost) || unitCost < 0) continue;

          this.overrides.set(variantId, {
            variantId,
            unitCost,
            ignoreCogs: false,
            updatedAt: updatedAt || nowIso(),
          });
        }

        this.loaded = true;
        await this.persistToDisk();
        this.lastMtimeMs = await this.readMtime();
        return;
      }

      if ((json as any)?.version === 2) {
        const v2 = json as FileShapeV2;

        for (const [k, v] of Object.entries(v2.overrides ?? {})) {
          const variantId = Number(k);
          if (!Number.isFinite(variantId) || variantId <= 0) continue;

          const unitCostRaw = (v as any)?.unitCost;
          const ignoreCogs = Boolean((v as any)?.ignoreCogs ?? false);
          const updatedAt = String((v as any)?.updatedAt ?? "");

          let unitCost: number | undefined = undefined;
          if (unitCostRaw !== undefined && unitCostRaw !== null && unitCostRaw !== "") {
            const n = Number(unitCostRaw);
            if (Number.isFinite(n) && n >= 0) unitCost = n;
          }

          this.overrides.set(variantId, {
            variantId,
            unitCost,
            ignoreCogs,
            updatedAt: updatedAt || nowIso(),
          });
        }

        this.loaded = true;
        this.lastMtimeMs = await this.readMtime();
        return;
      }

      this.loaded = true;
      this.lastMtimeMs = await this.readMtime();
    } catch {
      this.loaded = true;
      this.lastMtimeMs = await this.readMtime();
    }
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    await this.loadFromDisk();
  }

  async ensureFresh(): Promise<void> {
    await this.ensureLoaded();

    const mt = await this.readMtime();

    if (this.lastMtimeMs === null && mt === null) return;
    if (this.lastMtimeMs === null && mt !== null) {
      await this.loadFromDisk();
      return;
    }
    if (this.lastMtimeMs !== null && mt === null) {
      this.resetInMemory();
      this.lastMtimeMs = null;
      return;
    }
    if (mt !== this.lastMtimeMs) {
      await this.loadFromDisk();
    }
  }

  getUnitCostSync(variantId: number): number | undefined {
    return this.overrides.get(variantId)?.unitCost;
  }

  isIgnoredSync(variantId: number): boolean {
    return Boolean(this.overrides.get(variantId)?.ignoreCogs);
  }

  async list(): Promise<CogsOverrideRecord[]> {
    await this.ensureFresh();
    return Array.from(this.overrides.values()).sort((a, b) => a.variantId - b.variantId);
  }

  async upsert(params: {
    variantId: number;
    unitCost?: number | null;
    ignoreCogs?: boolean | null;
  }): Promise<CogsOverrideRecord> {
    await this.ensureFresh();

    const variantId = Number(params.variantId);
    if (!Number.isFinite(variantId) || variantId <= 0) {
      throw new Error("variantId must be a positive number");
    }

    const prev = this.overrides.get(variantId);

    let nextUnitCost = prev?.unitCost;
    if (params.unitCost !== undefined) {
      if (params.unitCost === null) {
        nextUnitCost = undefined;
      } else {
        const unitCost = Number(params.unitCost);
        if (!Number.isFinite(unitCost) || unitCost < 0) {
          throw new Error("unitCost must be a number >= 0");
        }
        nextUnitCost = unitCost;
      }
    }

    let nextIgnore = prev?.ignoreCogs ?? false;
    if (params.ignoreCogs !== undefined && params.ignoreCogs !== null) {
      nextIgnore = Boolean(params.ignoreCogs);
    }

    const rec: CogsOverrideRecord = {
      variantId,
      unitCost: nextUnitCost,
      ignoreCogs: nextIgnore,
      updatedAt: nowIso(),
    };

    this.overrides.set(variantId, rec);
    await this.persistToDisk();
    return rec;
  }

  async clearAll(): Promise<void> {
    await this.ensureFresh();
    this.overrides.clear();

    try {
      await fs.unlink(this.filePath);
    } catch {
      // ignore
    }

    this.lastMtimeMs = await this.readMtime();
  }

  private async persistToDisk(): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });

    const shape: FileShapeV2 = {
      version: 2,
      updatedAt: nowIso(),
      overrides: {},
    };

    for (const [variantId, rec] of this.overrides.entries()) {
      shape.overrides[String(variantId)] = {
        unitCost: rec.unitCost,
        ignoreCogs: Boolean(rec.ignoreCogs),
        updatedAt: rec.updatedAt,
      };
    }

    const tmpPath = `${this.filePath}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(shape, null, 2), "utf-8");
    await fs.rename(tmpPath, this.filePath);

    this.lastMtimeMs = await this.readMtime();
  }
}