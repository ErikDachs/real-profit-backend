/// <reference types="node" />

import test from "node:test";
import assert from "node:assert/strict";

import { calculateOrderProfit } from "../../src/domain/profit/orderProfit";
import { buildOrdersSummary } from "../../src/domain/profit/ordersSummary";

// ✅ richtiger Import: du exportierst buildDailyProfit aus src/domain/profitDaily/index.ts
import { buildDailyProfit } from "../../src/domain/profitDaily";

import {
  loadFixtures,
  toDomainOrders,
  makeFakeCogsService,
  costProfileFromFixture,
  dummyShopifyGET,
  computeUnitCostByVariantOnce,
  round2,
} from "./_helpers";

const fixtures = loadFixtures();

const SSOT_KEYS = [
  "grossSales",
  "refunds",
  "netAfterRefunds",
  "cogs",
  "paymentFees",
  "shippingRevenue",
  "shippingCost",
  "shippingImpact",
  "contributionMargin",
  "profitAfterFees",
  "profitAfterShipping",
] as const;

type SsotKey = (typeof SSOT_KEYS)[number];

function sumKey(rows: any[], key: SsotKey) {
  return round2(rows.reduce((s, r) => s + Number(r?.[key] ?? 0), 0));
}

function assertDefinedDerived(r: any, fxName: string) {
  // If any of these are ever undefined, someone introduced "optional derived fields"
  // which leads to shadow-calculation downstream. We kill that here.
  const mustExist = [
    "grossSales",
    "refunds",
    "netAfterRefunds",
    "cogs",
    "paymentFees",
    "shippingRevenue",
    "shippingCost",
    "shippingImpact",
    "contributionMargin",
    "profitAfterFees",
    "profitAfterShipping",
  ];

  for (const k of mustExist) {
    assert.notEqual(r?.[k], undefined, `${fxName}: orderProfit.${k} is undefined (SSOT breach)`);
  }

  // sanity relation (per order): shippingImpact = shippingRevenue - shippingCost
  const sr = Number(r.shippingRevenue ?? 0);
  const sc = Number(r.shippingCost ?? 0);
  const si = Number(r.shippingImpact ?? 0);
  assert.equal(round2(sr - sc), round2(si), `${fxName}: orderProfit.shippingImpact mismatch`);
}

for (const fx of fixtures) {
  test(`[golden] profitDaily SSOT: ${fx.name}`, async () => {
    const orders = toDomainOrders(fx);
    const costProfile = costProfileFromFixture(fx);
    const cogsService = makeFakeCogsService(fx);

    const unitCostByVariant = await computeUnitCostByVariantOnce({ fx, orders, cogsService });

    // ----------------------------
    // orderProfit rows (SSOT)
    // ----------------------------
    const orderResults: any[] = [];
    for (const o of orders) {
      const r: any = await calculateOrderProfit({
        order: o,
        costProfile,
        cogsService: cogsService as any,
        shopifyGET: dummyShopifyGET,
        unitCostByVariant,
      } as any);

      assertDefinedDerived(r, fx.name);
      orderResults.push(r);
    }

    // Totals derived ONLY by summing SSOT rows
    const orderTotals: Record<SsotKey, number> = Object.fromEntries(
      SSOT_KEYS.map((k) => [k, sumKey(orderResults, k)])
    ) as any;

    // Totals sanity: shippingImpact = shippingRevenue - shippingCost
    assert.equal(
      round2(orderTotals.shippingRevenue - orderTotals.shippingCost),
      round2(orderTotals.shippingImpact),
      `${fx.name}: orderTotals.shippingImpact mismatch`
    );

    // ----------------------------
    // profitDaily (must match SSOT totals)
    // ----------------------------
    const dailyOut: any = buildDailyProfit({
      shop: "test-shop",
      days: 30,
      orderProfits: orderResults,
    } as any);

    // Check profitDaily totals against SSOT totals for a set of keys (not only profitAfterShipping)
    for (const k of SSOT_KEYS) {
      const got = round2(Number(dailyOut?.totals?.[k] ?? 0));
      const expected = round2(Number(orderTotals[k] ?? 0));
      assert.equal(got, expected, `${fx.name}: profitDaily.totals.${k} != Σ(orderProfit.${k})`);
    }

    // ----------------------------
    // ordersSummary (must match SSOT totals)
    // ----------------------------
    const summary: any = await buildOrdersSummary({
      shop: "test-shop",
      days: 30,
      adSpend: (fx as any).costConfig?.ads?.periodTotal ?? 0,
      orders,
      costProfile,
      cogsService: cogsService as any,
      shopifyGET: dummyShopifyGET,
      unitCostByVariant,
    } as any);

    // Your summary uses `count`; fixtures sometimes use `orders`.
    // We don't assert that here; we assert SSOT numeric invariants.
    const summaryFieldMap: Partial<Record<SsotKey, string>> = {
      // same names
      grossSales: "grossSales",
      refunds: "refunds",
      netAfterRefunds: "netAfterRefunds",
      cogs: "cogs",
      paymentFees: "paymentFees",
      shippingRevenue: "shippingRevenue",
      shippingCost: "shippingCost",
      shippingImpact: "shippingImpact",
      contributionMargin: "contributionMargin",
      profitAfterFees: "profitAfterFees",
      profitAfterShipping: "profitAfterShipping",
    };

    for (const k of SSOT_KEYS) {
      const field = summaryFieldMap[k]!;
      const got = round2(Number(summary?.[field] ?? 0));
      const expected = round2(Number(orderTotals[k] ?? 0));
      assert.equal(got, expected, `${fx.name}: ordersSummary.${field} != Σ(orderProfit.${k})`);
    }

    // summary sanity: shippingImpact = shippingRevenue - shippingCost
    assert.equal(
      round2(Number(summary.shippingRevenue ?? 0) - Number(summary.shippingCost ?? 0)),
      round2(Number(summary.shippingImpact ?? 0)),
      `${fx.name}: ordersSummary.shippingImpact mismatch`
    );
  });
}