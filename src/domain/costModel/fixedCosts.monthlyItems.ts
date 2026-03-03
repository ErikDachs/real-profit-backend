// src/domain/costModel/fixedCosts.monthlyItems.ts
import type { FixedCostMonthlyItem } from "./types";

export function sanitizeMonthlyItem(x: any): FixedCostMonthlyItem | null {
  if (!x || typeof x !== "object") return null;

  const id = String(x.id ?? "").trim();
  const name = String(x.name ?? "").trim();
  const category = String(x.category ?? "").trim();
  const amountMonthly = Number(x.amountMonthly ?? 0);
  const enabled = Boolean(x.enabled ?? true);

  if (!id || !name) return null;
  if (!Number.isFinite(amountMonthly) || amountMonthly < 0) return null;

  return {
    id,
    name,
    category: category || "OTHER",
    amountMonthly,
    enabled,
  };
}

export function computeFixedCostsMonthlyTotal(items: FixedCostMonthlyItem[]): number {
  let sum = 0;
  for (const it of items) {
    if (!it.enabled) continue;
    sum += Number(it.amountMonthly || 0);
  }
  // keep deterministic (no rounding here)
  return Number.isFinite(sum) ? sum : 0;
}