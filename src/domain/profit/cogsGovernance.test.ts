import { describe, it, expect } from "vitest";
import { isMissingUnitCost } from "./cogsGovernance.js";

describe("isMissingUnitCost (SSOT governance) - Option C", () => {
  it("undefined => missing ALWAYS", () => {
    expect(isMissingUnitCost({ unitCost: undefined, variantId: 1 })).toBe(true);
    expect(isMissingUnitCost({ unitCost: undefined, variantId: 1, isIgnoredVariant: () => true })).toBe(true);
  });

  it("0 => missing when not ignored", () => {
    expect(isMissingUnitCost({ unitCost: 0, variantId: 1 })).toBe(true);
  });

  it("0 => not missing when ignored", () => {
    expect(isMissingUnitCost({ unitCost: 0, variantId: 1, isIgnoredVariant: () => true })).toBe(false);
  });

  it(">0 => not missing", () => {
    expect(isMissingUnitCost({ unitCost: 12.34, variantId: 1 })).toBe(false);
  });
});
