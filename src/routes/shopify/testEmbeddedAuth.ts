import jwt from "jsonwebtoken";

type TokenSource = {
  SHOPIFY_API_KEY?: string;
  SHOPIFY_API_SECRET?: string;
};

type MakeTokenParams = {
  shop: string;
  apiKey?: string;
  secret?: string;
  nowSec?: number;
  expSec?: number;
};

function readConfigSource(app?: any): TokenSource {
  if (!app || typeof app !== "object") return {};
  const cfg = (app as any).config;
  if (!cfg || typeof cfg !== "object") return {};
  return cfg as TokenSource;
}

function resolveApiKey(params?: { apiKey?: string; app?: any }): string {
  const fromApp = String(readConfigSource(params?.app).SHOPIFY_API_KEY ?? "").trim();
  const fromParam = String(params?.apiKey ?? "").trim();
  const fromEnv = String(process.env.SHOPIFY_API_KEY ?? "").trim();

  return fromParam || fromApp || fromEnv;
}

function resolveSecret(params?: { secret?: string; app?: any }): string {
  const fromApp = String(readConfigSource(params?.app).SHOPIFY_API_SECRET ?? "").trim();
  const fromParam = String(params?.secret ?? "").trim();
  const fromEnv = String(process.env.SHOPIFY_API_SECRET ?? "").trim();

  return fromParam || fromApp || fromEnv;
}

export function makeEmbeddedSessionToken(
  params: MakeTokenParams & { app?: any }
): string {
  const apiKey = resolveApiKey({ apiKey: params.apiKey, app: params.app });
  const secret = resolveSecret({ secret: params.secret, app: params.app });

  if (!apiKey) {
    throw new Error(
      "SHOPIFY_API_KEY missing for test token generation (pass apiKey, set app.config.SHOPIFY_API_KEY, or set process.env.SHOPIFY_API_KEY)"
    );
  }

  if (!secret) {
    throw new Error(
      "SHOPIFY_API_SECRET missing for test token generation (pass secret, set app.config.SHOPIFY_API_SECRET, or set process.env.SHOPIFY_API_SECRET)"
    );
  }

  const nowSec = Number.isFinite(params.nowSec)
    ? Number(params.nowSec)
    : Math.floor(Date.now() / 1000);

  const expSec = Number.isFinite(params.expSec) ? Number(params.expSec) : 300;

  return jwt.sign(
    {
      aud: apiKey,
      dest: `https://${params.shop}`,
      iss: "https://shopify.dev/test",
      sub: "user-test",
      sid: "sid-test",
      jti: `jti-${params.shop}-${nowSec}`,
      iat: nowSec,
      nbf: nowSec - 5,
      exp: nowSec + expSec,
    },
    secret,
    { algorithm: "HS256" }
  );
}

export function authHeadersForShop(
  shop: string,
  extraHeaders?: Record<string, string>,
  opts?: {
    app?: any;
    apiKey?: string;
    secret?: string;
    nowSec?: number;
    expSec?: number;
  }
) {
  const token = makeEmbeddedSessionToken({
    shop,
    app: opts?.app,
    apiKey: opts?.apiKey,
    secret: opts?.secret,
    nowSec: opts?.nowSec,
    expSec: opts?.expSec,
  });

  return {
    authorization: `Bearer ${token}`,
    ...(extraHeaders ?? {}),
  };
}

type InjectParams = {
  method: string;
  url: string;
  shop: string;
  payload?: any;
  headers?: Record<string, string>;
  apiKey?: string;
  secret?: string;
  nowSec?: number;
  expSec?: number;
};

export async function authedInject(app: any, params: InjectParams) {
  return app.inject({
    method: params.method,
    url: params.url,
    payload: params.payload,
    headers: authHeadersForShop(params.shop, params.headers, {
      app,
      apiKey: params.apiKey,
      secret: params.secret,
      nowSec: params.nowSec,
      expSec: params.expSec,
    }),
  });
}