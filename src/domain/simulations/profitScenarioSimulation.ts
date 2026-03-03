// src/domain/simulations/profitScenarioSimulation.ts
import { round2 } from "../../utils/money";

function safePctChange(base: number, next: number) {
  if (!Number.isFinite(base) || base === 0) return null;
  return round2(((next - base) / base) * 100);
}

export type ProfitScenarioResult = {
  baseline: any;
  simulated: any;
  delta: {
    profitLiftAfterFees: number;
    profitLiftAfterShipping: number;

    paymentFeesChange: number;
    shippingCostChange: number;

    contributionMarginChange: number;
    contributionMarginPctChange: number | null;

    breakEvenRoasChange: number | null;

    profitAfterShippingChange: number;
    profitMarginAfterShippingPctChange: number | null;

    // Optional nice-to-have % changes
    profitAfterShippingPctChange: number | null;
  };
};

export function buildProfitScenarioResult(params: { baseline: any; simulated: any }): ProfitScenarioResult {
  const { baseline, simulated } = params;

  const bProfitAfterFees = Number(baseline?.profitAfterFees ?? 0);
  const sProfitAfterFees = Number(simulated?.profitAfterFees ?? 0);

  const bProfitAfterShipping = Number(baseline?.profitAfterShipping ?? 0);
  const sProfitAfterShipping = Number(simulated?.profitAfterShipping ?? 0);

  const bFees = Number(baseline?.paymentFees ?? 0);
  const sFees = Number(simulated?.paymentFees ?? 0);

  const bShipCost = Number(baseline?.shippingCost ?? 0);
  const sShipCost = Number(simulated?.shippingCost ?? 0);

  const bCM = Number(baseline?.contributionMargin ?? 0);
  const sCM = Number(simulated?.contributionMargin ?? 0);

  const bCMPct = baseline?.contributionMarginPct === null ? null : Number(baseline?.contributionMarginPct ?? 0);
  const sCMPct = simulated?.contributionMarginPct === null ? null : Number(simulated?.contributionMarginPct ?? 0);

  const bBe = baseline?.breakEvenRoas === null ? null : Number(baseline?.breakEvenRoas ?? 0);
  const sBe = simulated?.breakEvenRoas === null ? null : Number(simulated?.breakEvenRoas ?? 0);

  const bPShipPct =
    baseline?.profitMarginAfterShippingPct === null ? null : Number(baseline?.profitMarginAfterShippingPct ?? 0);
  const sPShipPct =
    simulated?.profitMarginAfterShippingPct === null ? null : Number(simulated?.profitMarginAfterShippingPct ?? 0);

  const contributionMarginPctChange =
    bCMPct === null || sCMPct === null ? null : round2(Number(sCMPct) - Number(bCMPct));

  const breakEvenRoasChange = bBe === null || sBe === null ? null : round2(Number(sBe) - Number(bBe));

  const profitMarginAfterShippingPctChange =
    bPShipPct === null || sPShipPct === null ? null : round2(Number(sPShipPct) - Number(bPShipPct));

  return {
    baseline,
    simulated,
    delta: {
      profitLiftAfterFees: round2(sProfitAfterFees - bProfitAfterFees),
      profitLiftAfterShipping: round2(sProfitAfterShipping - bProfitAfterShipping),

      paymentFeesChange: round2(sFees - bFees),
      shippingCostChange: round2(sShipCost - bShipCost),

      contributionMarginChange: round2(sCM - bCM),
      contributionMarginPctChange,

      breakEvenRoasChange,

      profitAfterShippingChange: round2(sProfitAfterShipping - bProfitAfterShipping),
      profitMarginAfterShippingPctChange,

      profitAfterShippingPctChange: safePctChange(bProfitAfterShipping, sProfitAfterShipping),
    },
  };
}