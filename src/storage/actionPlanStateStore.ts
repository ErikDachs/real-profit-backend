// src/storage/actionPlanStateStore.ts
import fs from "node:fs/promises";
import path from "node:path";
import { isValidShopDomain, normalizeShopDomain } from "./shopsStore.js";

export type ActionStatus = "OPEN" | "IN_PROGRESS" | "DONE" | "DISMISSED";

export type ActionStateRecord = {
  actionId: string;
  status: ActionStatus;
  note?: string | null;
  dueDate?: string | null;
  dismissedReason?: string | null;
  updatedAt: string;
};

type FileShapeV1 = {
  version: 1;
  shop: string;
  updatedAt: string;
  states: Record<string, ActionStateRecord>;
};

function nowIso() {
  return new Date().toISOString();
}

function isIsoLike(s: any): boolean {
  if (!s || typeof s !== "string") return false;
  return /^\d{4}-\d{2}-\d{2}($|T)/.test(s);
}

function clampNote(x: any): string | null {
  if (x === undefined || x === null) return null;
  const s = String(x).trim();
  if (!s) return null;
  return s.length > 2000 ? s.slice(0, 2000) : s;
}

function clampReason(x: any): string | null {
  if (x === undefined || x === null) return null;
  const s = String(x).trim();
  if (!s) return null;
  return s.length > 500 ? s.slice(0, 500) : s;
}

function normalizeStatus(x: any): ActionStatus {
  const s = String(x || "").toUpperCase();
  if (s === "OPEN" || s === "IN_PROGRESS" || s === "DONE" || s === "DISMISSED") return s as ActionStatus;
  return "OPEN";
}

export class ActionPlanStateStore {
  private loaded = false;
  private file: FileShapeV1 | null = null;
  private lastMtimeMs: number | null = null;

  constructor(private params: { shop: string; dataDir?: string }) {
    const shop = normalizeShopDomain(params.shop);
    if (!isValidShopDomain(shop)) {
      throw new Error(`Invalid shop domain for ActionPlanStateStore: ${String(params.shop)}`);
    }
    this.params.shop = shop;
  }

  private filePath() {
    const dir = this.params.dataDir ?? path.join(process.cwd(), "data");
    return path.join(dir, `actionPlanState.${this.params.shop}.json`);
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

      if (!parsed || typeof parsed !== "object" || parsed.version !== 1) {
        this.file = null;
        this.loaded = true;
        this.lastMtimeMs = await this.readMtime();
        return;
      }

      const statesRaw = parsed.states && typeof parsed.states === "object" ? parsed.states : {};
      const states: Record<string, ActionStateRecord> = {};

      for (const [actionId, rec] of Object.entries(statesRaw)) {
        if (!actionId || typeof actionId !== "string") continue;
        const r = rec as any;

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
        shop: normalizeShopDomain(parsed.shop ?? this.params.shop),
        updatedAt: String(parsed.updatedAt ?? nowIso()),
        states,
      };

      this.loaded = true;
      this.lastMtimeMs = await this.readMtime();
    } catch {
      this.file = null;
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
      this.file = null;
      this.lastMtimeMs = null;
      return;
    }
    if (mt !== this.lastMtimeMs) {
      await this.loadFromDisk();
    }
  }

  getUpdatedAtSync(): string | null {
    return this.file?.updatedAt ?? null;
  }

  getStateSync(actionId: string): ActionStateRecord | null {
    const id = String(actionId || "");
    if (!id) return null;
    return this.file?.states?.[id] ?? null;
  }

  async list(): Promise<ActionStateRecord[]> {
    await this.ensureFresh();
    const states = this.file?.states ?? {};
    return Object.values(states).sort((a, b) => String(a.actionId).localeCompare(String(b.actionId)));
  }

  async upsert(params: {
    actionId: string;
    status?: ActionStatus | null;
    note?: string | null;
    dueDate?: string | null;
    dismissedReason?: string | null;
  }): Promise<ActionStateRecord> {
    await this.ensureFresh();

    const actionId = String(params.actionId || "").trim();
    if (!actionId) throw new Error("actionId is required");

    const prev = this.getStateSync(actionId);

    const nextStatus =
      params.status === undefined || params.status === null
        ? prev?.status ?? "OPEN"
        : normalizeStatus(params.status);

    const nextNote = params.note === undefined ? prev?.note ?? null : clampNote(params.note);

    const nextDue =
      params.dueDate === undefined
        ? prev?.dueDate ?? null
        : params.dueDate && isIsoLike(params.dueDate)
          ? String(params.dueDate)
          : null;

    const nextDismissReason =
      params.dismissedReason === undefined
        ? prev?.dismissedReason ?? null
        : clampReason(params.dismissedReason);

    const dismissedReason = nextStatus === "DISMISSED" ? nextDismissReason ?? null : null;

    const rec: ActionStateRecord = {
      actionId,
      status: nextStatus,
      note: nextNote ?? null,
      dueDate: nextDue ?? null,
      dismissedReason,
      updatedAt: nowIso(),
    };

    const file =
      this.file ??
      ({
        version: 1,
        shop: this.params.shop,
        updatedAt: nowIso(),
        states: {},
      } as FileShapeV1);

    file.states[actionId] = rec;
    file.updatedAt = nowIso();
    this.file = file;

    await this.persist();
    return rec;
  }

  async clear(actionId: string): Promise<void> {
    await this.ensureFresh();

    const id = String(actionId || "").trim();
    if (!id) return;
    if (!this.file?.states?.[id]) return;

    delete this.file.states[id];
    this.file.updatedAt = nowIso();
    await this.persist();
  }

  async clearAll(): Promise<void> {
    await this.ensureFresh();
    this.file = null;

    try {
      await fs.unlink(this.filePath());
    } catch {
      // ignore
    }

    this.lastMtimeMs = await this.readMtime();
  }

  private async persist(): Promise<void> {
    const fp = this.filePath();
    await fs.mkdir(path.dirname(fp), { recursive: true });

    const payload: FileShapeV1 =
      this.file ??
      ({
        version: 1,
        shop: this.params.shop,
        updatedAt: nowIso(),
        states: {},
      } as FileShapeV1);

    const tmp = `${fp}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(payload, null, 2), "utf-8");
    await fs.rename(tmp, fp);

    this.lastMtimeMs = await this.readMtime();
  }
}