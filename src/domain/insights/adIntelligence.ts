// src/domain/insights/adIntelligence.ts
import { round2 } from "../../utils/money.js";

function calcTargetRoasForProfitPct(params: {
  netAfterRefunds: number;
  contributionMargin: number; // profit before ads (CM)
  targetProfitPct: number; // e.g. 10
}): number | null {
  const net = Number(params.netAfterRefunds || 0);
  const cm = Number(params.contributionMargin || 0);
  const t = Number(params.targetProfitPct || 0);

  if (net <= 0) return null;
  const maxAdSpendForTarget = cm - (t / 100) * net;
  if (!Number.isFinite(maxAdSpendForTarget) || maxAdSpendForTarget <= 0) return null;

  return round2(net / maxAdSpendForTarget);
}

export function buildAdIntelligence(params: {
  currency: string;
  days: number;
  adSpend?: number;
  currentRoas?: number;
  totals: {
    netAfterRefunds: number;
    contributionMargin: number;
    breakEvenRoas: number | null;
  };
}) {
  const { currency, days, adSpend, currentRoas, totals } = params;

  const spend = Number(adSpend ?? NaN);
  const roas = Number(currentRoas ?? NaN);
  const be = totals.breakEvenRoas;

  if (!Number.isFinite(spend) && !Number.isFinite(roas)) return null;

  const out: any = {
    currency,
    periodDays: days,
    adSpendInput: Number.isFinite(spend) ? round2(spend) : null,
    currentRoas: Number.isFinite(roas) ? round2(roas) : null,
    breakEvenRoas: be === null ? null : round2(be),
    targetRoasFor10PctProfit: calcTargetRoasForProfitPct({
      netAfterRefunds: totals.netAfterRefunds,
      contributionMargin: totals.contributionMargin,
      targetProfitPct: 10,
    }),
  };

  if (Number.isFinite(spend) && spend > 0 && Number.isFinite(roas) && roas > 0 && be !== null && be > 0) {
    const profitAtCurrentRoas = (spend * roas) / be - spend;

    const monthlyLeakIfBelowBreakEven = profitAtCurrentRoas < 0 ? Math.abs(profitAtCurrentRoas) : 0;
    const profitPerAdDollar = profitAtCurrentRoas / spend;

    out.profitAtCurrentRoas = round2(profitAtCurrentRoas);
    out.monthlyLeakIfBelowBreakEven = round2(monthlyLeakIfBelowBreakEven);
    out.profitPerAdDollar = round2(profitPerAdDollar);

    if (roas < be) out.status = "BURNING_CASH";
    else if (roas === be) out.status = "BREAK_EVEN";
    else out.status = "PROFITABLE";
  } else {
    out.profitAtCurrentRoas = null;
    out.monthlyLeakIfBelowBreakEven = null;
    out.profitPerAdDollar = null;
    out.status = "INSUFFICIENT_INPUT";
  }

  out.actions = [];
  if (out.status === "BURNING_CASH") {
    out.actions.push("Pause or reduce spend until ROAS is above break-even");
    out.actions.push("Fix biggest profit leaks first (refunds, missing COGS, high fees, low margin)");
    out.actions.push("Move budget to higher-margin products and exclude high-refund SKUs");
  } else if (out.status === "PROFITABLE") {
    out.actions.push("Scale cautiously: increase budget while ROAS stays above break-even");
    out.actions.push("Monitor refund rate and fee rate while scaling");
  } else if (out.status === "INSUFFICIENT_INPUT") {
    out.actions.push("Provide adSpend and currentRoas to calculate ad profit/burn");
  }

  return out;
}
