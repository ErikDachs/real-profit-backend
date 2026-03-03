// src/domain/insights/profitKillers.daily.ts
import { round2 } from "../../utils/money";

export function buildDailyFromOrders(ordersWithReasons: Array<any>) {
  const dailyLike = ordersWithReasons
    .filter((o) => !!o.createdAt)
    .map((o) => ({
      day: String(o.createdAt).slice(0, 10),
      orders: 1,
      grossSales: Number(o.grossSales || 0),
      refunds: Number(o.refunds || 0),
      netAfterRefunds: Number(o.netAfterRefunds || 0),
      contributionMargin: Number(o.contributionMargin || 0),
      cogs: Number(o.cogs || 0),
      paymentFees: Number(o.paymentFees || 0),
      shippingRevenue: Number((o as any).shippingRevenue ?? 0),
      shippingCost: Number((o as any).shippingCost ?? 0),
    }));

  const byDay = new Map<
    string,
    {
      day: string;
      orders: number;
      grossSales: number;
      refunds: number;
      net: number;
      cm: number;
      cogs: number;
      fees: number;
      shippingRevenue: number;
      shippingCost: number;
    }
  >();

  for (const r of dailyLike) {
    if (!r.day || r.day === "unknown") continue;

    const cur =
      byDay.get(r.day) ?? {
        day: r.day,
        orders: 0,
        grossSales: 0,
        refunds: 0,
        net: 0,
        cm: 0,
        cogs: 0,
        fees: 0,
        shippingRevenue: 0,
        shippingCost: 0,
      };

    cur.orders += 1;

    cur.grossSales += r.grossSales;
    cur.refunds += r.refunds;

    cur.net += r.netAfterRefunds;
    cur.cm += r.contributionMargin;

    cur.cogs += r.cogs;
    cur.fees += r.paymentFees;

    cur.shippingRevenue += r.shippingRevenue;
    cur.shippingCost += r.shippingCost;

    byDay.set(r.day, cur);
  }

  return Array.from(byDay.values())
    .map((d) => ({
      day: d.day,
      orders: d.orders,

      grossSales: round2(d.grossSales),
      refunds: round2(d.refunds),

      netAfterRefunds: round2(d.net),
      contributionMargin: round2(d.cm),

      cogs: round2(d.cogs),
      paymentFees: round2(d.fees),

      shippingRevenue: round2(d.shippingRevenue),
      shippingCost: round2(d.shippingCost),
    }))
    .sort((a, b) => a.day.localeCompare(b.day));
}