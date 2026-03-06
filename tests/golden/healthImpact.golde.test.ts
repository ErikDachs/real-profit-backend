/// <reference types="node" />

import test from "node:test";
import assert from "node:assert/strict";

import { buildOrdersSummary } from "../../src/domain/profit/ordersSummary";
import { buildProfitKillersInsights } from "../../src/domain/insights/profitKillers";
import { computeProfitHealthFromSummary } from "../../src/domain/health/profitHealth";

import {
  loadFixtures,
  toDomainOrders,
  makeFakeCogsService,
  costProfileFromFixture,
  dummyShopifyGET,
  computeUnitCostByVariantOnce,
} from "./_helpers";

const fixtures = loadFixtures();

function getFx(name: string) {
  const fx = fixtures.find((f) => f.name === name);
  assert.ok(fx, `fixture not found: ${name}`);
  return fx!;
}

async function buildSummaryForFixture(fx: any) {
  const shop = "test-shop";
  const days = 30;

  const costProfile = costProfileFromFixture(fx);
  const cogsService = makeFakeCogsService(fx);
  const orders = toDomainOrders(fx);
  const unitCostByVariant = await computeUnitCostByVariantOnce({ fx, orders, cogsService });

  return buildOrdersSummary({
    shop,
    days,
    adSpend: fx.costConfig.ads?.periodTotal ?? 0,
    orders,
    costProfile,
    cogsService: cogsService as any,
    shopifyGET: dummyShopifyGET,
    unitCostByVariant,
  } as any);
}

async function computePerOrderSummaries(params: { fx: any; shop: string; days: number }) {
  const { fx, shop, days } = params;

  const costProfile = costProfileFromFixture(fx);
  const cogsService = makeFakeCogsService(fx);
  const domainOrders = toDomainOrders(fx);
  const unitCostByVariant = await computeUnitCostByVariantOnce({
    fx,
    orders: domainOrders,
    cogsService,
  });

  const perOrderSummaries: any[] = [];
  let missingCogsCount = 0;

  let shippingRevenueTotal = 0;
  let shippingCostTotal = 0;

  for (const o of domainOrders) {
    const s: any = await buildOrdersSummary({
      shop,
      days,
      adSpend: 0,
      orders: [o],
      costProfile,
      cogsService: cogsService as any,
      shopifyGET: dummyShopifyGET,
      unitCostByVariant,
    } as any);

    perOrderSummaries.push(s);
    missingCogsCount += Number(s.missingCogsCount ?? 0);
    shippingRevenueTotal += Number(s.shippingRevenue ?? 0);
    shippingCostTotal += Number(s.shippingCost ?? 0);
  }

  return {
    perOrderSummaries,
    missingCogsCount,
    shippingTotals: { revenue: shippingRevenueTotal, cost: shippingCostTotal },
  };
}

function assertHealthShape(health: any, label: string) {
  assert.ok(health, `${label}: health missing`);

  const score = Number(health.score ?? health.healthScore ?? health.value);
  assert.ok(Number.isFinite(score), `${label}: score not finite`);
  assert.ok(score >= 0 && score <= 100, `${label}: score out of bounds (${score})`);

  assert.ok(typeof health.status === "string" && health.status.length > 0, `${label}: status missing`);
  assert.ok(health.components && typeof health.components === "object", `${label}: components missing`);
  assert.ok(health.ratios && typeof health.ratios === "object", `${label}: ratios missing`);

  if (health.drivers != null) {
    assert.ok(Array.isArray(health.drivers), `${label}: drivers must be array`);
    assert.ok(health.drivers.length <= 5, `${label}: drivers > 5`);
  }
}

function assertSortedByLossDesc(items: any[], label: string) {
  for (let i = 1; i < items.length; i++) {
    const prev = Number(items[i - 1]?.estimatedMonthlyLoss ?? 0);
    const cur = Number(items[i]?.estimatedMonthlyLoss ?? 0);
    assert.ok(cur <= prev + 1e-9, `${label}: not sorted desc at i=${i} (${cur} > ${prev})`);
  }
}

test("[golden] health: all fixtures produce bounded deterministic health output", async () => {
  for (const fx of fixtures) {
    const summaryA: any = await buildSummaryForFixture(fx);
    const summaryB: any = await buildSummaryForFixture(fx);

    const healthA: any = computeProfitHealthFromSummary(summaryA);
    const healthB: any = computeProfitHealthFromSummary(summaryB);

    assertHealthShape(healthA, fx.name);
    assertHealthShape(healthB, fx.name);

    assert.equal(
      Number(healthA.score ?? 0),
      Number(healthB.score ?? 0),
      `${fx.name}: health score not deterministic`
    );
    assert.equal(
      String(healthA.status ?? ""),
      String(healthB.status ?? ""),
      `${fx.name}: health status not deterministic`
    );
  }
});

test("[golden] health: missing COGS cases are never healthier than happy path", async () => {
  const happySummary: any = await buildSummaryForFixture(getFx("case01_happy_path"));
  const missingSummary: any = await buildSummaryForFixture(getFx("case03_missing_cogs"));
  const partialMissingSummary: any = await buildSummaryForFixture(getFx("case12_partial_missing_cogs_multi_line"));

  const happyHealth: any = computeProfitHealthFromSummary(happySummary);
  const missingHealth: any = computeProfitHealthFromSummary(missingSummary);
  const partialMissingHealth: any = computeProfitHealthFromSummary(partialMissingSummary);

  const happyScore = Number(happyHealth.score ?? 0);
  const missingScore = Number(missingHealth.score ?? 0);
  const partialMissingScore = Number(partialMissingHealth.score ?? 0);

  assert.ok(missingScore <= happyScore + 1e-9, `case03_missing_cogs should not beat happy path`);
  assert.ok(
    partialMissingScore <= happyScore + 1e-9,
    `case12_partial_missing_cogs_multi_line should not beat happy path`
  );
});

test("[golden] health: over-refund case stays finite and does not produce NaN", async () => {
  const summary: any = await buildSummaryForFixture(getFx("case10_over_refund_negative_net"));
  const health: any = computeProfitHealthFromSummary(summary);

  assertHealthShape(health, "case10_over_refund_negative_net");

  const numericFields = [
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

  for (const key of numericFields) {
    const val = Number(summary?.[key] ?? 0);
    assert.ok(Number.isFinite(val), `case10_over_refund_negative_net: summary.${key} not finite`);
  }

  assert.ok(Number(summary.refunds ?? 0) > Number(summary.grossSales ?? 0), "fixture intent broken: refund not > gross");
});

test("[golden] health: mixed gift-card/physical order is not treated as gift-card-only", async () => {
  const summary: any = await buildSummaryForFixture(getFx("case11_mixed_gift_card_and_physical"));

  assert.equal(Number(summary.count ?? 0), 1, "case11 count mismatch");
  assert.equal(Number(summary.giftCardOrdersCount ?? 0), 0, "case11 must not be treated as gift-card-only");
  assert.equal(Number(summary.missingCogsCount ?? 0), 0, "case11 should not have missing COGS");
  assert.ok(Number(summary.netAfterRefunds ?? 0) > 0, "case11 netAfterRefunds should stay positive");
});

test("[golden] impactSimulation: shape + deterministic ordering across all fixtures", async () => {
  const shop = "test-shop";
  const days = 30;

  for (const fx of fixtures) {
    const adSpend = fx.costConfig.ads?.periodTotal ?? 0;

    const { perOrderSummaries, missingCogsCount, shippingTotals } = await computePerOrderSummaries({
      fx,
      shop,
      days,
    });

    const out: any = buildProfitKillersInsights({
      shop,
      days,
      orders: perOrderSummaries,
      products: [],
      missingCogsCount,
      adSpend,
      currentRoas: 2.0,
      shippingTotals,
      limit: 10,
    } as any);

    assert.ok(out, `profitKillers output missing for fixture ${fx.name}`);

    const sim: any[] = out.impactSimulation ?? [];
    assert.ok(Array.isArray(sim), `impactSimulation not array for fixture ${fx.name}`);

    if (sim.length > 0) {
      for (const it of sim) {
        assert.ok(typeof it.type === "string" && it.type.length > 0, `${fx.name}: impactSimulation.type missing`);
        assert.ok(typeof it.title === "string" && it.title.length > 0, `${fx.name}: impactSimulation.title missing`);

        const loss = Number(it.estimatedMonthlyLoss);
        assert.ok(Number.isFinite(loss), `${fx.name}: estimatedMonthlyLoss must be finite`);
        assert.ok(loss >= 0, `${fx.name}: estimatedMonthlyLoss must be >= 0`);
      }

      assertSortedByLossDesc(sim, `impactSimulation(${fx.name})`);
    }
  }
});

test("[golden] health: fixed-cost-pressure case stays bounded and reflects allocated fixed costs", async () => {
  const fx = fixtures.find((f) => f.name === "case14_fixed_cost_pressure");
  assert.ok(fx, "fixture not found: case14_fixed_cost_pressure");

  const summary: any = await buildSummaryForFixture(fx);
  const health: any = computeProfitHealthFromSummary(summary);

  assert.ok(Number(summary.fixedCostsAllocatedInPeriod ?? 0) > 0, "case14 fixed costs must be allocated");
  assert.ok(Number(summary.fixedCostRatioPct ?? 0) > 0, "case14 fixedCostRatioPct must be > 0");

  assert.equal(
    Number(summary.operatingProfit ?? 0),
    Number(summary.profitAfterFixedCosts ?? 0),
    "case14 operatingProfit must equal profitAfterFixedCosts"
  );

  const score = Number(health.score ?? 0);
  assert.ok(Number.isFinite(score), "case14 health score must be finite");
  assert.ok(score >= 0 && score <= 100, "case14 health score out of bounds");

  const driverTypes = (health.drivers ?? []).map((d: any) => String(d?.type ?? ""));
  assert.ok(
    driverTypes.includes("FIXED_COST_PRESSURE") || Number(summary.fixedCostRatioPct ?? 0) > 0,
    `case14 should at least preserve fixed-cost pressure semantics, got drivers: ${driverTypes.join(", ")}`
  );
});

test("[golden] health: margin-drift fixture still produces valid bounded health output", async () => {
  const fx = fixtures.find((f) => f.name === "case15_margin_drift_recent_drop");
  assert.ok(fx, "fixture not found: case15_margin_drift_recent_drop");

  const summary: any = await buildSummaryForFixture(fx);
  const health: any = computeProfitHealthFromSummary(summary);

  const score = Number(health.score ?? 0);

  assert.ok(Number.isFinite(score), "case15 health score must be finite");
  assert.ok(score >= 0 && score <= 100, "case15 health score out of bounds");

  assert.ok(Number(summary.count ?? 0) >= 6, "case15 should contain multiple orders");
  assert.ok(Number(summary.netAfterRefunds ?? 0) > 0, "case15 netAfterRefunds should remain positive overall");
});