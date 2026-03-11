import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ShopsStore,
  normalizeShopDomain,
  isValidShopDomain,
} from "../storage/shopsStore.js";

function publicFilePath(filename: string) {
  return path.join(process.cwd(), "public", filename);
}

async function sendPublicFile(reply: any, filename: string, contentType: string) {
  const file = await readFile(publicFilePath(filename), "utf8");
  reply.header("Content-Type", contentType);
  reply.header("Cache-Control", "no-store");
  return reply.send(file);
}

type AppQuery = {
  shop?: string;
  hmac?: string;
  host?: string;
  session?: string;
  timestamp?: string;
  embedded?: string;
};

async function resolveSingleKnownShop(app: FastifyInstance): Promise<string | null> {
  const shopsStore = new ShopsStore({ dataDir: app.config.DATA_DIR });
  await shopsStore.ensureLoaded();

  const rows = await shopsStore.listMasked();
  if (!Array.isArray(rows) || rows.length !== 1) return null;

  const rawShop = String((rows[0] as any)?.shop ?? "").trim();
  const shop = normalizeShopDomain(rawShop);

  return isValidShopDomain(shop) ? shop : null;
}

export async function registerAppFrontendRoutes(app: FastifyInstance) {
  // Shopify Admin often opens the app at "/?shop=...&host=...&hmac=..."
  // We must not 404 there.
  app.get<{ Querystring: AppQuery }>("/", async (req, reply) => {
    const queryShop = normalizeShopDomain(String(req.query.shop || "").trim());

    if (isValidShopDomain(queryShop)) {
      return reply.redirect(`/app?shop=${encodeURIComponent(queryShop)}`);
    }

    const singleKnownShop = await resolveSingleKnownShop(app);
    if (singleKnownShop) {
      return reply.redirect(`/app?shop=${encodeURIComponent(singleKnownShop)}`);
    }

    reply.header("Content-Type", "text/html; charset=utf-8");
    reply.header("Cache-Control", "no-store");
    return reply.send(`
      <!doctype html>
      <html lang="en">
        <head>
          <meta charset="UTF-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1" />
          <title>ProfitLens Analytics</title>
          <style>
            body {
              margin: 0;
              font-family: Inter, Arial, sans-serif;
              background: #f5f7fb;
              color: #17212f;
            }
            .wrap {
              max-width: 760px;
              margin: 80px auto;
              padding: 24px;
            }
            .card {
              background: #fff;
              border: 1px solid #e5eaf2;
              border-radius: 18px;
              padding: 24px;
              box-shadow: 0 12px 32px rgba(19, 33, 68, 0.08);
            }
            h1 {
              margin: 0 0 12px;
              font-size: 32px;
            }
            p {
              margin: 0;
              color: #5f6c7b;
              line-height: 1.6;
            }
            .hint {
              margin-top: 16px;
              font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
              color: #0f766e;
            }
          </style>
        </head>
        <body>
          <div class="wrap">
            <div class="card">
              <h1>ProfitLens Analytics</h1>
              <p>
                No shop context was provided. Please open the app from Shopify Admin
                or use a URL like:
              </p>
              <p class="hint">/app?shop=your-store.myshopify.com</p>
            </div>
          </div>
        </body>
      </html>
    `);
  });

  app.get<{ Querystring: AppQuery }>("/app", async (req, reply) => {
    const queryShop = normalizeShopDomain(String(req.query.shop || "").trim());

    if (isValidShopDomain(queryShop)) {
      return sendPublicFile(reply, "app.html", "text/html; charset=utf-8");
    }

    const singleKnownShop = await resolveSingleKnownShop(app);
    if (singleKnownShop) {
      return reply.redirect(`/app?shop=${encodeURIComponent(singleKnownShop)}`);
    }

    return sendPublicFile(reply, "app.html", "text/html; charset=utf-8");
  });

  app.get("/app.css", async (_req, reply) => {
    return sendPublicFile(reply, "app.css", "text/css; charset=utf-8");
  });

  app.get("/app.js", async (_req, reply) => {
    return sendPublicFile(reply, "app.js", "application/javascript; charset=utf-8");
  });
}