// src/storage/cogsOverridesStore.ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { isValidShopDomain, normalizeShopDomain } from "./shopsStore.js";

export type CogsOverrideRecord = {
  variantId: number;
  unitCost?: number; // optional override (per 1 unit, in shop currency)
  ignoreCogs?: boolean; // if true: COGS can be 0 by design; not "missing"
  updatedAt: string; // ISO
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
  | { filePath?: string } // legacy/global mode
  | { shop: string; dataDir?: string; filePath?: never }; // shop-scoped mode

function nowIso() {
  return new Date().toISOString();
}

/**
 * ✅ SHOP-SCOPED persistence (PCD-safe):
 * - File: <dataDir>/cogsOverrides.<shop>.json
 *
 * Backwards compatible:
 * - If constructed with {filePath} or no params => legacy global file.
 */
export class CogsOverridesStore {
  private filePath: string;
  private loaded = false;
  private overrides = new Map<number, CogsOverrideRecord>();

  constructor(params?: StoreParams) {
    const defaultLegacyPath = path.join(process.cwd(), "data", "cogs-overrides.json");

    if (params && "shop" in params) {
      const shop = normalizeShopDomain(params.shop);
      if (!isValidShopDomain(shop)) {
        // fail-fast: we do NOT want to write arbitrary filenames
        throw new Error(`Invalid shop domain for CogsOverridesStore: ${String(params.shop)}`);
      }
      const dir = params.dataDir ?? path.join(process.cwd(), "data");
      this.filePath = path.join(dir, `cogsOverrides.${shop}.json`);
    } else {
      this.filePath = (params as any)?.filePath ?? defaultLegacyPath;
    }
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;

    try {
      const raw = await fs.readFile(this.filePath, "utf-8");
      const json = JSON.parse(raw) as FileShapeV1 | FileShapeV2;

      // Migrate v1 -> in-memory v2
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
        await this.persistToDisk(); // best-effort migration
        return;
      }

      // Load v2
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
        return;
      }

      // Unknown format -> treat as empty
      this.loaded = true;
    } catch {
      this.loaded = true;
    }
  }

  getUnitCostSync(variantId: number): number | undefined {
    return this.overrides.get(variantId)?.unitCost;
  }

  isIgnoredSync(variantId: number): boolean {
    return Boolean(this.overrides.get(variantId)?.ignoreCogs);
  }

  async list(): Promise<CogsOverrideRecord[]> {
    await this.ensureLoaded();
    return Array.from(this.overrides.values()).sort((a, b) => a.variantId - b.variantId);
  }

  async upsert(params: {
    variantId: number;
    unitCost?: number | null;
    ignoreCogs?: boolean | null;
  }): Promise<CogsOverrideRecord> {
    await this.ensureLoaded();

    const variantId = Number(params.variantId);
    if (!Number.isFinite(variantId) || variantId <= 0) throw new Error("variantId must be a positive number");

    const prev = this.overrides.get(variantId);

    // unitCost handling
    let nextUnitCost = prev?.unitCost;
    if (params.unitCost !== undefined) {
      if (params.unitCost === null) {
        nextUnitCost = undefined; // allow clearing override
      } else {
        const unitCost = Number(params.unitCost);
        if (!Number.isFinite(unitCost) || unitCost < 0) throw new Error("unitCost must be a number >= 0");
        nextUnitCost = unitCost;
      }
    }

    // ignore flag handling
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

  /**
   * ✅ PCD: clear ALL overrides for this store file.
   * Idempotent.
   */
  async clearAll(): Promise<void> {
    await this.ensureLoaded();
    this.overrides.clear();

    try {
      await fs.unlink(this.filePath);
    } catch {
      // ignore
    }
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
  }
}