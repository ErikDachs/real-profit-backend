// src/domain/opportunities/deepDive/deepDive.worstOrders.ts
import { round2 } from "../../../utils/money.js";
import type { OpportunityType } from "../types.js";
import type { OrderProfitRow } from "../../insights/types.js";

function shippingImpactValue(o: any): number {
  const impactRaw = (o as any).shippingImpact;
  const rev = Number((o as any).shippingRevenue ?? 0);
  const cost = Number((o as any).shippingCost ?? 0);
  return Number.isFinite(Number(impactRaw)) ? Number(impactRaw) : rev - cost;
}

export function pickWorstOrders(params: { orders: OrderProfitRow[]; type: OpportunityType; limit: number }) {
  const { orders, type, limit } = params;

  const sorted = [...orders]
  .filter((o: any) => !Boolean(o?.isGiftCardOnlyOrder))
  .sort((a, b) => {
    if (type === "HIGH_REFUNDS") return Number((b as any).refunds || 0) - Number((a as any).refunds || 0);
    if (type === "HIGH_FEES") return Number((b as any).paymentFees || 0) - Number((a as any).paymentFees || 0);
    if (type === "SHIPPING_SUBSIDY") {
      // shippingImpact: negativ = schlecht -> am negativsten zuerst
      const av = shippingImpactValue(a);
      const bv = shippingImpactValue(b);
      return av - bv;
    }

    const ap = Number((a as any).profitAfterAds ?? (a as any).contributionMargin ?? 0);
    const bp = Number((b as any).profitAfterAds ?? (b as any).contributionMargin ?? 0);
    return ap - bp;
  });

  return sorted.slice(0, limit).map((o: any) => ({
    id: o.id,
    name: o.name ?? null,
    createdAt: o.createdAt ?? null,

    grossSales: round2(Number(o.grossSales || 0)),
    refunds: round2(Number(o.refunds || 0)),
    netAfterRefunds: round2(Number(o.netAfterRefunds || 0)),
    cogs: round2(Number(o.cogs || 0)),
    paymentFees: round2(Number(o.paymentFees || 0)),

    contributionMargin: round2(Number(o.contributionMargin || 0)),
    contributionMarginPct: round2(Number(o.contributionMarginPct || 0)),

    shippingRevenue: o.shippingRevenue !== undefined ? round2(Number(o.shippingRevenue || 0)) : undefined,
    shippingCost: o.shippingCost !== undefined ? round2(Number(o.shippingCost || 0)) : undefined,
    shippingImpact: o.shippingImpact !== undefined ? round2(Number(o.shippingImpact || 0)) : undefined,
    profitAfterShipping: o.profitAfterShipping !== undefined ? round2(Number(o.profitAfterShipping || 0)) : undefined,

    allocatedAdSpend: o.allocatedAdSpend !== undefined ? round2(Number(o.allocatedAdSpend || 0)) : undefined,
    profitAfterAds: o.profitAfterAds !== undefined ? round2(Number(o.profitAfterAds || 0)) : undefined,
    profitAfterAdsAndShipping:
      o.profitAfterAdsAndShipping !== undefined ? round2(Number(o.profitAfterAdsAndShipping || 0)) : undefined,
  }));
}
