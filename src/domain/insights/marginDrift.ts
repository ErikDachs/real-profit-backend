// src/domain/insights/marginDrift.ts
import { round2 } from "../../utils/money.js";
import { decomposeCmDrift, type CmAgg, type CmDecompositionResult } from "./cmDecomposition.js";

export type DailyProfitRowLike = {
  day: string; // YYYY-MM-DD

  // minimum required (existing)
  netAfterRefunds: number;
  contributionMargin: number;
  contributionMarginPct?: number;

  // optional (enables decomposition)
  orders?: number;
  grossSales?: number;
  refunds?: number;

  cogs?: number;
  paymentFees?: number;

  shippingRevenue?: number;
  shippingCost?: number;
};

export type MarginDriftResult = {
  type: "marginDrift";
  currency: string;
  periodDays: number;

  shortWindowDays: number;
  longWindowDays: number;

  shortNetAfterRefunds: number;
  longNetAfterRefunds: number;

  shortContributionMargin: number;
  longContributionMargin: number;

  shortCmPct: number;
  longCmPct: number;

  driftPctPoints: number; // short - long
  status: "IMPROVING" | "STABLE" | "DETERIORATING" | "INSUFFICIENT_DATA";

  // deterministic "loss in period" proxy:
  estimatedLossInPeriod: number;

  // ✅ NEW: optional “WHY” explanation (if daily rows contain components)
  decomposition: CmDecompositionResult | null;

  meta: {
    minRequiredShortDays: number;
    minRequiredLongDays: number;
    includedDaysShort: number;
    includedDaysLong: number;
    thresholdPctPoints: number;

    // debugging: did we have enough fields for decomposition?
    decompositionEnabled: boolean;
  };
};

function isDayKey(s: string): boolean {
  return typeof s === "string" && s.length >= 10 && s[4] === "-" && s[7] === "-";
}

function takeLastNDays(rows: DailyProfitRowLike[], n: number): DailyProfitRowLike[] {
  const cleaned = rows
    .filter((r) => isDayKey(r.day) && r.day !== "unknown")
    .slice()
    .sort((a, b) => a.day.localeCompare(b.day));
  if (cleaned.length <= n) return cleaned;
  return cleaned.slice(cleaned.length - n);
}

function sumAgg(rows: DailyProfitRowLike[]) {
  return rows.reduce(
    (acc, r) => {
      acc.orders += Number(r.orders || 0);

      acc.grossSales += Number(r.grossSales || 0);
      acc.refunds += Number(r.refunds || 0);

      acc.net += Number(r.netAfterRefunds || 0);
      acc.cm += Number(r.contributionMargin || 0);

      acc.cogs += Number((r as any).cogs || 0);
      acc.fees += Number((r as any).paymentFees || 0);

      acc.shippingRevenue += Number((r as any).shippingRevenue || 0);
      acc.shippingCost += Number((r as any).shippingCost || 0);

      return acc;
    },
    {
      orders: 0,
      grossSales: 0,
      refunds: 0,
      net: 0,
      cm: 0,
      cogs: 0,
      fees: 0,
      shippingRevenue: 0,
      shippingCost: 0,
    }
  );
}

function cmPctFrom(net: number, cm: number): number {
  if (!Number.isFinite(net) || net <= 0) return 0;
  return (Number(cm || 0) / net) * 100;
}

function canDecompose(a: ReturnType<typeof sumAgg>) {
  // minimum needed for useful decomposition: net, cogs, fees exist (they are aggregated anyway)
  // refunds driver needs grossSales+refunds, shipping driver needs shippingCost.
  // We treat decomposition as enabled if we have cogs+fees at least.
  return Number.isFinite(a.net) && a.net > 0 && (Number.isFinite(a.cogs) || Number.isFinite(a.fees));
}

export function detectMarginDrift(params: {
  currency: string;
  days: number;
  daily: DailyProfitRowLike[];

  shortWindowDays?: number; // default 7
  longWindowDays?: number; // default 30

  thresholdPctPoints?: number; // default 2.0

  minRequiredShortDays?: number; // default 5
  minRequiredLongDays?: number; // default 14
}): MarginDriftResult | null {
  const currency = params.currency || "USD";
  const periodDays = Math.max(1, Number(params.days || 0));
  const shortWindowDays = Math.max(1, Number(params.shortWindowDays ?? 7));
  const longWindowDays = Math.max(shortWindowDays, Number(params.longWindowDays ?? 30));

  const threshold = Number(params.thresholdPctPoints ?? 2.0);
  const minShort = Math.max(1, Number(params.minRequiredShortDays ?? 5));
  const minLong = Math.max(1, Number(params.minRequiredLongDays ?? 14));

  const shortRows = takeLastNDays(params.daily || [], shortWindowDays);
  const longRows = takeLastNDays(params.daily || [], longWindowDays);

  if (shortRows.length < minShort || longRows.length < minLong) return null;

  const shortAgg = sumAgg(shortRows);
  const longAgg = sumAgg(longRows);

  const shortCmPct = cmPctFrom(shortAgg.net, shortAgg.cm);
  const longCmPct = cmPctFrom(longAgg.net, longAgg.cm);

  const drift = shortCmPct - longCmPct;

  let status: MarginDriftResult["status"] = "STABLE";
  if (!Number.isFinite(drift)) status = "INSUFFICIENT_DATA";
  else if (drift <= -Math.abs(threshold)) status = "DETERIORATING";
  else if (drift >= Math.abs(threshold)) status = "IMPROVING";
  else status = "STABLE";

  const lossInPeriod =
    status === "DETERIORATING"
      ? Math.max(0, ((longCmPct - shortCmPct) / 100) * shortAgg.net)
      : 0;

  // ✅ NEW: decomposition (best effort)
  let decomposition: CmDecompositionResult | null = null;
  const decompositionEnabled = canDecompose(shortAgg) && canDecompose(longAgg);

  if (decompositionEnabled) {
    const shortInput: CmAgg = {
      orders: shortAgg.orders,
      grossSales: shortAgg.grossSales,
      refunds: shortAgg.refunds,
      netAfterRefunds: shortAgg.net,
      cogs: shortAgg.cogs,
      paymentFees: shortAgg.fees,
      shippingRevenue: shortAgg.shippingRevenue,
      shippingCost: shortAgg.shippingCost,
    };

    const longInput: CmAgg = {
      orders: longAgg.orders,
      grossSales: longAgg.grossSales,
      refunds: longAgg.refunds,
      netAfterRefunds: longAgg.net,
      cogs: longAgg.cogs,
      paymentFees: longAgg.fees,
      shippingRevenue: longAgg.shippingRevenue,
      shippingCost: longAgg.shippingCost,
    };

    decomposition = decomposeCmDrift({ short: shortInput, long: longInput, currency });
  }

  return {
    type: "marginDrift",
    currency,
    periodDays,

    shortWindowDays,
    longWindowDays,

    shortNetAfterRefunds: round2(shortAgg.net),
    longNetAfterRefunds: round2(longAgg.net),

    shortContributionMargin: round2(shortAgg.cm),
    longContributionMargin: round2(longAgg.cm),

    shortCmPct: round2(shortCmPct),
    longCmPct: round2(longCmPct),

    driftPctPoints: round2(drift),
    status,

    estimatedLossInPeriod: round2(lossInPeriod),

    decomposition,

    meta: {
      minRequiredShortDays: minShort,
      minRequiredLongDays: minLong,
      includedDaysShort: shortRows.length,
      includedDaysLong: longRows.length,
      thresholdPctPoints: threshold,
      decompositionEnabled,
    },
  };
}
