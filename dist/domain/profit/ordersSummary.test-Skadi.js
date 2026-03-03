// src/domain/profit/ordersSummary.test.ts
import { describe, it, expect } from "vitest";
import { buildOrdersSummary } from "./ordersSummary";
import { calcPaymentFees } from "./fees";
import { calcContributionMargin, calcBreakEvenRoas, calcContributionMarginPct } from "../metrics";
const dummyShopifyGET = async () => {
    throw new Error("shopifyGET should not be called in these tests");
};
function makeOrder(params) {
    return {
        total_price: String(params.total_price),
        total_shipping_price_set: params.shippingAmount === undefined
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
        const cogsService = {
            computeUnitCostsByVariant: async (_shopifyGET, variantIds) => {
                const m = new Map();
                for (const id of variantIds) {
                    if (id === 11)
                        m.set(id, 30);
                    else if (id === 22)
                        m.set(id, 10);
                    else
                        m.set(id, undefined);
                }
                return m;
            },
            isIgnoredVariantSync: () => false,
        };
        const costProfile = {
            payment: { feePercent: 0.03, feeFixed: 0.35 },
            shipping: { costPerOrder: 7 },
            fixedCosts: { allocationMode: "PER_ORDER", daysInMonth: 30 },
            derived: { fixedCostsMonthlyTotal: 0 },
            flags: { includeShippingCost: true, excludeGiftCards: true },
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
        expect(out.giftCardOrdersCount).toBe(0);
        expect(out.giftCardNetSalesExcluded).toBe(0);
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
        if (expectedBe === null)
            expect(out.breakEvenRoas).toBeNull();
        else
            expect(out.breakEvenRoas).toBeCloseTo(expectedBe, 2);
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
    it("setzt shippingCost=0 wenn includeShippingCost=false (und 0-Cogs ist NICHT missing)", async () => {
        const orders = [
            makeOrder({
                total_price: 100,
                shippingAmount: 5,
                refunds: [],
                line_items: [{ variant_id: 11, quantity: 1 }],
            }),
        ];
        const cogsService = {
            // 0 is a valid explicit cost ("by design")
            computeUnitCostsByVariant: async () => new Map([[11, 0]]),
            isIgnoredVariantSync: () => true, // ignored => 0 is allowed and NOT missing
        };
        const costProfile = {
            payment: { feePercent: 0, feeFixed: 0 },
            shipping: { costPerOrder: 999 },
            fixedCosts: { allocationMode: "PER_ORDER", daysInMonth: 30 },
            derived: { fixedCostsMonthlyTotal: 0 },
            flags: { includeShippingCost: false, excludeGiftCards: true },
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
        // ✅ 0 ist explizit erlaubt => NICHT missing
        expect(out.missingCogsCount).toBe(0);
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
        const cogsService = {
            // unknown cost => missing
            computeUnitCostsByVariant: async () => new Map(), // no entry for 11
            isIgnoredVariantSync: () => false,
        };
        const costProfile = {
            payment: { feePercent: 0, feeFixed: 0 },
            shipping: { costPerOrder: 0 },
            fixedCosts: { allocationMode: "PER_ORDER", daysInMonth: 30 },
            derived: { fixedCostsMonthlyTotal: 0 },
            flags: { includeShippingCost: true, excludeGiftCards: true },
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
                line_items: [{ variant_id: null, quantity: 1, gift_card: false }],
            }),
        ];
        const cogsService = {
            computeUnitCostsByVariant: async () => new Map(),
            isIgnoredVariantSync: () => false,
        };
        const costProfile = {
            payment: { feePercent: 0, feeFixed: 0 },
            shipping: { costPerOrder: 0 },
            fixedCosts: { allocationMode: "PER_ORDER", daysInMonth: 30 },
            derived: { fixedCostsMonthlyTotal: 0 },
            flags: { includeShippingCost: true, excludeGiftCards: true },
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
    // ✅ NEW: Aggregation Test (Gift Card excluded)
    it("Aggregation: gift-card-only orders are excluded from KPIs, but tracked transparently", async () => {
        const orders = [
            // gift-card-only
            makeOrder({
                total_price: 200,
                refunds: [],
                shippingAmount: 0,
                line_items: [{ variant_id: null, quantity: 1, gift_card: true }],
            }),
            // normal
            makeOrder({
                total_price: 100,
                refunds: [],
                shippingAmount: 0,
                line_items: [{ variant_id: 10, quantity: 1, gift_card: false }],
            }),
        ];
        const cogsService = {
            computeUnitCostsByVariant: async () => new Map([[10, 40]]),
            isIgnoredVariantSync: () => false,
        };
        const costProfile = {
            payment: { feePercent: 0, feeFixed: 0 },
            shipping: { costPerOrder: 0 },
            fixedCosts: { allocationMode: "PER_ORDER", daysInMonth: 30 },
            derived: { fixedCostsMonthlyTotal: 0 },
            flags: { includeShippingCost: true, excludeGiftCards: true },
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
        // ✅ count includes ALL orders now (requirement)
        expect(out.count).toBe(2);
        // ✅ KPIs only include the normal order
        expect(out.grossSales).toBe(100);
        expect(out.netAfterRefunds).toBe(100);
        expect(out.cogs).toBe(40);
        expect(out.profitAfterFixedCosts).toBe(out.operatingProfit);
        // ✅ transparency
        expect(out.giftCardOrdersCount).toBe(1);
        expect(out.giftCardNetSalesExcluded).toBe(200);
        // ✅ Missing COGS denominator ignores gift-card-only orders (so still 0)
        expect(out.missingCogsCount).toBe(0);
        expect(out.missingCogsRatePct).toBe(0);
    });
});
