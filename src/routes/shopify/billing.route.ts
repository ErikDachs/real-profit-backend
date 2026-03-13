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

export function registerBillingRoutes(app: FastifyInstance, ctx: ShopifyCtx) {
  const apiVersion = String((app.config as any).SHOPIFY_API_VERSION || "2026-01");
  const appUrl = cleanAppUrl(String(app.config.APP_URL || ""));
  const trialDays = Math.max(
    0,
    Number((app.config as any).BILLING_TRIAL_DAYS ?? 7) || 0
  );
  const billingTestMode = Boolean((app.config as any).BILLING_TEST_MODE ?? true);

  app.get("/api/billing/status", async (req, reply) => {
    const q = req.query as any;
    const requestedShop = parseShop(q);

    const auth = await requireEmbeddedAuthAndMatchShop(app, req, reply, requestedShop);
    if (!auth) return;

    const shop = auth.shop;
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
    const body = (req.body ?? {}) as any;
    const q = req.query as any;

    const requestedShop = parseShop(q) || parseShop(body);
    const auth = await requireEmbeddedAuthAndMatchShop(app, req, reply, requestedShop);
    if (!auth) return;

    const shop = auth.shop;
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