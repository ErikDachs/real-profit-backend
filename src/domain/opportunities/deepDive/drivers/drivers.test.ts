import { describe, expect, it } from "vitest";

import { buildFeeDrivers } from "./fees.js";
import { buildRefundDrivers } from "./refunds.js";
import { buildShippingDrivers } from "./shipping.js";
import { buildMissingCogsDrivers } from "./missingCogs.js";
import { buildNegativeCmDrivers } from "./negativeCm.js";
import { buildLowMarginDrivers } from "./lowMargin.js";
import { mkDrivers } from "./index.js";

describe("deepDive drivers", () => {
  describe("buildFeeDrivers", () => {
    it("builds ranked fee drivers from products", () => {
      const result = buildFeeDrivers({
        type: "HIGH_FEES",
        orders: [],
        products: [
          {
            productId: 1,
            variantId: 101,
            title: "A",
            sku: "SKU-A",
            variantTitle: "Red",
            paymentFeesAllocated: 12,
            netSales: 100,
            qty: 2,
          },
          {
            productId: 2,
            variantId: 202,
            title: "B",
            sku: "SKU-B",
            variantTitle: "Blue",
            paymentFeesAllocated: 30,
            netSales: 150,
            qty: 3,
          },
        ] as any,
        limit: 10,
      });

      expect(result.totalImpact).toBe(42);
      expect(result.drivers).toHaveLength(2);
      expect(result.drivers[0]).toMatchObject({
        key: "variant:202",
        productId: 2,
        variantId: 202,
        title: "B",
        impact: 30,
      });
      expect(result.drivers[0].metrics).toEqual({
        paymentFeesAllocated: 30,
        netSales: 150,
        feeRatePctOfNetSales: 20,
        qty: 3,
      });
      expect(result.drivers[0].impactSharePct).toBeCloseTo(71.43, 2);
    });

    it("respects limit", () => {
      const result = buildFeeDrivers({
        type: "HIGH_FEES",
        orders: [],
        products: [
          { variantId: 1, title: "A", paymentFeesAllocated: 10, netSales: 100, qty: 1 },
          { variantId: 2, title: "B", paymentFeesAllocated: 20, netSales: 100, qty: 1 },
          { variantId: 3, title: "C", paymentFeesAllocated: 30, netSales: 100, qty: 1 },
        ] as any,
        limit: 2,
      });

      expect(result.drivers.map((d) => d.variantId)).toEqual([3, 2]);
    });
  });

  describe("buildRefundDrivers", () => {
    it("builds ranked refund drivers from products", () => {
      const result = buildRefundDrivers({
        type: "HIGH_REFUNDS",
        orders: [],
        products: [
          {
            productId: 1,
            variantId: 101,
            title: "A",
            refundsAllocated: 15,
            grossSales: 100,
            netSales: 85,
            qty: 2,
          },
          {
            productId: 2,
            variantId: 202,
            title: "B",
            refundsAllocated: 30,
            grossSales: 120,
            netSales: 90,
            qty: 1,
          },
        ] as any,
        limit: 10,
      });

      expect(result.totalImpact).toBe(45);
      expect(result.drivers[0]).toMatchObject({
        key: "variant:202",
        impact: 30,
      });
      expect(result.drivers[0].metrics).toEqual({
        refunds: 30,
        grossSales: 120,
        refundRatePct: 25,
        netSales: 90,
        qty: 1,
      });
    });
  });

  describe("buildShippingDrivers", () => {
    it("builds shipping loss drivers from orders with explicit shippingImpact", () => {
      const result = buildShippingDrivers({
        type: "SHIPPING_SUBSIDY",
        orders: [
          {
            id: "o1",
            name: "#1001",
            shippingRevenue: 2,
            shippingCost: 8,
            shippingImpact: -6,
            netAfterRefunds: 100,
          },
          {
            id: "o2",
            name: "#1002",
            shippingRevenue: 10,
            shippingCost: 8,
            shippingImpact: 2,
            netAfterRefunds: 120,
          },
        ] as any,
        products: [],
        limit: 10,
      });

      expect(result.totalImpact).toBe(6);
      expect(result.drivers).toHaveLength(1);
      expect(result.drivers[0]).toMatchObject({
        key: "order:o1",
        title: "#1001",
        impact: 6,
        impactSharePct: 100,
      });
      expect(result.drivers[0].metrics).toEqual({
        shippingRevenue: 2,
        shippingCost: 8,
        shippingImpact: -6,
        netAfterRefunds: 100,
      });
    });

    it("falls back to revenue - cost when shippingImpact is missing", () => {
      const result = buildShippingDrivers({
        type: "SHIPPING_SUBSIDY",
        orders: [
          {
            id: "o1",
            name: "#1001",
            shippingRevenue: 1,
            shippingCost: 10,
            netAfterRefunds: 100,
          },
          {
            id: "o2",
            name: "#1002",
            shippingRevenue: 6,
            shippingCost: 8,
            netAfterRefunds: 100,
          },
        ] as any,
        products: [],
        limit: 10,
      });

      expect(result.totalImpact).toBe(11);
      expect(result.drivers.map((d) => d.key)).toEqual(["order:o1", "order:o2"]);
      expect(result.drivers[0].impact).toBe(9);
      expect(result.drivers[1].impact).toBe(2);
    });
  });

  describe("buildMissingCogsDrivers", () => {
    it("includes only products with missing cogs and positive qty/net", () => {
      const result = buildMissingCogsDrivers({
        type: "MISSING_COGS",
        orders: [],
        products: [
          {
            productId: 1,
            variantId: 101,
            title: "A",
            netSales: 100,
            qty: 2,
            hasMissingCogs: true,
          },
          {
            productId: 2,
            variantId: 202,
            title: "B",
            netSales: 50,
            qty: 0,
            hasMissingCogs: true,
          },
          {
            productId: 3,
            variantId: 303,
            title: "C",
            netSales: 80,
            qty: 1,
            hasMissingCogs: false,
          },
        ] as any,
        limit: 10,
      });

      expect(result.totalImpact).toBe(100);
      expect(result.drivers).toHaveLength(1);
      expect(result.drivers[0]).toMatchObject({
        key: "variant:101",
        impact: 100,
      });
      expect(result.drivers[0].metrics).toEqual({
        netSalesExposure: 100,
        qty: 2,
        missingCogsFlag: 1,
      });
    });
  });

  describe("buildNegativeCmDrivers", () => {
    it("keeps only products with negative profit", () => {
      const result = buildNegativeCmDrivers({
        type: "NEGATIVE_CM",
        orders: [],
        products: [
          {
            productId: 1,
            variantId: 101,
            title: "A",
            profitAfterAds: -20,
            netSales: 100,
            marginPct: -20,
          },
          {
            productId: 2,
            variantId: 202,
            title: "B",
            profitAfterAds: 10,
            netSales: 80,
            marginPct: 12.5,
          },
          {
            productId: 3,
            variantId: 303,
            title: "C",
            profitAfterFees: -5,
            netSales: 50,
            marginPct: -10,
          },
        ] as any,
        limit: 10,
      });

      expect(result.totalImpact).toBe(25);
      expect(result.drivers.map((d) => d.variantId)).toEqual([101, 303]);
      expect(result.drivers[0].metrics).toEqual({
        profit: -20,
        netSales: 100,
        marginPct: -20,
        allocatedAdSpend: undefined,
      });
    });
  });

  describe("buildLowMarginDrivers", () => {
it("builds proxy impact from profit/net margin when netSales is present", () => {
  const result = buildLowMarginDrivers({
    type: "LOW_MARGIN",
    orders: [],
    products: [
      {
        productId: 1,
        variantId: 101,
        title: "A",
        netSales: 100,
        profitAfterAds: 5, // 5%
        allocatedAdSpend: 10,
      },
      {
        productId: 2,
        variantId: 202,
        title: "B",
        netSales: 200,
        profitAfterFees: 40, // 20%
      },
      {
        productId: 3,
        variantId: 303,
        title: "C",
        netSales: 50,
        marginPct: 10, // ignored because netSales > 0 and profit defaults to 0
      },
    ] as any,
    limit: 10,
  });

  expect(result.drivers.map((d) => d.variantId)).toEqual([101, 303]);
  expect(result.totalImpact).toBe(17.5);

  expect(result.drivers[0]).toMatchObject({
    key: "variant:101",
    impact: 10,
  });
  expect(result.drivers[0].metrics).toEqual({
    netSales: 100,
    profit: 5,
    marginPct: 5,
    gapTo15Pct: 10,
    allocatedAdSpend: 10,
  });

  expect(result.drivers[1]).toMatchObject({
    key: "variant:303",
    impact: 7.5,
  });
  expect(result.drivers[1].metrics).toEqual({
    netSales: 50,
    profit: 0,
    marginPct: 0,
    gapTo15Pct: 15,
    allocatedAdSpend: undefined,
  });
});

it("uses marginPct fallback only when netSales is not positive", () => {
  const result = buildLowMarginDrivers({
    type: "LOW_MARGIN",
    orders: [],
    products: [
      {
        productId: 3,
        variantId: 303,
        title: "C",
        netSales: 0,
        marginPct: 10,
      },
    ] as any,
    limit: 10,
  });

  expect(result.totalImpact).toBe(0);
  expect(result.drivers).toEqual([]);
});

    it("filters zero-impact rows", () => {
      const result = buildLowMarginDrivers({
        type: "LOW_MARGIN",
        orders: [],
        products: [
          {
            productId: 1,
            variantId: 101,
            title: "A",
            netSales: 100,
            profitAfterFees: 20, // 20%
          },
        ] as any,
        limit: 10,
      });

      expect(result.totalImpact).toBe(0);
      expect(result.drivers).toEqual([]);
    });
  });

  describe("mkDrivers", () => {
    const params = {
      orders: [
        {
          id: "o1",
          name: "#1001",
          shippingRevenue: 2,
          shippingCost: 8,
          shippingImpact: -6,
          netAfterRefunds: 100,
        },
      ],
      products: [
        {
          productId: 1,
          variantId: 101,
          title: "A",
          paymentFeesAllocated: 10,
          refundsAllocated: 5,
          grossSales: 100,
          netSales: 90,
          qty: 1,
          hasMissingCogs: true,
          profitAfterAds: -10,
          profitAfterFees: -10,
          marginPct: -11.11,
        },
      ],
      limit: 10,
    } as any;

    it("routes HIGH_REFUNDS to refund drivers", () => {
      const result = mkDrivers({ ...params, type: "HIGH_REFUNDS" });
      expect(result.drivers[0].key).toBe("variant:101");
      expect(result.drivers[0].metrics).toHaveProperty("refunds");
    });

    it("routes HIGH_FEES to fee drivers", () => {
      const result = mkDrivers({ ...params, type: "HIGH_FEES" });
      expect(result.drivers[0].metrics).toHaveProperty("paymentFeesAllocated");
    });

    it("routes SHIPPING_SUBSIDY to shipping drivers", () => {
      const result = mkDrivers({ ...params, type: "SHIPPING_SUBSIDY" });
      expect(result.drivers[0].key).toBe("order:o1");
    });

    it("routes MISSING_COGS to missing cogs drivers", () => {
      const result = mkDrivers({ ...params, type: "MISSING_COGS" });
      expect(result.drivers[0].metrics).toHaveProperty("missingCogsFlag", 1);
    });

    it("routes NEGATIVE_CM to negative cm drivers", () => {
      const result = mkDrivers({ ...params, type: "NEGATIVE_CM" });
      expect(result.drivers[0].metrics).toHaveProperty("profit", -10);
    });

    it("falls back to low margin drivers for LOW_MARGIN", () => {
      const result = mkDrivers({ ...params, type: "LOW_MARGIN" });
      expect(result.drivers[0].metrics).toHaveProperty("gapTo15Pct");
    });

    it("falls back to low margin drivers for unknown future types", () => {
      const result = mkDrivers({ ...params, type: "OPERATING_LEVERAGE_RISK" as any });
      expect(result.drivers[0].metrics).toHaveProperty("gapTo15Pct");
    });
  });
});