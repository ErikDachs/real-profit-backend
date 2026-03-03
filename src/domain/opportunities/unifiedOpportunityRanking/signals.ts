// src/domain/opportunities/unifiedOpportunityRanking/signals.ts
import type { UnifiedOpportunity } from "../types.js";
import type { UnifiedOpportunityRankingParams } from "./build.js";
import { mk } from "./factory.js";

export function addProfitImpactSignals(out: UnifiedOpportunity[], params: UnifiedOpportunityRankingParams, base: { days: number; currency: string }) {
  const { days, currency } = base;

  if (params.profitImpact?.lowMargin) {
    out.push(
      mk({
        type: "LOW_MARGIN",
        title: "Low margin after ads",
        summary: "Margins are too thin after ad costs.",
        lossInPeriod: Number(params.profitImpact.lowMargin.lossInPeriod || 0),
        currency,
        days,
        meta: { marginPct: params.profitImpact.lowMargin.marginPct ?? null },
        actions: [
          { label: "Review pricing & discounting", code: "FIX_PRICING" },
          { label: "Cut wasteful ad spend", code: "OPTIMIZE_ADS" },
        ],
      })
    );
  }

  if (params.profitImpact?.negativeCm) {
    out.push(
      mk({
        type: "NEGATIVE_CM",
        title: "Negative contribution margin after ads",
        summary: "You lose money on average after ads.",
        lossInPeriod: Number(params.profitImpact.negativeCm.lossInPeriod || 0),
        currency,
        days,
        meta: { cm: params.profitImpact.negativeCm.cm ?? null, cmPct: params.profitImpact.negativeCm.cmPct ?? null },
        actions: [
          { label: "Pause/limit unprofitable campaigns", code: "PAUSE_LOSERS" },
          { label: "Increase AOV / upsells", code: "INCREASE_AOV" },
        ],
      })
    );
  }
}

export function addRefundSignals(out: UnifiedOpportunity[], params: UnifiedOpportunityRankingParams, base: { days: number; currency: string }) {
  const { days, currency } = base;
  if (!params.refunds) return;

  out.push(
    mk({
      type: "HIGH_REFUNDS",
      title: "High refunds",
      summary: "Refunds are eating into net sales.",
      lossInPeriod: Number(params.refunds.lossInPeriod || 0),
      currency,
      days,
      meta: { refundRatePct: params.refunds.refundRatePct ?? null },
      actions: [
        { label: "Audit product quality & expectations", code: "REDUCE_REFUNDS" },
        { label: "Improve support & delivery clarity", code: "IMPROVE_SUPPORT" },
      ],
    })
  );
}

export function addFeeSignals(out: UnifiedOpportunity[], params: UnifiedOpportunityRankingParams, base: { days: number; currency: string }) {
  const { days, currency } = base;
  if (!params.fees) return;

  out.push(
    mk({
      type: "HIGH_FEES",
      title: "High payment fees",
      summary: "Payment fees are unusually costly vs net revenue.",
      lossInPeriod: Number(params.fees.lossInPeriod || 0),
      currency,
      days,
      meta: { feePctOfNet: params.fees.feePctOfNet ?? null },
      actions: [
        { label: "Negotiate payment provider rates", code: "NEGOTIATE_FEES" },
        { label: "Shift customers to cheaper methods", code: "PAYMENT_MIX" },
      ],
    })
  );
}

export function addMissingCogsSignals(out: UnifiedOpportunity[], params: UnifiedOpportunityRankingParams, base: { days: number; currency: string }) {
  const { days, currency } = base;

  const missingCount = Number(params.missingCogsCount || 0);
  const missingLoss = Number(params.missingCogsLossInPeriod || 0);

  if (missingCount > 0 && missingLoss > 0) {
    out.push(
      mk({
        type: "MISSING_COGS",
        title: "Missing COGS",
        summary: "Some variants have no COGS, profit is overstated.",
        lossInPeriod: missingLoss,
        currency,
        days,
        meta: { missingCogsCount: missingCount },
        actions: [
          { label: "Fill in COGS for missing variants", code: "ADD_COGS" },
          { label: "Enable COGS alerts", code: "COGS_ALERTS" },
        ],
      })
    );
  }
}

export function addShippingSignals(out: UnifiedOpportunity[], params: UnifiedOpportunityRankingParams, base: { days: number; currency: string }) {
  const { days, currency } = base;
  if (!params.shippingSubsidy) return;

  out.push(
    mk({
      type: "SHIPPING_SUBSIDY",
      title: "Shipping subsidy",
      summary: "You subsidize shipping (cost > shipping revenue).",
      lossInPeriod: Number(params.shippingSubsidy.lossInPeriod || 0),
      currency,
      days,
      meta: { subsidyRatePct: params.shippingSubsidy.subsidyRatePct ?? null },
      actions: [
        { label: "Raise shipping fees / thresholds", code: "FIX_SHIPPING_PRICING" },
        { label: "Renegotiate carrier rates", code: "NEGOTIATE_SHIPPING" },
      ],
    })
  );
}

export function addMarginDriftSignals(out: UnifiedOpportunity[], params: UnifiedOpportunityRankingParams, base: { days: number; currency: string }) {
  const { days, currency } = base;
  if (!params.marginDrift || Number(params.marginDrift.lossInPeriod || 0) <= 0) return;

  out.push(
    mk({
      type: "MARGIN_DRIFT",
      title: "Margin drift",
      summary: "Your recent margin dropped compared to your longer-term baseline.",
      lossInPeriod: Number(params.marginDrift.lossInPeriod || 0),
      currency,
      days,
      meta: {
        driftPctPoints: params.marginDrift.driftPctPoints,
        shortWindowDays: params.marginDrift.shortWindowDays,
        longWindowDays: params.marginDrift.longWindowDays,
        shortCmPct: params.marginDrift.shortCmPct,
        longCmPct: params.marginDrift.longCmPct,
      },
      actions: [
        { label: "Find the products causing the drop", code: "DRIFT_ROOT_CAUSE" },
        { label: "Check refunds, discounts, and COGS changes", code: "AUDIT_MARGIN_DRIVERS" },
      ],
    })
  );
}

export function addBreakEvenRiskSignals(out: UnifiedOpportunity[], params: UnifiedOpportunityRankingParams, base: { days: number; currency: string }) {
  const { days, currency } = base;
  if (!params.breakEvenRisk || Number(params.breakEvenRisk.lossInPeriod || 0) <= 0) return;

  out.push(
    mk({
      type: "BREAK_EVEN_RISK",
      title: "ROAS below break-even",
      summary: "Your current ROAS is below break-even, meaning ads lose money (before fixed costs).",
      lossInPeriod: Number(params.breakEvenRisk.lossInPeriod || 0),
      currency,
      days,
      meta: {
        adSpend: params.breakEvenRisk.adSpend ?? null,
        currentRoas: params.breakEvenRisk.currentRoas ?? null,
        breakEvenRoas: params.breakEvenRisk.breakEvenRoas ?? null,
        roasGap: params.breakEvenRisk.roasGap ?? null,
      },
      actions: [
        { label: "Reduce spend until ROAS is above break-even", code: "STOP_BURN" },
        { label: "Shift budget to higher-margin products", code: "SHIFT_BUDGET" },
      ],
    })
  );
}

export function addFixedCostSignals(out: UnifiedOpportunity[], params: UnifiedOpportunityRankingParams, base: { days: number; currency: string }) {
  const { days, currency } = base;
  if (!params.fixedCosts || Number(params.fixedCosts.lossInPeriod || 0) <= 0) return;

  out.push(
    mk({
      type: "HIGH_FIXED_COST_LOAD",
      title: "High fixed cost load",
      summary: "Fixed costs take a large share of net sales.",
      lossInPeriod: Number(params.fixedCosts.lossInPeriod || 0),
      currency,
      days,
      meta: { fixedCostRatePct: params.fixedCosts.fixedCostRatePct ?? null },
      actions: [
        { label: "Cut non-essential overhead", code: "REDUCE_OVERHEAD" },
        { label: "Increase contribution margin / AOV", code: "RAISE_CM_OR_AOV" },
      ],
    })
  );

  const pct = Number(params.fixedCosts.fixedCostRatePct ?? 0);
  if (Number.isFinite(pct) && pct >= 20) {
    out.push(
      mk({
        type: "OPERATING_LEVERAGE_RISK",
        title: "Operating leverage risk",
        summary: "High fixed costs make profit highly sensitive to volume changes.",
        lossInPeriod: Number(params.fixedCosts.lossInPeriod || 0),
        currency,
        days,
        meta: { fixedCostRatePct: params.fixedCosts.fixedCostRatePct ?? null },
        actions: [
          { label: "Stabilize demand (retention / repeat)", code: "STABILIZE_DEMAND" },
          { label: "Lower fixed baseline costs", code: "LOWER_FIXED_BASELINE" },
        ],
      })
    );
  }
}
