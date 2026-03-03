// src/domain/metrics.ts
import { round2 } from "../utils/money.js";

export function calcContributionMargin(params: {
  netAfterRefunds: number;
  cogs: number;
  paymentFees: number;
}): number {
  const net = Number(params.netAfterRefunds || 0);
  const cogs = Number(params.cogs || 0);
  const fees = Number(params.paymentFees || 0);
  return net - cogs - fees;
}

export function calcContributionMarginPct(params: {
  netAfterRefunds: number;
  contributionMargin: number;
}): number {
  const net = Number(params.netAfterRefunds || 0);
  const cm = Number(params.contributionMargin || 0);
  if (net <= 0) return 0;
  return (cm / net) * 100;
}

/**
 * Break-even ROAS = Revenue / Max Ad Spend
 * Max Ad Spend (break-even) = Contribution Margin (before ads)
 *
 * Returns null when break-even spend <= 0 (can’t break even).
 */
export function calcBreakEvenRoas(params: {
  netAfterRefunds: number;
  contributionMargin: number;
}): number | null {
  const net = Number(params.netAfterRefunds || 0);
  const cm = Number(params.contributionMargin || 0);
  if (net <= 0) return null;
  if (cm <= 0) return null;
  return net / cm;
}

export function roundMetric(n: number): number {
  return round2(n);
}
