// src/storage/webhookDedupeStore.ts
import fs from "node:fs/promises";
import path from "node:path";
import { isValidShopDomain, normalizeShopDomain } from "./shopsStore.js";

type FileShapeV1 = {
  version: 1;
  shop: string;
  updatedAt: string;
  // eventId -> seenAt ISO
  seen: Record<string, string>;
};

function nowIso() {
  return new Date().toISOString();
}

function clampEventId(eventId: any): string {
  const s = String(eventId ?? "").trim();
  // Keep it strict & short (no PII, but also no huge keys)
  if (!s) return "";
  return s.length > 200 ? s.slice(0, 200) : s;
}

/**
 * ✅ PCD-safe dedupe store:
 * - Stores only Shopify event ids + timestamps (no payload, no customer data).
 * - Per shop file: <dataDir>/webhookDedupe.<shop>.json
 * - TTL pruning on write.
 */
export class WebhookDedupeStore {
  private loaded = false;
  private file: FileShapeV1 | null = null;

  constructor(private params: { shop: string; dataDir?: string }) {
    const shop = normalizeShopDomain(params.shop);
    if (!isValidShopDomain(shop)) {
      throw new Error(`Invalid shop domain for WebhookDedupeStore: ${String(params.shop)}`);
    }
    this.params.shop = shop;
  }

  private filePath() {
    const dir = this.params.dataDir ?? path.join(process.cwd(), "data");
    return path.join(dir, `webhookDedupe.${this.params.shop}.json`);
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    try {
      const raw = await fs.readFile(this.filePath(), "utf-8");
      const parsed = JSON.parse(raw);

      if (!parsed || typeof parsed !== "object" || parsed.version !== 1) {
        this.file = null;
        return;
      }

      const seenRaw = parsed.seen && typeof parsed.seen === "object" ? parsed.seen : {};
      const seen: Record<string, string> = {};

      for (const [k, v] of Object.entries(seenRaw)) {
        const id = clampEventId(k);
        const ts = String(v ?? "");
        if (!id) continue;
        if (!/^\d{4}-\d{2}-\d{2}T/.test(ts)) continue;
        seen[id] = ts;
      }

      this.file = {
        version: 1,
        shop: String(parsed.shop ?? this.params.shop),
        updatedAt: String(parsed.updatedAt ?? nowIso()),
        seen,
      };
    } catch {
      this.file = null;
    }
  }

  async has(eventId: string): Promise<boolean> {
    await this.ensureLoaded();
    const id = clampEventId(eventId);
    if (!id) return false;
    return Boolean(this.file?.seen?.[id]);
  }

  async put(eventId: string, ttlDays = 30): Promise<void> {
    await this.ensureLoaded();
    const id = clampEventId(eventId);
    if (!id) return;

    const file =
      this.file ??
      ({
        version: 1,
        shop: this.params.shop,
        updatedAt: nowIso(),
        seen: {},
      } as FileShapeV1);

    file.seen[id] = nowIso();
    file.updatedAt = nowIso();

    // prune
    const ttlMs = Math.max(1, ttlDays) * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - ttlMs;

    for (const [eid, seenAt] of Object.entries(file.seen)) {
      const t = Date.parse(seenAt);
      if (!Number.isFinite(t) || t < cutoff) delete file.seen[eid];
    }

    this.file = file;
    await this.persist();
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
        seen: {},
      } as FileShapeV1);

    const tmp = `${fp}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(payload, null, 2), "utf-8");
    await fs.rename(tmp, fp);
  }
}