import type { FastifyInstance } from "fastify";
import {
  ShopsStore,
  ShopsStoreError,
  isValidShopDomain,
  normalizeShopDomain,
} from "../../storage/shopsStore.js";
import {
  buildAuthorizeUrl,
  exchangeCodeForAccessToken,
  randomState,
  verifyShopifyQueryHmac,
  ShopifyOAuthError,
} from "../../integrations/shopify/oauth.js";
import { registerWebhooksAfterInstall } from "../../integrations/shopify/webhooks.js";

type OAuthInstallQuery = {
  shop?: string;
  hmac?: string;
  timestamp?: string;
  host?: string;
  embedded?: string;
};

type OAuthCallbackQuery = {
  shop?: string;
  hmac?: string;
  timestamp?: string;
  host?: string;
  code?: string;
  state?: string;
};

function errReply(e: any) {
  const status = Number(e?.status) || 500;
  return {
    status,
    body: {
      error: e?.message ?? "Unexpected error",
      code: e?.code ?? "UNKNOWN",
    },
  };
}

export async function registerShopifyOAuthRoutes(app: FastifyInstance) {
  const shopsStore = new ShopsStore({ dataDir: app.config.DATA_DIR });
  await shopsStore.ensureLoaded();

  const apiKey = String(app.config.SHOPIFY_API_KEY || "").trim();
  const apiSecret = String(app.config.SHOPIFY_API_SECRET || "").trim();
  const scopes = String(app.config.SHOPIFY_SCOPES || "read_orders,read_products").trim();
  const appUrl = String(app.config.APP_URL || "").trim();

  const redirectUri = `${appUrl.replace(/\/$/, "")}/api/shopify/oauth/callback`;
  const apiVersion = "2024-01";

  app.get<{ Querystring: OAuthInstallQuery }>("/api/shopify/oauth/install", async (req, reply) => {
    try {
      const shop = normalizeShopDomain(req.query.shop || "");
      if (!isValidShopDomain(shop)) {
        reply.status(400);
        return { error: "Invalid shop domain", code: "INVALID_SHOP" };
      }

      if (req.query.hmac) {
        const ok = verifyShopifyQueryHmac({ query: req.query as any, apiSecret });
        if (!ok) {
          reply.status(401);
          return { error: "Invalid HMAC", code: "HMAC_INVALID" };
        }
      }

      const state = randomState();
      await shopsStore.setPendingOAuthState({ shop, state, ttlSeconds: 10 * 60 });

      const authorizeUrl = buildAuthorizeUrl({
        shop,
        apiKey,
        scopes,
        redirectUri,
        state,
      });

      reply.header("Cache-Control", "no-store");
      reply.code(302);
      return reply.redirect(authorizeUrl);
    } catch (e: any) {
      if (e instanceof ShopsStoreError) {
        reply.status(e.status);
        return { error: e.message, code: e.code };
      }
      const { status, body } = errReply(e);
      reply.status(status);
      return body;
    }
  });

  app.get<{ Querystring: OAuthCallbackQuery }>("/api/shopify/oauth/callback", async (req, reply) => {
    try {
      const shop = normalizeShopDomain(req.query.shop || "");
      const code = String(req.query.code || "").trim();
      const state = String(req.query.state || "").trim();

      if (!isValidShopDomain(shop)) {
        throw new ShopifyOAuthError("Invalid shop domain", "INVALID_SHOP", 400);
      }
      if (!code) {
        throw new ShopifyOAuthError("Missing code", "MISSING_PARAM", 400);
      }
      if (!state) {
        throw new ShopifyOAuthError("Missing state", "MISSING_PARAM", 400);
      }

      const ok = verifyShopifyQueryHmac({ query: req.query as any, apiSecret });
      if (!ok) {
        throw new ShopifyOAuthError("Invalid HMAC", "HMAC_INVALID", 401);
      }

      await shopsStore.consumePendingOAuthState({ shop, state });

      const tok = await exchangeCodeForAccessToken({ shop, apiKey, apiSecret, code });
      await shopsStore.upsertToken({ shop, accessToken: tok.access_token, scope: tok.scope ?? null });

      await registerWebhooksAfterInstall({
        shop,
        accessToken: tok.access_token,
        apiVersion,
        appUrl,
      });

      reply.header("Cache-Control", "no-store");
      return reply.redirect(`/app?shop=${encodeURIComponent(shop)}`);
    } catch (e: any) {
      if (e instanceof ShopsStoreError) {
        reply.status(e.status);
        return { error: e.message, code: e.code };
      }
      const { status, body } = errReply(e);
      reply.status(status);
      return body;
    }
  });

  app.get("/api/shopify/debug/shops", async (_req, reply) => {
    try {
      const rows = await shopsStore.listMasked();
      return reply.send({ ok: true, count: rows.length, shops: rows });
    } catch (e: any) {
      const { status, body } = errReply(e);
      return reply.status(status).send(body);
    }
  });
}