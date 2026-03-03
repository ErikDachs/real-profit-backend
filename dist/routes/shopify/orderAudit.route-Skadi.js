import { calculateOrderProfit, extractVariantQtyFromOrder } from "../../domain/profit";
import { getOrderLineItemFacts } from "../../domain/profit/variants";
import { isMissingUnitCost } from "../../domain/profit/cogsGovernance";
import { round2 } from "../../utils/money";
// ✅ SSOT Cost Model Engine
import { resolveCostProfile, costOverridesFromAny } from "../../domain/costModel/resolve";
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
            const q = req.query ?? {};
            // ✅ Resolve cost profile per request (config + optional overrides)
            const costProfile = resolveCostProfile({
                config: app.config ?? {},
                overrides: costOverridesFromAny(q),
            });
            const order = await ctx.fetchOrderById(parsed.id);
            // ✅ Facts (SSOT) – shows gift-card filtering + unmapped/non-variant counts
            const facts = getOrderLineItemFacts(order);
            // Variants included in COGS calc (gift cards excluded by variants.ts)
            const variantQty = extractVariantQtyFromOrder(order);
            const variantIds = variantQty.map((x) => x.variantId);
            // Unit costs as delivered by COGS service (undefined means missing)
            const unitCostByVariant = variantIds.length > 0 ? await ctx.cogsService.computeUnitCostsByVariant(ctx.shopify.get, variantIds) : new Map();
            // DEBUG: show whether overrides actually match extracted variantIds
            const overrideDebug = variantQty.map((li) => ({
                variantId: li.variantId,
                overrideUnitCost: ctx.cogsOverridesStore.getUnitCostSync(li.variantId) ?? null,
                overrideIgnoreCogs: ctx.cogsOverridesStore.isIgnoredSync(li.variantId),
                resolvedUnitCost: unitCostByVariant.get(li.variantId) ?? null,
            }));
            // OPTIONAL: allow passing ignored variants via query later (kept deterministic now)
            // Example in the future: ?ignoredVariantIds=123,456
            const ignoredSet = new Set(String(q.ignoredVariantIds ?? "")
                .split(",")
                .map((s) => Number(s.trim()))
                .filter((n) => Number.isFinite(n) && n > 0));
            const isIgnoredVariant = (variantId) => ignoredSet.has(variantId);
            // Use SSOT order profit function
            const profit = await calculateOrderProfit({
                order,
                costProfile,
                cogsService: ctx.cogsService,
                shopifyGET: ctx.shopify.get,
                unitCostByVariant,
                isIgnoredVariant: ignoredSet.size > 0 ? isIgnoredVariant : undefined,
            });
            // Build helpful meta from raw REST line_items if present (best-effort)
            const rawLineItems = Array.isArray(order?.line_items) ? order.line_items : [];
            const byVariantMeta = new Map();
            for (const li of rawLineItems) {
                const vid = Number(li?.variant_id || 0);
                if (vid > 0 && !byVariantMeta.has(vid))
                    byVariantMeta.set(vid, li);
            }
            const lineItems = variantQty.map((li) => {
                const unitCost = unitCostByVariant.get(li.variantId); // keep undefined (do NOT coerce to 0)
                const unitCostSafe = unitCost === undefined ? 0 : unitCost;
                const cogs = li.qty * unitCostSafe;
                const ignored = ignoredSet.size > 0 ? isIgnoredVariant(li.variantId) : false;
                const missingByGovernance = isMissingUnitCost({
                    unitCost,
                    variantId: li.variantId,
                    isIgnoredVariant: ignoredSet.size > 0 ? isIgnoredVariant : undefined,
                });
                const meta = byVariantMeta.get(li.variantId);
                return {
                    variantId: li.variantId,
                    qty: li.qty,
                    // Show both: raw + UI-safe
                    unitCost: unitCost === undefined ? null : round2(unitCost),
                    unitCostRaw: unitCost === undefined ? null : unitCost, // for debugging without rounding
                    cogs: round2(cogs),
                    ignored,
                    missingByGovernance,
                    // helpful UI fields if present
                    title: meta?.title ?? null,
                    sku: meta?.sku ?? null,
                    productId: meta?.product_id ?? null,
                };
            });
            const missingCogsVariants = Array.from(new Set(lineItems.filter((x) => x.missingByGovernance).map((x) => x.variantId)));
            const orderMeta = {
                id: String(order?.id ?? parsed.id),
                name: order?.name ?? null,
                createdAt: order?.created_at ?? order?.createdAt ?? null,
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
                warnings.push("missing COGS detected for one or more variants (by governance).");
            if (profit.refunds > 0)
                warnings.push("order has refunds.");
            if (facts.hasUnmappedVariants)
                warnings.push("unmapped variants: relevant items exist but no variant ids could be extracted.");
            if (facts.nonVariantLineItemsCount > 0)
                warnings.push(`non-variant line items present: ${facts.nonVariantLineItemsCount} (may be tips/custom/services).`);
            return reply.send({
                type: "order_audit",
                shop: ctx.shop,
                order: orderMeta,
                costModel: configInputs,
                facts,
                profit,
                lineItems,
                checks: {
                    missingCogsVariants,
                    missingCogsLineItemsCount: lineItems.filter((x) => x.missingByGovernance).length,
                    ignoredVariantIds: Array.from(ignoredSet),
                    warnings,
                    // ✅ DEBUG (temporary)
                    debug: {
                        extractedVariantIds: Array.from(new Set(variantIds)),
                        overrideDebug,
                    },
                },
            });
        }
        catch (err) {
            const status = err?.status && Number.isFinite(err.status) ? err.status : 500;
            return reply.status(status).send({ error: "Unexpected error", details: String(err?.message ?? err) });
        }
    });
}
