// src/domain/opportunities/deepDive/drivers/refunds.ts
import { round2 } from "../../../../utils/money.js";
import { finalizeShares } from "../deepDive.utils.js";
export function buildRefundDrivers(params) {
    const { products, limit } = params;
    const totalRefunds = products.reduce((s, p) => s + Number(p.refundsAllocated || 0), 0);
    const drivers = [...products]
        .map((p) => {
        const refunds = Number(p.refundsAllocated || 0);
        const gross = Number(p.grossSales || 0);
        const refundPct = gross > 0 ? (refunds / gross) * 100 : 0;
        return {
            key: `variant:${p.variantId}`,
            productId: p.productId,
            variantId: p.variantId,
            title: String(p.title || ""),
            sku: p.sku ?? null,
            variantTitle: p.variantTitle ?? null,
            impact: Math.max(0, refunds),
            impactSharePct: 0,
            metrics: {
                refunds: round2(refunds),
                grossSales: round2(gross),
                refundRatePct: round2(refundPct),
                netSales: round2(Number(p.netSales || 0)),
                qty: Number(p.qty || 0),
            },
        };
    })
        .sort((a, b) => Number(b.impact || 0) - Number(a.impact || 0))
        .slice(0, limit);
    return finalizeShares(drivers, totalRefunds);
}
