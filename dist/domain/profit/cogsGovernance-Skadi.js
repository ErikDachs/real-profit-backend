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
export function isMissingUnitCost(params) {
    const { unitCost, variantId, isIgnoredVariant } = params;
    if (unitCost === undefined)
        return true;
    if (!Number.isFinite(unitCost))
        return true;
    if (unitCost < 0)
        return true;
    if (unitCost === 0)
        return !Boolean(isIgnoredVariant?.(variantId));
    return false;
}
