// src/domain/insights/cmDecomposition.core.ts
import { round2 } from "../../utils/money.js";
import type { CmAgg, CmDecompositionDriver, CmDecompositionResult } from "./cmDecomposition.js";
import { safeDiv, marginPct, roundDriver } from "./cmDecomposition.utils.js";

type DecompositionMode = "CM" | "OPERATING";

function buildRefundDriver(params: {
  short: CmAgg;
  long: CmAgg;
  shortNet: number;
  notes: string[];
}): CmDecompositionDriver | null {
  const { short: s, long: l, shortNet, notes } = params;

  const sGross = Number(s.grossSales ?? NaN);
  const lGross = Number(l.grossSales ?? NaN);
  const sRefunds = Number(s.refunds ?? NaN);
  const lRefunds = Number(l.refunds ?? NaN);

  const haveRefundInputs =
    Number.isFinite(sGross) &&
    Number.isFinite(lGross) &&
    sGross > 0 &&
    lGross > 0 &&
    Number.isFinite(sRefunds) &&
    Number.isFinite(lRefunds);

  if (!haveRefundInputs) {
    notes.push("Refund driver omitted (grossSales/refunds missing in daily aggregates).");
    return null;
  }

  const sRefundRate = safeDiv(sRefunds, sGross);
  const lRefundRate = safeDiv(lRefunds, lGross);

  const expectedRefundsAtBaseline = sGross * lRefundRate;
  const deltaRefunds = sRefunds - expectedRefundsAtBaseline;
  const impactOnCm = -deltaRefunds;

  return roundDriver({
    code: "REFUNDS",
    label: "Refund rate change",
    deltaPctPoints: (impactOnCm / shortNet) * 100,
    impactOnCm,
    meta: {
      shortRefundRatePct: round2(sRefundRate * 100),
      longRefundRatePct: round2(lRefundRate * 100),
    },
  });
}

function buildRatioDriver(params: {
  code: CmDecompositionDriver["code"];
  label: string;
  shortValue: number;
  longValue: number;
  shortNet: number;
  longNet: number;
  shortRateLabel: string;
  longRateLabel: string;
}): CmDecompositionDriver {
  const { code, label, shortValue, longValue, shortNet, longNet, shortRateLabel, longRateLabel } = params;

  const longRateOnNet = safeDiv(longValue, longNet);
  const expectedAtBaseline = shortNet * longRateOnNet;
  const delta = shortValue - expectedAtBaseline;
  const impactOnCm = -delta;

  return roundDriver({
    code,
    label,
    deltaPctPoints: (impactOnCm / shortNet) * 100,
    impactOnCm,
    meta: {
      [shortRateLabel]: round2(safeDiv(shortValue, shortNet) * 100),
      [longRateLabel]: round2(longRateOnNet * 100),
    },
  });
}

function maybeBuildShippingCostDriver(params: {
  short: CmAgg;
  long: CmAgg;
  shortNet: number;
  longNet: number;
  notes: string[];
}): CmDecompositionDriver | null {
  const { short: s, long: l, shortNet, longNet, notes } = params;

  const sShipCost = Number(s.shippingCost ?? NaN);
  const lShipCost = Number(l.shippingCost ?? NaN);

  const haveShipping = Number.isFinite(sShipCost) && Number.isFinite(lShipCost);
  if (!haveShipping) {
    notes.push("Shipping driver omitted (shippingCost missing in daily aggregates).");
    return null;
  }

  return buildRatioDriver({
    code: "SHIPPING_COST",
    label: "Shipping cost share change",
    shortValue: sShipCost,
    longValue: lShipCost,
    shortNet,
    longNet,
    shortRateLabel: "shortShippingCostRatePct",
    longRateLabel: "longShippingCostRatePct",
  });
}

function maybeBuildFixedCostsDriver(params: {
  short: CmAgg;
  long: CmAgg;
  shortNet: number;
  longNet: number;
  notes: string[];
}): CmDecompositionDriver | null {
  const { short: s, long: l, shortNet, longNet, notes } = params;

  const sFixed = Number(s.fixedCostsAllocatedInPeriod ?? NaN);
  const lFixed = Number(l.fixedCostsAllocatedInPeriod ?? NaN);

  const haveFixed =
    (s.fixedCostsAllocatedInPeriod !== undefined && Number.isFinite(sFixed)) ||
    (l.fixedCostsAllocatedInPeriod !== undefined && Number.isFinite(lFixed));

  if (!haveFixed) {
    notes.push("Fixed cost driver omitted (fixedCostsAllocatedInPeriod missing).");
    return null;
  }

  // treat missing as 0 if one side missing but "haveFixed" is true
  const shortFixed = Number.isFinite(sFixed) ? sFixed : 0;
  const longFixed = Number.isFinite(lFixed) ? lFixed : 0;

  return buildRatioDriver({
    code: "FIXED_COSTS",
    label: "Fixed cost pressure change",
    shortValue: shortFixed,
    longValue: longFixed,
    shortNet,
    longNet,
    shortRateLabel: "shortFixedCostRatePct",
    longRateLabel: "longFixedCostRatePct",
  });
}

export function decomposeMarginDriftCore(params: {
  short: CmAgg;
  long: CmAgg;
  currency: string; // kept for API symmetry
  mode: DecompositionMode;
}): CmDecompositionResult | null {
  const s = params.short;
  const l = params.long;

  const shortNet = Number(s.netAfterRefunds || 0);
  const longNet = Number(l.netAfterRefunds || 0);
  if (shortNet <= 0 || longNet <= 0) return null;

  // CM / Operating profit (deterministic from components)
  const shortCm = shortNet - Number(s.cogs || 0) - Number(s.paymentFees || 0);
  const longCm = longNet - Number(l.cogs || 0) - Number(l.paymentFees || 0);

  const shortShip = Number(s.shippingCost ?? 0);
  const longShip = Number(l.shippingCost ?? 0);

  const shortFixed = Number(s.fixedCostsAllocatedInPeriod ?? 0);
  const longFixed = Number(l.fixedCostsAllocatedInPeriod ?? 0);

  const shortProfit =
    params.mode === "OPERATING" ? shortCm - shortShip - shortFixed : shortCm;

  const longProfit =
    params.mode === "OPERATING" ? longCm - longShip - longFixed : longCm;

  const shortPct = marginPct(shortNet, shortProfit);
  const longPct = marginPct(longNet, longProfit);
  const drift = shortPct - longPct;

  const notes: string[] = [
    "Baseline ratios computed from LONG window and applied to SHORT window scale.",
    "This is an explanatory (not predictive) deterministic decomposition.",
    ...(params.mode === "OPERATING"
      ? ["Operating margin includes shipping cost + fixed costs (if provided)."]
      : []),
  ];

  const drivers: CmDecompositionDriver[] = [];

  // REFUNDS driver only for CM mode (best effort; uses grossSales/refunds)
  if (params.mode === "CM") {
    const refundDriver = buildRefundDriver({ short: s, long: l, shortNet, notes });
    if (refundDriver) drivers.push(refundDriver);
  }

  // COGS
  drivers.push(
    buildRatioDriver({
      code: "COGS",
      label: "COGS share change",
      shortValue: Number(s.cogs || 0),
      longValue: Number(l.cogs || 0),
      shortNet,
      longNet,
      shortRateLabel: "shortCogsRatePct",
      longRateLabel: "longCogsRatePct",
    })
  );

  // PAYMENT FEES
  drivers.push(
    buildRatioDriver({
      code: "PAYMENT_FEES",
      label: "Payment fee share change",
      shortValue: Number(s.paymentFees || 0),
      longValue: Number(l.paymentFees || 0),
      shortNet,
      longNet,
      shortRateLabel: "shortFeeRatePct",
      longRateLabel: "longFeeRatePct",
    })
  );

  // SHIPPING COST (optional)
  const shipDriver = maybeBuildShippingCostDriver({ short: s, long: l, shortNet, longNet, notes });
  if (shipDriver) drivers.push(shipDriver);

  // FIXED COSTS (optional, only for OPERATING)
  if (params.mode === "OPERATING") {
    const fixedDriver = maybeBuildFixedCostsDriver({ short: s, long: l, shortNet, longNet, notes });
    if (fixedDriver) drivers.push(fixedDriver);
  }

  // OTHER (remaining)
  const sumDrivers = drivers.reduce((acc, d) => acc + Number(d.deltaPctPoints || 0), 0);
  const otherPct = drift - sumDrivers;
  const otherImpact = (otherPct / 100) * shortNet;

  drivers.push(
    roundDriver({
      code: "OTHER",
      label: "Other / rounding / missing inputs",
      deltaPctPoints: otherPct,
      impactOnCm: otherImpact,
      meta: { sumDriversPctPoints: round2(sumDrivers) },
    })
  );

  drivers.sort((a, b) => Math.abs(Number(b.impactOnCm || 0)) - Math.abs(Number(a.impactOnCm || 0)));

  return {
    baseline: { window: "LONG", cmPct: round2(longPct) },
    current: { window: "SHORT", cmPct: round2(shortPct) },
    driftPctPoints: round2(drift),
    drivers,
    meta: { method: "RATIO_TO_SHORT_WINDOW", notes },
  };
}
