// src/domain/opportunities/types.ts

export type OpportunityType =
  | "LOW_MARGIN"
  | "NEGATIVE_CM"
  | "HIGH_REFUNDS"
  | "HIGH_FEES"
  | "MISSING_COGS"
  | "SHIPPING_SUBSIDY"
  | "MARGIN_DRIFT"
  | "BREAK_EVEN_RISK"
  // ✅ NEW
  | "HIGH_FIXED_COST_LOAD"
  | "OPERATING_LEVERAGE_RISK";

export type OpportunitySeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export type UnifiedOpportunity = {
  type: OpportunityType;

  title: string;
  summary: string;

  estimatedMonthlyLoss: number;

  currency: string;
  days: number;

  meta?: Record<string, any>;

  actions?: Array<{
    label: string;
    code: string;
  }>;

  score?: number;
  confidence?: number;
  controllability?: number;
  severity?: OpportunitySeverity;
};
