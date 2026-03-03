// src/domain/actions/types.ts
import type { OpportunityType, UnifiedOpportunity } from "../opportunities/types";
import type { OpportunityDeepDive } from "../opportunities/deepDive/types";

export type ActionEffort = "LOW" | "MEDIUM" | "HIGH";
export type ActionConfidence = "LOW" | "MEDIUM" | "HIGH";

export type ActionItem = {
  // Stable identifier for feature flags / playbooks
  code: string;

  // Human label
  label: string;

  // Deterministic metadata
  effort: ActionEffort;
  confidence: ActionConfidence;

  // Main ranking metric (monthly profit gain potential)
  estimatedMonthlyGain: number;

  // Priority score (0..100)
  priorityScore: number;

  // Links / context
  opportunityType: OpportunityType;

  // Optional short "why" (deterministic)
  why: string;

  // Optional actionable checklist (deterministic suggestions)
  checklist: Array<{
    label: string;
    code: string; // stable step identifier (can be used later for UI state)
  }>;

  // Evidence for UI/debugging (kept compact)
  evidence?: {
    currency: string;
    days: number;

    // From unified opportunity
    estimatedMonthlyLoss: number;
    meta?: Record<string, any>;

    // From deep dive
    concentration?: OpportunityDeepDive["concentration"];
    topDrivers?: OpportunityDeepDive["drivers"];
    worstOrders?: OpportunityDeepDive["worstOrders"];

    // From scenario simulations (if available)
    scenarios?: any;
  };
};

export type ActionPlan = {
  shop: string;
  days: number;
  currency: string;

  // Cost model fingerprint used for this plan (debug determinism)
  costModelFingerprint?: string;

  // Ranked list of actions
  actions: ActionItem[];

  // Helpful top-level context
  meta?: {
    generatedAtIso: string;
    inputs?: Record<string, any>;
  };
};

export type BuildActionPlanParams = {
  shop: string;
  days: number;
  currency: string;

  unifiedOpportunities: UnifiedOpportunity[];

  // optional (but recommended)
  deepDives?: OpportunityDeepDive[];

  // optional (from runScenarioPresets)
  scenarioSimulationsByOpportunityType?: Map<OpportunityType, any>;

  costModelFingerprint?: string;

  // optional request context
  inputs?: Record<string, any>;

  limit?: number; // default 10 actions
};