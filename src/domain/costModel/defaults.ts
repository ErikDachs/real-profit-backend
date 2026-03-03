// src/domain/costModel/defaults.ts
import type { CostProfile } from "./types.js";

export const DEFAULT_COST_PROFILE: CostProfile = {
  payment: {
    feePercent: 0.029,
    feeFixed: 0.3,
  },
  shipping: {
    costPerOrder: 0,
  },
  ads: {
    allocationMode: "BY_NET_SALES",
  },
  fixedCosts: {
    allocationMode: "PER_ORDER",
    daysInMonth: 30,
    monthlyItems: [],
  },
  derived: {
    fixedCostsMonthlyTotal: 0,
  },
  flags: {
    includeShippingCost: true,
  },
};
