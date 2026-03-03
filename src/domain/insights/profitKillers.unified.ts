// src/domain/insights/profitKillers.unified.ts
import { safeDiv, DEFAULTS } from "./utils.js";

export function buildUnifiedRankingInputs(params: {
  days: number;
  currency: string;

  totals: {
    grossSales: number;
    refunds: number;
    netAfterRefunds: number;
    paymentFees: number;
  };

  missingCogsCount: number;
  missingCogsLossInPeriod: number;

  legacyAll: any[];

  shippingSubsidy: any | null;
  shippingLossInPeriod: number;

  marginDrift: any | null;
  breakEvenRisk: any | null;

  fixedCosts?: { allocatedInPeriod?: number } | null;
}) {
  const { totals, missingCogsCount, missingCogsLossInPeriod, legacyAll, shippingSubsidy, shippingLossInPeriod, marginDrift, breakEvenRisk, fixedCosts } =
    params;

  const refundRatePctTotal = safeDiv(totals.refunds, totals.grossSales) * 100;
  const feeRatePctTotal = safeDiv(totals.paymentFees, totals.netAfterRefunds) * 100;

  const includeRefunds = totals.grossSales > 0 && refundRatePctTotal > DEFAULTS.HIGH_REFUNDS_PCT;
  const includeFees = totals.netAfterRefunds > 0 && feeRatePctTotal > DEFAULTS.HIGH_FEES_PCT;

  // ProfitImpact mapping: buildProfitImpact returns `reason`, not `type`.
  const lowMarginOpp = legacyAll.find((x: any) => x?.reason === "LOW_MARGIN");
  const negativeOpp = legacyAll.find((x: any) => x?.reason === "NEGATIVE_CM");

  // Fixed costs signal (from SSOT cost model + allocator)
  const fixedCostsAllocatedInPeriod = Math.max(0, Number(fixedCosts?.allocatedInPeriod ?? 0));
  const fixedCostRatePctTotal =
    totals.netAfterRefunds > 0 ? (fixedCostsAllocatedInPeriod / totals.netAfterRefunds) * 100 : 0;
  const includeFixedCosts = fixedCostsAllocatedInPeriod > 0;

  return {
    profitImpact: {
      lowMargin: lowMarginOpp
        ? {
            lossInPeriod: Number(lowMarginOpp.estimatedLoss ?? 0),
            marginPct: lowMarginOpp?.evidence?.contributionMarginPct ?? lowMarginOpp?.meta?.marginPct ?? null,
          }
        : undefined,
      negativeCm: negativeOpp
        ? {
            lossInPeriod: Number(negativeOpp.estimatedLoss ?? 0),
            cm: negativeOpp?.meta?.cm ?? null,
            cmPct: negativeOpp?.meta?.cmPct ?? null,
          }
        : undefined,
    },

    refunds: includeRefunds
      ? {
          lossInPeriod: Number(totals.refunds || 0),
          refundRatePct: refundRatePctTotal,
        }
      : undefined,

    fees: includeFees
      ? {
          lossInPeriod: Number(totals.paymentFees || 0),
          feePctOfNet: feeRatePctTotal,
        }
      : undefined,

    missingCogsCount,
    missingCogsLossInPeriod,

    shippingSubsidy:
      shippingLossInPeriod > 0
        ? {
            lossInPeriod: shippingLossInPeriod,
            subsidyRatePct: (shippingSubsidy as any)?.subsidyRatePct ?? null,
          }
        : undefined,

    marginDrift:
      marginDrift && marginDrift.status === "DETERIORATING"
        ? {
            lossInPeriod: Number(marginDrift.estimatedLossInPeriod || 0),
            driftPctPoints: Number(marginDrift.driftPctPoints || 0),
            shortWindowDays: Number(marginDrift.shortWindowDays || 7),
            longWindowDays: Number(marginDrift.longWindowDays || 30),
            shortCmPct: Number(marginDrift.shortCmPct || 0),
            longCmPct: Number(marginDrift.longCmPct || 0),
          }
        : undefined,

    breakEvenRisk:
      breakEvenRisk && breakEvenRisk.status === "BURNING_CASH"
        ? {
            lossInPeriod: Number(breakEvenRisk.lossInPeriod || 0),
            adSpend: breakEvenRisk.adSpend,
            currentRoas: breakEvenRisk.currentRoas,
            breakEvenRoas: breakEvenRisk.breakEvenRoas,
            roasGap: breakEvenRisk.meta.roasGap,
          }
        : undefined,

    fixedCosts: includeFixedCosts
      ? {
          lossInPeriod: fixedCostsAllocatedInPeriod,
          fixedCostRatePct: fixedCostRatePctTotal,
        }
      : undefined,
  };
}
