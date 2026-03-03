// src/storage/cogsOverridesStore.ts
import { promises as fs } from "node:fs";
import path from "node:path";
/**
 * MVP persistence for manual COGS overrides + ignore flag.
 * File: <projectRoot>/data/cogs-overrides.json
 *
 * Later: replace with DB table:
 *  shop_id + variant_id + unit_cost + ignore_cogs + updated_at
 */
export class CogsOverridesStore {
    filePath;
    loaded = false;
    overrides = new Map();
    constructor(params) {
        const defaultPath = path.join(process.cwd(), "data", "cogs-overrides.json");
        this.filePath = params?.filePath ?? defaultPath;
    }
    async ensureLoaded() {
        if (this.loaded)
            return;
        try {
            const raw = await fs.readFile(this.filePath, "utf-8");
            const json = JSON.parse(raw);
            // Migrate v1 -> in-memory v2
            if (json?.version === 1) {
                const v1 = json;
                for (const [k, v] of Object.entries(v1.overrides ?? {})) {
                    const variantId = Number(k);
                    const unitCost = Number(v?.unitCost ?? NaN);
                    const updatedAt = String(v?.updatedAt ?? "");
                    if (!Number.isFinite(variantId) || variantId <= 0)
                        continue;
                    if (!Number.isFinite(unitCost) || unitCost < 0)
                        continue;
                    this.overrides.set(variantId, {
                        variantId,
                        unitCost,
                        ignoreCogs: false,
                        updatedAt: updatedAt || new Date().toISOString(),
                    });
                }
                this.loaded = true;
                // Persist migrated format once (best effort)
                await this.persistToDisk();
                return;
            }
            // Load v2
            if (json?.version === 2) {
                const v2 = json;
                for (const [k, v] of Object.entries(v2.overrides ?? {})) {
                    const variantId = Number(k);
                    const unitCostRaw = v?.unitCost;
                    const ignoreCogs = Boolean(v?.ignoreCogs ?? false);
                    const updatedAt = String(v?.updatedAt ?? "");
                    if (!Number.isFinite(variantId) || variantId <= 0)
                        continue;
                    let unitCost = undefined;
                    if (unitCostRaw !== undefined && unitCostRaw !== null && unitCostRaw !== "") {
                        const n = Number(unitCostRaw);
                        if (Number.isFinite(n) && n >= 0)
                            unitCost = n;
                    }
                    this.overrides.set(variantId, {
                        variantId,
                        unitCost,
                        ignoreCogs,
                        updatedAt: updatedAt || new Date().toISOString(),
                    });
                }
                this.loaded = true;
                return;
            }
            // Unknown format -> treat as empty
            this.loaded = true;
        }
        catch {
            // file missing -> fine
            this.loaded = true;
        }
    }
    getUnitCostSync(variantId) {
        return this.overrides.get(variantId)?.unitCost;
    }
    isIgnoredSync(variantId) {
        return Boolean(this.overrides.get(variantId)?.ignoreCogs);
    }
    async list() {
        await this.ensureLoaded();
        return Array.from(this.overrides.values()).sort((a, b) => a.variantId - b.variantId);
    }
    /**
     * Upsert unitCost and/or ignore flag.
     * - Pass unitCost to set/overwrite
     * - Pass ignoreCogs to set/overwrite
     * - Omit a field to keep it unchanged
     */
    async upsert(params) {
        await this.ensureLoaded();
        const variantId = Number(params.variantId);
        if (!Number.isFinite(variantId) || variantId <= 0) {
            throw new Error("variantId must be a positive number");
        }
        const prev = this.overrides.get(variantId);
        // unitCost handling
        let nextUnitCost = prev?.unitCost;
        if (params.unitCost !== undefined) {
            if (params.unitCost === null) {
                nextUnitCost = undefined; // allow clearing override
            }
            else {
                const unitCost = Number(params.unitCost);
                if (!Number.isFinite(unitCost) || unitCost < 0) {
                    throw new Error("unitCost must be a number >= 0");
                }
                nextUnitCost = unitCost;
            }
        }
        // ignore flag handling
        let nextIgnore = prev?.ignoreCogs ?? false;
        if (params.ignoreCogs !== undefined && params.ignoreCogs !== null) {
            nextIgnore = Boolean(params.ignoreCogs);
        }
        const rec = {
            variantId,
            unitCost: nextUnitCost,
            ignoreCogs: nextIgnore,
            updatedAt: new Date().toISOString(),
        };
        this.overrides.set(variantId, rec);
        await this.persistToDisk();
        return rec;
    }
    async persistToDisk() {
        const dir = path.dirname(this.filePath);
        await fs.mkdir(dir, { recursive: true });
        const shape = {
            version: 2,
            updatedAt: new Date().toISOString(),
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
