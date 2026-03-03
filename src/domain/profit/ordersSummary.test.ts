import { describe, it, expect } from "vitest";
import { buildOrdersSummary } from "./ordersSummary.js";
import { calcPaymentFees } from "./fees.js";
import { calcContributionMargin, calcBreakEvenRoas, calcContributionMarginPct } from "../metrics.js";

const dummyShopifyGET: any = async () => {
  throw new Error("shopifyGET should not be called in these tests");
};

function makeOrder(params: {
  total_price: number;
  shippingAmount?: number;
  refunds?: Array<{ transactions?: Array<{ amount: number | string }> }>;
  line_items: Array<{ variant_id?: number | null; quantity: number; gift_card?: boolean }>;
}) {
  return {
    total_price: String(params.total_price),
    total_shipping_price_set:
      params.shippingAmount === undefined
        ? undefined
        : { shop_money: { amount: String(params.shippingAmount) } },
    refunds: params.refunds ?? [],
    line_items: params.line_items,
  };
}

describe("buildOrdersSummary", () => {
  it("berechnet gross/refunds/net, shipping totals, fees, CM, breakEven, profitAfterShipping/Ads korrekt", async () => {
    const orders = [
      makeOrder({
        total_price: 110,
        shippingAmount: 5,
        refunds: [{ transactions: [{ amount: 20 }] }],
        line_items: [{ variant_id: 11, quantity: 1 }],
      }),
      makeOrder({
        total_price: 60,
        shippingAmount: 0,
        refunds: [],
        line_items: [{ variant_id: 22, quantity: 2 }],
      }),
    ];

    // Total COGS: 1*30 + 2*10 = 50
    const cogsService: any = {
      computeUnitCostsByVariant: async (_shopifyGET: any, variantIds: number[]) => {
        const m = new Map<number, number | undefined>();
        for (const id of variantIds) {
          if (id === 11) m.set(id, 30);
          else if (id === 22) m.set(id, 10);
          else m.set(id, undefined);
        }
        return m;
      },
    };

    const costProfile: any = {
      payment: { feePercent: 0.03, feeFixed: 0.35 },
      shipping: { costPerOrder: 7 },
      flags: { includeShippingCost: true },
      fixedCosts: { allocationMode: "PER_ORDER", daysInMonth: 30, monthlyItems: [] },
      derived: { fixedCostsMonthlyTotal: 0 },
    };

    const out = await buildOrdersSummary({
      shop: "test-shop",
      days: 30,
      adSpend: 40,
      orders,
      costProfile,
      cogsService,
      shopifyGET: dummyShopifyGET,
    });

    expect(out.shop).toBe("test-shop");
    expect(out.days).toBe(30);
    expect(out.count).toBe(2);

    expect(out.grossSales).toBe(170);
    expect(out.refunds).toBe(20);
    expect(out.netAfterRefunds).toBe(150);

    // Shipping totals
    expect(out.shippingRevenue).toBe(5);
    expect(out.shippingCost).toBe(14); // 7 * 2
    expect(out.shippingImpact).toBe(5 - 14); // -9

    // Fees
    const expectedFees = calcPaymentFees({
      netAfterRefunds: 150,
      orderCount: 2,
      feePercent: 0.03,
      feeFixed: 0.35,
    });
    expect(out.paymentFees).toBeCloseTo(expectedFees, 2);

    // CM
    const expectedCm = calcContributionMargin({
      netAfterRefunds: 150,
      cogs: 50,
      paymentFees: expectedFees,
    });
    expect(out.contributionMargin).toBeCloseTo(expectedCm, 2);

    // CM pct
    const expectedCmPct = calcContributionMarginPct({
      netAfterRefunds: 150,
      contributionMargin: expectedCm,
    });
    expect(out.contributionMarginPct).toBeCloseTo(expectedCmPct, 2);

    // Break-even ROAS
    const expectedBe = calcBreakEvenRoas({
      netAfterRefunds: 150,
      contributionMargin: expectedCm,
    });
    if (expectedBe === null) expect(out.breakEvenRoas).toBeNull();
    else expect(out.breakEvenRoas).toBeCloseTo(expectedBe, 2);

    // profitAfterShipping = CM - shippingCost
    expect(out.profitAfterShipping).toBeCloseTo(expectedCm - 14, 2);

    // profitAfterAds = profitAfterFees - adSpend
    expect(out.adSpend).toBe(40);
    expect(out.profitAfterFees).toBeCloseTo(expectedCm, 2);
    expect(out.profitAfterAds).toBeCloseTo(expectedCm - 40, 2);

    // profitAfterAdsAndShipping = profitAfterShipping - adSpend
    expect(out.profitAfterAdsAndShipping).toBeCloseTo(expectedCm - 14 - 40, 2);

    // sanity margins
    expect(out.profitMarginAfterShippingPct).toBeCloseTo(((expectedCm - 14) / 150) * 100, 2);

    // Since we provided known unit costs for used variants, missingCogsCount should be 0
    expect(out.missingCogsCount).toBe(0);
  });

  it("setzt shippingCost=0 wenn includeShippingCost=false", async () => {
    const orders = [
      makeOrder({
        total_price: 100,
        shippingAmount: 5,
        refunds: [],
        line_items: [{ variant_id: 11, quantity: 1 }],
      }),
    ];

    const cogsService: any = {
      // explicit 0 (note: governance may still treat 0 as missing unless ignored)
      computeUnitCostsByVariant: async () => new Map<number, number | undefined>([[11, 0]]),
    };

    const costProfile: any = {
      payment: { feePercent: 0, feeFixed: 0 },
      shipping: { costPerOrder: 999 },
      flags: { includeShippingCost: false },
      fixedCosts: { allocationMode: "PER_ORDER", daysInMonth: 30, monthlyItems: [] },
      derived: { fixedCostsMonthlyTotal: 0 },
    };

    const out = await buildOrdersSummary({
      shop: "x",
      days: 7,
      adSpend: 0,
      orders,
      costProfile,
      cogsService,
      shopifyGET: dummyShopifyGET,
    });

    expect(out.shippingRevenue).toBe(5);
    expect(out.shippingCost).toBe(0);
    expect(out.shippingImpact).toBe(5);
    expect(out.profitAfterShipping).toBe(out.profitAfterFees);

    // ✅ With your current governance (Option C): unitCost===0 counts as missing unless ignored.
    // In this test we do NOT pass isIgnoredVariant => missingCogsCount should be 1.
    expect(out.missingCogsCount).toBe(1);
  });

  it("markiert Missing COGS wenn unitCost unbekannt ist (undefined)", async () => {
    const orders = [
      makeOrder({
        total_price: 100,
        shippingAmount: 0,
        refunds: [],
        line_items: [{ variant_id: 11, quantity: 1 }],
      }),
    ];

    const cogsService: any = {
      // unknown cost => missing
      computeUnitCostsByVariant: async () => new Map<number, number | undefined>(), // no entry for 11
    };

    const costProfile: any = {
      payment: { feePercent: 0, feeFixed: 0 },
      shipping: { costPerOrder: 0 },
      flags: { includeShippingCost: true },
      fixedCosts: { allocationMode: "PER_ORDER", daysInMonth: 30, monthlyItems: [] },
      derived: { fixedCostsMonthlyTotal: 0 },
    };

    const out = await buildOrdersSummary({
      shop: "x",
      days: 7,
      adSpend: 0,
      orders,
      costProfile,
      cogsService,
      shopifyGET: dummyShopifyGET,
    });

    expect(out.missingCogsCount).toBe(1);
  });

  it("markiert Missing COGS wenn LineItems relevant sind, aber keine Variant-IDs extrahierbar sind (unmapped variants)", async () => {
    const orders = [
      makeOrder({
        total_price: 100,
        shippingAmount: 0,
        refunds: [],
        // variant_id missing/null => extractor yields 0 => filtered out => extractedVariantQty empty
        line_items: [{ variant_id: null, quantity: 1 }],
      }),
    ];

    const cogsService: any = {
      computeUnitCostsByVariant: async () => new Map<number, number | undefined>(),
    };

    const costProfile: any = {
      payment: { feePercent: 0, feeFixed: 0 },
      shipping: { costPerOrder: 0 },
      flags: { includeShippingCost: true },
      fixedCosts: { allocationMode: "PER_ORDER", daysInMonth: 30, monthlyItems: [] },
      derived: { fixedCostsMonthlyTotal: 0 },
    };

    const out = await buildOrdersSummary({
      shop: "x",
      days: 7,
      adSpend: 0,
      orders,
      costProfile,
      cogsService,
      shopifyGET: dummyShopifyGET,
    });

    expect(out.missingCogsCount).toBe(1);
  });

  it("Gift-Card-only Orders werden aus operational net sales excluded, fees bleiben real", async () => {
    const orders = [
      makeOrder({
        total_price: 100,
        shippingAmount: 0,
        refunds: [],
        line_items: [{ variant_id: null, quantity: 1, gift_card: true }],
      }),
      makeOrder({
        total_price: 200,
        shippingAmount: 0,
        refunds: [],
        line_items: [{ variant_id: 11, quantity: 1 }],
      }),
    ];

    const cogsService: any = {
      computeUnitCostsByVariant: async () => new Map<number, number | undefined>([[11, 50]]),
    };

    const costProfile: any = {
      payment: { feePercent: 0.029, feeFixed: 0.3 },
      shipping: { costPerOrder: 5 },
      flags: { includeShippingCost: true },
      fixedCosts: { allocationMode: "PER_ORDER", daysInMonth: 30, monthlyItems: [] },
      derived: { fixedCostsMonthlyTotal: 0 },
    };

    const out = await buildOrdersSummary({
      shop: "x",
      days: 30,
      adSpend: 0,
      orders,
      costProfile,
      cogsService,
      shopifyGET: dummyShopifyGET,
    });

    // operational totals: only the non-gift-card order counts
    expect(out.giftCardOrdersCount).toBe(1);
    expect(out.giftCardNetSalesExcluded).toBe(100);

    expect(out.grossSales).toBe(200);
    expect(out.netAfterRefunds).toBe(200);

    // fees should include gift-card payment too (raw total = 300)
    const expectedFees = 300 * 0.029 + 2 * 0.3;
    expect(out.paymentFees).toBeCloseTo(expectedFees, 2);

    // COGS only for the real product order
    expect(out.cogs).toBe(50);
  });
});
