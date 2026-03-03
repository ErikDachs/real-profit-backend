// src/domain/opportunities/deepDive/drivers/lowMargin.ts
import { round2 } from "../../../../utils/money.js";
import { finalizeShares } from "../deepDive.utils.js";
export function buildLowMarginDrivers(params) {
    const { products, limit } = params;
    const targetMarginPct = 15;
    const rows = [...products].map((p) => {
        const net = Number(p.netSales || 0);
        const profit = Number(p.profitAfterAds ?? p.profitAfterFees ?? 0);
        const marginPct = net > 0 ? (profit / net) * 100 : Number(p.marginPct || 0);
        const gap = Math.max(0, targetMarginPct - marginPct);
        const proxy = net * (gap / 100);
        return {
            key: `variant:${p.variantId}`,
            productId: p.productId,
            variantId: p.variantId,
            title: String(p.title || ""),
            sku: p.sku ?? null,
            variantTitle: p.variantTitle ?? null,
            impact: Math.max(0, proxy),
            impactSharePct: 0,
            metrics: {
                netSales: round2(net),
                profit: round2(profit),
                marginPct: round2(marginPct),
                gapTo15Pct: round2(gap),
                allocatedAdSpend: p.allocatedAdSpend !== undefined ? round2(Number(p.allocatedAdSpend || 0)) : undefined,
            },
        };
    });
    const totalProxy = rows.reduce((s, d) => s + Number(d.impact || 0), 0);
    const drivers = rows
        .filter((d) => Number(d.impact || 0) > 0)
        .sort((a, b) => Number(b.impact || 0) - Number(a.impact || 0))
        .slice(0, limit);
    return finalizeShares(drivers, totalProxy);
}
