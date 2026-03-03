// src/domain/opportunities/deepDive/drivers/shipping.ts
import { round2 } from "../../../../utils/money.js";
import { finalizeShares } from "../deepDive.utils.js";
export function buildShippingDrivers(params) {
    const { orders, limit } = params;
    const totalLoss = orders.reduce((s, o) => {
        const rev = Number(o.shippingRevenue ?? 0);
        const cost = Number(o.shippingCost ?? 0);
        const impact = o.shippingImpact !== undefined ? Number(o.shippingImpact) : rev - cost;
        return impact < 0 ? s + Math.abs(impact) : s;
    }, 0);
    const drivers = [...orders]
        .map((o) => {
        const rev = Number(o.shippingRevenue ?? 0);
        const cost = Number(o.shippingCost ?? 0);
        const impact = o.shippingImpact !== undefined ? Number(o.shippingImpact) : rev - cost;
        const loss = impact < 0 ? Math.abs(impact) : 0;
        return {
            key: `order:${o.id}`,
            title: String(o.name ?? o.id),
            impact: loss,
            impactSharePct: 0,
            metrics: {
                shippingRevenue: round2(rev),
                shippingCost: round2(cost),
                shippingImpact: round2(impact),
                netAfterRefunds: round2(Number(o.netAfterRefunds || 0)),
            },
        };
    })
        .filter((d) => Number(d.impact || 0) > 0)
        .sort((a, b) => Number(b.impact || 0) - Number(a.impact || 0))
        .slice(0, limit);
    return finalizeShares(drivers, totalLoss);
}
