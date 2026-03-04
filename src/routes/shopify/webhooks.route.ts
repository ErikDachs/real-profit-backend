// src/routes/shopify/webhooks.route.ts
import type { FastifyInstance, FastifyPluginAsync, FastifyRequest } from "fastify";
import crypto from "node:crypto";
import { Readable } from "node:stream";

import { ShopsStore, normalizeShopDomain, isValidShopDomain } from "../../storage/shopsStore.js";
import { CostModelOverridesStore } from "../../storage/costModelOverridesStore.js";
import { CogsOverridesStore } from "../../storage/cogsOverridesStore.js";
import { ActionPlanStateStore } from "../../storage/actionPlanStateStore.js";
import { WebhookDedupeStore } from "../../storage/webhookDedupeStore.js";

type VerifyParams = {
  rawBody: Buffer;
  hmacHeader: string;
  secret: string;
};

const ALLOWED_TOPICS = new Set([
  "app/uninstalled",
  "shop/redact",
  "customers/data_request",
  "customers/redact",
]);

const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024; // 1MB hard cap

function safeB64ToBuffer(b64: string): Buffer | null {
  try {
    if (!b64) return null;
    if (!/^[A-Za-z0-9+/=]+$/.test(b64)) return null;
    return Buffer.from(b64, "base64");
  } catch {
    return null;
  }
}

export function verifyWebhookHmac({ rawBody, hmacHeader, secret }: VerifyParams): boolean {
  if (!secret) return false;

  const computedB64 = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");

  const a = safeB64ToBuffer(computedB64);
  const b = safeB64ToBuffer(hmacHeader);

  if (!a || !b) return false;
  if (a.length !== b.length) return false;

  return crypto.timingSafeEqual(a, b);
}

function getHeader(req: FastifyRequest, name: string): string {
  const v = req.headers[name.toLowerCase()];
  if (Array.isArray(v)) return String(v[0] ?? "");
  return typeof v === "string" ? v : "";
}

function redactShopDomain(shop: string): string {
  const s = String(shop || "");
  const parts = s.split(".");
  if (parts.length < 3) return "***";
  const sub = parts[0] ?? "";
  const redactedSub = sub.length <= 2 ? "***" : `${sub[0]}***${sub[sub.length - 1]}`;
  return [redactedSub, ...parts.slice(1)].join(".");
}

function shortEventId(eventId: string): string | undefined {
  const s = String(eventId || "").trim();
  if (!s) return undefined;
  return s.length <= 10 ? s : `${s.slice(0, 6)}…${s.slice(-3)}`;
}

function dataDirFromEnv(): string | undefined {
  const v = String(process.env.DATA_DIR ?? "").trim();
  return v ? v : undefined;
}

async function readStreamToBuffer(payload: any, limitBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;

  // payload is a stream
  for await (const chunk of payload) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > limitBytes) {
      const err: any = new Error("Webhook body too large");
      err.statusCode = 413;
      throw err;
    }
    chunks.push(buf);
  }

  return Buffer.concat(chunks);
}

export const shopifyWebhooksRoute: FastifyPluginAsync = async (instance: FastifyInstance) => {
  instance.post(
    "/api/shopify/webhooks",
    {
      // ✅ Route-scoped raw-body capture WITHOUT global parser overrides.
      preParsing: async (req, _reply, payload) => {
        const raw = await readStreamToBuffer(payload, MAX_WEBHOOK_BODY_BYTES);
        (req as any).rawBody = raw;

        // ✅ IMPORTANT: return a fresh stream so Fastify/Inject doesn't hang.
        // Even if we never use req.body, Fastify expects a readable payload pipeline.
        return Readable.from(raw);
      },
    },
    async (req, reply) => {
      const rawBody: Buffer = (req as any).rawBody ?? Buffer.from("");

      const hmacHeader = getHeader(req, "x-shopify-hmac-sha256");
      const topic = getHeader(req, "x-shopify-topic");
      const shopHeader = getHeader(req, "x-shopify-shop-domain");
      const eventId = getHeader(req, "x-shopify-event-id");

      // Missing required auth inputs => 401
      if (!hmacHeader || !topic || !shopHeader) {
        return reply.status(401).send();
      }

      // Allowlist: unknown topics => 200 No-Op
      if (!ALLOWED_TOPICS.has(topic)) {
        instance.log.info(
          { evt: "shopify_webhook_noop", topic, shop: redactShopDomain(shopHeader) },
          "Webhook noop (unsupported topic)"
        );
        return reply.status(200).send();
      }
instance.log.warn({ evt: "debug_secret_len", len: (process.env.SHOPIFY_API_SECRET || "").length }, "dbg");
      const ok = verifyWebhookHmac({
        rawBody,
        hmacHeader,
        secret: process.env.SHOPIFY_API_SECRET || "",
      });

      instance.log.info(
        {
          evt: "shopify_webhook",
          ok,
          topic,
          shop: redactShopDomain(shopHeader),
          eventId: shortEventId(eventId),
          rawLen: rawBody.length,
        },
        "Webhook received"
      );

      if (!ok) return reply.status(401).send();

      const shop = normalizeShopDomain(shopHeader);
      if (!isValidShopDomain(shop)) {
        instance.log.warn({ evt: "shopify_webhook_invalid_shop", topic }, "Invalid shop domain in webhook");
        return reply.status(200).send();
      }

      const dataDir = dataDirFromEnv();

      instance.log.warn({ evt: "dbg_datadir", dataDir: dataDir ?? "(cwd)/data", cwd: process.cwd() }, "dbg");
      // Optional dedupe
      if (eventId) {
        try {
          const dedupe = new WebhookDedupeStore({ shop, dataDir });
          const seen = await dedupe.has(eventId);
          if (seen) return reply.status(200).send();
          await dedupe.put(eventId, 30);
        } catch {
          // ignore, rely on idempotence
        }
      }

      try {
        switch (topic) {
          case "app/uninstalled":
          case "shop/redact": {
            const shopsStore = new ShopsStore({ dataDir });
            await shopsStore.clearToken({ shop, reason: "UNINSTALLED" });

            const costModel = new CostModelOverridesStore({ shop, dataDir });
            await costModel.clear();

            const cogs = new CogsOverridesStore({ shop, dataDir });
            await cogs.clearAll();

            const action = new ActionPlanStateStore({ shop, dataDir });
            await action.clearAll();

            break;
          }

          case "customers/data_request":
          case "customers/redact": {
            // ack-only (no customer PII persisted)
            break;
          }
        }

        return reply.status(200).send();
      } catch (e) {
        instance.log.warn(
          { evt: "shopify_webhook_failed", topic, shop: redactShopDomain(shop) },
          "Webhook processing failed"
        );
        return reply.status(500).send();
      }
    }
  );
};

export async function registerShopifyWebhooksRoutes(app: FastifyInstance) {
  await app.register(shopifyWebhooksRoute);
}