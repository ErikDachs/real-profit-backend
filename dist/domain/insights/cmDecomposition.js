// src/domain/insights/cmDecomposition.ts
import { decomposeMarginDriftCore } from "./cmDecomposition.core.js";
/**
 * Deterministic decomposition of CM% drift between two windows.
 */
export function decomposeCmDrift(params) {
    return decomposeMarginDriftCore({ ...params, mode: "CM" });
}
/**
 * ✅ NEW:
 * Decomposition of OPERATING margin drift:
 * operatingProfit = net - cogs - fees - shippingCost - fixedCosts
 */
export function decomposeOperatingMarginDrift(params) {
    return decomposeMarginDriftCore({ ...params, mode: "OPERATING" });
}
