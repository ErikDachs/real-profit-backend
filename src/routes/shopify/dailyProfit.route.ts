// src/routes/shopify/dailyProfit.route.ts
import { FastifyInstance } from "fastify";
import type { ShopifyCtx } from "./ctx";
import { round2 } from "../../utils/money";
import { calculateOrderProfit } from "../../domain/profit";
import { buildDailyProfit } from "../../domain/profitDaily";
import { computeProfitHealthFromSummary } from "../../domain/health/profitHealth";
import { allocateAdSpendForOrders, computeProfitAfterAds } from "../../domain/profit/ads";
import { allocateFixedCostsForOrders } from "../../domain/profit"; // ✅ SSOT fixed allocator
import { parseDays, precomputeUnitCostsForOrders, effectiveCostOverrides } from "./helpers";

// ✅ SSOT Cost Model Engine
import { resolveCostProfile } from "../../domain/costModel/resolve";

// ✅ SSOT variant qty extraction (same as used elsewhere)
import { extractVariantQtyFromOrder } from "../../domain/profit/variants";

export function registerDailyProfitRoute(app: FastifyInstance, ctx: ShopifyCtx) {
  app.get("/api/orders/daily-profit", async (req, reply) => {
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

      // -------------------------
      // Build base order profit rows
      // -------------------------
      const orderProfits: any[] = [];

      // ✅ Per-order missing COGS flag (no extra API calls)
      function computeHasMissingCogs(order: any): boolean {
        const vqs = extractVariantQtyFromOrder(order);
        for (const li of vqs) {
          const unitCost = unitCostByVariant.get(li.variantId) ?? 0;
          if (!Number.isFinite(unitCost) || unitCost <= 0) return true;
        }
        return false;
      }

      let missingCogsCount = 0;

      for (const o of orders) {
        const p = await calculateOrderProfit({
          order: o,
          costProfile,
          cogsService: ctx.cogsService,
          shopifyGET: ctx.shopify.get,
          unitCostByVariant,
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

          // ✅ new diagnostic
          hasMissingCogs,
        });
      }

      // -------------------------
      // Ads allocation (optional)
      // -------------------------
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

      // -------------------------
      // ✅ Fixed costs allocation (SSOT)
      // -------------------------
      const daysInMonth = Math.max(1, Number(costProfile.fixedCosts?.daysInMonth ?? 30));
      const monthlyTotal = round2(Number(costProfile.derived?.fixedCostsMonthlyTotal ?? 0));
      const fixedCostsAllocatedInPeriod = round2(monthlyTotal * (Math.max(1, Number(daysNum || 0)) / daysInMonth));

      const fixedAllocMode = (costProfile.fixedCosts?.allocationMode ?? "PER_ORDER") as "PER_ORDER" | "BY_NET_SALES";

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

      // -------------------------
      // Build daily aggregation
      // -------------------------
      const daily = buildDailyProfit({
        shop: ctx.shop,
        days: daysNum,
        orderProfits: withFixed,

        // ✅ keep deterministic totals (daily can also fallback if needed)
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

        // ✅ add shipping signals
        shippingRevenue: daily.totals.shippingRevenue,
        shippingCost: daily.totals.shippingCost,

        adSpend: adSpendNum > 0 ? adSpendNum : undefined,

        // ✅ fixed costs signal
        fixedCostsAllocatedInPeriod,

        // ✅ missing cogs signal (now deterministic)
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
          persistedUpdatedAt: ctx.costModelOverridesStore.getUpdatedAtSync() ?? null,
        },
      });
    } catch (err: any) {
      const status = err?.status && Number.isFinite(err.status) ? err.status : 500;
      return reply.status(status).send({ error: "Unexpected error", details: String(err?.message ?? err) });
    }
  });
}