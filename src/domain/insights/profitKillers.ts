// src/domain/insights/profitKillers.ts
import { round2 } from "../../utils/money.js";
import { buildProfitImpact } from "../profitImpact.js";

import type { ProfitKillersParams } from "./types.js";
import { buildAdIntelligence } from "./adIntelligence.js";
import { buildShippingSubsidyInsight } from "./shippingSubsidy.js";
import { DEFAULTS, buildActions, periodLabel, safeDiv } from "./utils.js";
import { buildUnifiedOpportunityRanking } from "../opportunities/unifiedOpportunityRanking.js";
import { buildImpactSimulation } from "../simulations/impactSimulation.js";

import { detectMarginDrift } from "./marginDrift.js";
import { computeBreakEvenRisk } from "./breakEvenRisk.js";

import { computeTotals, computeContributionMarginPct, computeBreakEvenRoas, buildTotalsOut } from "./profitKillers.totals.js";
import { enrichOrdersWithReasons, pickWorstOrders, pickBestOrders } from "./profitKillers.orders.js";
import { pickWorstProducts, pickBestProducts } from "./profitKillers.products.js";
import { buildDailyFromOrders } from "./profitKillers.daily.js";
import { buildUnifiedRankingInputs } from "./profitKillers.unified.js";

export function buildProfitKillersInsights(params: ProfitKillersParams) {
  const { shop, days, orders, products, missingCogsCount, adSpend, currentRoas, shippingTotals, fixedCosts } = params;
  const limit = Math.max(1, Math.min(Number(params.limit ?? 10), 50));

  const currency = orders[0]?.currency ?? "USD";

  const totals = computeTotals(orders);
  const contributionMarginPct = computeContributionMarginPct(totals);
  const breakEvenRoas = computeBreakEvenRoas(totals);

  const totalsOut = buildTotalsOut({ currency, totals, contributionMarginPct, breakEvenRoas });

  const operationalOrders = orders.filter((o: any) => !Boolean(o?.isGiftCardOnlyOrder));

  const ordersWithReasons = enrichOrdersWithReasons(operationalOrders);

  const worstOrders = pickWorstOrders(ordersWithReasons, limit);
  const bestOrders = pickBestOrders(ordersWithReasons, limit);

  const worstProducts = pickWorstProducts(products as any[], limit);
  const bestProducts = pickBestProducts(products as any[], limit);

  const actions = buildActions({
    totals: {
      grossSales: totals.grossSales,
      refunds: totals.refunds,
      netAfterRefunds: totals.netAfterRefunds,
      cogs: totals.cogs,
      paymentFees: totals.paymentFees,
      contributionMargin: totals.contributionMargin,
      contributionMarginPct,
      breakEvenRoas,
    },
    missingCogsCount,
    worstOrders,
  });

  // -------------------------
  // LEGACY opportunities (ProfitImpact) — keep for backward compatibility
  // -------------------------
  const legacyOpportunities = buildProfitImpact({
    days,
    currency,
    thresholds: {
      highRefundsPct: DEFAULTS.HIGH_REFUNDS_PCT,
      lowMarginPct: DEFAULTS.LOW_MARGIN_PCT,
      highFeesPct: DEFAULTS.HIGH_FEES_PCT,
    },
    orders: ordersWithReasons.map((o) => ({
      id: o.id,
      grossSales: o.grossSales,
      refunds: o.refunds,
      netAfterRefunds: o.netAfterRefunds,
      cogs: o.cogs,
      paymentFees: o.paymentFees,
      contributionMargin: o.contributionMargin,
      contributionMarginPct: o.contributionMarginPct,
      profitAfterAds: (o as any).profitAfterAds,
      reasons: (o as any).reasons,
    })),
    totals: {
      grossSales: totals.grossSales,
      refunds: totals.refunds,
      netAfterRefunds: totals.netAfterRefunds,
      cogs: totals.cogs,
      paymentFees: totals.paymentFees,
      contributionMargin: totals.contributionMargin,
      contributionMarginPct,
      profitAfterAds: ordersWithReasons.reduce((s, o) => s + Number((o as any).profitAfterAds ?? 0), 0),
    },
  });

  const adIntelligence = buildAdIntelligence({
    currency,
    days,
    adSpend,
    currentRoas,
    totals: {
      netAfterRefunds: totals.netAfterRefunds,
      contributionMargin: totals.contributionMargin,
      breakEvenRoas,
    },
  });

  const shippingSubsidy = buildShippingSubsidyInsight({ currency, days, shippingTotals });

  const insights: any[] = [];
  if (shippingSubsidy) insights.push(shippingSubsidy);

  // -------------------------
  // Margin Drift (7d vs 30d) computed from SAME order rows
  // -------------------------
  const daily = buildDailyFromOrders(ordersWithReasons);

  const marginDrift = detectMarginDrift({
    currency,
    days,
    daily,
    shortWindowDays: 7,
    longWindowDays: 30,
    thresholdPctPoints: 0.1,
    minRequiredShortDays: 2,
    minRequiredLongDays: 2,
  });

  if (marginDrift) insights.push(marginDrift);

  // -------------------------
  // Break-even risk derived from AdIntelligence (single source)
  // -------------------------
  const breakEvenRisk = adIntelligence
    ? computeBreakEvenRisk({
        currency,
        days,
        adSpend: adIntelligence.adSpendInput,
        currentRoas: adIntelligence.currentRoas,
        breakEvenRoas: adIntelligence.breakEvenRoas,
        monthlyLeakIfBelowBreakEven: adIntelligence.monthlyLeakIfBelowBreakEven,
        status: adIntelligence.status,
      })
    : null;

  if (breakEvenRisk) insights.push(breakEvenRisk);

  // -------------------------
  // STRICT Profit Killers ranking inputs (Option A)
  // -------------------------
  const shippingLossInPeriod =
    shippingSubsidy && Number.isFinite(Number((shippingSubsidy as any).totalShippingImpact))
      ? Math.max(0, -Number((shippingSubsidy as any).totalShippingImpact))
      : shippingSubsidy && Number.isFinite(Number((shippingSubsidy as any).estimatedLossInPeriod))
        ? Math.max(0, Number((shippingSubsidy as any).estimatedLossInPeriod))
        : 0;

  const legacyAll: any[] = ((legacyOpportunities as any)?.all ?? []) as any[];
  const missingCogsOpp = legacyAll.find((x: any) => x?.reason === "MISSING_COGS");
  const missingCogsLossInPeriod = Math.max(0, Number(missingCogsOpp?.estimatedLoss ?? 0));

  const unifiedInputs = buildUnifiedRankingInputs({
    days,
    currency,
    totals: {
      grossSales: totals.grossSales,
      refunds: totals.refunds,
      netAfterRefunds: totals.netAfterRefunds,
      paymentFees: totals.paymentFees,
    },
    missingCogsCount: Number(missingCogsCount || 0),
    missingCogsLossInPeriod,
    legacyAll,
    shippingSubsidy: shippingSubsidy ?? null,
    shippingLossInPeriod,
    marginDrift: marginDrift ?? null,
    breakEvenRisk: breakEvenRisk ?? null,
    fixedCosts: fixedCosts ?? null,
  });

  const unified = buildUnifiedOpportunityRanking({
    days,
    currency,
    ...unifiedInputs,
    limit: 5,
  });

  const impactSimulation = buildImpactSimulation({ opportunities: unified.all, limit: 5 });

  const opportunities = { all: unified.all, top: unified.top };

  return {
    shop,
    meta: {
      currency,
      periodDays: days,
      periodLabel: periodLabel(days),
    },
    days,
    thresholds: {
      highRefundsPct: DEFAULTS.HIGH_REFUNDS_PCT,
      lowMarginPct: DEFAULTS.LOW_MARGIN_PCT,
      highFeesPct: DEFAULTS.HIGH_FEES_PCT,
    },
    totals: totalsOut,
    highlights: { missingCogsCount },
    insights,

    // ✅ SSOT ranking output
    opportunities,

    // ✅ add (your extra convenience fields)
    unifiedOpportunitiesAll: opportunities.all,
    unifiedOpportunitiesTop5: opportunities.top,

    // ✅ kept to avoid breaking anything still reading the old structure
    legacyOpportunities,

    adIntelligence,
    profitKillers: {
      worstOrders,
      bestOrders,
      worstProducts,
      bestProducts,
    },

    impactSimulation: impactSimulation.top,
    actions,
  };
}
