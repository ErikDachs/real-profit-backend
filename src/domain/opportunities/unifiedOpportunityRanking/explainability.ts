// src/domain/opportunities/unifiedOpportunityRanking/explainability.ts
import { round2 } from "../../../utils/money.js";
import type { UnifiedOpportunity } from "../types.js";
import { monthlyize } from "./factory.js";

function pctFmt(x: number | null | undefined): number | null {
  if (x === null || x === undefined) return null;
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  return round2(n);
}

function numFmt(x: number | null | undefined): number | null {
  if (x === null || x === undefined) return null;
  const n = Number(x);
  if (!Number.isFinite(n)) return null;
  return round2(n);
}

export function mkWhyEvidence(input: {
  type: UnifiedOpportunity["type"];
  currency: string;
  days: number;
  lossInPeriod: number;

  refundRatePct?: number | null;
  feePctOfNet?: number | null;

  marginPct?: number | null;
  cm?: number | null;
  cmPct?: number | null;

  missingCogsCount?: number | null;

  subsidyRatePct?: number | null;

  driftPctPoints?: number | null;
  shortWindowDays?: number | null;
  longWindowDays?: number | null;
  shortCmPct?: number | null;
  longCmPct?: number | null;

  adSpend?: number | null;
  currentRoas?: number | null;
  breakEvenRoas?: number | null;
  roasGap?: number | null;

  fixedCostRatePct?: number | null;
}): { why: string; evidence: Record<string, any> } {
  const loss = round2(Number(input.lossInPeriod || 0));
  const monthly = monthlyize(loss, input.days);

  const baseEvidence: Record<string, any> = {
    lossInPeriod: loss,
    estimatedMonthlyLoss: monthly,
    currency: input.currency,
    days: input.days,
  };

  switch (input.type) {
    case "HIGH_REFUNDS": {
      const rr = pctFmt(input.refundRatePct);
      return {
        why: rr === null ? "Refunds are high in this period." : `Refunds are high (${rr}%).`,
        evidence: { ...baseEvidence, refundRatePct: rr },
      };
    }

    case "HIGH_FEES": {
      const fr = pctFmt(input.feePctOfNet);
      return {
        why: fr === null ? "Payment fees are high in this period." : `Payment fees are high (${fr}% of net).`,
        evidence: { ...baseEvidence, feePctOfNet: fr },
      };
    }

    case "MISSING_COGS": {
      const mc = input.missingCogsCount ?? null;
      return {
        why: mc ? `Some variants are missing COGS (${mc} missing). Profit is overstated.` : "Some variants are missing COGS. Profit is overstated.",
        evidence: { ...baseEvidence, missingCogsCount: mc },
      };
    }

    case "SHIPPING_SUBSIDY": {
      const sr = pctFmt(input.subsidyRatePct);
      return {
        why: "Shipping cost is higher than shipping revenue (you subsidize shipping).",
        evidence: { ...baseEvidence, subsidyRatePct: sr },
      };
    }

    case "LOW_MARGIN": {
      const m = pctFmt(input.marginPct);
      return {
        why: m === null ? "Margins are too thin after ad costs." : `Margins are thin after ad costs (${m}% margin).`,
        evidence: { ...baseEvidence, marginPct: m },
      };
    }

    case "NEGATIVE_CM": {
      const cm = numFmt(input.cm);
      const cmp = pctFmt(input.cmPct);
      return {
        why: cmp !== null ? `Average contribution margin is negative after ads (${cmp}%).` : "Average contribution margin is negative after ads.",
        evidence: { ...baseEvidence, cm, cmPct: cmp },
      };
    }

    case "MARGIN_DRIFT": {
      const drift = numFmt(input.driftPctPoints);
      return {
        why: "Your recent margin dropped versus your longer-term baseline.",
        evidence: {
          ...baseEvidence,
          driftPctPoints: drift,
          shortWindowDays: input.shortWindowDays ?? null,
          longWindowDays: input.longWindowDays ?? null,
          shortCmPct: pctFmt(input.shortCmPct),
          longCmPct: pctFmt(input.longCmPct),
        },
      };
    }

    case "BREAK_EVEN_RISK": {
      const gap = numFmt(input.roasGap);
      const cur = numFmt(input.currentRoas);
      const be = numFmt(input.breakEvenRoas);
      return {
        why:
          gap !== null && cur !== null && be !== null
            ? `ROAS is below break-even by ${gap} (current ${cur} vs break-even ${be}).`
            : "ROAS is below break-even (ads lose money before fixed costs).",
        evidence: { ...baseEvidence, adSpend: numFmt(input.adSpend), currentRoas: cur, breakEvenRoas: be, roasGap: gap },
      };
    }

    case "HIGH_FIXED_COST_LOAD": {
      const pct = pctFmt(input.fixedCostRatePct);
      return {
        why: pct !== null ? `Fixed costs are heavy (${pct}% of net sales).` : "Fixed costs are heavy in this period.",
        evidence: { ...baseEvidence, fixedCostRatePct: pct },
      };
    }

    case "OPERATING_LEVERAGE_RISK": {
      const pct = pctFmt(input.fixedCostRatePct);
      return {
        why:
          pct !== null
            ? `Operating leverage risk: fixed costs are high (${pct}% of net), so volume swings hit profit hard.`
            : "Operating leverage risk: fixed costs are high relative to net sales.",
        evidence: { ...baseEvidence, fixedCostRatePct: pct },
      };
    }

    default:
      return { why: "This factor is causing measurable profit loss.", evidence: baseEvidence };
  }
}
