import { describe, it, expect } from "vitest";
import {
  parseDays,
  parseLimit,
  parseAdInputs,
  parseOverrideBody,
  effectiveCostOverrides,
  pickCostOverrideInput,
  mergeCostOverrides,
} from "./helpers.js";

describe("shopify helpers - branch hardening", () => {
  describe("parseDays", () => {
    it("uses valid positive integer days", () => {
      expect(parseDays({ days: "30" }, 7)).toBe(30);
      expect(parseDays({ days: 12.9 }, 7)).toBe(12);
    });

    it("falls back for invalid values", () => {
      expect(parseDays({ days: 0 }, 7)).toBe(7);
      expect(parseDays({ days: -5 }, 7)).toBe(7);
      expect(parseDays({ days: "abc" }, 7)).toBe(7);
      expect(parseDays({}, 7)).toBe(7);
    });
  });

  describe("parseLimit", () => {
    it("accepts valid limit in range", () => {
      expect(parseLimit({ limit: "10" }, 5)).toBe(10);
    });

    it("clamps low and high values", () => {
      expect(parseLimit({ limit: 0 }, 5)).toBe(1);
      expect(parseLimit({ limit: -10 }, 5)).toBe(1);
      expect(parseLimit({ limit: 999 }, 5)).toBe(50);
      expect(parseLimit({ limit: 50.9 }, 5)).toBe(50);
    });

    it("falls back for invalid values", () => {
      expect(parseLimit({ limit: "abc" }, 5)).toBe(5);
      expect(parseLimit({}, 5)).toBe(5);
    });
  });

  describe("parseAdInputs", () => {
    it("returns undefined for empty fields", () => {
      expect(parseAdInputs({})).toEqual({ adSpend: undefined, currentRoas: undefined });
      expect(parseAdInputs({ adSpend: "", currentRoas: "" })).toEqual({
        adSpend: undefined,
        currentRoas: undefined,
      });
    });

    it("parses numeric fields", () => {
      expect(parseAdInputs({ adSpend: "123.456", currentRoas: "2.789" })).toEqual({
        adSpend: 123.46,
        currentRoas: 2.79,
      });
    });

    it("normalizes invalid numeric values to 0 when present", () => {
      expect(parseAdInputs({ adSpend: "abc", currentRoas: "xyz" })).toEqual({
        adSpend: 0,
        currentRoas: 0,
      });
    });
  });

  describe("parseOverrideBody", () => {
    it("rejects invalid variantId", () => {
      expect(parseOverrideBody({})).toEqual({
        ok: false,
        status: 400,
        error: "variantId must be a positive number",
      });

      expect(parseOverrideBody({ variantId: 0 })).toEqual({
        ok: false,
        status: 400,
        error: "variantId must be a positive number",
      });
    });

    it("accepts valid body with unitCost and ignoreCogs", () => {
      expect(parseOverrideBody({ variantId: 123, unitCost: 12.345, ignoreCogs: true })).toEqual({
        ok: true,
        variantId: 123,
        unitCost: 12.35,
        ignoreCogs: true,
      });
    });

    it("accepts null clears", () => {
      expect(parseOverrideBody({ variantId: 123, unitCost: null, ignoreCogs: null })).toEqual({
        ok: true,
        variantId: 123,
        unitCost: null,
        ignoreCogs: null,
      });
    });

    it("rejects negative unitCost", () => {
      expect(parseOverrideBody({ variantId: 123, unitCost: -1 })).toEqual({
        ok: false,
        status: 400,
        error: "unitCost must be a number >= 0 (or null to clear)",
      });
    });
  });

  describe("mergeCostOverrides", () => {
    it("returns undefined when both missing", () => {
      expect(mergeCostOverrides(undefined, undefined)).toBeUndefined();
    });

    it("merges nested override sections", () => {
      expect(
        mergeCostOverrides(
          {
            payment: { feePercent: 0.03 },
            shipping: { costPerOrder: 5 },
            flags: { includeShippingCost: true },
          } as any,
          {
            payment: { feeFixed: 0.3 },
            ads: { allocationMode: "BY_NET_SALES" },
            fixedCosts: { allocationMode: "PER_ORDER" },
          } as any
        )
      ).toEqual({
        payment: { feePercent: 0.03, feeFixed: 0.3 },
        shipping: { costPerOrder: 5 },
        ads: { allocationMode: "BY_NET_SALES" },
        flags: { includeShippingCost: true },
        fixedCosts: { allocationMode: "PER_ORDER" },
      });
    });
  });

  describe("effectiveCostOverrides", () => {
    it("returns persisted only when request has no valid overrides", () => {
      expect(
        effectiveCostOverrides({
          persisted: {
            payment: { feePercent: 0.05 },
          } as any,
          input: {},
        })
      ).toEqual({
        payment: { feePercent: 0.05 },
      });
    });

    it("request overrides win over persisted", () => {
      expect(
        effectiveCostOverrides({
          persisted: {
            payment: { feePercent: 0.05, feeFixed: 0.3 },
            shipping: { costPerOrder: 5 },
          } as any,
          input: {
            feePercent: "0.02",
            shippingCostPerOrder: "9",
          },
        })
      ).toEqual({
        payment: { feePercent: 0.02, feeFixed: 0.3 },
        shipping: { costPerOrder: 9 },
      });
    });
  });

  describe("pickCostOverrideInput", () => {
    it("picks only relevant override fields", () => {
      expect(
        pickCostOverrideInput({
          feePercent: "0.03",
          feeFixed: "0.2",
          shippingCostPerOrder: "7",
          includeShippingCost: "true",
          adAllocationMode: "BY_NET_SALES",
          ignored: "x",
        })
      ).toEqual({
        feePercent: "0.03",
        feeFixed: "0.2",
        shippingCostPerOrder: "7",
        includeShippingCost: "true",
        adAllocationMode: "BY_NET_SALES",
      });
    });
  });
});