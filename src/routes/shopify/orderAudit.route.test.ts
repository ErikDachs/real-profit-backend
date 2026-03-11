import { beforeEach, describe, expect, it, vi } from "vitest";
import Fastify from "fastify";

const {
  calculateOrderProfitMock,
  extractVariantQtyFromOrderMock,
  resolveCostProfileMock,
  costOverridesFromAnyMock,
} = vi.hoisted(() => ({
  calculateOrderProfitMock: vi.fn(),
  extractVariantQtyFromOrderMock: vi.fn(),
  resolveCostProfileMock: vi.fn(),
  costOverridesFromAnyMock: vi.fn(),
}));

vi.mock("../../domain/profit.js", () => ({
  calculateOrderProfit: calculateOrderProfitMock,
  extractVariantQtyFromOrder: extractVariantQtyFromOrderMock,
}));

vi.mock("../../domain/costModel/resolve.js", () => ({
  resolveCostProfile: resolveCostProfileMock,
  costOverridesFromAny: costOverridesFromAnyMock,
}));

import { registerOrderAuditRoute } from "./orderAudit.route.js";

function makeCtx(overrides?: Partial<any>) {
  const cogsService = {
    computeUnitCostsByVariant: vi.fn().mockResolvedValue(
      new Map<number, number | undefined>([
        [101, 12.5],
        [202, undefined],
      ])
    ),
  };

  const sameShopOrder = {
    id: "12345",
    name: "#1001",
    created_at: "2026-01-10T12:00:00.000Z",
    currency: "USD",
    financial_status: "paid",
    fulfillment_status: "fulfilled",
    line_items: [
      { variant_id: 101, title: "Product A", sku: "SKU-A", product_id: 9001 },
      { variant_id: 202, title: "Product B", sku: "SKU-B", product_id: 9002 },
    ],
  };

  const foreignShopOrder = {
    id: "99999",
    name: "#2001",
    created_at: "2026-02-10T12:00:00.000Z",
    currency: "EUR",
    financial_status: "paid",
    fulfillment_status: null,
    line_items: [{ variant_id: 303, title: "Foreign Product", sku: "SKU-F", product_id: 9100 }],
  };

  return {
    shop: "main-shop.myshopify.com",
    shopify: { get: vi.fn() },

    cogsService,
    getCogsServiceForShop: vi.fn().mockResolvedValue({
      computeUnitCostsByVariant: vi.fn().mockResolvedValue(
        new Map<number, number | undefined>([[303, 4.5]])
      ),
    }),

    fetchOrderById: vi.fn().mockResolvedValue(sameShopOrder),
    fetchOrderByIdForShop: vi.fn().mockResolvedValue(foreignShopOrder),

    createShopifyForShop: vi.fn().mockResolvedValue({ get: vi.fn() }),

    ...overrides,
  };
}

async function buildApp(ctx: any) {
  const app = Fastify({ logger: false });
  (app as any).config = {
    DATA_DIR: "/tmp/test-data",
  };

  registerOrderAuditRoute(app, ctx);
  return app;
}

describe("orderAudit.route", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    costOverridesFromAnyMock.mockReturnValue(undefined);

    resolveCostProfileMock.mockReturnValue({
      meta: { fingerprint: "fp_order_audit" },
      payment: { feePercent: 0.03, feeFixed: 0.3 },
      shipping: { costPerOrder: 8 },
      flags: { includeShippingCost: true, adAllocationMode: "BY_NET_SALES" },
    });

    extractVariantQtyFromOrderMock.mockReturnValue([
      { variantId: 101, qty: 2 },
      { variantId: 202, qty: 1 },
    ]);

    calculateOrderProfitMock.mockResolvedValue({
      grossSales: 120,
      refunds: 10,
      netAfterRefunds: 110,
      cogs: 25,
      paymentFees: 4,
      contributionMargin: 81,
      contributionMarginPct: 73.64,
      shippingRevenue: 6,
      shippingCost: 8,
      shippingImpact: -2,
      profitAfterShipping: 79,
      adSpendBreakEven: 79,
      breakEvenRoas: 1.4,
    });
  });

  it("returns 400 for non-numeric orderId", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);

    const res = await app.inject({
      method: "GET",
      url: "/api/audit/order/not-a-number?shop=main-shop.myshopify.com",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: "orderId must be a numeric Shopify order id",
    });

    expect(ctx.fetchOrderById).not.toHaveBeenCalled();
    expect(calculateOrderProfitMock).not.toHaveBeenCalled();
  });

  it("returns 400 when shop is missing and ctx.shop fallback is empty", async () => {
    const ctx = makeCtx({ shop: "" });
    const app = await buildApp(ctx);

    const res = await app.inject({
      method: "GET",
      url: "/api/audit/order/12345",
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: "shop is required (valid *.myshopify.com)",
    });

    expect(ctx.fetchOrderById).not.toHaveBeenCalled();
  });

  it("uses same-shop path and returns audited order payload", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);

    const res = await app.inject({
      method: "GET",
      url: "/api/audit/order/12345?shop=main-shop.myshopify.com&feePercent=0.025",
    });

    expect(res.statusCode).toBe(200);

    expect(costOverridesFromAnyMock).toHaveBeenCalledTimes(1);
    expect(resolveCostProfileMock).toHaveBeenCalledTimes(1);

    expect(ctx.fetchOrderById).toHaveBeenCalledWith("12345");
    expect(ctx.fetchOrderByIdForShop).not.toHaveBeenCalled();
    expect(ctx.createShopifyForShop).not.toHaveBeenCalled();
    expect(ctx.getCogsServiceForShop).not.toHaveBeenCalled();

    expect(extractVariantQtyFromOrderMock).toHaveBeenCalledTimes(1);

    expect(ctx.cogsService.computeUnitCostsByVariant).toHaveBeenCalledWith(
      ctx.shopify.get,
      [101, 202]
    );

    expect(calculateOrderProfitMock).toHaveBeenCalledWith({
      order: expect.any(Object),
      costProfile: expect.objectContaining({
        meta: { fingerprint: "fp_order_audit" },
      }),
      cogsService: ctx.cogsService,
      shopifyGET: ctx.shopify.get,
      unitCostByVariant: expect.any(Map),
    });

    expect(res.json()).toEqual({
      type: "order_audit",
      shop: "main-shop.myshopify.com",
      order: {
        id: "12345",
        name: "#1001",
        createdAt: "2026-01-10T12:00:00.000Z",
        currency: "USD",
        financialStatus: "paid",
        fulfillmentStatus: "fulfilled",
      },
      costModel: {
        payment: {
          feePercent: 0.03,
          feeFixed: 0.3,
        },
        shipping: {
          includeShippingCost: true,
          costPerOrder: 8,
        },
        ads: {
          allocationMode: "BY_NET_SALES",
        },
        fingerprint: "fp_order_audit",
      },
      profit: {
        grossSales: 120,
        refunds: 10,
        netAfterRefunds: 110,
        cogs: 25,
        paymentFees: 4,
        contributionMargin: 81,
        contributionMarginPct: 73.64,
        shippingRevenue: 6,
        shippingCost: 8,
        shippingImpact: -2,
        profitAfterShipping: 79,
        adSpendBreakEven: 79,
        breakEvenRoas: 1.4,
      },
      lineItems: [
        {
          variantId: 101,
          qty: 2,
          unitCost: 12.5,
          cogs: 25,
          missingCogs: false,
          title: "Product A",
          sku: "SKU-A",
          productId: 9001,
        },
        {
          variantId: 202,
          qty: 1,
          unitCost: 0,
          cogs: 0,
          missingCogs: true,
          title: "Product B",
          sku: "SKU-B",
          productId: 9002,
        },
      ],
      checks: {
        missingCogsVariants: [202],
        missingCogsLineItemsCount: 1,
        warnings: [
          "missing COGS detected for one or more variants.",
          "order has refunds.",
        ],
      },
    });
  });

  it("adds netAfterRefunds warning when <= 0", async () => {
    const ctx = makeCtx();
    const app = await buildApp(ctx);

    calculateOrderProfitMock.mockResolvedValue({
      grossSales: 50,
      refunds: 60,
      netAfterRefunds: -10,
      cogs: 0,
      paymentFees: 1,
      contributionMargin: -11,
      contributionMarginPct: -22,
      shippingRevenue: 0,
      shippingCost: 0,
      shippingImpact: 0,
      profitAfterShipping: -11,
      adSpendBreakEven: -11,
      breakEvenRoas: null,
    });

    extractVariantQtyFromOrderMock.mockReturnValue([
      { variantId: 101, qty: 1 },
    ]);

    ctx.cogsService.computeUnitCostsByVariant.mockResolvedValue(
      new Map<number, number | undefined>([[101, 5]])
    );

    const res = await app.inject({
      method: "GET",
      url: "/api/audit/order/12345?shop=main-shop.myshopify.com",
    });

    expect(res.statusCode).toBe(200);

    expect(res.json().checks.warnings).toEqual([
      "netAfterRefunds <= 0 (rates may be unstable / break-even not meaningful).",
      "order has refunds.",
    ]);
  });

  it("uses multi-shop branch when requested shop differs from ctx.shop", async () => {
    const foreignShopify = { get: vi.fn() };
    const foreignCogsService = {
      computeUnitCostsByVariant: vi.fn().mockResolvedValue(
        new Map<number, number | undefined>([[303, 4.5]])
      ),
    };

    const ctx = makeCtx({
      createShopifyForShop: vi.fn().mockResolvedValue(foreignShopify),
      getCogsServiceForShop: vi.fn().mockResolvedValue(foreignCogsService),
    });

    extractVariantQtyFromOrderMock.mockReturnValue([
      { variantId: 303, qty: 3 },
    ]);

    calculateOrderProfitMock.mockResolvedValue({
      grossSales: 90,
      refunds: 0,
      netAfterRefunds: 90,
      cogs: 13.5,
      paymentFees: 3,
      contributionMargin: 73.5,
      contributionMarginPct: 81.67,
      shippingRevenue: 0,
      shippingCost: 0,
      shippingImpact: 0,
      profitAfterShipping: 73.5,
      adSpendBreakEven: 73.5,
      breakEvenRoas: 1.2,
    });

    const app = await buildApp(ctx);

    const res = await app.inject({
      method: "GET",
      url: "/api/audit/order/99999?shop=other-shop.myshopify.com",
    });

    expect(res.statusCode).toBe(200);

    expect(ctx.fetchOrderById).not.toHaveBeenCalled();
    expect(ctx.fetchOrderByIdForShop).toHaveBeenCalledWith("other-shop.myshopify.com", "99999");
    expect(ctx.createShopifyForShop).toHaveBeenCalledWith("other-shop.myshopify.com");
    expect(ctx.getCogsServiceForShop).toHaveBeenCalledWith("other-shop.myshopify.com");

    expect(foreignCogsService.computeUnitCostsByVariant).toHaveBeenCalledWith(
      foreignShopify.get,
      [303]
    );

    expect(res.json().shop).toBe("other-shop.myshopify.com");
    expect(res.json().order).toEqual({
      id: "99999",
      name: "#2001",
      createdAt: "2026-02-10T12:00:00.000Z",
      currency: "EUR",
      financialStatus: "paid",
      fulfillmentStatus: null,
    });
  });

  it("propagates explicit downstream status", async () => {
    const ctx = makeCtx();
    ctx.fetchOrderById.mockRejectedValue(
      Object.assign(new Error("Order not found"), { status: 404 })
    );

    const app = await buildApp(ctx);

    const res = await app.inject({
      method: "GET",
      url: "/api/audit/order/12345?shop=main-shop.myshopify.com",
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({
      error: "Unexpected error",
      details: "Order not found",
    });
  });
});