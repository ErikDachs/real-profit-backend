import type { FastifyInstance } from "fastify";
import type { ShopifyCtx } from "./ctx.js";
import { requireEmbeddedAuthAndMatchShop } from "./auth.js";
import { parseShop } from "./helpers.js";
import {
  getBillingPlanOrThrow,
  isBillingPlanKey,
  type BillingPlanKey,
} from "../../domain/billing/plans.js";
import {
  createRecurringSubscription,
  getPrimaryActiveSubscription,
} from "../../integrations/shopify/billing.js";
import { normalizeShopDomain } from "../../storage/shopsStore.js";

type BillingStatusResponse = {
  shop: string;
  active: boolean;
  plan: BillingPlanKey;
  subscriptionId: string | null;
  subscriptionName: string | null;
  status: string | null;
  trialDays: number;
  currentPeriodEnd: string | null;
  test: boolean;
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
        trialDays: 0,
        currentPeriodEnd: null,
        test: true,
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
        trialDays: activeSub.trialDays,
        currentPeriodEnd: activeSub.currentPeriodEnd,
        test: activeSub.test,
      };

      return reply.send(out);
    }

    const stored = await ctx.shopsStore.get(shop);

    const out: BillingStatusResponse = {
      shop,
      active: false,
      plan: inferPlanFromStoredOrDefault(stored?.billing?.plan),
      subscriptionId: stored?.billing?.subscriptionId ?? null,
      subscriptionName: stored?.billing?.subscriptionName ?? null,
      status: stored?.billing?.status ?? null,
      trialDays: Number(stored?.billing?.trialDays ?? 0),
      currentPeriodEnd: stored?.billing?.currentPeriodEnd ?? null,
      test: Boolean(stored?.billing?.test ?? false),
    };

    return reply.send(out);
  });

  app.post("/api/billing/subscribe", async (req, reply) => {
    try {
      const body = (req.body ?? {}) as any;
      const q = req.query as any;

      const requestedShop = parseShop(q) || parseShop(body);
      const auth = await requireEmbeddedAuthAndMatchShop(app, req, reply, requestedShop);
      if (!auth) return;

      const shop = auth.shop;

      if (billingBypass) {
        const bypassPlan = getBillingPlanOrThrow(body?.plan ?? resolveBypassPlan(app).toString());

        return reply.send({
          ok: true,
          shop,
          plan: bypassPlan.key,
          confirmationUrl: `/app?shop=${encodeURIComponent(shop)}&billing=bypass&plan=${encodeURIComponent(
            bypassPlan.key
          )}`,
        });
      }

      const plan = getBillingPlanOrThrow(body?.plan);
      const shopify = await ctx.createShopifyForShop(shop);

      const returnUrl =
        `${appUrl}/api/billing/confirm` +
        `?shop=${encodeURIComponent(shop)}` +
        `&plan=${encodeURIComponent(plan.key)}`;

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

    if (!shop) {
      return reply.status(400).send({
        error: "Missing shop",
        code: "MISSING_SHOP",
      });
    }

    if (billingBypass) {
      const targetPlan = isBillingPlanKey(requestedPlan) ? requestedPlan : resolveBypassPlan(app);
      const redirectUrl =
        `/app?shop=${encodeURIComponent(shop)}` +
        `&billing=confirmed` +
        `&plan=${encodeURIComponent(targetPlan)}`;

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

    const redirectUrl =
      `/app?shop=${encodeURIComponent(shop)}` +
      `&billing=confirmed` +
      `&plan=${encodeURIComponent(targetPlan)}`;

    return reply.redirect(redirectUrl, 302);
  });
}