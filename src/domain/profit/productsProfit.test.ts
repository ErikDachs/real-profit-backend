import { describe, it, expect, vi } from "vitest";

// ---- Ads Mock (damit der Test deterministisch ist, egal wie ads.ts intern implementiert ist)
vi.mock("./ads", () => {
  function safeDiv(a: number, b: number) {
    return b > 0 ? a / b : 0;
  }

  return {
    allocateAdSpendForProducts: ({ rows, adSpend }: any) => {
      const totalNet = rows.reduce((s: number, r: any) => s + Number(r.netSales || 0), 0);
      return rows.map((r: any) => {
        const share = safeDiv(Number(r.netSales || 0), totalNet);
        return { ...r, allocatedAdSpend: Number(adSpend) * share };
      });
    },
    computeProfitAfterAds: ({ profitBeforeAds, allocatedAdSpend }: any) => {
      return Number(profitBeforeAds || 0) - Number(allocatedAdSpend || 0);
    }
  };
});

import { buildProductsProfit } from "./productsProfit.js";

const dummyShopifyGET: any = async () => {
  throw new Error("shopifyGET should not be called in these tests");
};

function makeRestOrder(params: {
  total_price: number;
  refunds?: Array<{ transactions?: Array<{ amount: number | string }> }>;
  line_items: Array<{
    product_id: number;
    variant_id: number;
    quantity: number;
    price: number;
    title: string;
    variant_title?: string;
    sku?: string;
    gift_card?: boolean;
  }>;
}) {
  return {
    total_price: String(params.total_price),
    refunds: params.refunds ?? [],
    line_items: params.line_items
  };
}

describe("buildProductsProfit", () => {
  it("aggregiert qty/gross/net korrekt, allokiert refunds & fees deterministisch, und matched totals", async () => {
    const orders = [
      makeRestOrder({
        total_price: 110,
        refunds: [{ transactions: [{ amount: 20 }] }],
        line_items: [
          { product_id: 101, variant_id: 1, quantity: 1, price: 50, title: "Prod A", variant_title: "A1", sku: "SKU-A" },
          { product_id: 202, variant_id: 2, quantity: 1, price: 50, title: "Prod B", variant_title: "B1", sku: "SKU-B" }
        ]
      }),
      makeRestOrder({
        total_price: 60,
        refunds: [],
        line_items: [{ product_id: 101, variant_id: 1, quantity: 1, price: 60, title: "Prod A", variant_title: "A1", sku: "SKU-A" }]
      })
    ];

    const cogsService: any = {
      computeCogsByVariant: async (_shopifyGET: any, _variantQty: any[]) => {
        return new Map<number, number>([
          [1, 30],
          [2, 25]
        ]);
      }
    };

    const costProfile: any = {
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
    });

    expect(res.shop).toBe("test-shop");
    expect(res.days).toBe(30);
    expect(res.orderCount).toBe(2);

    expect(res.totals.totalNetSales).toBe(140);
    expect(res.totals.paymentFeesTotal).toBeCloseTo(5.2, 2);
    expect(res.totals.uniqueVariants).toBe(2);

    expect(res.products.length).toBe(2);
    const p0 = res.products[0];
    const p1 = res.products[1];

    expect(p0.variantId).toBe(2);
    expect(p0.productId).toBe(202);
    expect(p0.qty).toBe(1);
    expect(p0.grossSales).toBe(50);
    expect(p0.refundsAllocated).toBe(10);
    expect(p0.netSales).toBe(40);
    expect(p0.cogs).toBe(25);
    expect(p0.paymentFeesAllocated).toBeCloseTo(1.49, 2);
    expect(p0.profitAfterFees).toBeCloseTo(13.51, 2);
    expect(p0.marginPct).toBeCloseTo((13.514285714285714 / 40) * 100, 2);

    expect(p1.variantId).toBe(1);
    expect(p1.productId).toBe(101);
    expect(p1.qty).toBe(2);
    expect(p1.grossSales).toBe(110);
    expect(p1.refundsAllocated).toBe(10);
    expect(p1.netSales).toBe(100);
    expect(p1.cogs).toBe(30);
    expect(p1.paymentFeesAllocated).toBeCloseTo(3.71, 2);
    expect(p1.profitAfterFees).toBeCloseTo(66.29, 2);

    expect(res.highlights.topWinners[0].variantId).toBe(1);
    expect(res.highlights.topLosers[0].variantId).toBe(2);

    expect(res.highlights.missingCogsCount).toBe(0);
    expect(res.highlights.missingCogs.length).toBe(0);
  });

  it("wenn adSpend gesetzt ist: allocatedAdSpend + profitAfterAds werden gesetzt und Sorting/Highlights nutzen profitAfterAds", async () => {
    const orders = [
      makeRestOrder({
        total_price: 110,
        refunds: [{ transactions: [{ amount: 20 }] }],
        line_items: [
          { product_id: 101, variant_id: 1, quantity: 1, price: 50, title: "Prod A" },
          { product_id: 202, variant_id: 2, quantity: 1, price: 50, title: "Prod B" }
        ]
      }),
      makeRestOrder({
        total_price: 60,
        refunds: [],
        line_items: [{ product_id: 101, variant_id: 1, quantity: 1, price: 60, title: "Prod A" }]
      })
    ];

    const cogsService: any = {
      computeCogsByVariant: async () =>
        new Map<number, number>([
          [1, 30],
          [2, 25]
        ])
    };

    const costProfile: any = {
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
    expect(res.products.length).toBe(2);

    const b = res.products[0];
    const a = res.products[1];

    expect(b.variantId).toBe(2);
    expect(a.variantId).toBe(1);

    expect(b.allocatedAdSpend).toBeCloseTo(4, 2);
    expect(a.allocatedAdSpend).toBeCloseTo(10, 2);

    expect(b.profitAfterAds).toBeCloseTo(b.profitAfterFees - (b.allocatedAdSpend ?? 0), 2);
    expect(a.profitAfterAds).toBeCloseTo(a.profitAfterFees - (a.allocatedAdSpend ?? 0), 2);

    expect(res.highlights.topWinners[0].variantId).toBe(1);
    expect(res.highlights.topLosers[0].variantId).toBe(2);
  });

  it("verarbeitet camelCase lineItems mit camelCase ids", async () => {
    const orders = [
      {
        total_price: "110",
        refunds: [{ transactions: [{ amount: 20 }] }],
        lineItems: [
          { productId: 101, variantId: 1, quantity: 1, price: 50, title: "Prod A", variantTitle: "A1", sku: "SKU-A" },
          { productId: 202, variantId: 2, quantity: 1, price: 50, title: "Prod B", variantTitle: "B1", sku: "SKU-B" }
        ]
      },
      {
        total_price: "60",
        refunds: [],
        lineItems: [
          { productId: 101, variantId: 1, quantity: 1, price: 60, title: "Prod A", variantTitle: "A1", sku: "SKU-A" }
        ]
      }
    ];

    const cogsService: any = {
      computeCogsByVariant: async () =>
        new Map<number, number>([
          [1, 30],
          [2, 25]
        ])
    };

    const costProfile: any = {
      payment: { feePercent: 0.03, feeFixed: 0.35 }
    };

    const res = await buildProductsProfit({
      shop: "test-shop",
      days: 30,
      orders,
      costProfile,
      cogsService,
      shopifyGET: dummyShopifyGET
    });

    expect(res.products.length).toBe(2);
    expect(res.totals.totalNetSales).toBe(140);

    const a = res.products.find((p) => p.variantId === 1)!;
    const b = res.products.find((p) => p.variantId === 2)!;

    expect(a.grossSales).toBe(110);
    expect(a.netSales).toBe(100);
    expect(b.grossSales).toBe(50);
    expect(b.netSales).toBe(40);
  });

  it("verarbeitet GraphQL lineItems.nodes mit GID variant/product ids", async () => {
    const orders = [
      {
        total_price: "110",
        refunds: [{ transactions: [{ amount: 20 }] }],
        lineItems: {
          nodes: [
            {
              product: { id: "gid://shopify/Product/101" },
              variant: { id: "gid://shopify/ProductVariant/1", title: "A1", sku: "SKU-A" },
              quantity: 1,
              title: "Prod A",
              originalUnitPriceSet: { shopMoney: { amount: "50" } }
            },
            {
              product: { id: "gid://shopify/Product/202" },
              variant: { id: "gid://shopify/ProductVariant/2", title: "B1", sku: "SKU-B" },
              quantity: 1,
              title: "Prod B",
              originalUnitPriceSet: { shopMoney: { amount: "50" } }
            }
          ]
        }
      },
      {
        total_price: "60",
        refunds: [],
        lineItems: {
          nodes: [
            {
              product: { id: "gid://shopify/Product/101" },
              variant: { id: "gid://shopify/ProductVariant/1", title: "A1", sku: "SKU-A" },
              quantity: 1,
              title: "Prod A",
              originalUnitPriceSet: { shopMoney: { amount: "60" } }
            }
          ]
        }
      }
    ];

    const cogsService: any = {
      computeCogsByVariant: async () =>
        new Map<number, number>([
          [1, 30],
          [2, 25]
        ])
    };

    const costProfile: any = {
      payment: { feePercent: 0.03, feeFixed: 0.35 }
    };

    const res = await buildProductsProfit({
      shop: "test-shop",
      days: 30,
      orders,
      costProfile,
      cogsService,
      shopifyGET: dummyShopifyGET
    });

    expect(res.products.length).toBe(2);
    expect(res.totals.totalNetSales).toBe(140);

    const a = res.products.find((p) => p.variantId === 1)!;
    const b = res.products.find((p) => p.variantId === 2)!;

    expect(a.productId).toBe(101);
    expect(a.grossSales).toBe(110);
    expect(a.netSales).toBe(100);
    expect(a.variantTitle).toBe("A1");
    expect(a.sku).toBe("SKU-A");

    expect(b.productId).toBe(202);
    expect(b.grossSales).toBe(50);
    expect(b.netSales).toBe(40);
  });

  it("ignoriert gift cards in der Produktaggregation", async () => {
    const orders = [
      makeRestOrder({
        total_price: 160,
        refunds: [],
        line_items: [
          { product_id: 101, variant_id: 1, quantity: 1, price: 60, title: "Prod A" },
          { product_id: 999, variant_id: 999, quantity: 1, price: 100, title: "Gift Card", gift_card: true }
        ]
      })
    ];

    const cogsService: any = {
      computeCogsByVariant: async () => new Map<number, number>([[1, 30]])
    };

    const costProfile: any = {
      payment: { feePercent: 0.03, feeFixed: 0.35 }
    };

    const res = await buildProductsProfit({
      shop: "test-shop",
      days: 30,
      orders,
      costProfile,
      cogsService,
      shopifyGET: dummyShopifyGET
    });

    expect(res.products.length).toBe(1);
    expect(res.products[0].variantId).toBe(1);
    expect(res.products[0].grossSales).toBe(60);
    expect(res.products[0].qty).toBe(1);
  });
});