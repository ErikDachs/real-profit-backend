// src/domain/profitDaily/aggregateDaily.ts
import { round2 } from "../../utils/money.js";
import { calcBreakEvenRoas, calcContributionMarginPct } from "../metrics.js";

import type { DayAgg, RowWithFixed } from "./types.js";

function toDayKey(createdAt: string | null): string {
  if (!createdAt) return "unknown";
  return String(createdAt).slice(0, 10);
}

type DayAggWorking = Omit<
  DayAgg,
  | "contributionMarginPct"
  | "breakEvenRoas"
  | "profitMarginAfterShippingPct"
  | "profitMarginAfterAdsPct"
  | "profitMarginAfterAdsAndShippingPct"
  | "profitMarginAfterFixedCostsPct"
  | "missingCogsRatePct"
>;

export function buildDailyRows(params: { rows: RowWithFixed[] }): DayAgg[] {
  const byDay = new Map<string, DayAggWorking>();

  for (const o of params.rows) {
    const day = toDayKey(o.createdAt);

    const cur =
      byDay.get(day) ?? {
        day,
        orders: 0,
        grossSales: 0,
        refunds: 0,
        netAfterRefunds: 0,

        shippingRevenue: 0,
        shippingCost: 0,
        shippingImpact: 0,

        cogs: 0,
        paymentFees: 0,

        contributionMargin: 0,
        profitAfterFees: 0,

        profitAfterShipping: 0,

        allocatedAdSpend: 0,
        profitAfterAds: 0,
        profitAfterAdsAndShipping: 0,

        fixedCostsAllocated: 0,
        profitAfterFixedCosts: 0,

        missingCogsOrders: 0,

        adSpendBreakEven: 0,
      };

    cur.orders += 1;

    cur.grossSales += Number(o.grossSales || 0);
    cur.refunds += Number(o.refunds || 0);
    cur.netAfterRefunds += Number(o.netAfterRefunds || 0);

    cur.cogs += Number(o.cogs || 0);
    cur.paymentFees += Number(o.paymentFees || 0);

    const cm = Number(o.contributionMargin ?? o.profitAfterFees ?? 0);
    cur.contributionMargin += cm;
    cur.profitAfterFees += Number(o.profitAfterFees || 0);

    const sRev = Number(o.shippingRevenue ?? 0);
    const sCost = Number(o.shippingCost ?? 0);
    cur.shippingRevenue += sRev;
    cur.shippingCost += sCost;
    cur.shippingImpact += sRev - sCost;

    const pAfterShip =
      o.profitAfterShipping !== undefined
        ? Number(o.profitAfterShipping || 0)
        : Number(o.profitAfterFees || 0) - sCost;

    cur.profitAfterShipping += pAfterShip;

    const aSpend = Number(o.allocatedAdSpend ?? 0);
    cur.allocatedAdSpend += aSpend;

    const pAfterAds =
      o.profitAfterAds !== undefined ? Number(o.profitAfterAds || 0) : Number(o.profitAfterFees || 0) - aSpend;

    const pAfterAdsAndShip =
      o.profitAfterAdsAndShipping !== undefined ? Number(o.profitAfterAdsAndShipping || 0) : pAfterShip - aSpend;

    cur.profitAfterAds += pAfterAds;
    cur.profitAfterAdsAndShipping += pAfterAdsAndShip;

    cur.fixedCostsAllocated += Number(o.fixedCostAllocated ?? 0);
    cur.profitAfterFixedCosts += Number(o.profitAfterFixedCosts ?? 0);

    if (o.hasMissingCogs) cur.missingCogsOrders += 1;

    cur.adSpendBreakEven += cm;

    byDay.set(day, cur);
  }

  const daily: DayAgg[] = Array.from(byDay.values())
    .map((d) => {
      const net = d.netAfterRefunds;
      const cm = d.contributionMargin;

      const cmPct = calcContributionMarginPct({ netAfterRefunds: net, contributionMargin: cm });
      const beRoas = calcBreakEvenRoas({ netAfterRefunds: net, contributionMargin: cm });

      const profitMarginAfterShippingPct = net > 0 ? (d.profitAfterShipping / net) * 100 : 0;
      const profitMarginAfterAdsPct = net > 0 ? (d.profitAfterAds / net) * 100 : 0;
      const profitMarginAfterAdsAndShippingPct = net > 0 ? (d.profitAfterAdsAndShipping / net) * 100 : 0;
      const profitMarginAfterFixedCostsPct = net > 0 ? (d.profitAfterFixedCosts / net) * 100 : 0;

      const missingCogsRatePct = d.orders > 0 ? (d.missingCogsOrders / d.orders) * 100 : 0;

      return {
        day: d.day,
        orders: d.orders,

        grossSales: round2(d.grossSales),
        refunds: round2(d.refunds),
        netAfterRefunds: round2(d.netAfterRefunds),

        shippingRevenue: round2(d.shippingRevenue),
        shippingCost: round2(d.shippingCost),
        shippingImpact: round2(d.shippingImpact),

        cogs: round2(d.cogs),
        paymentFees: round2(d.paymentFees),

        contributionMargin: round2(d.contributionMargin),
        contributionMarginPct: round2(cmPct),

        profitAfterShipping: round2(d.profitAfterShipping),
        profitMarginAfterShippingPct: round2(profitMarginAfterShippingPct),

        profitAfterFees: round2(d.profitAfterFees),

        allocatedAdSpend: round2(d.allocatedAdSpend),
        profitAfterAds: round2(d.profitAfterAds),
        profitMarginAfterAdsPct: round2(profitMarginAfterAdsPct),

        profitAfterAdsAndShipping: round2(d.profitAfterAdsAndShipping),
        profitMarginAfterAdsAndShippingPct: round2(profitMarginAfterAdsAndShippingPct),

        fixedCostsAllocated: round2(d.fixedCostsAllocated),
        profitAfterFixedCosts: round2(d.profitAfterFixedCosts),
        profitMarginAfterFixedCostsPct: round2(profitMarginAfterFixedCostsPct),

        missingCogsOrders: d.missingCogsOrders,
        missingCogsRatePct: round2(missingCogsRatePct),

        adSpendBreakEven: round2(d.adSpendBreakEven),
        breakEvenRoas: beRoas === null ? null : round2(beRoas),
      };
    })
    .sort((a, b) => {
      if (a.day === "unknown") return 1;
      if (b.day === "unknown") return -1;
      return a.day.localeCompare(b.day);
    });

  return daily;
}
