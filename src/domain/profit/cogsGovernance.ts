// src/domain/profit/cogsGovernance.ts

/**
 * Missing-COGS governance (SSOT):
 * - unitCost === undefined => missing
 * - unitCost === null => missing
 * - unitCost === NaN / non-finite => missing
 * - unitCost === 0 => NOT missing (explicit zero-cost is valid)
 * - unitCost > 0 => not missing
 *
 * Interpretation:
 * - "missing" means unknown / invalid cost data
 * - explicit zero is a valid, deterministic cost value
 * - ignoreCogs can still be used by higher-level logic, but it is NOT required
 *   to make explicit zero-cost values valid
 */
export function isMissingUnitCost(params: {
  unitCost: number | undefined | null;
  variantId: number;
  isIgnoredVariant?: (variantId: number) => boolean;
}): boolean {
  const { unitCost, variantId, isIgnoredVariant } = params;

  if (unitCost === undefined || unitCost === null) return true;
  if (!Number.isFinite(Number(unitCost))) return true;

  if (Number(unitCost) === 0) {
    return isIgnoredVariant ? !isIgnoredVariant(variantId) : true;
  }

  return false;
}