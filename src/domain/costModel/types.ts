// src/domain/costModel/types.ts

export type AdSpendAllocationMode = "BY_NET_SALES" | "PER_ORDER";
export type FixedCostsAllocationMode = "PER_ORDER" | "BY_NET_SALES" | "BY_DAYS"; // ✅ now fully supported

export type FixedCostMonthlyItem = {
  id: string; // stable identifier
  name: string;
  category: string; // keep as string (UI will map)
  amountMonthly: number; // >= 0
  enabled: boolean;
};

export type CostProfile = {
  payment: {
    feePercent: number; // e.g. 0.029
    feeFixed: number; // e.g. 0.30
  };

  shipping: {
    costPerOrder: number; // fallback shipping cost if no order-level shipping cost exists
  };

  ads: {
    allocationMode: AdSpendAllocationMode;
  };

  fixedCosts: {
    allocationMode: FixedCostsAllocationMode; // ✅ PER_ORDER | BY_NET_SALES | BY_DAYS
    daysInMonth: number; // default 30
    monthlyItems: FixedCostMonthlyItem[];
  };

  // derived, computed deterministically by resolveCostProfile()
  derived: {
    fixedCostsMonthlyTotal: number;
  };

  flags: {
    includeShippingCost: boolean;
  };
};

// Overrides sind optional/partiell
export type CostProfileOverrides = Partial<{
  payment: Partial<CostProfile["payment"]>;
  shipping: Partial<CostProfile["shipping"]>;
  ads: Partial<CostProfile["ads"]>;
  fixedCosts: Partial<CostProfile["fixedCosts"]>;
  flags: Partial<CostProfile["flags"]>;
}>;

export type ResolvedCostProfile = CostProfile & {
  meta: {
    fingerprint: string;
    resolvedFrom: {
      config: any;
      overrides?: CostProfileOverrides;
    };
  };
};
