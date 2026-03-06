import { FastifyInstance } from "fastify";
import type { ShopifyCtx } from "./ctx.js";

import { calculateOrderProfit, extractVariantQtyFromOrder } from "../../domain/profit.js";
import { round2 } from "../../utils/money.js";

// ✅ SSOT Cost Model Engine
import { resolveCostProfile, costOverridesFromAny } from "../../domain/costModel/resolve.js";
import { parseShop } from "./helpers.js";

function parseOrderId(raw: any): { ok: true; id: string } | { ok: false; status: number; error: string } {
  const s = String(raw ?? "").trim();
  if (!/^\d+$/.test(s)) return { ok: false, status: 400, error: "orderId must be a numeric Shopify order id" };
  return { ok: true, id: s };
}

export function registerOrderAuditRoute(app: FastifyInstance, ctx: ShopifyCtx) {
  app.get("/api/audit/order/:orderId", async (req, reply) => {
    try {
      const p = (req.params as any) ?? {};
      const parsed = parseOrderId(p.orderId);
      if (!parsed.ok) return reply.status(parsed.status).send({ error: parsed.error });

      const q = req.query as any;

      const shop = parseShop(q, ctx.shop);
      if (!shop) {
        return reply.status(400).send({ error: "shop is required (valid *.myshopify.com)" });
      }

      const shopifyClient = shop === ctx.shop ? ctx.shopify : await ctx.createShopifyForShop(shop);

      const cogsService = shop === ctx.shop
        ? ctx.cogsService
        : await ctx.getCogsServiceForShop(shop);

      // ✅ Resolve cost profile per request (config + optional overrides)
      const costProfile = resolveCostProfile({
        config: (app as any).config ?? {},
        overrides: costOverridesFromAny(q),
      });

      const order = shop === ctx.shop
        ? await ctx.fetchOrderById(parsed.id)
        : await ctx.fetchOrderByIdForShop(shop, parsed.id);

      const variantQty = extractVariantQtyFromOrder(order);
      const variantIds = variantQty.map((x) => x.variantId);

      const unitCostByVariant = await cogsService.computeUnitCostsByVariant(shopifyClient.get, variantIds);

      const profit = await calculateOrderProfit({
        order,
        costProfile,
        cogsService,
        shopifyGET: shopifyClient.get,
        unitCostByVariant,
      });

      const rawLineItems = Array.isArray(order?.line_items) ? order.line_items : [];
      const byVariantMeta = new Map<number, any>();
      for (const li of rawLineItems) {
        const vid = Number(li?.variant_id || 0);
        if (vid > 0 && !byVariantMeta.has(vid)) byVariantMeta.set(vid, li);
      }

      const lineItems = variantQty.map((li) => {
        const unitCost = unitCostByVariant.get(li.variantId) ?? 0;
        const cogs = li.qty * unitCost;
        const missingCogs = !Number.isFinite(unitCost) || unitCost <= 0;

        const meta = byVariantMeta.get(li.variantId);
        return {
          variantId: li.variantId,
          qty: li.qty,
          unitCost: round2(unitCost),
          cogs: round2(cogs),
          missingCogs,

          title: meta?.title ?? null,
          sku: meta?.sku ?? null,
          productId: meta?.product_id ?? null,
        };
      });

      const missingCogsVariants = Array.from(new Set(lineItems.filter((x) => x.missingCogs).map((x) => x.variantId)));
      const missingCogsLineItemsCount = lineItems.filter((x) => x.missingCogs).length;

      const orderMeta = {
        id: String(order?.id ?? parsed.id),
        name: order?.name ?? null,
        createdAt: order?.created_at ?? null,
        currency: order?.currency ?? null,
        financialStatus: order?.financial_status ?? null,
        fulfillmentStatus: order?.fulfillment_status ?? null,
      };

      const configInputs = {
        payment: {
          feePercent: Number(costProfile.payment?.feePercent ?? 0),
          feeFixed: Number(costProfile.payment?.feeFixed ?? 0),
        },
        shipping: {
          includeShippingCost: Boolean(costProfile.flags?.includeShippingCost ?? true),
          costPerOrder: Number(costProfile.shipping?.costPerOrder ?? 0),
        },
        ads: {
          allocationMode:
            (costProfile as any).ads?.allocationMode ??
            (costProfile as any).adAllocationMode ??
            (costProfile as any).flags?.adAllocationMode ??
            "BY_NET_SALES",
        },
        fingerprint: costProfile.meta.fingerprint,
      };

      const warnings: string[] = [];
      if (profit.netAfterRefunds <= 0) warnings.push("netAfterRefunds <= 0 (rates may be unstable / break-even not meaningful).");
      if (missingCogsVariants.length > 0) warnings.push("missing COGS detected for one or more variants.");
      if (profit.refunds > 0) warnings.push("order has refunds.");

      return reply.send({
        type: "order_audit",
        shop,
        order: orderMeta,

        costModel: configInputs,

        profit,

        lineItems,

        checks: {
          missingCogsVariants,
          missingCogsLineItemsCount,
          warnings,
        },
      });
    } catch (err: any) {
      const status = err?.status && Number.isFinite(err.status) ? err.status : 500;
      return reply.status(status).send({ error: "Unexpected error", details: String(err?.message ?? err) });
    }
  });
}