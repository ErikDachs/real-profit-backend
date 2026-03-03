// src/domain/health/profitHealth.ts
import { round2 } from "../../utils/money.js";
import { getDefaultProfitHealthConfig, type ProfitHealthConfig } from "./healthConfig.js";
import type { ProfitHealth, HealthDriver } from "./types.js";

import { clamp, pctOrNaN, scoreHigherIsBetter, scoreLowerIsBetter, statusFromScore } from "./profitHealth.scoring.js";
import { normalizeWeights, impactFrom, mkDriver } from "./profitHealth.weights.js";
import { applyMissingCogsCap } from "./profitHealth.governance.js";

export function computeProfitHealthFromSummary(params: {
  grossSales: number;
  refunds: number;
  netAfterRefunds: number;
  cogs: number;
  paymentFees: number;

  contributionMarginPct: number;

  ordersCount?: number;
  count?: number;

  breakEvenRoas?: number | null;
  adSpend?: number;

  shippingRevenue?: number;
  shippingCost?: number;

  missingCogsCount?: number;

  fixedCostsAllocatedInPeriod?: number;

  config?: ProfitHealthConfig;
  currency?: string;
}): ProfitHealth {
  const cfg = params.config ?? getDefaultProfitHealthConfig();

  const grossSales = Number(params.grossSales || 0);
  const refunds = Number(params.refunds || 0);
  const netAfterRefunds = Number(params.netAfterRefunds || 0);
  const cogs = Number(params.cogs || 0);
  const paymentFees = Number(params.paymentFees || 0);
  const cmPct = Number(params.contributionMarginPct || 0);

  const ordersCountRaw =
    params.ordersCount !== undefined ? params.ordersCount : params.count !== undefined ? params.count : 0;
  const ordersCount = Math.max(0, Number(ordersCountRaw || 0));

  const refundRatePct = pctOrNaN(refunds, grossSales);
  const feeRatePct = pctOrNaN(paymentFees, netAfterRefunds);
  const cogsRatePct = pctOrNaN(cogs, netAfterRefunds);

  const cmScore = scoreHigherIsBetter(cmPct, cfg.cmPct);
  const refundScore = scoreLowerIsBetter(refundRatePct, cfg.refundRatePct);
  const feeScore = scoreLowerIsBetter(feeRatePct, cfg.feeRatePct);
  const cogsScore = scoreLowerIsBetter(cogsRatePct, cfg.cogsRatePct);

  // --- Ads efficiency ---
  let adScore: number | undefined;
  let roas: number | null | undefined;
  let salesRoas: number | null | undefined;

  const adSpend = params.adSpend;
  const breakEvenRoas = params.breakEvenRoas ?? null;

  if (adSpend !== undefined && Number.isFinite(adSpend) && adSpend > 0) {
    salesRoas = netAfterRefunds > 0 ? netAfterRefunds / adSpend : null;

    const contributionMargin = (netAfterRefunds * cmPct) / 100;
    roas = Number.isFinite(contributionMargin) ? contributionMargin / adSpend : null;

    if (
      breakEvenRoas !== null &&
      Number.isFinite(breakEvenRoas) &&
      breakEvenRoas > 0 &&
      roas !== null &&
      Number.isFinite(roas)
    ) {
      const ratio = (salesRoas ?? null) !== null && breakEvenRoas ? (salesRoas as number) / breakEvenRoas : null;

      if (ratio !== null && Number.isFinite(ratio)) {
        if (ratio >= cfg.adEfficiency.greatMultiplier) adScore = 100;
        else if (ratio >= cfg.adEfficiency.goodMultiplier) {
          const k =
            (ratio - cfg.adEfficiency.goodMultiplier) /
            (cfg.adEfficiency.greatMultiplier - cfg.adEfficiency.goodMultiplier);
          adScore = 85 + 15 * clamp(k, 0, 1);
        } else if (ratio >= cfg.adEfficiency.okMultiplier) {
          const k =
            (ratio - cfg.adEfficiency.okMultiplier) /
            (cfg.adEfficiency.goodMultiplier - cfg.adEfficiency.okMultiplier);
          adScore = 60 + 25 * clamp(k, 0, 1);
        } else if (ratio >= cfg.adEfficiency.badMultiplier) {
          const k =
            (ratio - cfg.adEfficiency.badMultiplier) /
            (cfg.adEfficiency.okMultiplier - cfg.adEfficiency.badMultiplier);
          adScore = 30 + 30 * clamp(k, 0, 1);
        } else {
          const k = ratio / cfg.adEfficiency.badMultiplier;
          adScore = 30 * clamp(k, 0, 1);
        }
      } else {
        const sr = salesRoas;
        if (sr === null || !Number.isFinite(sr)) adScore = 0;
        else if (sr >= 3) adScore = 90;
        else if (sr >= 2) adScore = 70;
        else if (sr >= 1.5) adScore = 50;
        else if (sr >= 1.1) adScore = 30;
        else adScore = 10;
      }
    }
  }

  // --- Shipping subsidy ---
  let shippingScore: number | undefined;
  let shippingSubsidyLoss: number | null = null;
  let shippingSubsidyPct: number | null = null;

  const shippingRevenue = params.shippingRevenue;
  const shippingCost = params.shippingCost;

  if (
    shippingRevenue !== undefined &&
    shippingCost !== undefined &&
    Number.isFinite(shippingRevenue) &&
    Number.isFinite(shippingCost)
  ) {
    shippingSubsidyLoss = Math.max(0, Number(shippingCost) - Number(shippingRevenue));
    const sp = pctOrNaN(shippingSubsidyLoss, netAfterRefunds);
    shippingSubsidyPct = Number.isFinite(sp) ? sp : null;
    shippingScore = Number.isFinite(sp) ? scoreLowerIsBetter(sp, cfg.shippingSubsidyPct) : 0;
  }

  // --- Missing COGS ---
  let missingCogsScore: number | undefined;
  let missingCogsRatePct: number | null = null;

  if (params.missingCogsCount !== undefined && Number.isFinite(params.missingCogsCount) && ordersCount > 0) {
    missingCogsRatePct = (Number(params.missingCogsCount) / ordersCount) * 100;
    missingCogsScore = scoreLowerIsBetter(missingCogsRatePct, cfg.missingCogsRatePct);
  }

  // --- Fixed costs pressure ---
  let fixedCostScore: number | undefined;
  let fixedCostRatePct: number | null = null;

  const fixedCostsAllocatedInPeriod = params.fixedCostsAllocatedInPeriod;

  if (
    fixedCostsAllocatedInPeriod !== undefined &&
    Number.isFinite(fixedCostsAllocatedInPeriod) &&
    fixedCostsAllocatedInPeriod > 0
  ) {
    const fcPct = pctOrNaN(Number(fixedCostsAllocatedInPeriod), netAfterRefunds);
    fixedCostRatePct = Number.isFinite(fcPct) ? fcPct : null;
    fixedCostScore = Number.isFinite(fcPct) ? scoreLowerIsBetter(fcPct, cfg.fixedCostRatePct) : 0;
  }

  // Weights: disable when not available
  const baseWeights = { ...cfg.weights };
  if (adScore === undefined) baseWeights.adEfficiency = 0;
  if (shippingScore === undefined) baseWeights.shippingSubsidy = 0;
  if (missingCogsScore === undefined) baseWeights.missingCogs = 0;
  if (fixedCostScore === undefined) baseWeights.fixedCostPressure = 0;

  const w = normalizeWeights(baseWeights);

  const scoreRaw =
    cmScore * w.contributionMarginPct +
    refundScore * w.refundRate +
    feeScore * w.feeRate +
    cogsScore * w.cogsRate +
    (adScore ?? 0) * w.adEfficiency +
    (shippingScore ?? 0) * w.shippingSubsidy +
    (missingCogsScore ?? 0) * w.missingCogs +
    (fixedCostScore ?? 0) * w.fixedCostPressure;

  let score = round2(clamp(scoreRaw, 0, 100));

  // ✅ Apply data quality cap (Missing COGS governance)
  const capRes = applyMissingCogsCap({ score, missingCogsRatePct, cfg });
  score = round2(capRes.cappedScore);

  const status = statusFromScore(score, cfg);

  const components: Record<string, number> = {
    contributionMarginPct: round2(cmScore),
    refundRate: round2(refundScore),
    feeRate: round2(feeScore),
    cogsRate: round2(cogsScore),
    ...(adScore === undefined ? {} : { adEfficiency: round2(adScore) }),
    ...(shippingScore === undefined ? {} : { shippingSubsidy: round2(shippingScore) }),
    ...(missingCogsScore === undefined ? {} : { missingCogs: round2(missingCogsScore) }),
    ...(fixedCostScore === undefined ? {} : { fixedCostPressure: round2(fixedCostScore) }),
  };

  const ratios: Record<string, number | null | undefined> = {
    contributionMarginPct: round2(cmPct),
    refundRatePct: Number.isFinite(refundRatePct) ? round2(refundRatePct) : null,
    feeRatePct: Number.isFinite(feeRatePct) ? round2(feeRatePct) : null,
    cogsRatePct: Number.isFinite(cogsRatePct) ? round2(cogsRatePct) : null,

    shippingSubsidyLoss: shippingSubsidyLoss === null ? null : round2(shippingSubsidyLoss),
    shippingSubsidyPct: shippingSubsidyPct === null ? null : round2(shippingSubsidyPct),

    missingCogsRatePct: missingCogsRatePct === null ? null : round2(missingCogsRatePct),

    fixedCostRatePct: fixedCostRatePct === null ? null : round2(fixedCostRatePct),

    roas: roas === undefined ? undefined : roas === null ? null : round2(roas),
    salesRoas: salesRoas === undefined ? undefined : salesRoas === null ? null : round2(salesRoas),
  };

  const allDrivers: HealthDriver[] = [];

  if (ordersCount <= 0) {
    allDrivers.push(
      mkDriver({
        type: "MISSING_SIGNALS",
        title: "No orders in period",
        explanation: "Health cannot be reliably computed because there are 0 orders in the selected period.",
        impact: -25,
        meta: { ordersCount },
      })
    );
  }

  // ✅ Data quality driver (cap explanation)
  if (capRes.capApplied && capRes.capValue !== null) {
    allDrivers.push(
      mkDriver({
        type: "DATA_QUALITY_CAP",
        title: "Data quality cap (missing COGS)",
        explanation: `Health score is capped at ${capRes.capValue} because missing COGS coverage is too high. Fill costs to unlock full accuracy.`,
        impact: -round2(Math.max(0, scoreRaw - score)),
        meta: {
          capValue: capRes.capValue,
          missingCogsRatePct: missingCogsRatePct === null ? null : round2(missingCogsRatePct),
        },
      })
    );
  }

  if (cmPct < 0) {
    allDrivers.push(
      mkDriver({
        type: "NEGATIVE_CM",
        title: "Negative contribution margin",
        explanation: `Contribution margin is negative (${round2(cmPct)}%). You lose money before ads/fixed costs.`,
        impact: impactFrom(cmScore, w.contributionMarginPct) - 5,
        meta: { contributionMarginPct: round2(cmPct) },
      })
    );
  } else if (cmPct < cfg.cmPct.good) {
    allDrivers.push(
      mkDriver({
        type: "LOW_CM_PCT",
        title: "Low contribution margin",
        explanation: `Contribution margin is low (${round2(cmPct)}%). Target is ≥ ${cfg.cmPct.good}%.`,
        impact: impactFrom(cmScore, w.contributionMarginPct),
        meta: { contributionMarginPct: round2(cmPct), targetGoodPct: cfg.cmPct.good },
      })
    );
  }

  if (Number.isFinite(refundRatePct) && refundRatePct > cfg.refundRatePct.ok) {
    allDrivers.push(
      mkDriver({
        type: "HIGH_REFUND_RATE",
        title: "High refund rate",
        explanation: `Refund rate is ${round2(refundRatePct)}% (ok ≤ ${cfg.refundRatePct.ok}%).`,
        impact: impactFrom(refundScore, w.refundRate),
        meta: { refundRatePct: round2(refundRatePct), okMax: cfg.refundRatePct.ok },
      })
    );
  }

  if (Number.isFinite(feeRatePct) && feeRatePct > cfg.feeRatePct.ok) {
    allDrivers.push(
      mkDriver({
        type: "HIGH_FEE_BURDEN",
        title: "High payment fee burden",
        explanation: `Payment fees are ${round2(feeRatePct)}% of net sales (ok ≤ ${cfg.feeRatePct.ok}%).`,
        impact: impactFrom(feeScore, w.feeRate),
        meta: { feeRatePct: round2(feeRatePct), okMax: cfg.feeRatePct.ok },
      })
    );
  }

  if (Number.isFinite(cogsRatePct) && cogsRatePct > cfg.cogsRatePct.ok) {
    allDrivers.push(
      mkDriver({
        type: "HIGH_COGS_RATE",
        title: "High COGS ratio",
        explanation: `COGS are ${round2(cogsRatePct)}% of net sales (ok ≤ ${cfg.cogsRatePct.ok}%).`,
        impact: impactFrom(cogsScore, w.cogsRate),
        meta: { cogsRatePct: round2(cogsRatePct), okMax: cfg.cogsRatePct.ok },
      })
    );
  }

  if (shippingSubsidyPct !== null && shippingSubsidyPct > cfg.shippingSubsidyPct.ok) {
    allDrivers.push(
      mkDriver({
        type: "SHIPPING_SUBSIDY",
        title: "Shipping is subsidized",
        explanation: `Shipping subsidy is ${round2(shippingSubsidyPct)}% of net sales (ok ≤ ${cfg.shippingSubsidyPct.ok}%).`,
        impact: impactFrom(shippingScore ?? 0, w.shippingSubsidy),
        meta: { shippingSubsidyPct: round2(shippingSubsidyPct), okMax: cfg.shippingSubsidyPct.ok },
      })
    );
  }

  if (missingCogsRatePct !== null && missingCogsRatePct > cfg.missingCogsRatePct.ok) {
    allDrivers.push(
      mkDriver({
        type: "MISSING_COGS",
        title: "Missing COGS coverage",
        explanation: `${round2(missingCogsRatePct)}% of orders have missing COGS (ok ≤ ${cfg.missingCogsRatePct.ok}%). Profit is likely overstated until costs are filled.`,
        impact: impactFrom(missingCogsScore ?? 0, w.missingCogs),
        meta: { missingCogsRatePct: round2(missingCogsRatePct), okMax: cfg.missingCogsRatePct.ok },
      })
    );
  }

  if (
    roas !== undefined &&
    roas !== null &&
    Number.isFinite(roas) &&
    breakEvenRoas !== null &&
    Number.isFinite(breakEvenRoas) &&
    breakEvenRoas > 0
  ) {
    if (roas < breakEvenRoas) {
      allDrivers.push(
        mkDriver({
          type: "ROAS_BELOW_BREAK_EVEN",
          title: "ROAS below break-even",
          explanation: `ROAS is ${round2(roas)} but break-even ROAS is ${round2(breakEvenRoas)}. Ads likely push you into loss.`,
          impact: impactFrom(adScore ?? 0, w.adEfficiency),
          meta: { roas: round2(roas), breakEvenRoas: round2(breakEvenRoas) },
        })
      );
    }
  }

  if (fixedCostRatePct !== null && fixedCostRatePct > cfg.fixedCostRatePct.ok) {
    allDrivers.push(
      mkDriver({
        type: "FIXED_COST_PRESSURE",
        title: "High fixed cost pressure",
        explanation: `Fixed costs are ${round2(fixedCostRatePct)}% of net sales (ok ≤ ${cfg.fixedCostRatePct.ok}%). This compresses true operating profit.`,
        impact: impactFrom(fixedCostScore ?? 0, w.fixedCostPressure),
        meta: {
          fixedCostsAllocatedInPeriod: round2(Number(fixedCostsAllocatedInPeriod || 0)),
          fixedCostRatePct: round2(fixedCostRatePct),
          okMax: cfg.fixedCostRatePct.ok,
        },
      })
    );
  }

  const drivers = allDrivers
    .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
    .slice(0, 5);

  return {
    score,
    status,
    drivers,
    components,
    ratios,
    signals: {
      currency: params.currency,
      orders: ordersCount,
      grossSales: round2(grossSales),
      refunds: round2(refunds),
      netAfterRefunds: round2(netAfterRefunds),
      cogs: round2(cogs),
      paymentFees: round2(paymentFees),
      contributionMarginPct: round2(cmPct),
      ...(shippingRevenue === undefined ? {} : { shippingRevenue: round2(Number(shippingRevenue || 0)) }),
      ...(shippingCost === undefined ? {} : { shippingCost: round2(Number(shippingCost || 0)) }),
      ...(params.missingCogsCount === undefined ? {} : { missingCogsCount: Number(params.missingCogsCount || 0) }),
      ...(adSpend === undefined ? {} : { adSpend: round2(Number(adSpend || 0)) }),
      ...(roas === undefined ? {} : { roas: roas === null ? null : round2(roas) }),
      breakEvenRoas: breakEvenRoas ?? null,
      ...(fixedCostsAllocatedInPeriod === undefined
        ? {}
        : { fixedCostsAllocatedInPeriod: round2(Number(fixedCostsAllocatedInPeriod || 0)) }),
      ...(salesRoas === undefined ? {} : { salesRoas: salesRoas === null ? null : round2(salesRoas) }),
    },
  };
}

export function computeProfitHealthFromOrdersSummary(
  summary: {
    count: number;
    grossSales: number;
    refunds: number;
    netAfterRefunds: number;
    cogs: number;
    paymentFees: number;
    contributionMarginPct: number;
    breakEvenRoas: number | null;
    adSpend?: number;
    shippingRevenue?: number;
    shippingCost?: number;
    missingCogsCount?: number;
    currency?: string;
    fixedCostsAllocatedInPeriod?: number;
  },
  config?: ProfitHealthConfig
): ProfitHealth {
  return computeProfitHealthFromSummary({
    grossSales: summary.grossSales,
    refunds: summary.refunds,
    netAfterRefunds: summary.netAfterRefunds,
    cogs: summary.cogs,
    paymentFees: summary.paymentFees,
    contributionMarginPct: summary.contributionMarginPct,
    breakEvenRoas: summary.breakEvenRoas,
    adSpend: summary.adSpend,
    shippingRevenue: summary.shippingRevenue,
    shippingCost: summary.shippingCost,
    missingCogsCount: summary.missingCogsCount,
    ordersCount: summary.count,
    currency: summary.currency,
    fixedCostsAllocatedInPeriod: summary.fixedCostsAllocatedInPeriod,
    config,
  });
}
