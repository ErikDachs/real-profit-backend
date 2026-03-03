// src/domain/insights/utils.ts
import { round2 } from "../../utils/money.js";
import type { OrderProfitRow, Reason } from "./types.js";

export const DEFAULTS = {
  HIGH_REFUNDS_PCT: 10,
  LOW_MARGIN_PCT: 15,
  HIGH_FEES_PCT: 4,
};

export function safeDiv(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b === 0) return 0;
  return a / b;
}

export function periodLabel(days: number) {
  const d = Math.max(1, Math.floor(Number(days || 0)));
  return d === 1 ? "Last 1 day" : `Last ${d} days`;
}

export function computeOrderReasons(o: OrderProfitRow): Reason[] {
  const reasons: Reason[] = [];

  const gross = Number((o as any).grossSales || 0);
  const refunds = Number((o as any).refunds || 0);
  const net = Number((o as any).netAfterRefunds || 0);
  const fees = Number((o as any).paymentFees || 0);
  const cm = Number((o as any).contributionMargin || 0);
  const cmPct = Number((o as any).contributionMarginPct || 0);

  const refundPct = safeDiv(refunds, gross) * 100;
  const feePct = safeDiv(fees, net) * 100;

  if (cm <= 0) reasons.push("NEGATIVE_CM");
  if (gross > 0 && refundPct > DEFAULTS.HIGH_REFUNDS_PCT) reasons.push("HIGH_REFUNDS");
  if (net > 0 && feePct > DEFAULTS.HIGH_FEES_PCT) reasons.push("HIGH_FEES");
  if (net > 0 && cmPct < DEFAULTS.LOW_MARGIN_PCT) reasons.push("LOW_MARGIN");

  // ✅ Missing COGS is a DATA QUALITY signal (deterministic), not "cogs==0"
  const hasMissing = Boolean((o as any).hasMissingCogs ?? (o as any).missingCogs ?? false);
  if (hasMissing) reasons.push("MISSING_COGS");

  return reasons;
}

export function buildActions(params: {
  totals: {
    grossSales: number;
    refunds: number;
    netAfterRefunds: number;
    cogs: number;
    paymentFees: number;
    contributionMargin: number;
    contributionMarginPct: number;
    breakEvenRoas: number | null;
  };
  missingCogsCount: number;
  worstOrders: Array<{ reasons: Reason[] }>;
}): string[] {
  const actions: string[] = [];
  const { totals, missingCogsCount, worstOrders } = params;

  const refundRatePct = safeDiv(totals.refunds, totals.grossSales) * 100;
  const feeRatePct = safeDiv(totals.paymentFees, totals.netAfterRefunds) * 100;

  const reasonCounts = worstOrders.reduce(
    (acc, w) => {
      for (const r of w.reasons) acc[r] = (acc[r] ?? 0) + 1;
      return acc;
    },
    {} as Record<Reason, number>
  );

  if (missingCogsCount > 0) {
    actions.push(`Add COGS overrides for missing variants (missingCogsCount=${missingCogsCount}).`);
  }

  if (refundRatePct > DEFAULTS.HIGH_REFUNDS_PCT) {
    actions.push(
      `Refunds are high (${round2(refundRatePct)}% of gross sales). Investigate product quality/shipping/expectations.`
    );
  }

  if (feeRatePct > DEFAULTS.HIGH_FEES_PCT) {
    actions.push(
      `Payment fees are high (${round2(feeRatePct)}% of net sales). Check payment provider/plan or consider pricing adjustments.`
    );
  }

  if (totals.contributionMarginPct < DEFAULTS.LOW_MARGIN_PCT) {
    actions.push(
      `Contribution margin is low (${round2(totals.contributionMarginPct)}%). Focus on COGS, pricing, shipping/fulfillment costs.`
    );
  }

  if (totals.breakEvenRoas !== null) {
    actions.push(
      `Break-even ROAS is ${round2(totals.breakEvenRoas)}. Any ad ROAS below this loses money (before fixed costs).`
    );
  } else {
    actions.push(`Break-even ROAS is not reachable (contribution margin <= 0). Fix refunds/COGS/fees first.`);
  }

  const topReasons = Object.entries(reasonCounts)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .slice(0, 2);

  for (const [r, n] of topReasons) {
    if ((n ?? 0) <= 0) continue;
    if (r === "MISSING_COGS") actions.push(`Many worst orders have missing COGS (${n}). Add unit costs.`);
    if (r === "HIGH_REFUNDS") actions.push(`Many worst orders have high refunds (${n}). Review refund reasons.`);
    if (r === "LOW_MARGIN") actions.push(`Many worst orders have low margin (${n}). Review pricing/COGS.`);
    if (r === "HIGH_FEES") actions.push(`Many worst orders have high fee share (${n}). Review fee setup.`);
    if (r === "NEGATIVE_CM") actions.push(`Some worst orders are negative contribution margin (${n}). Stop ads to these products.`);
  }

  return actions.slice(0, 7);
}
