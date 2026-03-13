import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { normalizeShopDomain, isValidShopDomain } from "../storage/shopsStore.js";

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

function buildAppUrl(query: AppQuery): string {
  const params = new URLSearchParams();

  const shop = normalizeShopDomain(String(query.shop || "").trim());
  const host = String(query.host || "").trim();
  const embedded = String(query.embedded || "").trim();

  if (isValidShopDomain(shop)) params.set("shop", shop);
  if (host) params.set("host", host);
  if (embedded) params.set("embedded", embedded);

  return `/app?${params.toString()}`;
}

function sendOpenFromShopifyPage(reply: any) {
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
            margin: 0 0 12px;
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
            <p>Please open this app from Shopify Admin.</p>
            <p class="hint">This page no longer serves merchant data without an authenticated embedded app session.</p>
          </div>
        </div>
      </body>
    </html>
  `);
}

export async function registerAppFrontendRoutes(app: FastifyInstance) {
  app.get<{ Querystring: AppQuery }>("/", async (req, reply) => {
    const queryShop = normalizeShopDomain(String(req.query.shop || "").trim());

    if (isValidShopDomain(queryShop)) {
      return reply.redirect(buildAppUrl(req.query));
    }

    return sendOpenFromShopifyPage(reply);
  });

  app.get<{ Querystring: AppQuery }>("/app", async (req, reply) => {
    const queryShop = normalizeShopDomain(String(req.query.shop || "").trim());
    const host = String(req.query.host || "").trim();

    if (!isValidShopDomain(queryShop) || !host) {
      return sendOpenFromShopifyPage(reply);
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