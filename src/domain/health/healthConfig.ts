// src/domain/health/healthConfig.ts

export type ProfitHealthWeights = {
  contributionMarginPct: number;
  refundRate: number;
  feeRate: number;
  cogsRate: number;
  adEfficiency: number;

  // components (optional)
  shippingSubsidy: number;
  missingCogs: number;

  // ✅ NEW optional component
  fixedCostPressure: number;
};

export type ProfitHealthConfig = {
  weights: ProfitHealthWeights;

  // Status thresholds for the final decision layer
  status: {
    healthyMin: number;  // score >= => HEALTHY
    unstableMin: number; // score >= => UNSTABLE (else CRITICAL)
  };

  cmPct: {
    low: number;
    ok: number;
    good: number;
    great: number;
  };

  refundRatePct: {
    low: number;
    ok: number;
    bad: number;
    awful: number;
  };

  feeRatePct: {
    low: number;
    ok: number;
    bad: number;
    awful: number;
  };

  cogsRatePct: {
    low: number;
    ok: number;
    bad: number;
    awful: number;
  };

  shippingSubsidyPct: {
    low: number;
    ok: number;
    bad: number;
    awful: number;
  };

  missingCogsRatePct: {
    low: number;
    ok: number;
    bad: number;
    awful: number;
  };

  // ✅ NEW: Fixed cost pressure ratio thresholds (as % of net sales)
  fixedCostRatePct: {
    low: number;
    ok: number;
    bad: number;
    awful: number;
  };

  adEfficiency: {
    greatMultiplier: number;
    goodMultiplier: number;
    okMultiplier: number;
    badMultiplier: number;
  };
};

export function getDefaultProfitHealthConfig(): ProfitHealthConfig {
  return {
    weights: {
      contributionMarginPct: 0.38,
      refundRate: 0.16,
      feeRate: 0.11,
      cogsRate: 0.11,
      adEfficiency: 0.09,
      shippingSubsidy: 0.06,
      missingCogs: 0.04,

      // ✅ NEW
      fixedCostPressure: 0.05,
    },

    // Final decision thresholds (deterministic, easy to reason about)
    status: {
      healthyMin: 75,
      unstableMin: 55,
    },

    cmPct: {
      low: 5,
      ok: 10,
      good: 20,
      great: 30,
    },

    refundRatePct: {
      low: 2,
      ok: 5,
      bad: 10,
      awful: 20,
    },

    feeRatePct: {
      low: 2.5,
      ok: 3.5,
      bad: 5.0,
      awful: 7.0,
    },

    cogsRatePct: {
      low: 25,
      ok: 40,
      bad: 55,
      awful: 70,
    },

    shippingSubsidyPct: {
      low: 0.5,
      ok: 1.5,
      bad: 3.0,
      awful: 6.0,
    },

    missingCogsRatePct: {
      low: 1,
      ok: 3,
      bad: 8,
      awful: 15,
    },

    // ✅ NEW: fixed costs as % of net sales
    // Heuristik: <10% super, 10–20 ok-ish, 20–30 bad, >30 awful
    fixedCostRatePct: {
      low: 8,
      ok: 15,
      bad: 25,
      awful: 35,
    },

    adEfficiency: {
      greatMultiplier: 1.3,
      goodMultiplier: 1.15,
      okMultiplier: 1.0,
      badMultiplier: 0.85,
    },
  };
}