// src/domain/insights/profitKillers.totals.ts
import { round2 } from "../../utils/money";

export type ProfitKillersTotals = {
  orders: number;
  grossSales: number;
  refunds: number;
  netAfterRefunds: number;
  cogs: number;
  paymentFees: number;
  contributionMargin: number;
};

export function computeTotals(orders: Array<any>): ProfitKillersTotals {
  return orders.reduce(
    (acc, o) => {
      acc.orders += 1;
      acc.grossSales += Number(o.grossSales || 0);
      acc.refunds += Number(o.refunds || 0);
      acc.netAfterRefunds += Number(o.netAfterRefunds || 0);
      acc.cogs += Number(o.cogs || 0);
      acc.paymentFees += Number(o.paymentFees || 0);
      acc.contributionMargin += Number(o.contributionMargin || 0);
      return acc;
    },
    {
      orders: 0,
      grossSales: 0,
      refunds: 0,
      netAfterRefunds: 0,
      cogs: 0,
      paymentFees: 0,
      contributionMargin: 0,
    }
  );
}

export function computeContributionMarginPct(totals: ProfitKillersTotals): number {
  return totals.netAfterRefunds > 0 ? (totals.contributionMargin / totals.netAfterRefunds) * 100 : 0;
}

export function computeBreakEvenRoas(totals: ProfitKillersTotals): number | null {
  return totals.netAfterRefunds > 0 && totals.contributionMargin > 0 ? totals.netAfterRefunds / totals.contributionMargin : null;
}

export function buildTotalsOut(params: {
  currency: string;
  totals: ProfitKillersTotals;
  contributionMarginPct: number;
  breakEvenRoas: number | null;
}) {
  const { currency, totals, contributionMarginPct, breakEvenRoas } = params;

  return {
    currency,
    orders: totals.orders,
    grossSales: round2(totals.grossSales),
    refunds: round2(totals.refunds),
    netAfterRefunds: round2(totals.netAfterRefunds),
    cogs: round2(totals.cogs),
    paymentFees: round2(totals.paymentFees),
    contributionMargin: round2(totals.contributionMargin),
    contributionMarginPct: round2(contributionMarginPct),
    adSpendBreakEven: round2(totals.contributionMargin),
    breakEvenRoas: breakEvenRoas === null ? null : round2(breakEvenRoas),
  };
}