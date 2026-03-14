import type { FastifyInstance } from "fastify";
import type { ShopifyCtx } from "./ctx.js";
import { requireEmbeddedAuthAndMatchShop } from "./auth.js";
import { parseShop } from "./helpers.js";
import {
  getBillingPlanOrThrow,
  getBillingPlans,
  isBillingPlanKey,
  type BillingPlanKey,
} from "../../domain/billing/plans.js";
import {
  createRecurringSubscription,
  getPrimaryActiveSubscription,
} from "../../integrations/shopify/billing.js";
import { normalizeShopDomain } from "../../storage/shopsStore.js";

type BillingStatusPlanSummary = {
  key: BillingPlanKey;
  name: string;
  priceUsd: number;
  description: string;
  isCurrent: boolean;
};

type BillingStatusResponse = {
  shop: string;
  active: boolean;
  plan: BillingPlanKey;
  subscriptionId: string | null;
  subscriptionName: string | null;
  status: string | null;
  statusLabel: string;
  trialDays: number;
  currentPeriodEnd: string | null;
  test: boolean;
  isBypass: boolean;
  isTrial: boolean;
  availablePlans: BillingStatusPlanSummary[];
};

function cleanAppUrl(input: string) {
  return String(input || "").replace(/\/$/, "");
}

function inferPlanFromStoredOrDefault(value: unknown): BillingPlanKey {
  return isBillingPlanKey(value) ? value : "starter";
}

function resolveBypassPlan(app: FastifyInstance): BillingPlanKey {
  const raw = String((app.config as any).BILLING_BYPASS_PLAN || "pro").trim();
  return isBillingPlanKey(raw) ? raw : "pro";
}

function mapStatusLabel(params: {
  active: boolean;
  status: string | null;
  test: boolean;
  isBypass: boolean;
  trialDays: number;
}) {
  if (params.isBypass) return "Dev bypass";
  if (!params.active) return "Inactive";

  const status = String(params.status || "").toUpperCase();

  if (params.trialDays > 0) return `Trial (${params.trialDays} days)`;
  if (params.test) return "Active (test)";
  if (status === "ACTIVE") return "Active";
  if (status === "CANCELLED") return "Cancelled";
  if (status === "PENDING") return "Pending";

  return params.status || "Active";
}

function buildAvailablePlans(currentPlan: BillingPlanKey): BillingStatusPlanSummary[] {
  return getBillingPlans().map((plan) => ({
    key: plan.key,
    name: plan.name,
    priceUsd: plan.priceUsd,
    description: plan.description,
    isCurrent: plan.key === currentPlan,
  }));
}

function readHost(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  return raw || null;
}

function buildEmbeddedAppRedirect(params: {
  shop: string;
  host?: string | null;
  route?: string | null;
  billing?: string | null;
  plan?: string | null;
}) {
  const parts = new URLSearchParams();

  parts.set("shop", params.shop);

  if (params.host) {
    parts.set("host", params.host);
  }

  if (params.route) {
    parts.set("route", params.route);
  }

  if (params.billing) {
    parts.set("billing", params.billing);
  }

  if (params.plan) {
    parts.set("plan", params.plan);
  }

  return `/app?${parts.toString()}`;
}

export function registerBillingRoutes(app: FastifyInstance, ctx: ShopifyCtx) {
  const apiVersion = String((app.config as any).SHOPIFY_API_VERSION || "2026-01");
  const appUrl = cleanAppUrl(String(app.config.APP_URL || ""));
  const trialDays = Math.max(
    0,
    Number((app.config as any).BILLING_TRIAL_DAYS ?? 7) || 0
  );
  const billingTestMode = Boolean((app.config as any).BILLING_TEST_MODE ?? true);
  const billingBypass = Boolean((app.config as any).BILLING_BYPASS ?? false);

  app.get("/api/billing/status", async (req, reply) => {
    const q = req.query as any;
    const requestedShop = parseShop(q);

    const auth = await requireEmbeddedAuthAndMatchShop(app, req, reply, requestedShop);
    if (!auth) return;

    const shop = auth.shop;

    if (billingBypass) {
      const bypassPlan = resolveBypassPlan(app);

      req.log.warn({
        msg: "Billing bypass active",
        shop,
        bypassPlan,
      });

      const out: BillingStatusResponse = {
        shop,
        active: true,
        plan: bypassPlan,
        subscriptionId: "dev-bypass",
        subscriptionName: `Dev Bypass ${bypassPlan}`,
        status: "ACTIVE",
        statusLabel: "Dev bypass",
        trialDays: 0,
        currentPeriodEnd: null,
        test: true,
        isBypass: true,
        isTrial: false,
        availablePlans: buildAvailablePlans(bypassPlan),
      };

      return reply.send(out);
    }

    const shopify = await ctx.createShopifyForShop(shop);
    const activeSub = await getPrimaryActiveSubscription({
      shopify,
      apiVersion,
    });

    if (activeSub?.planKey) {
      await ctx.shopsStore.upsertBilling({
        shop,
        plan: activeSub.planKey,
        subscriptionId: activeSub.id,
        status: activeSub.status,
        currentPeriodEnd: activeSub.currentPeriodEnd,
        subscriptionName: activeSub.name,
        test: activeSub.test,
        trialDays: activeSub.trialDays,
      });

      const out: BillingStatusResponse = {
        shop,
        active: true,
        plan: activeSub.planKey,
        subscriptionId: activeSub.id,
        subscriptionName: activeSub.name,
        status: activeSub.status,
        statusLabel: mapStatusLabel({
          active: true,
          status: activeSub.status,
          test: activeSub.test,
          isBypass: false,
          trialDays: activeSub.trialDays,
        }),
        trialDays: activeSub.trialDays,
        currentPeriodEnd: activeSub.currentPeriodEnd,
        test: activeSub.test,
        isBypass: false,
        isTrial: activeSub.trialDays > 0,
        availablePlans: buildAvailablePlans(activeSub.planKey),
      };

      return reply.send(out);
    }

    const stored = await ctx.shopsStore.get(shop);
    const currentPlan = inferPlanFromStoredOrDefault(stored?.billing?.plan);

    const out: BillingStatusResponse = {
      shop,
      active: false,
      plan: currentPlan,
      subscriptionId: stored?.billing?.subscriptionId ?? null,
      subscriptionName: stored?.billing?.subscriptionName ?? null,
      status: stored?.billing?.status ?? null,
      statusLabel: "Inactive",
      trialDays: Number(stored?.billing?.trialDays ?? 0),
      currentPeriodEnd: stored?.billing?.currentPeriodEnd ?? null,
      test: Boolean(stored?.billing?.test ?? false),
      isBypass: false,
      isTrial: Number(stored?.billing?.trialDays ?? 0) > 0,
      availablePlans: buildAvailablePlans(currentPlan),
    };

    return reply.send(out);
  });

  app.post("/api/billing/subscribe", async (req, reply) => {
    try {
      const body = (req.body ?? {}) as any;
      const q = req.query as any;

      const requestedShop = parseShop(q) || parseShop(body);
      const host = readHost(q?.host) || readHost(body?.host);

      const auth = await requireEmbeddedAuthAndMatchShop(app, req, reply, requestedShop);
      if (!auth) return;

      const shop = auth.shop;
      const plan = getBillingPlanOrThrow(body?.plan);

      if (billingBypass) {
        return reply.send({
          ok: true,
          shop,
          plan: plan.key,
          confirmationUrl: buildEmbeddedAppRedirect({
            shop,
            host,
            route: "billing",
            billing: "bypass",
            plan: plan.key,
          }),
        });
      }

      const shopify = await ctx.createShopifyForShop(shop);
      const existing = await getPrimaryActiveSubscription({
        shopify,
        apiVersion,
      });

      if (existing?.planKey === plan.key) {
        return reply.send({
          ok: true,
          shop,
          plan: plan.key,
          alreadyOnPlan: true,
          confirmationUrl: buildEmbeddedAppRedirect({
            shop,
            host,
            route: "billing",
            billing: "unchanged",
            plan: plan.key,
          }),
        });
      }

      const returnUrl =
        `${appUrl}/api/billing/confirm` +
        `?shop=${encodeURIComponent(shop)}` +
        `&plan=${encodeURIComponent(plan.key)}` +
        (host ? `&host=${encodeURIComponent(host)}` : "");

      const result = await createRecurringSubscription({
        shopify,
        apiVersion,
        plan,
        returnUrl,
        trialDays,
        test: billingTestMode,
      });

      return reply.send({
        ok: true,
        shop,
        plan: plan.key,
        confirmationUrl: result.confirmationUrl,
      });
    } catch (e: any) {
      req.log.error({
        msg: "Billing subscribe failed",
        error: e?.message ?? String(e),
        status: e?.status,
        code: e?.code,
      });

      return reply.status(Number(e?.status) || 400).send({
        error: e?.message ?? "Billing subscribe failed",
        code: e?.code ?? "BILLING_SUBSCRIBE_FAILED",
      });
    }
  });

  app.get("/api/billing/confirm", async (req, reply) => {
    const q = req.query as any;
    const shop = normalizeShopDomain(String(q?.shop || ""));
    const requestedPlan = String(q?.plan || "").trim();
    const host = readHost(q?.host);

    if (!shop) {
      return reply.status(400).send({
        error: "Missing shop",
        code: "MISSING_SHOP",
      });
    }

    if (billingBypass) {
      const targetPlan = isBillingPlanKey(requestedPlan)
        ? requestedPlan
        : resolveBypassPlan(app);

      const redirectUrl = buildEmbeddedAppRedirect({
        shop,
        host,
        route: "billing",
        billing: "confirmed",
        plan: targetPlan,
      });

      return reply.redirect(redirectUrl, 302);
    }

    const shopify = await ctx.createShopifyForShop(shop);
    const activeSub = await getPrimaryActiveSubscription({
      shopify,
      apiVersion,
    });

    if (activeSub?.planKey) {
      await ctx.shopsStore.upsertBilling({
        shop,
        plan: activeSub.planKey,
        subscriptionId: activeSub.id,
        status: activeSub.status,
        currentPeriodEnd: activeSub.currentPeriodEnd,
        subscriptionName: activeSub.name,
        test: activeSub.test,
        trialDays: activeSub.trialDays,
      });
    }

    const targetPlan =
      activeSub?.planKey ||
      (isBillingPlanKey(requestedPlan) ? requestedPlan : "starter");

    const redirectUrl = buildEmbeddedAppRedirect({
      shop,
      host,
      route: "billing",
      billing: "confirmed",
      plan: targetPlan,
    });

    return reply.redirect(redirectUrl, 302);
  });
}