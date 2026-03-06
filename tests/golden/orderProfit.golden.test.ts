/// <reference types="node" />

import test from "node:test";
import assert from "node:assert/strict";

import { calculateOrderProfit } from "../../src/domain/profit/orderProfit";
import { buildOrdersSummary } from "../../src/domain/profit/ordersSummary";

import {
  loadFixtures,
  toDomainOrders,
  makeFakeCogsService,
  costProfileFromFixture,
  dummyShopifyGET,
  computeUnitCostByVariantOnce,
  round2,
} from "./_helpers";

// ----------------------------
// Assertions
// ----------------------------
function assertMaybeNumber(actual: any, expected: number | undefined, label: string) {
  if (expected == null) return;
  assert.equal(round2(Number(actual)), round2(expected), `${label} mismatch: got=${actual} expected=${expected}`);
}
function assertMaybeBool(actual: any, expected: boolean | undefined, label: string) {
  if (expected == null) return;
  assert.equal(Boolean(actual), Boolean(expected), `${label} mismatch: got=${actual} expected=${expected}`);
}

// ----------------------------
// Golden Tests
// ----------------------------
const fixtures = loadFixtures();

for (const fx of fixtures) {
  test(`[golden] orderProfit: ${fx.name}`, async () => {
    const orders = toDomainOrders(fx);
    const costProfile = costProfileFromFixture(fx);
    const cogsService = makeFakeCogsService(fx);

    const unitCostByVariant = await computeUnitCostByVariantOnce({ fx, orders, cogsService });

    // 1) Per-order assertions
    const expById = (fx as any).expected?.orderProfitByOrderId ?? {};
    const orderResults: any[] = [];

    for (const o of orders) {
      const r: any = await calculateOrderProfit({
        order: o,
        costProfile,
        cogsService: cogsService as any,
        shopifyGET: dummyShopifyGET,
        unitCostByVariant,
      } as any);

      orderResults.push(r);

      const exp = expById[String(o.id)];
      if (!exp) continue;

      assertMaybeNumber(r.grossSales, exp.grossSales, `${fx.name}#${o.id}.grossSales`);
      assertMaybeNumber(r.refunds, exp.refunds, `${fx.name}#${o.id}.refunds`);
      assertMaybeNumber(r.netAfterRefunds, exp.netAfterRefunds, `${fx.name}#${o.id}.netAfterRefunds`);

      assertMaybeNumber(r.cogs, exp.cogs, `${fx.name}#${o.id}.cogs`);
      assertMaybeNumber(r.paymentFees, exp.paymentFees, `${fx.name}#${o.id}.paymentFees`);
      assertMaybeNumber(r.contributionMargin, exp.contributionMargin, `${fx.name}#${o.id}.contributionMargin`);

      assertMaybeNumber(r.shippingRevenue, exp.shippingRevenue, `${fx.name}#${o.id}.shippingRevenue`);
      assertMaybeNumber(r.shippingCost, exp.shippingCost, `${fx.name}#${o.id}.shippingCost`);
      assertMaybeNumber(r.profitAfterShipping, exp.profitAfterShipping, `${fx.name}#${o.id}.profitAfterShipping`);

      assertMaybeBool(r.hasMissingCogs, exp.hasMissingCogs, `${fx.name}#${o.id}.hasMissingCogs`);
    }

    // 2) SSOT drift guard (KPI semantics only)
    const adSpend = (fx as any).costConfig?.ads?.periodTotal ?? 0;

    const summary: any = await buildOrdersSummary({
      shop: "test-shop",
      days: 30,
      adSpend,
      orders,
      costProfile,
      cogsService: cogsService as any,
      shopifyGET: dummyShopifyGET,
      unitCostByVariant,
    } as any);

    const agg = {
      grossSales: round2(orderResults.reduce((s, r) => s + Number(r.grossSales ?? 0), 0)),
      refunds: round2(orderResults.reduce((s, r) => s + Number(r.refunds ?? 0), 0)),
      netAfterRefunds: round2(orderResults.reduce((s, r) => s + Number(r.netAfterRefunds ?? 0), 0)),

      cogs: round2(orderResults.reduce((s, r) => s + Number(r.cogs ?? 0), 0)),
      paymentFees: round2(orderResults.reduce((s, r) => s + Number(r.paymentFees ?? 0), 0)),
      contributionMargin: round2(orderResults.reduce((s, r) => s + Number(r.contributionMargin ?? 0), 0)),

      shippingRevenue: round2(orderResults.reduce((s, r) => s + Number(r.shippingRevenue ?? 0), 0)),
      shippingCost: round2(orderResults.reduce((s, r) => s + Number(r.shippingCost ?? 0), 0)),
      profitAfterShipping: round2(orderResults.reduce((s, r) => s + Number(r.profitAfterShipping ?? 0), 0)),
    };

    const excludeGiftCards = Boolean((costProfile as any)?.flags?.excludeGiftCards ?? false);
    const hasGiftCardOnlyOrders = orders.some((o: any) => {
      const lis = o?.line_items ?? [];
      return Array.isArray(lis) && lis.length > 0 && lis.every((li: any) => li?.gift_card === true);
    });

    // IMPORTANT:
    // For excludeGiftCards + gift-card-only orders, calculateOrderProfit keeps raw grossSales/refunds visible,
    // while ordersSummary grossSales/refunds are operational (0). Comparing those is invalid by contract.
    if (!(excludeGiftCards && hasGiftCardOnlyOrders)) {
      assert.equal(round2(summary.grossSales), agg.grossSales, `${fx.name}: summary.grossSales drift`);
      assert.equal(round2(summary.refunds), agg.refunds, `${fx.name}: summary.refunds drift`);
    }

    // KPI-consistent checks (always valid)
// KPI-consistent checks
assert.equal(round2(summary.netAfterRefunds), agg.netAfterRefunds, `${fx.name}: summary.netAfterRefunds drift`);
assert.equal(round2(summary.cogs), agg.cogs, `${fx.name}: summary.cogs drift`);

// paymentFees semantics:
// - ordersSummary uses RAW net (includes gift cards) because fees are real cash costs
// - orderProfit with excludeGiftCards=true may zero-out KPIs for gift-only orders
// => comparing fees is invalid in that governance mode
if (!(excludeGiftCards && hasGiftCardOnlyOrders)) {
  assert.equal(round2(summary.paymentFees), agg.paymentFees, `${fx.name}: summary.paymentFees drift`);
}

// contributionMargin/profit semantics:
// ordersSummary subtracts real paymentFees even when operational netAfterRefunds=0 (gift-card-only excluded from KPIs),
// while orderProfit may zero-out KPIs entirely in excludeGiftCards mode.
// => comparing CM/profit is invalid in that governance mode
if (!(excludeGiftCards && hasGiftCardOnlyOrders)) {
  assert.equal(round2(summary.contributionMargin), agg.contributionMargin, `${fx.name}: summary.contributionMargin drift`);
  assert.equal(round2(summary.profitAfterShipping), agg.profitAfterShipping, `${fx.name}: summary.profitAfterShipping drift`);
}

assert.equal(round2(summary.shippingRevenue), agg.shippingRevenue, `${fx.name}: summary.shippingRevenue drift`);
assert.equal(round2(summary.shippingCost), agg.shippingCost, `${fx.name}: summary.shippingCost drift`);

    // 3) optional expected ordersSummary checks
    const expSum = (fx as any).expected?.ordersSummary;
    if (expSum) {
      if (expSum.orders != null) assert.equal(Number(summary.count), Number(expSum.orders), `${fx.name}: summary.count mismatch`);
      if (expSum.grossSales != null) assertMaybeNumber(summary.grossSales, expSum.grossSales, `${fx.name}: summary.grossSales`);
      if (expSum.refunds != null) assertMaybeNumber(summary.refunds, expSum.refunds, `${fx.name}: summary.refunds`);
      if (expSum.netAfterRefunds != null) assertMaybeNumber(summary.netAfterRefunds, expSum.netAfterRefunds, `${fx.name}: summary.netAfterRefunds`);

      if (expSum.shippingRevenue != null) assertMaybeNumber(summary.shippingRevenue, expSum.shippingRevenue, `${fx.name}: summary.shippingRevenue`);
      if (expSum.shippingCost != null) assertMaybeNumber(summary.shippingCost, expSum.shippingCost, `${fx.name}: summary.shippingCost`);

      if (expSum.cogs != null) assertMaybeNumber(summary.cogs, expSum.cogs, `${fx.name}: summary.cogs`);
      if (expSum.paymentFees != null) assertMaybeNumber(summary.paymentFees, expSum.paymentFees, `${fx.name}: summary.paymentFees`);
      if (expSum.contributionMargin != null) assertMaybeNumber(summary.contributionMargin, expSum.contributionMargin, `${fx.name}: summary.contributionMargin`);
      if (expSum.profitAfterShipping != null) assertMaybeNumber(summary.profitAfterShipping, expSum.profitAfterShipping, `${fx.name}: summary.profitAfterShipping`);

      if (expSum.missingCogsCount != null) assert.equal(Number(summary.missingCogsCount ?? 0), Number(expSum.missingCogsCount), `${fx.name}: summary.missingCogsCount`);
      if (expSum.missingCogsRatePct != null) assertMaybeNumber(summary.missingCogsRatePct, expSum.missingCogsRatePct, `${fx.name}: summary.missingCogsRatePct`);
      if (expSum.isCogsReliable != null) assert.equal(Boolean(summary.isCogsReliable), Boolean(expSum.isCogsReliable), `${fx.name}: summary.isCogsReliable`);
    }
  });
}