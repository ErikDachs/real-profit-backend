import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import jwt from "jsonwebtoken";
import { isValidShopDomain, normalizeShopDomain } from "../../storage/shopsStore.js";

type ShopifySessionTokenPayload = {
  aud?: string | string[];
  dest?: string;
  exp?: number;
  iss?: string;
  nbf?: number;
  sub?: string;
  iat?: number;
  sid?: string;
  jti?: string;
};

export type EmbeddedAuthResult = {
  shop: string;
  payload: ShopifySessionTokenPayload;
};

function extractBearerToken(req: FastifyRequest): string | null {
  const raw = req.headers.authorization;
  if (!raw || typeof raw !== "string") return null;

  const prefix = "Bearer ";
  if (!raw.startsWith(prefix)) return null;

  const token = raw.slice(prefix.length).trim();
  return token || null;
}

function shopFromDest(dest: string | undefined): string {
  const raw = String(dest ?? "").trim();
  if (!raw) return "";

  const normalized = normalizeShopDomain(raw.replace(/^https?:\/\//i, ""));
  return isValidShopDomain(normalized) ? normalized : "";
}

function sendUnauthorized(reply: FastifyReply, message: string) {
  reply.header("X-Shopify-Retry-Invalid-Session-Request", "1");
  return reply.status(401).send({
    error: "Unauthorized",
    details: message,
  });
}

export async function requireEmbeddedAuth(
  app: FastifyInstance,
  req: FastifyRequest,
  reply: FastifyReply
): Promise<EmbeddedAuthResult | null> {
  const token = extractBearerToken(req);
  if (!token) {
    sendUnauthorized(reply, "Missing session token");
    return null;
  }

  const secret = String(app.config.SHOPIFY_API_SECRET || "").trim();
  const apiKey = String(app.config.SHOPIFY_API_KEY || "").trim();

  if (!secret || !apiKey) {
    reply.status(500).send({
      error: "Auth misconfiguration",
      details: "SHOPIFY_API_SECRET or SHOPIFY_API_KEY missing",
    });
    return null;
  }

  let payload: ShopifySessionTokenPayload;
  try {
    payload = jwt.verify(token, secret, {
      algorithms: ["HS256"],
      audience: apiKey,
    }) as ShopifySessionTokenPayload;
  } catch (err: any) {
    sendUnauthorized(reply, `Invalid session token: ${String(err?.message ?? err)}`);
    return null;
  }

  const shop = shopFromDest(payload.dest);
  if (!shop) {
    sendUnauthorized(reply, "Session token does not contain a valid shop");
    return null;
  }

  return { shop, payload };
}

export async function requireEmbeddedAuthAndMatchShop(
  app: FastifyInstance,
  req: FastifyRequest,
  reply: FastifyReply,
  requestedShopRaw?: unknown
): Promise<EmbeddedAuthResult | null> {
  const auth = await requireEmbeddedAuth(app, req, reply);
  if (!auth) return null;

  const requestedShop = normalizeShopDomain(String(requestedShopRaw ?? "").trim());
  if (requestedShop && requestedShop !== auth.shop) {
    reply.status(403).send({
      error: "Forbidden",
      details: "Requested shop does not match authenticated shop",
    });
    return null;
  }

  return auth;
}