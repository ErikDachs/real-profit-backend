// src/routes/shopify/dashboardOverview.route.ts
import type { FastifyInstance } from "fastify";
import type { ShopifyCtx } from "./ctx";

import { round2 } from "../../utils/money";
import { parseDays, precomputeUnitCostsForOrders, effectiveCostOverrides } from "./helpers";

// ✅ SSOT Cost Model Engine
import { resolveCostProfile } from "../../domain/costModel/resolve";
import type { CostProfileOverrides } from "../../domain/costModel/types";

// Aggregation + Health
import { buildOrdersSummary } from "../../domain/profit/ordersSummary";
import { computeProfitHealthFromSummary } from "../../domain/health/profitHealth";

// ✅ Order profit engine (same as /api/orders/profit)
import { calculateOrderProfit, allocateFixedCostsForOrders } from "../../domain/profit";
import { allocateAdSpendForOrders, computeProfitAfterAds } from "../../domain/profit/ads";

// Insights / Opportunities / Actions
import { buildProfitKillersInsights } from "../../domain/insights/profitKillers";
import { buildActionPlan } from "../../domain/actions/buildActionPlan";

async function readPersistedOverrides(
  store: any
): Promise<{ overrides?: CostProfileOverrides; updatedAt?: string } | null> {
  if (!store) return null;

  if (typeof store.getOverridesSync === "function") {
    return {
      overrides: store.getOverridesSync(),
      updatedAt: store.getUpdatedAtSync?.(),
    };
  }

  if (typeof store.get === "function") return await store.get();
  if (typeof store.read === "function") return await store.read();
  if (typeof store.load === "function") return await store.load();
  if (typeof store.current === "function") return await store.current();

  return null;
}

function safeCall<T>(label: string, fn: () => T): { ok: true; value: T } | { ok: false; error: string } {
  try {
    return { ok: true, value: fn() };
  } catch (e: any) {
    return { ok: false, error: `[${label}] ${String(e?.message ?? e)}` };
  }
}

function pickInsight(insightsArr: any[] | undefined, type: string) {
  if (!Array.isArray(insightsArr)) return null;
  return insightsArr.find((x) => x?.type === type) ?? null;
}

function pickCurrency(summary: any, fallback: string) {
  const c = summary?.currency ?? summary?.meta?.currency ?? null;
  return typeof c === "string" && c.trim().length ? c : fallback;
}

export function registerDashboardOverviewRoute(app: FastifyInstance, ctx: ShopifyCtx) {
  app.get("/api/dashboard/overview", async (req, reply) => {
    try {
      const q = req.query as any;

      const days = parseDays(q, 30);
      const adSpend = round2(Number(q?.adSpend ?? 0) || 0);
      const currentRoas = Number(q?.currentRoas ?? 0) || 0;

      // ---- Orders (raw from Shopify)
      const raw = await ctx.fetchOrders(days);
      const ordersRaw: any[] = Array.isArray(raw) ? raw : Array.isArray((raw as any)?.orders) ? (raw as any).orders : [];

      // ---- Cost Profile (SSOT)
      const persisted = await readPersistedOverrides(ctx.costModelOverridesStore as any);
      const persistedOverrides = (persisted as any)?.overrides as CostProfileOverrides | undefined;
      const overrides = effectiveCostOverrides({ persisted: persistedOverrides, input: q });

      const costProfile = resolveCostProfile({
        config: (app as any).config,
        overrides,
      });

      // ---- Unit costs
      const unitCostByVariant = await precomputeUnitCostsForOrders({
        orders: ordersRaw,
        cogsService: ctx.cogsService,
        shopifyGET: ctx.shopify.get,
      });

      // ---- SSOT summary (store-level)
      const summary = await buildOrdersSummary({
        shop: ctx.shop,
        days,
        adSpend,
        orders: ordersRaw,
        costProfile,
        cogsService: ctx.cogsService,
        shopifyGET: ctx.shopify.get,
        unitCostByVariant,
        isIgnoredVariant: (variantId: number) => ctx.cogsOverridesStore.isIgnoredSync(variantId),
      });

      // ---- Health
      const health = computeProfitHealthFromSummary(summary as any);

      // ---- Build order profit rows (same logic as /api/orders/profit)
      const orderProfitsBase: any[] = [];
      for (const o of ordersRaw) {
        const p = await calculateOrderProfit({
          order: o,
          costProfile,
          cogsService: ctx.cogsService,
          shopifyGET: ctx.shopify.get,
          unitCostByVariant,
          isIgnoredVariant: (variantId: number) => ctx.cogsOverridesStore.isIgnoredSync(variantId),
        });

        orderProfitsBase.push({
          id: o.id,
          name: o.name ?? null,
          createdAt: o.created_at ?? null,
          currency: o.currency ?? null,
          ...p,
        });
      }

      // Ads allocation (optional)
      let enriched = orderProfitsBase;

      if (adSpend > 0) {
        enriched = allocateAdSpendForOrders({
          rows: enriched,
          adSpend,
          mode: costProfile.ads.allocationMode ?? "BY_NET_SALES",
        }).map((o: any) => {
          const allocatedAdSpend = round2(Number(o.allocatedAdSpend ?? 0));

          const profitAfterAds = computeProfitAfterAds({
            profitBeforeAds: Number(o.profitAfterFees ?? o.contributionMargin ?? 0),
            allocatedAdSpend,
          });

          const profitAfterAdsAndShipping = computeProfitAfterAds({
            profitBeforeAds: Number(o.profitAfterShipping ?? 0),
            allocatedAdSpend,
          });

          return {
            ...o,
            allocatedAdSpend,
            profitAfterAds,
            profitAfterAdsAndShipping,
          };
        });
      } else {
        enriched = enriched.map((o: any) => ({
          ...o,
          allocatedAdSpend: 0,
          profitAfterAds: Number(o.profitAfterFees ?? 0),
          profitAfterAdsAndShipping: Number(o.profitAfterShipping ?? 0),
        }));
      }

      // Fixed costs allocation (SSOT)
      const daysInMonth = Math.max(1, Number(costProfile.fixedCosts?.daysInMonth ?? 30));
      const monthlyTotal = round2(Number(costProfile.derived?.fixedCostsMonthlyTotal ?? 0));
      const fixedCostsAllocatedInPeriod = round2(monthlyTotal * (Math.max(1, Number(days || 0)) / daysInMonth));

      const fixedAllocMode = (costProfile.fixedCosts?.allocationMode ?? "PER_ORDER") as "PER_ORDER" | "BY_NET_SALES";

      enriched = allocateFixedCostsForOrders({
        rows: enriched,
        fixedCostsTotal: fixedCostsAllocatedInPeriod,
        mode: fixedAllocMode === "BY_NET_SALES" ? "BY_NET_SALES" : "PER_ORDER",
      }).map((o: any) => {
        const profitAfterFixedCosts = round2(Number(o.profitAfterAdsAndShipping ?? 0) - Number(o.fixedCostAllocated ?? 0));
        return {
          ...o,
          fixedCostAllocated: round2(Number(o.fixedCostAllocated ?? 0)),
          profitAfterFixedCosts,
        };
      });

      // ---- Insights (Profit Killers produces SSOT unified opportunities internally)
      const debug: any = { insightErrors: [] as string[] };

      let profitKillers: any = null;
      {
        const r = safeCall("profitKillers", () =>
          buildProfitKillersInsights({
            shop: ctx.shop,
            days,

            orders: enriched,
            products: [], // keep iterable; wire real products later
            missingCogsCount: Number((summary as any)?.missingCogsCount ?? 0),

            adSpend,
            currentRoas,

            shippingTotals: {
              orders: Number((summary as any)?.count ?? 0),
              shippingRevenue: Number((summary as any)?.shippingRevenue ?? 0),
              shippingCost: Number((summary as any)?.shippingCost ?? 0),
              shippingImpact: Number((summary as any)?.shippingImpact ?? 0),
            },

            fixedCosts: {
              monthlyTotal,
              allocatedInPeriod: fixedCostsAllocatedInPeriod,
              allocationMode: fixedAllocMode,
              daysInMonth,
            },

            limit: 10,
          } as any)
        );

        if (r.ok) profitKillers = r.value;
        else debug.insightErrors.push(r.error);
      }

      // Pull optional insights from ProfitKillers output (single source)
      const shippingSubsidy = pickInsight(profitKillers?.insights, "shippingSubsidy");
      const marginDrift = pickInsight(profitKillers?.insights, "marginDrift");
      const breakEvenRisk = pickInsight(profitKillers?.insights, "breakEvenRisk");

      const insights: any = {
        profitKillers,
        shippingSubsidy,
        marginDrift,
        breakEvenRisk,
      };

      // ✅ Canonical opportunities (from ProfitKillers SSOT ranking)
      const opportunities = profitKillers?.opportunities ?? { top: [], all: [] };

      // ✅ Decision system (ActionPlan MUST be built from UnifiedOpportunity[] — not summary/health/insights)
      const currency = pickCurrency(summary as any, "USD");
      const fingerprint = (costProfile as any)?.meta?.fingerprint ?? undefined;

      const actions = buildActionPlan({
        shop: ctx.shop,
        days,
        currency,
        costModelFingerprint: fingerprint,
        unifiedOpportunities: Array.isArray(opportunities?.top) ? opportunities.top : [],
        limit: Number(q?.actionsLimit ?? 10) || 10,
        inputs: {
          adSpend,
          currentRoas,
          // optional debug context for determinism
          fixedCostsAllocatedInPeriod,
        },
      } as any);

      return reply.send({
        shop: ctx.shop,
        meta: {
          currency: (summary as any)?.currency ?? null,
          periodDays: days,
          periodLabel: `Last ${days} days`,
          costModelFingerprint: (costProfile as any)?.meta?.fingerprint ?? null,
          costModelPersistedUpdatedAt: (persisted as any)?.updatedAt ?? null,
        },
        totals: summary,
        health,
        insights,
        actions,
        opportunities,
        debug,
      });
    } catch (err: any) {
      console.error("[dashboardOverview] ERROR:", err);
      console.error("[dashboardOverview] STACK:", err?.stack);
      return reply.status(500).send({
        error: "Unexpected error",
        details: String(err?.message ?? err),
      });
    }
  });
}