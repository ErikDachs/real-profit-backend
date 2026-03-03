import { describe, it, expect, vi } from "vitest";
// ---- Ads Mock (damit der Test deterministisch ist, egal wie ads.ts intern implementiert ist)
vi.mock("./ads", () => {
    function safeDiv(a, b) {
        return b > 0 ? a / b : 0;
    }
    return {
        allocateAdSpendForProducts: ({ rows, adSpend }) => {
            const totalNet = rows.reduce((s, r) => s + Number(r.netSales || 0), 0);
            return rows.map((r) => {
                const share = safeDiv(Number(r.netSales || 0), totalNet);
                return { ...r, allocatedAdSpend: Number(adSpend) * share };
            });
        },
        computeProfitAfterAds: ({ profitBeforeAds, allocatedAdSpend }) => {
            return Number(profitBeforeAds || 0) - Number(allocatedAdSpend || 0);
        }
    };
});
import { buildProductsProfit } from "./productsProfit.js";
const dummyShopifyGET = async () => {
    throw new Error("shopifyGET should not be called in these tests");
};
function makeOrder(params) {
    return {
        total_price: String(params.total_price),
        refunds: params.refunds ?? [],
        line_items: params.line_items
    };
}
describe("buildProductsProfit", () => {
    it("aggregiert qty/gross/net korrekt, allokiert refunds & fees deterministisch, und matched totals", async () => {
        // Orders:
        // Order1: 2 lines à 50 (gross=100), refund=20 => refund alloc 10/10 => net 40/40
        // Order2: 1 line A à 60, refund=0 => net 60
        const orders = [
            makeOrder({
                total_price: 110, // includes e.g. shipping revenue, but allocation uses line_items only
                refunds: [{ transactions: [{ amount: 20 }] }],
                line_items: [
                    { product_id: 101, variant_id: 1, quantity: 1, price: 50, title: "Prod A", variant_title: "A1", sku: "SKU-A" },
                    { product_id: 202, variant_id: 2, quantity: 1, price: 50, title: "Prod B", variant_title: "B1", sku: "SKU-B" }
                ]
            }),
            makeOrder({
                total_price: 60,
                refunds: [],
                line_items: [{ product_id: 101, variant_id: 1, quantity: 1, price: 60, title: "Prod A", variant_title: "A1", sku: "SKU-A" }]
            })
        ];
        // Dummy COGS by variant (deterministisch)
        const cogsService = {
            computeCogsByVariant: async (_shopifyGET, _variantQty) => {
                return new Map([
                    [1, 30], // variant A
                    [2, 25] // variant B
                ]);
            }
        };
        const costProfile = {
            payment: { feePercent: 0.03, feeFixed: 0.35 },
            shipping: { costPerOrder: 7 },
            flags: { includeShippingCost: true }
        };
        const res = await buildProductsProfit({
            shop: "test-shop",
            days: 30,
            orders,
            costProfile,
            cogsService,
            shopifyGET: dummyShopifyGET
            // adSpend not set
        });
        expect(res.shop).toBe("test-shop");
        expect(res.days).toBe(30);
        expect(res.orderCount).toBe(2);
        // Totals:
        // grossSalesTotal = 110 + 60 = 170
        // refundsTotal = 20
        // netAfterRefundsTotal = 150
        // paymentFeesTotal = 150*0.03 + 2*0.35 = 4.5 + 0.7 = 5.2
        expect(res.totals.totalNetSales).toBe(140); // from line-item net allocation: A 100 + B 40
        expect(res.totals.paymentFeesTotal).toBeCloseTo(5.2, 2);
        expect(res.totals.uniqueVariants).toBe(2);
        // Products are sorted ascending by profitAfterFees (no ads)
        expect(res.products.length).toBe(2);
        const p0 = res.products[0];
        const p1 = res.products[1];
        // Variant B should be first (lower profit)
        expect(p0.variantId).toBe(2);
        expect(p0.productId).toBe(202);
        expect(p0.qty).toBe(1);
        expect(p0.grossSales).toBe(50);
        expect(p0.refundsAllocated).toBe(10);
        expect(p0.netSales).toBe(40);
        expect(p0.cogs).toBe(25);
        // Fee allocation by netSales share:
        // totalNet=140; fees=5.2
        // B fee = 40/140*5.2 = 1.485714... -> 1.49 after round2
        expect(p0.paymentFeesAllocated).toBeCloseTo(1.49, 2);
        // profitAfterFees = 40 - 25 - 1.485714... = 13.514285... -> 13.51
        expect(p0.profitAfterFees).toBeCloseTo(13.51, 2);
        expect(p0.marginPct).toBeCloseTo((13.514285714285714 / 40) * 100, 2);
        // Variant A second
        expect(p1.variantId).toBe(1);
        expect(p1.productId).toBe(101);
        expect(p1.qty).toBe(2);
        expect(p1.grossSales).toBe(110);
        expect(p1.refundsAllocated).toBe(10);
        expect(p1.netSales).toBe(100);
        expect(p1.cogs).toBe(30);
        // A fee = 100/140*5.2 = 3.714285... -> 3.71
        expect(p1.paymentFeesAllocated).toBeCloseTo(3.71, 2);
        // profitAfterFees = 100 - 30 - 3.714285... = 66.285714... -> 66.29
        expect(p1.profitAfterFees).toBeCloseTo(66.29, 2);
        // Highlights
        expect(res.highlights.topWinners[0].variantId).toBe(1);
        expect(res.highlights.topLosers[0].variantId).toBe(2);
        // Missing COGS (keiner, da beide >0)
        expect(res.highlights.missingCogsCount).toBe(0);
        expect(res.highlights.missingCogs.length).toBe(0);
    });
    it("wenn adSpend gesetzt ist: allocatedAdSpend + profitAfterAds werden gesetzt und Sorting/Highlights nutzen profitAfterAds", async () => {
        const orders = [
            makeOrder({
                total_price: 110,
                refunds: [{ transactions: [{ amount: 20 }] }],
                line_items: [
                    { product_id: 101, variant_id: 1, quantity: 1, price: 50, title: "Prod A" },
                    { product_id: 202, variant_id: 2, quantity: 1, price: 50, title: "Prod B" }
                ]
            }),
            makeOrder({
                total_price: 60,
                refunds: [],
                line_items: [{ product_id: 101, variant_id: 1, quantity: 1, price: 60, title: "Prod A" }]
            })
        ];
        const cogsService = {
            computeCogsByVariant: async () => new Map([
                [1, 30],
                [2, 25]
            ])
        };
        const costProfile = {
            payment: { feePercent: 0.03, feeFixed: 0.35 },
            shipping: { costPerOrder: 7 },
            flags: { includeShippingCost: true }
        };
        const res = await buildProductsProfit({
            shop: "test-shop",
            days: 30,
            orders,
            costProfile,
            cogsService,
            shopifyGET: dummyShopifyGET,
            adSpend: 14
        });
        expect(res.totals.adSpend).toBe(14);
        // Sortierung jetzt via profitAfterAds (weil gesetzt)
        expect(res.products.length).toBe(2);
        const b = res.products[0]; // loser
        const a = res.products[1]; // winner
        expect(b.variantId).toBe(2);
        expect(a.variantId).toBe(1);
        // totalNetSales = 140, adSpend=14 -> A gets 10, B gets 4 (nach unserem Mock)
        expect(b.allocatedAdSpend).toBeCloseTo(4, 2);
        expect(a.allocatedAdSpend).toBeCloseTo(10, 2);
        // profitAfterAds = profitAfterFees - allocatedAdSpend
        expect(b.profitAfterAds).toBeCloseTo(b.profitAfterFees - (b.allocatedAdSpend ?? 0), 2);
        expect(a.profitAfterAds).toBeCloseTo(a.profitAfterFees - (a.allocatedAdSpend ?? 0), 2);
        // Highlights nutzen profitAfterAds
        expect(res.highlights.topWinners[0].variantId).toBe(1);
        expect(res.highlights.topLosers[0].variantId).toBe(2);
    });
});
