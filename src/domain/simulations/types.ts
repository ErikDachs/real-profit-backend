// src/domain/simulations/types.ts

import type { OpportunityType } from "../opportunities/types.js";

export type SimulationScenario = {
  key: string; // stable id
  label: string; // UI label e.g. "-20% refunds"
  changePct: number; // -0.2 means reduce by 20%
};

export type OpportunitySimulation = {
  type: OpportunityType;
  title: string;

  currency: string;
  days: number;

  // legacy/top-level convenience fields used by current simulation output
  estimatedMonthlyLoss: number;
  estimatedAnnualLoss: number;

  baseline: {
    estimatedMonthlyLoss: number;
    estimatedAnnualLoss: number;
  };

  scenarios: Array<{
    scenario: SimulationScenario;

    // Profit lift if you achieve this scenario (positive numbers)
    profitLiftMonthly: number;
    profitLiftAnnual: number;

    // Remaining loss after applying the scenario
    newEstimatedMonthlyLoss: number;
    newEstimatedAnnualLoss: number;
  }>;

  // Optional context for UI
  meta?: Record<string, any>;
};