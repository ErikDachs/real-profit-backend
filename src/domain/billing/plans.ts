export type BillingPlanKey = "starter" | "pro" | "scale";

export type BillingPlanDef = {
  key: BillingPlanKey;
  name: string;
  priceUsd: number;
};

export const BILLING_PLANS: Record<BillingPlanKey, BillingPlanDef> = {
  starter: {
    key: "starter",
    name: "Real Profit Starter",
    priceUsd: 19,
  },
  pro: {
    key: "pro",
    name: "Real Profit Pro",
    priceUsd: 49,
  },
  scale: {
    key: "scale",
    name: "Real Profit Scale",
    priceUsd: 99,
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

export function planFromSubscriptionName(name: any): BillingPlanKey | null {
  const raw = String(name ?? "").trim();

  for (const plan of Object.values(BILLING_PLANS)) {
    if (plan.name === raw) return plan.key;
  }

  return null;
}