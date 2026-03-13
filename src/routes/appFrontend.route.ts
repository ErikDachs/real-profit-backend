import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { normalizeShopDomain, isValidShopDomain } from "../storage/shopsStore.js";

function publicFilePath(...parts: string[]) {
  return path.join(process.cwd(), "public", ...parts);
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
        <title>Real Profit</title>
        <style>
          body {
            margin: 0;
            font-family: Inter, Arial, sans-serif;
            background: #0b1020;
            color: #f5f7fb;
          }
          .wrap {
            max-width: 760px;
            margin: 80px auto;
            padding: 24px;
          }
          .card {
            background: #12182b;
            border: 1px solid #26304a;
            border-radius: 18px;
            padding: 24px;
            box-shadow: 0 12px 32px rgba(0, 0, 0, 0.25);
          }
          h1 {
            margin: 0 0 12px;
            font-size: 32px;
          }
          p {
            margin: 0 0 12px;
            color: #8e9ab2;
            line-height: 1.6;
          }
          .hint {
            margin-top: 16px;
            font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
            color: #3dd9c5;
          }
        </style>
      </head>
      <body>
        <div class="wrap">
          <div class="card">
            <h1>Real Profit</h1>
            <p>Please open this app from Shopify Admin.</p>
            <p class="hint">This app requires an authenticated embedded Shopify session.</p>
          </div>
        </div>
      </body>
    </html>
  `);
}

function injectRuntimeParams(html: string, query: AppQuery) {
  const shop = normalizeShopDomain(String(query.shop || "").trim());
  const host = String(query.host || "").trim();
  const embedded = String(query.embedded || "").trim();
  const apiKey = process.env.SHOPIFY_API_KEY || "";

  const runtimeScript = `
    <script>
      window.__REAL_PROFIT_RUNTIME__ = {
        shop: ${JSON.stringify(shop || "")},
        host: ${JSON.stringify(host || "")},
        embedded: ${JSON.stringify(embedded || "")},
        apiKey: ${JSON.stringify(apiKey)}
      };
    </script>
  `;

  return html.replace("</head>", `${runtimeScript}\n</head>`);
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

    const indexPath = publicFilePath("index.html");

    if (!existsSync(indexPath)) {
      return reply.status(500).send({
        error: "Frontend build missing",
        details: "backend/public/index.html not found. Build the frontend first.",
      });
    }

    const html = await readFile(indexPath, "utf8");
    const injected = injectRuntimeParams(html, req.query);

    reply.header("Content-Type", "text/html; charset=utf-8");
    reply.header("Cache-Control", "no-store");
    return reply.send(injected);
  });

  app.get("/assets/*", async (req, reply) => {
    const wildcard = (req.params as any)["*"];
    const filePath = publicFilePath("assets", wildcard);

    if (!existsSync(filePath)) {
      return reply.status(404).send({ error: "Asset not found" });
    }

    const ext = path.extname(filePath).toLowerCase();

    const contentType =
      ext === ".js"
        ? "application/javascript; charset=utf-8"
        : ext === ".css"
          ? "text/css; charset=utf-8"
          : ext === ".svg"
            ? "image/svg+xml"
            : ext === ".png"
              ? "image/png"
              : ext === ".jpg" || ext === ".jpeg"
                ? "image/jpeg"
                : "application/octet-stream";

    const file = await readFile(filePath);
    reply.header("Content-Type", contentType);
    reply.header("Cache-Control", "public, max-age=31536000, immutable");
    return reply.send(file);
  });
}