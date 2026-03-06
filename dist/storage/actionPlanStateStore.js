// src/storage/actionPlanStateStore.ts
import fs from "node:fs/promises";
import path from "node:path";
import { isValidShopDomain, normalizeShopDomain } from "./shopsStore.js";
function nowIso() {
    return new Date().toISOString();
}
function isIsoLike(s) {
    if (!s || typeof s !== "string")
        return false;
    return /^\d{4}-\d{2}-\d{2}($|T)/.test(s);
}
function clampNote(x) {
    if (x === undefined || x === null)
        return null;
    const s = String(x).trim();
    if (!s)
        return null;
    return s.length > 2000 ? s.slice(0, 2000) : s;
}
function clampReason(x) {
    if (x === undefined || x === null)
        return null;
    const s = String(x).trim();
    if (!s)
        return null;
    return s.length > 500 ? s.slice(0, 500) : s;
}
function normalizeStatus(x) {
    const s = String(x || "").toUpperCase();
    if (s === "OPEN" || s === "IN_PROGRESS" || s === "DONE" || s === "DISMISSED")
        return s;
    return "OPEN";
}
export class ActionPlanStateStore {
    params;
    loaded = false;
    file = null;
    constructor(params) {
        this.params = params;
        const shop = normalizeShopDomain(params.shop);
        if (!isValidShopDomain(shop)) {
            throw new Error(`Invalid shop domain for ActionPlanStateStore: ${String(params.shop)}`);
        }
        this.params.shop = shop;
    }
    filePath() {
        const dir = this.params.dataDir ?? path.join(process.cwd(), "data");
        return path.join(dir, `actionPlanState.${this.params.shop}.json`);
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
            const statesRaw = parsed.states && typeof parsed.states === "object" ? parsed.states : {};
            const states = {};
            for (const [actionId, rec] of Object.entries(statesRaw)) {
                if (!actionId || typeof actionId !== "string")
                    continue;
                const r = rec;
                const status = normalizeStatus(r?.status);
                const note = clampNote(r?.note);
                const dismissedReason = clampReason(r?.dismissedReason);
                const dueDate = r?.dueDate && isIsoLike(r?.dueDate) ? String(r?.dueDate) : null;
                const updatedAt = r?.updatedAt && isIsoLike(r?.updatedAt) ? String(r?.updatedAt) : nowIso();
                states[actionId] = {
                    actionId,
                    status,
                    note,
                    dueDate,
                    dismissedReason,
                    updatedAt,
                };
            }
            this.file = {
                version: 1,
                shop: String(parsed.shop ?? this.params.shop),
                updatedAt: String(parsed.updatedAt ?? nowIso()),
                states,
            };
        }
        catch {
            this.file = null;
        }
    }
    getUpdatedAtSync() {
        return this.file?.updatedAt ?? null;
    }
    getStateSync(actionId) {
        const id = String(actionId || "");
        if (!id)
            return null;
        return this.file?.states?.[id] ?? null;
    }
    async list() {
        await this.ensureLoaded();
        const states = this.file?.states ?? {};
        return Object.values(states).sort((a, b) => String(a.actionId).localeCompare(String(b.actionId)));
    }
    async upsert(params) {
        await this.ensureLoaded();
        const actionId = String(params.actionId || "").trim();
        if (!actionId)
            throw new Error("actionId is required");
        const prev = this.getStateSync(actionId);
        const nextStatus = params.status === undefined || params.status === null ? prev?.status ?? "OPEN" : normalizeStatus(params.status);
        const nextNote = params.note === undefined ? prev?.note ?? null : clampNote(params.note);
        const nextDue = params.dueDate === undefined
            ? prev?.dueDate ?? null
            : params.dueDate && isIsoLike(params.dueDate)
                ? String(params.dueDate)
                : null;
        const nextDismissReason = params.dismissedReason === undefined ? prev?.dismissedReason ?? null : clampReason(params.dismissedReason);
        const dismissedReason = nextStatus === "DISMISSED" ? nextDismissReason ?? null : null;
        const rec = {
            actionId,
            status: nextStatus,
            note: nextNote ?? null,
            dueDate: nextDue ?? null,
            dismissedReason,
            updatedAt: nowIso(),
        };
        const file = this.file ??
            {
                version: 1,
                shop: this.params.shop,
                updatedAt: nowIso(),
                states: {},
            };
        file.states[actionId] = rec;
        file.updatedAt = nowIso();
        this.file = file;
        await this.persist();
        return rec;
    }
    async clear(actionId) {
        await this.ensureLoaded();
        const id = String(actionId || "").trim();
        if (!id)
            return;
        if (!this.file?.states?.[id])
            return;
        delete this.file.states[id];
        this.file.updatedAt = nowIso();
        await this.persist();
    }
    /**
     * ✅ PCD: clear ALL action plan state for this shop.
     * Idempotent.
     */
    async clearAll() {
        await this.ensureLoaded();
        this.file = null;
        try {
            await fs.unlink(this.filePath());
        }
        catch {
            // ignore
        }
    }
    async persist() {
        const fp = this.filePath();
        await fs.mkdir(path.dirname(fp), { recursive: true });
        const payload = this.file ??
            {
                version: 1,
                shop: this.params.shop,
                updatedAt: nowIso(),
                states: {},
            };
        const tmp = `${fp}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(payload, null, 2), "utf-8");
        await fs.rename(tmp, fp);
    }
}
