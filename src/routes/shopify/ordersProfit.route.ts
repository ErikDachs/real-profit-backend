import { FastifyInstance } from "fastify";
import type { ShopifyCtx } from "./ctx.js";
import { round2 } from "../../utils/money.js";
import { calculateOrderProfit, allocateFixedCostsForOrders } from "../../domain/profit.js";
import { allocateAdSpendForOrders, computeProfitAfterAds } from "../../domain/profit/ads.js";
import {
  parseDays,
  parseShop,
  precomputeUnitCostsForOrders,
  effectiveCostOverrides,
} from "./helpers.js";

// ✅ SSOT Cost Model Engine
import { resolveCostProfile } from "../../domain/costModel/resolve.js";

type OrderProfitRow = {
  id: number | string;
  name: string | null;
  createdAt: string | null;
  currency: string | null;

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

  allocatedAdSpend?: number;
  profitAfterAds?: number;
  profitAfterAdsAndShipping?: number;

  fixedCostAllocated?: number;
  profitAfterFixedCosts?: number;

  operatingProfit?: number;
};

export function registerOrdersProfitRoute(app: FastifyInstance, ctx: ShopifyCtx) {
  app.get("/api/orders/profit", async (req, reply) => {
    try {
      const q = req.query as any;

      const daysNum = parseDays(q, 30);
      const adSpendNum = round2(Number(q?.adSpend ?? 0) || 0);

      const shop = parseShop(q, ctx.shop);
      if (!shop) {
        return reply.status(400).send({ error: "shop is required (valid *.myshopify.com)" });
      }

      const shopifyClient = shop === ctx.shop ? ctx.shopify : await ctx.createShopifyForShop(shop);
      const orders = shop === ctx.shop ? await ctx.fetchOrders(daysNum) : await ctx.fetchOrdersForShop(shop, daysNum);

      const cogsOverridesStore = shop === ctx.shop
        ? ctx.cogsOverridesStore
        : await ctx.getCogsOverridesStoreForShop(shop);

      const cogsService = shop === ctx.shop
        ? ctx.cogsService
        : await ctx.getCogsServiceForShop(shop);

      const costModelOverridesStore = shop === ctx.shop
        ? ctx.costModelOverridesStore
        : await ctx.getCostModelOverridesStoreForShop(shop);

      await costModelOverridesStore.ensureLoaded();
      const persisted = costModelOverridesStore.getOverridesSync();
      const mergedOverrides = effectiveCostOverrides({ persisted, input: q });

      const costProfile = resolveCostProfile({
        config: (app as any).config ?? {},
        overrides: mergedOverrides,
      });

      const unitCostByVariant = await precomputeUnitCostsForOrders({
        orders,
        cogsService,
        shopifyGET: shopifyClient.get,
      });

      const orderProfits: OrderProfitRow[] = [];
      for (const o of orders) {
        const p = await calculateOrderProfit({
          order: o,
          costProfile,
          cogsService,
          shopifyGET: shopifyClient.get,
          unitCostByVariant,
          isIgnoredVariant: (variantId: number) => cogsOverridesStore.isIgnoredSync(variantId),
        });

        orderProfits.push({
          id: o.id,
          name: o.name ?? null,
          createdAt: o.created_at ?? null,
          currency: o.currency ?? null,
          ...(p as any),
        } as OrderProfitRow);
      }

      const isOperational = (o: OrderProfitRow) => !o.isGiftCardOnlyOrder;
      const operationalRows = orderProfits.filter(isOperational);

      let enriched: OrderProfitRow[] = orderProfits;

      if (adSpendNum > 0) {
        const adMode = costProfile.ads.allocationMode ?? "BY_NET_SALES";
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

      const daysInMonth = Math.max(1, Number(costProfile.fixedCosts?.daysInMonth ?? 30));
      const monthlyTotal = round2(Number(costProfile.derived?.fixedCostsMonthlyTotal ?? 0));
      const fixedCostsAllocatedInPeriod = round2(
        monthlyTotal * (Math.max(1, Number(daysNum || 0)) / daysInMonth)
      );

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
            operatingProfit: profitAfterFixedCosts,
          };
        });
      } else {
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
            operatingProfit: profitAfterFixedCosts,
          } as OrderProfitRow;
        });

        const giftOnlyPatched: OrderProfitRow[] = enrichedGiftOnly.map((o) => {
          const profitAfterFixedCosts = round2(Number(o.profitAfterAdsAndShipping ?? 0));
          return {
            ...o,
            fixedCostAllocated: 0,
            profitAfterFixedCosts,
            operatingProfit: profitAfterFixedCosts,
          };
        });

        const byId = new Map<any, OrderProfitRow>(
          [...allocatedOperational, ...giftOnlyPatched].map((x) => [x.id, x])
        );
        enriched = enriched.map((o) => byId.get(o.id) ?? o);
      }

      enriched = enriched.map((o) => {
        const pafc = Number(o.profitAfterFixedCosts ?? o.profitAfterAds ?? o.profitAfterFees ?? 0);
        return {
          ...o,
          operatingProfit: Number.isFinite(Number(o.operatingProfit))
            ? Number(o.operatingProfit)
            : round2(pafc),
        };
      });

      enriched.sort((a, b) => {
        const av = Number(a.profitAfterFixedCosts ?? a.profitAfterAds ?? a.profitAfterFees ?? 0);
        const bv = Number(b.profitAfterFixedCosts ?? b.profitAfterAds ?? b.profitAfterFees ?? 0);
        return av - bv;
      });

      return reply.send({
        shop,
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
          persistedUpdatedAt: costModelOverridesStore.getUpdatedAtSync() ?? null,
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