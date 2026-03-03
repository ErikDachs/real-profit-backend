import { calculateOrderProfit, extractVariantQtyFromOrder } from "../../domain/profit.js";
import { round2 } from "../../utils/money.js";
// ✅ SSOT Cost Model Engine
import { resolveCostProfile, costOverridesFromAny } from "../../domain/costModel/resolve.js";
function parseOrderId(raw) {
    const s = String(raw ?? "").trim();
    if (!/^\d+$/.test(s))
        return { ok: false, status: 400, error: "orderId must be a numeric Shopify order id" };
    return { ok: true, id: s };
}
export function registerOrderAuditRoute(app, ctx) {
    app.get("/api/audit/order/:orderId", async (req, reply) => {
        try {
            const p = req.params ?? {};
            const parsed = parseOrderId(p.orderId);
            if (!parsed.ok)
                return reply.status(parsed.status).send({ error: parsed.error });
            const q = req.query;
            // ✅ Resolve cost profile per request (config + optional overrides)
            const costProfile = resolveCostProfile({
                config: app.config ?? {},
                overrides: costOverridesFromAny(q),
            });
            const order = await ctx.fetchOrderById(parsed.id);
            // Pull line items + unit costs (override wins). Missing => 0
            const variantQty = extractVariantQtyFromOrder(order);
            const variantIds = variantQty.map((x) => x.variantId);
            const unitCostByVariant = await ctx.cogsService.computeUnitCostsByVariant(ctx.shopify.get, variantIds);
            // Use SSOT order profit function
            const profit = await calculateOrderProfit({
                order,
                costProfile,
                cogsService: ctx.cogsService,
                shopifyGET: ctx.shopify.get,
                unitCostByVariant,
            });
            // Build line-item audit (deterministic)
            const rawLineItems = Array.isArray(order?.line_items) ? order.line_items : [];
            const byVariantMeta = new Map();
            for (const li of rawLineItems) {
                const vid = Number(li?.variant_id || 0);
                if (vid > 0 && !byVariantMeta.has(vid))
                    byVariantMeta.set(vid, li);
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
                    // helpful UI fields if present
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
            // Transparent “explain” fields (use RESOLVED cost profile, not ctx)
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
                    // ResolvedCostProfile currently doesn't expose a typed `ads` object.
                    // Keep it deterministic and compatible with different model shapes.
                    allocationMode: costProfile.ads?.allocationMode ??
                        costProfile.adAllocationMode ??
                        costProfile.flags?.adAllocationMode ??
                        "BY_NET_SALES",
                },
                fingerprint: costProfile.meta.fingerprint,
            };
            const warnings = [];
            if (profit.netAfterRefunds <= 0)
                warnings.push("netAfterRefunds <= 0 (rates may be unstable / break-even not meaningful).");
            if (missingCogsVariants.length > 0)
                warnings.push("missing COGS detected for one or more variants.");
            if (profit.refunds > 0)
                warnings.push("order has refunds.");
            return reply.send({
                type: "order_audit",
                shop: ctx.shop,
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
        }
        catch (err) {
            const status = err?.status && Number.isFinite(err.status) ? err.status : 500;
            return reply.status(status).send({ error: "Unexpected error", details: String(err?.message ?? err) });
        }
    });
}
