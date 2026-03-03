// src/routes/shopify/webhooks.route.ts
import type { FastifyInstance } from "fastify";
import crypto from "node:crypto";
import { ShopsStore, isValidShopDomain } from "../../storage/shopsStore";

function verifyWebhookHmac(params: { rawBody: Buffer; hmacHeader: string; secret: string }): boolean {
  const { rawBody, hmacHeader, secret } = params;
  if (!hmacHeader) return false;

  const digest = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");

  const a = Buffer.from(digest, "base64");
  const b = Buffer.from(hmacHeader, "base64");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function registerShopifyWebhooksRoutes(app: FastifyInstance) {
  const shopsStore = new ShopsStore({ dataDir: app.config.DATA_DIR });
  await shopsStore.ensureLoaded();

  const apiSecret = String(app.config.SHOPIFY_API_SECRET || "").trim();

  await app.register(async function webhookScope(instance) {
    instance.addContentTypeParser("*", { parseAs: "buffer" }, (req, body: Buffer, done) => {
      (req as any).rawBody = body;
      const txt = body.toString("utf8");
      try {
        done(null, txt ? JSON.parse(txt) : {});
      } catch {
        done(null, {});
      }
    });

    instance.post("/api/shopify/webhooks", async (req, reply) => {
      const rawBody: Buffer = (req as any).rawBody ?? Buffer.from("", "utf8");

      const hmacHeader = String((req.headers["x-shopify-hmac-sha256"] as any) ?? "");
      const topic = String((req.headers["x-shopify-topic"] as any) ?? "");
      const shop = String((req.headers["x-shopify-shop-domain"] as any) ?? "").toLowerCase();

      const ok = verifyWebhookHmac({ rawBody, hmacHeader, secret: apiSecret });

      if (!ok) {
        reply.status(401);
        return { ok: false, error: "Invalid webhook HMAC" };
      }

      reply.status(200);

      if (topic === "app/uninstalled") {
        if (isValidShopDomain(shop)) {
          await shopsStore.clearToken({ shop, reason: "UNINSTALLED" });
        }
        return { ok: true };
      }

      return { ok: true };
    });
  });
}