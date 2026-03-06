import { FastifyInstance } from "fastify";
import type { ShopifyCtx } from "./ctx.js";
import { round2 } from "../../utils/money.js";
import { calculateOrderProfit } from "../../domain/profit.js";
import { buildDailyProfit } from "../../domain/profitDaily.js";
import { computeProfitHealthFromSummary } from "../../domain/health/profitHealth.js";
import { allocateAdSpendForOrders, computeProfitAfterAds } from "../../domain/profit/ads.js";
import { allocateFixedCostsForOrders } from "../../domain/profit.js";
import {
  parseDays,
  parseShop,
  precomputeUnitCostsForOrders,
  effectiveCostOverrides,
} from "./helpers.js";

// ✅ SSOT Cost Model Engine
import { resolveCostProfile } from "../../domain/costModel/resolve.js";

// ✅ SSOT variant qty extraction
import { extractVariantQtyFromOrder } from "../../domain/profit/variants.js";

export function registerDailyProfitRoute(app: FastifyInstance, ctx: ShopifyCtx) {
  app.get("/api/orders/daily-profit", async (req, reply) => {
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

      // ✅ persisted overrides + request overrides (request wins)
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

      const orderProfits: any[] = [];

      function computeHasMissingCogs(order: any): boolean {
        const vqs = extractVariantQtyFromOrder(order);
        for (const li of vqs) {
          const unitCost = unitCostByVariant.get(li.variantId) ?? 0;
          const isIgnored = cogsOverridesStore.isIgnoredSync(li.variantId);
          if (!isIgnored && (!Number.isFinite(unitCost) || unitCost <= 0)) return true;
        }
        return false;
      }

      let missingCogsCount = 0;

      for (const o of orders) {
        const p = await calculateOrderProfit({
          order: o,
          costProfile,
          cogsService,
          shopifyGET: shopifyClient.get,
          unitCostByVariant,
          isIgnoredVariant: (variantId: number) => cogsOverridesStore.isIgnoredSync(variantId),
        });

        const hasMissingCogs = computeHasMissingCogs(o);
        if (hasMissingCogs) missingCogsCount += 1;

        orderProfits.push({
          id: o.id,
          createdAt: o.created_at ?? null,

          grossSales: p.grossSales,
          refunds: p.refunds,
          netAfterRefunds: p.netAfterRefunds,
          cogs: p.cogs,
          paymentFees: p.paymentFees,

          profitAfterFees: p.profitAfterFees,
          contributionMargin: p.contributionMargin,

          shippingRevenue: p.shippingRevenue,
          shippingCost: p.shippingCost,
          profitAfterShipping: p.profitAfterShipping,

          hasMissingCogs,
        });
      }

      let orderRows = orderProfits;

      if (adSpendNum > 0) {
        orderRows = allocateAdSpendForOrders({
          rows: orderRows,
          adSpend: adSpendNum,
          mode: costProfile.ads.allocationMode ?? "BY_NET_SALES",
        }).map((o) => {
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
        orderRows = orderRows.map((o) => ({
          ...o,
          allocatedAdSpend: 0,
          profitAfterAds: Number(o.profitAfterFees ?? 0),
          profitAfterAdsAndShipping: Number(o.profitAfterShipping ?? 0),
        }));
      }

      const daysInMonth = Math.max(1, Number(costProfile.fixedCosts?.daysInMonth ?? 30));
      const monthlyTotal = round2(Number(costProfile.derived?.fixedCostsMonthlyTotal ?? 0));
      const fixedCostsAllocatedInPeriod = round2(
        monthlyTotal * (Math.max(1, Number(daysNum || 0)) / daysInMonth)
      );

      const fixedAllocMode = (costProfile.fixedCosts?.allocationMode ?? "PER_ORDER") as
        | "PER_ORDER"
        | "BY_NET_SALES";

      const withFixed = allocateFixedCostsForOrders({
        rows: orderRows,
        fixedCostsTotal: fixedCostsAllocatedInPeriod,
        mode: fixedAllocMode === "BY_NET_SALES" ? "BY_NET_SALES" : "PER_ORDER",
      }).map((o) => {
        const profitAfterFixedCosts = round2(
          Number(o.profitAfterAdsAndShipping ?? 0) - Number(o.fixedCostAllocated ?? 0)
        );

        return {
          ...o,
          fixedCostAllocated: round2(Number(o.fixedCostAllocated ?? 0)),
          profitAfterFixedCosts,
        };
      });

      const daily = buildDailyProfit({
        shop,
        days: daysNum,
        orderProfits: withFixed,
        fixedCostsAllocatedInPeriod,
        fixedCostsAllocationMode: fixedAllocMode,
      });

      const health = computeProfitHealthFromSummary({
        grossSales: daily.totals.grossSales,
        refunds: daily.totals.refunds,
        netAfterRefunds: daily.totals.netAfterRefunds,
        cogs: daily.totals.cogs,
        paymentFees: daily.totals.paymentFees,
        contributionMarginPct: daily.totals.contributionMarginPct,

        ordersCount: orders.length,
        breakEvenRoas: daily.totals.breakEvenRoas,

        shippingRevenue: daily.totals.shippingRevenue,
        shippingCost: daily.totals.shippingCost,

        adSpend: adSpendNum > 0 ? adSpendNum : undefined,
        fixedCostsAllocatedInPeriod,
        missingCogsCount,
      });

      return reply.send({
        ...daily,
        adSpend: adSpendNum > 0 ? adSpendNum : 0,
        fixedCosts: {
          monthlyTotal,
          allocatedInPeriod: fixedCostsAllocatedInPeriod,
          allocationMode: fixedAllocMode,
          daysInMonth,
        },
        health,
        costModel: {
          fingerprint: costProfile.meta.fingerprint,
          persistedUpdatedAt: costModelOverridesStore.getUpdatedAtSync() ?? null,
        },
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