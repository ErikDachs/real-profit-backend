// src/routes/shopify/ordersProfit.route.ts
import { FastifyInstance } from "fastify";
import type { ShopifyCtx } from "./ctx";
import { round2 } from "../../utils/money";
import { calculateOrderProfit, allocateFixedCostsForOrders } from "../../domain/profit";
import { allocateAdSpendForOrders, computeProfitAfterAds } from "../../domain/profit/ads";
import { parseDays, precomputeUnitCostsForOrders, effectiveCostOverrides } from "./helpers";

// ✅ SSOT Cost Model Engine
import { resolveCostProfile } from "../../domain/costModel/resolve";

type OrderProfitRow = {
  id: number | string;

  name: string | null;
  createdAt: string | null;
  currency: string | null;

  // from calculateOrderProfit()
  orderId: string;

  isGiftCardOnlyOrder: boolean;
  giftCardNetSalesExcluded: number;

  grossSales: number;
  refunds: number;
  netAfterRefunds: number;

  cogs: number;
  paymentFees: number;

  contributionMargin: number;
  contributionMarginPct: number;

  hasMissingCogs: boolean;
  missingCogsVariantIds: number[];

  shippingRevenue: number;
  shippingCost: number;
  shippingImpact: number;

  profitAfterShipping: number;
  profitMarginAfterShippingPct: number;

  adSpendBreakEven: number;
  breakEvenRoas: number | null;

  profitAfterFees: number;
  marginAfterFeesPct: number;

  // computed in route
  allocatedAdSpend?: number;
  profitAfterAds?: number;
  profitAfterAdsAndShipping?: number;

  fixedCostAllocated?: number;
  profitAfterFixedCosts?: number;
};

export function registerOrdersProfitRoute(app: FastifyInstance, ctx: ShopifyCtx) {
  app.get("/api/orders/profit", async (req, reply) => {
    try {
      const q = req.query as any;
      const daysNum = parseDays(q, 30);
      const adSpendNum = round2(Number(q?.adSpend ?? 0) || 0);

      // ✅ persisted overrides + request overrides (request wins) — SSOT helper
      await ctx.costModelOverridesStore.ensureLoaded();
      const persisted = ctx.costModelOverridesStore.getOverridesSync();
      const mergedOverrides = effectiveCostOverrides({ persisted, input: q });

      // ✅ Resolve cost profile per request (config + merged overrides)
      const costProfile = resolveCostProfile({
        config: (app as any).config ?? {},
        overrides: mergedOverrides,
      });

      const orders = await ctx.fetchOrders(daysNum);

      const unitCostByVariant = await precomputeUnitCostsForOrders({
        orders,
        cogsService: ctx.cogsService,
        shopifyGET: ctx.shopify.get,
      });

      const orderProfits: OrderProfitRow[] = [];
      for (const o of orders) {
        const p = await calculateOrderProfit({
          order: o,
          costProfile,
          cogsService: ctx.cogsService,
          shopifyGET: ctx.shopify.get,
          unitCostByVariant,
          isIgnoredVariant: (variantId: number) => ctx.cogsOverridesStore.isIgnoredSync(variantId),
        });

        orderProfits.push({
          id: o.id,

          name: o.name ?? null,
          createdAt: o.created_at ?? null,
          currency: o.currency ?? null,

          ...(p as any),
        } as OrderProfitRow);
      }

      // Helper: operational vs gift-card-only
      const isOperational = (o: OrderProfitRow) => !o.isGiftCardOnlyOrder;
      const operationalRows = orderProfits.filter(isOperational);

      // -------------------------
      // Ads allocation (optional)
      // -------------------------
      let enriched: OrderProfitRow[] = orderProfits;

      if (adSpendNum > 0) {
        const adMode = costProfile.ads.allocationMode ?? "BY_NET_SALES";

        // ✅ PER_ORDER: exclude gift-card-only orders, otherwise they would get ad spend even though operational net=0
        const rowsForAds: OrderProfitRow[] = adMode === "PER_ORDER" ? operationalRows : orderProfits;

        const adsAllocated = allocateAdSpendForOrders({
          rows: rowsForAds,
          adSpend: adSpendNum,
          mode: adMode,
        }).map((o) => {
          const allocatedAdSpend = round2(Number(o.allocatedAdSpend ?? 0));

          const profitAfterAds = computeProfitAfterAds({
            profitBeforeAds: Number((o as any).profitAfterFees ?? (o as any).contributionMargin ?? 0),
            allocatedAdSpend,
          });

          const profitAfterAdsAndShipping = computeProfitAfterAds({
            profitBeforeAds: Number((o as any).profitAfterShipping ?? 0),
            allocatedAdSpend,
          });

          return {
            ...(o as any),
            allocatedAdSpend,
            profitAfterAds,
            profitAfterAdsAndShipping,
          } as OrderProfitRow;
        });

        if (adMode === "PER_ORDER") {
          // Merge back: gift-card-only rows get 0 ad spend deterministically
          const byId = new Map<any, OrderProfitRow>(adsAllocated.map((x) => [x.id, x]));

          enriched = orderProfits.map((o) => {
            const hit = byId.get(o.id);
            if (hit) return hit;

            return {
              ...o,
              allocatedAdSpend: 0,
              profitAfterAds: Number(o.profitAfterFees ?? o.contributionMargin ?? 0),
              profitAfterAdsAndShipping: Number(o.profitAfterShipping ?? 0),
            };
          });
        } else {
          enriched = adsAllocated;
        }
      } else {
        enriched = orderProfits.map((o) => ({
          ...o,
          allocatedAdSpend: 0,
          profitAfterAds: Number(o.profitAfterFees ?? o.contributionMargin ?? 0),
          profitAfterAdsAndShipping: Number(o.profitAfterShipping ?? 0),
        }));
      }

      // -------------------------
      // ✅ Fixed costs allocation (SSOT)
      // -------------------------
      const daysInMonth = Math.max(1, Number(costProfile.fixedCosts?.daysInMonth ?? 30));
      const monthlyTotal = round2(Number(costProfile.derived?.fixedCostsMonthlyTotal ?? 0));
      const fixedCostsAllocatedInPeriod = round2(monthlyTotal * (Math.max(1, Number(daysNum || 0)) / daysInMonth));

      // NOTE: cost model types currently only include PER_ORDER | BY_NET_SALES.
      // We keep BY_DAYS support here as a route-level mode (deterministic, no per-order split).
      const fixedAllocMode =
        (costProfile.fixedCosts?.allocationMode ?? "PER_ORDER") as "PER_ORDER" | "BY_NET_SALES" | "BY_DAYS";

      if (fixedAllocMode === "BY_DAYS") {
        enriched = enriched.map((o) => {
          const fixedCostAllocated = 0;
          const profitAfterFixedCosts = round2(Number(o.profitAfterAdsAndShipping ?? 0) - fixedCostAllocated);
          return {
            ...o,
            fixedCostAllocated,
            profitAfterFixedCosts,
          };
        });
      } else {
        // ✅ Exclude gift-card-only orders from fixed-cost allocation (operational expenses)
        const enrichedOperational = enriched.filter(isOperational);
        const enrichedGiftOnly = enriched.filter((o) => !isOperational(o));

        const allocatedOperational = allocateFixedCostsForOrders({
          rows: enrichedOperational,
          fixedCostsTotal: fixedCostsAllocatedInPeriod,
          mode: fixedAllocMode === "BY_NET_SALES" ? "BY_NET_SALES" : "PER_ORDER",
        }).map((o) => {
          const fixedCostAllocated = round2(Number((o as any).fixedCostAllocated ?? 0));
          const profitAfterFixedCosts = round2(Number((o as any).profitAfterAdsAndShipping ?? 0) - fixedCostAllocated);

          return {
            ...(o as any),
            fixedCostAllocated,
            profitAfterFixedCosts,
          } as OrderProfitRow;
        });

        const giftOnlyPatched: OrderProfitRow[] = enrichedGiftOnly.map((o) => ({
          ...o,
          fixedCostAllocated: 0,
          profitAfterFixedCosts: round2(Number(o.profitAfterAdsAndShipping ?? 0)),
        }));

        // merge back in original order
        const byId = new Map<any, OrderProfitRow>([...allocatedOperational, ...giftOnlyPatched].map((x) => [x.id, x]));
        enriched = enriched.map((o) => byId.get(o.id) ?? o);
      }

      // sort by most negative first (operational view)
      enriched.sort((a, b) => {
        const av = Number(a.profitAfterFixedCosts ?? a.profitAfterAds ?? a.profitAfterFees ?? 0);
        const bv = Number(b.profitAfterFixedCosts ?? b.profitAfterAds ?? b.profitAfterFees ?? 0);
        return av - bv;
      });

      return reply.send({
        shop: ctx.shop,
        days: daysNum,
        count: enriched.length,
        adSpend: adSpendNum > 0 ? adSpendNum : 0,
        fixedCosts: {
          monthlyTotal,
          allocatedInPeriod: fixedCostsAllocatedInPeriod,
          allocationMode: fixedAllocMode,
          daysInMonth,
        },
        costModel: {
          fingerprint: costProfile.meta.fingerprint,
          persistedUpdatedAt: ctx.costModelOverridesStore.getUpdatedAtSync() ?? null,
        },
        orders: enriched,
      });
    } catch (err: any) {
      const status = err?.status && Number.isFinite(err.status) ? err.status : 500;
      return reply.status(status).send({
        error: "Unexpected error",
        details: String(err?.message ?? err),
      });
    }
  });
}