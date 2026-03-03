// src/domain/profit/cogsGovernance.ts

/**
 * Missing-COGS governance (SSOT) - Option C:
 * - unitCost === undefined => missing ALWAYS (even if ignored)
 * - unitCost === 0 => missing unless ignored
 * - unitCost > 0 => not missing
 *
 * Interpretation:
 * - "ignored" means: 0 is allowed (freebie/service), but unknown is still missing data.
 */
export function isMissingUnitCost(params: {
  unitCost: number | undefined;
  variantId: number;
  isIgnoredVariant?: (variantId: number) => boolean;
}): boolean {
  const { unitCost, variantId, isIgnoredVariant } = params;

  // Unknown cost is ALWAYS missing (even if ignored)
  if (unitCost === undefined) return true;

  // Explicit 0 is only OK if variant is ignored
  if (unitCost === 0) return !Boolean(isIgnoredVariant?.(variantId));

  // Any positive finite cost => not missing
  return false;
}