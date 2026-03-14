export type BillingPlanKey = "starter" | "pro" | "scale";

export type BillingPlanDef = {
  key: BillingPlanKey;
  name: string;
  priceUsd: number;
  description: string;
  sortOrder: number;
};

export const BILLING_PLANS: Record<BillingPlanKey, BillingPlanDef> = {
  starter: {
    key: "starter",
    name: "Starter",
    priceUsd: 19,
    description:
      "Core profit visibility for stores that need order, product and daily profit clarity.",
    sortOrder: 10,
  },
  pro: {
    key: "pro",
    name: "Pro",
    priceUsd: 49,
    description:
      "Full profit intelligence with diagnosis, action planning and scenario simulation.",
    sortOrder: 20,
  },
  scale: {
    key: "scale",
    name: "Scale",
    priceUsd: 99,
    description:
      "Everything in Pro for larger operators who want the complete decision layer.",
    sortOrder: 30,
  },
};

export function isBillingPlanKey(value: any): value is BillingPlanKey {
  return value === "starter" || value === "pro" || value === "scale";
}

export function getBillingPlanOrThrow(value: any): BillingPlanDef {
  if (!isBillingPlanKey(value)) {
    const err: any = new Error(`Invalid billing plan: ${String(value ?? "")}`);
    err.status = 400;
    throw err;
  }
  return BILLING_PLANS[value];
}

export function getBillingPlans(): BillingPlanDef[] {
  return Object.values(BILLING_PLANS).sort((a, b) => a.sortOrder - b.sortOrder);
}

export function planFromSubscriptionName(name: any): BillingPlanKey | null {
  const raw = String(name ?? "").trim().toLowerCase();

  if (!raw) return null;

  if (raw.includes("scale")) return "scale";
  if (raw.includes("pro")) return "pro";
  if (raw.includes("starter")) return "starter";

  return null;
}

export function toShopifySubscriptionName(plan: BillingPlanDef): string {
  return `Real Profit ${plan.name}`;
}