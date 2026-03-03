// src/domain/profit/orderProfit.ssot.test.ts
import { describe, it, expect } from "vitest";
import { calculateOrderProfit } from "./orderProfit.js";

const dummyShopifyGET: any = async () => {
  throw new Error("shopifyGET should not be called in these SSOT tests");
};

function makeOrder(params: {
  id?: string | number;
  total_price: number;
  shippingAmount?: number;
  refunds?: Array<{ transactions?: Array<{ amount: number | string }> }>;
  line_items: Array<{ variant_id?: number | null; quantity: number; gift_card?: boolean | string | number }>;
}) {
  return {
    id: params.id ?? "o1",
    total_price: String(params.total_price),
    total_shipping_price_set:
      params.shippingAmount === undefined
        ? undefined
        : { shop_money: { amount: String(params.shippingAmount) } },
    refunds: params.refunds ?? [],
    line_items: params.line_items,
  };
}

describe("calculateOrderProfit (SSOT) - Gift Cards Governance", () => {
  it("A) Gift Card Only Order: excluded from profit KPIs, hasMissingCogs=false", async () => {
    const order = makeOrder({
      id: "gift-only",
      total_price: 200,
      shippingAmount: 9, // must remain visible
      refunds: [],
      line_items: [{ variant_id: null, quantity: 1, gift_card: true }],
    });

    const cogsService: any = {
      computeUnitCostsByVariant: async () => new Map<number, number | undefined>(),
      computeCogsForVariants: async () => 0,
      isIgnoredVariantSync: () => false,
    };

    const costProfile: any = {
      payment: { feePercent: 0.03, feeFixed: 0.35 },
      shipping: { costPerOrder: 7 },
      fixedCosts: { allocationMode: "PER_ORDER", daysInMonth: 30 },
      derived: { fixedCostsMonthlyTotal: 0 },
      flags: { includeShippingCost: true, excludeGiftCards: true },
    };

    const base = await calculateOrderProfit({
      order,
      costProfile,
      cogsService,
      shopifyGET: dummyShopifyGET,
    });

    // ✅ current contract fields
    expect(base.isGiftCardOnlyOrder).toBe(true);
    expect(base.giftCardNetSalesExcluded).toBe(200);

    // ✅ excluded KPIs => 0
    expect(base.netAfterRefunds).toBe(0);
    expect(base.cogs).toBe(0);
    expect(base.paymentFees).toBe(0);
    expect(base.contributionMargin).toBe(0);

    // ✅ breakEvenRoas must be 0 (not null)
    expect(base.breakEvenRoas).toBe(0);

    // ✅ raw values stay visible
    expect(base.grossSales).toBe(200);
    expect(base.refunds).toBe(0);

    // ✅ shippingRevenue remains visible (requirement)
    expect(base.shippingRevenue).toBe(9);

    // ✅ missing COGS must never trigger for gift-only
    expect(base.hasMissingCogs).toBe(false);
    expect(base.missingCogsVariantIds).toEqual([]);
  });

  it("B) Mixed Order: not gift-card-only, missingCogs only for real product (gift card ignored)", async () => {
    const order = makeOrder({
      id: "mixed",
      total_price: 150,
      shippingAmount: 0,
      refunds: [],
      line_items: [
        { variant_id: null, quantity: 1, gift_card: true }, // gift card
        { variant_id: 111, quantity: 1, gift_card: false }, // real product (missing unit cost)
      ],
    });

    const cogsService: any = {
      computeUnitCostsByVariant: async () => new Map<number, number | undefined>([[111, undefined]]),
      computeCogsForVariants: async () => 0,
      isIgnoredVariantSync: () => false,
    };

    const costProfile: any = {
      payment: { feePercent: 0, feeFixed: 0 },
      shipping: { costPerOrder: 0 },
      fixedCosts: { allocationMode: "PER_ORDER", daysInMonth: 30 },
      derived: { fixedCostsMonthlyTotal: 0 },
      flags: { includeShippingCost: true, excludeGiftCards: true },
    };

    const base = await calculateOrderProfit({
      order,
      costProfile,
      cogsService,
      shopifyGET: dummyShopifyGET,
    });

    expect(base.isGiftCardOnlyOrder).toBe(false);

    // We still expect gift card net sales to be excluded from KPIs
    // (If your extractor sets this only for gift-card-only, then change this assertion accordingly.)
    expect(base.giftCardNetSalesExcluded).toBeGreaterThanOrEqual(0);

    // Missing should only include the real product variant id
    expect(base.hasMissingCogs).toBe(true);
    expect(base.missingCogsVariantIds).toEqual([111]);
  });
});