import { describe, it, expect } from "vitest";
import { calculateOrderProfit } from "./orderProfit.js";
// Minimaler Dummy – wird nicht genutzt, solange wir unitCostByVariant setzen.
const dummyCogsService = {
    computeCogsForVariants: async () => {
        throw new Error("computeCogsForVariants should not be called when unitCostByVariant is provided");
    }
};
const dummyShopifyGET = async () => {
    throw new Error("shopifyGET should not be called in these tests");
};
function makeOrder(params) {
    return {
        id: params.id ?? "1",
        total_price: String(params.total_price),
        total_shipping_price_set: params.shippingAmount === undefined
            ? undefined
            : { shop_money: { amount: String(params.shippingAmount) } },
        refunds: params.refunds ?? [],
        line_items: params.line_items ?? []
    };
}
describe("calculateOrderProfit (SSOT)", () => {
    it("berechnet Refunds korrekt und Fees auf netAfterRefunds (percent + fixed)", async () => {
        const order = makeOrder({
            id: "1001",
            total_price: 100,
            shippingAmount: 5,
            refunds: [{ transactions: [{ amount: 10 }] }], // refunds = 10
            line_items: [{ variant_id: 11, quantity: 1 }]
        });
        const unitCostByVariant = new Map([[11, 30]]);
        const costProfile = {
            payment: { feePercent: 0.03, feeFixed: 0.35 },
            shipping: { costPerOrder: 7 },
            flags: { includeShippingCost: true }
        };
        const out = await calculateOrderProfit({
            order,
            costProfile,
            cogsService: dummyCogsService,
            shopifyGET: dummyShopifyGET,
            unitCostByVariant
        });
        // grossSales = 100
        expect(out.grossSales).toBe(100);
        // refunds = 10 => net = 90
        expect(out.refunds).toBe(10);
        expect(out.netAfterRefunds).toBe(90);
        // cogs = 30
        expect(out.cogs).toBe(30);
        // paymentFees = netAfterRefunds * 0.03 + 0.35 = 90*0.03 + 0.35 = 2.7 + 0.35 = 3.05
        expect(out.paymentFees).toBeCloseTo(3.05, 2);
        // contributionMargin = net - cogs - fees = 90 - 30 - 3.05 = 56.95
        expect(out.contributionMargin).toBeCloseTo(56.95, 2);
        // shipping revenue extracted
        expect(out.shippingRevenue).toBe(5);
        // shipping cost included: 7
        expect(out.shippingCost).toBe(7);
        // profitAfterShipping = contributionMargin - shippingCost = 49.95
        expect(out.profitAfterShipping).toBeCloseTo(49.95, 2);
        // compatibility
        expect(out.profitAfterFees).toBeCloseTo(out.contributionMargin, 5);
        expect(out.marginAfterFeesPct).toBeCloseTo(out.contributionMarginPct, 5);
        // gift card flags
        expect(out.isGiftCardOnlyOrder).toBe(false);
        expect(out.giftCardNetSalesExcluded).toBe(0);
    });
    it("setzt shippingCost = 0 wenn includeShippingCost=false", async () => {
        const order = makeOrder({
            id: "1002",
            total_price: 100,
            shippingAmount: 0,
            refunds: [],
            line_items: [{ variant_id: 11, quantity: 1 }]
        });
        const unitCostByVariant = new Map([[11, 10]]);
        const costProfile = {
            payment: { feePercent: 0.0, feeFixed: 0.0 },
            shipping: { costPerOrder: 99 }, // sollte ignoriert werden
            flags: { includeShippingCost: false }
        };
        const out = await calculateOrderProfit({
            order,
            costProfile,
            cogsService: dummyCogsService,
            shopifyGET: dummyShopifyGET,
            unitCostByVariant
        });
        expect(out.netAfterRefunds).toBe(100);
        expect(out.cogs).toBe(10);
        expect(out.paymentFees).toBe(0);
        // CM = 90
        expect(out.contributionMargin).toBe(90);
        // shipping ignored
        expect(out.shippingCost).toBe(0);
        expect(out.profitAfterShipping).toBe(90);
    });
    it("liefert shippingRevenue=0 wenn keine shipping fields vorhanden sind", async () => {
        const order = {
            id: "1003",
            total_price: "50",
            refunds: [],
            line_items: [{ variant_id: 11, quantity: 1 }]
            // keine shipping felder
        };
        const unitCostByVariant = new Map([[11, 0]]);
        const costProfile = {
            payment: { feePercent: 0.0, feeFixed: 0.0 },
            shipping: { costPerOrder: 0 },
            flags: { includeShippingCost: true }
        };
        const out = await calculateOrderProfit({
            order,
            costProfile,
            cogsService: dummyCogsService,
            shopifyGET: dummyShopifyGET,
            unitCostByVariant
        });
        expect(out.shippingRevenue).toBe(0);
        expect(out.shippingCost).toBe(0);
        expect(out.shippingImpact).toBe(0);
    });
    it("kann Full Refund abbilden (netAfterRefunds=0) und liefert breakEvenRoas=null oder Zahl deterministisch", async () => {
        const order = makeOrder({
            id: "1004",
            total_price: 100,
            shippingAmount: 5,
            refunds: [{ transactions: [{ amount: 100 }] }], // full refund
            line_items: [{ variant_id: 11, quantity: 1 }]
        });
        const unitCostByVariant = new Map([[11, 30]]);
        const costProfile = {
            payment: { feePercent: 0.03, feeFixed: 0.35 },
            shipping: { costPerOrder: 7 },
            flags: { includeShippingCost: true }
        };
        const out = await calculateOrderProfit({
            order,
            costProfile,
            cogsService: dummyCogsService,
            shopifyGET: dummyShopifyGET,
            unitCostByVariant
        });
        expect(out.netAfterRefunds).toBe(0);
        // fees rechnen aktuell trotzdem auf raw net (0) + fixed => 0.35
        expect(out.paymentFees).toBeCloseTo(0.35, 2);
        // CM = 0 - 30 - 0.35 = -30.35
        expect(out.contributionMargin).toBeCloseTo(-30.35, 2);
        // breakEvenRoas hängt von deiner metrics-Implementierung ab.
        expect(out.breakEvenRoas === null || typeof out.breakEvenRoas === "number").toBe(true);
    });
    it("nutzt unitCostByVariant fast path und ruft cogsService NICHT", async () => {
        const order = makeOrder({
            id: "1005",
            total_price: 40,
            refunds: [],
            line_items: [
                { variant_id: 11, quantity: 2 }, // 2 * 3
                { variant_id: 22, quantity: 1 } // 1 * 4
            ]
        });
        const unitCostByVariant = new Map([
            [11, 3],
            [22, 4]
        ]);
        const costProfile = {
            payment: { feePercent: 0, feeFixed: 0 },
            shipping: { costPerOrder: 0 },
            flags: { includeShippingCost: true }
        };
        const out = await calculateOrderProfit({
            order,
            costProfile,
            cogsService: dummyCogsService,
            shopifyGET: dummyShopifyGET,
            unitCostByVariant
        });
        // cogs = 2*3 + 1*4 = 10
        expect(out.cogs).toBe(10);
        // CM = net - cogs = 30
        expect(out.contributionMargin).toBe(30);
    });
    it("Gift-Card-only Order: operational net=0, fees bleiben real, profit negativ", async () => {
        const order = makeOrder({
            id: "GC1",
            total_price: 100,
            refunds: [],
            line_items: [{ variant_id: null, quantity: 1, gift_card: true }] // gift card line item
        });
        const unitCostByVariant = new Map(); // irrelevant
        const costProfile = {
            payment: { feePercent: 0.029, feeFixed: 0.3 },
            shipping: { costPerOrder: 5 },
            flags: { includeShippingCost: true }
        };
        const out = await calculateOrderProfit({
            order,
            costProfile,
            cogsService: dummyCogsService,
            shopifyGET: dummyShopifyGET,
            unitCostByVariant
        });
        expect(out.isGiftCardOnlyOrder).toBe(true);
        expect(out.giftCardNetSalesExcluded).toBe(100);
        // operational
        expect(out.grossSales).toBe(0);
        expect(out.netAfterRefunds).toBe(0);
        // fees are real
        expect(out.paymentFees).toBeCloseTo(100 * 0.029 + 0.3, 2);
        // CM should be negative (0 - fees)
        expect(out.contributionMargin).toBeCloseTo(-(100 * 0.029 + 0.3), 2);
        // shipping cost excluded for gift-card-only
        expect(out.shippingCost).toBe(0);
    });
});
