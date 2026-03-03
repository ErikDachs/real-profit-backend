import { round2 } from "../../utils/money.js";
import { buildProductsProfit } from "../../domain/profit.js";
import { parseDays } from "./helpers.js";
// ✅ SSOT Cost Model Engine
import { resolveCostProfile, costOverridesFromAny } from "../../domain/costModel/resolve.js";
export function registerProductsProfitRoute(app, ctx) {
    app.get("/api/orders/products/profit", async (req, reply) => {
        try {
            const q = req.query;
            const daysNum = parseDays(q, 30);
            const adSpendNum = round2(Number(q?.adSpend ?? 0) || 0);
            // ✅ Resolve cost profile per request (config + optional overrides)
            const costProfile = resolveCostProfile({
                config: app.config ?? {},
                overrides: costOverridesFromAny(q),
            });
            const orders = await ctx.fetchOrders(daysNum);
            const result = await buildProductsProfit({
                shop: ctx.shop,
                days: daysNum,
                orders,
                costProfile,
                cogsService: ctx.cogsService,
                shopifyGET: ctx.shopify.get,
                adSpend: adSpendNum > 0 ? adSpendNum : undefined,
            });
            return reply.send({
                ...result,
                costModel: {
                    fingerprint: costProfile.meta.fingerprint,
                },
            });
        }
        catch (err) {
            const status = err?.status && Number.isFinite(err.status) ? err.status : 500;
            return reply.status(status).send({ error: "Unexpected error", details: String(err?.message ?? err) });
        }
    });
}
