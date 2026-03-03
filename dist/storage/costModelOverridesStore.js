// src/storage/costModelOverridesStore.ts
import fs from "node:fs/promises";
import path from "node:path";
export class CostModelOverridesStore {
    params;
    loaded = false;
    persisted = null;
    constructor(params) {
        this.params = params;
    }
    filePath() {
        const dir = this.params.dataDir ?? path.join(process.cwd(), "data");
        return path.join(dir, `costModelOverrides.${this.params.shop}.json`);
    }
    async ensureLoaded() {
        if (this.loaded)
            return;
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
                overrides: parsed.overrides,
            };
        }
        catch {
            this.persisted = null;
        }
    }
    getOverridesSync() {
        return this.persisted?.overrides;
    }
    getUpdatedAtSync() {
        return this.persisted?.updatedAt;
    }
    async setOverrides(overrides) {
        await this.ensureLoaded();
        const payload = {
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
        }
        catch {
            // ignore
        }
    }
}
