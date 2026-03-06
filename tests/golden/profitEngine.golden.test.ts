/// <reference types="node" />

import test from "node:test";
import assert from "node:assert/strict";

import { buildOrdersSummary } from "../../src/domain/profit/ordersSummary";
import { runOpportunityScenarioSimulations } from "../../src/domain/simulations/runScenarioPresets";

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
// Golden Tests (Orders Summary)
// ----------------------------
const fixtures = loadFixtures();

for (const fx of fixtures) {
  // Scenario fixture wird im separaten Scenario-Test geprüft, nicht hier
  if (fx.name === "case07_scenario_fee_minus_10pct") continue;

  test(`[golden] ${fx.name}`, async () => {
    const orders = toDomainOrders(fx);
    const costProfile = costProfileFromFixture(fx);
    const adSpend = (fx as any).costConfig.ads?.periodTotal ?? 0;

    const cogsService = makeFakeCogsService(fx);
    const unitCostByVariant = await computeUnitCostByVariantOnce({ fx, orders, cogsService });

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

    assert.ok(summary, "summary should exist");

    // must exist
    assert.equal(typeof summary.grossSales, "number");
    assert.equal(typeof summary.refunds, "number");
    assert.equal(typeof summary.netAfterRefunds, "number");
    assert.equal(typeof summary.cogs, "number");
    assert.equal(typeof summary.paymentFees, "number");
    assert.equal(typeof summary.contributionMargin, "number");

    const exp = (fx as any).expected?.ordersSummary;
    if (!exp) return;

    assert.equal(Number(summary.count), Number(exp.orders));

    assert.equal(round2(summary.grossSales), round2(exp.grossSales));
    assert.equal(round2(summary.refunds), round2(exp.refunds));
    assert.equal(round2(summary.netAfterRefunds), round2(exp.netAfterRefunds));

    if (exp.shippingRevenue != null) assert.equal(round2(summary.shippingRevenue), round2(exp.shippingRevenue));
    if (exp.shippingCost != null) assert.equal(round2(summary.shippingCost), round2(exp.shippingCost));

    if (exp.cogs != null) assert.equal(round2(summary.cogs), round2(exp.cogs));
    if (exp.paymentFees != null) assert.equal(round2(summary.paymentFees), round2(exp.paymentFees));
    if (exp.contributionMargin != null) assert.equal(round2(summary.contributionMargin), round2(exp.contributionMargin));

    if (exp.profitAfterShipping != null) assert.equal(round2(summary.profitAfterShipping), round2(exp.profitAfterShipping));
    if (exp.profitAfterAds != null) assert.equal(round2(summary.profitAfterAds), round2(exp.profitAfterAds));
    if (exp.profitAfterAdsAndShipping != null)
      assert.equal(round2(summary.profitAfterAdsAndShipping), round2(exp.profitAfterAdsAndShipping));

    if (exp.missingCogsCount != null) assert.equal(Number(summary.missingCogsCount ?? 0), Number(exp.missingCogsCount));
    if (exp.missingCogsRatePct != null) assert.equal(round2(summary.missingCogsRatePct), round2(exp.missingCogsRatePct));
    if (exp.isCogsReliable != null) assert.equal(Boolean(summary.isCogsReliable), Boolean(exp.isCogsReliable));
  });
}

// ----------------------------
// Golden Test (Scenario Simulation: fees_-10)
// ----------------------------
test("[golden] scenario fees_-10 reduces fees & increases profit", async () => {
  const fx = fixtures.find((x) => x.name === "case07_scenario_fee_minus_10pct");
  assert.ok(fx, "fixture case07_scenario_fee_minus_10pct not found");

  const orders = toDomainOrders(fx);
  const adSpend = (fx as any).costConfig.ads?.periodTotal ?? 0;

  const cogsService = makeFakeCogsService(fx);
  const unitCostByVariant = await computeUnitCostByVariantOnce({ fx, orders, cogsService });

  const baseCostProfile = costProfileFromFixture(fx);
  (baseCostProfile as any).meta = { fingerprint: `golden:${fx.name}:baseline` };

  const config = {} as any;
  const baseOverrides = {} as any;

  const opportunities = [
    {
      type: "HIGH_FEES",
      title: "High fees",
      summary: "Fees are too high",
      estimatedMonthlyLoss: 0,
      currency: "EUR",
      days: 30,
    },
  ] as any;

  const out: any = await runOpportunityScenarioSimulations({
    shop: "test-shop",
    days: 30,
    adSpend,
    orders,
    baseCostProfile,
    config,
    baseOverrides,
    cogsService: cogsService as any,
    shopifyGET: dummyShopifyGET,
    unitCostByVariant,
    opportunities,
  } as any);

  assert.ok(out?.baselineSummary, "baselineSummary missing");
  assert.ok(Array.isArray(out?.simulationsByOpportunity), "simulationsByOpportunity missing");
  assert.ok(out.simulationsByOpportunity.length === 1, "expected exactly 1 opportunity simulation");

  const simForOpp = out.simulationsByOpportunity[0];
  assert.ok(Array.isArray(simForOpp.scenarios), "scenarios missing");

  const feesMinus10 = simForOpp.scenarios.find((s: any) => s.key === "fees_-10");
  assert.ok(feesMinus10, "fees_-10 preset not found");

  const baseline = feesMinus10.result?.baseline ?? out.baselineSummary;
  const simulated = feesMinus10.result?.simulated;

  assert.ok(baseline, "baseline missing in result");
  assert.ok(simulated, "simulated missing in result");

  const baselineFees = Number(baseline.paymentFees);
  const simulatedFees = Number(simulated.paymentFees);

  assert.ok(Number.isFinite(baselineFees), "baseline paymentFees not finite");
  assert.ok(Number.isFinite(simulatedFees), "simulated paymentFees not finite");
  assert.ok(simulatedFees < baselineFees, "fees_-10 should reduce paymentFees");

  const baselineProfit = Number(baseline.profitAfterFees ?? baseline.contributionMargin);
  const simulatedProfit = Number(simulated.profitAfterFees ?? simulated.contributionMargin);

  assert.ok(Number.isFinite(baselineProfit), "baseline profit not finite");
  assert.ok(Number.isFinite(simulatedProfit), "simulated profit not finite");
  assert.ok(simulatedProfit > baselineProfit, "fees_-10 should increase profit after fees");

  // keep your hard asserts (optional)
  // assert.equal(round2(baselineFees), 2.3);
  // assert.equal(round2(simulatedFees), 2.07);
  // assert.equal(round2(baselineProfit), 57.7);
  // assert.equal(round2(simulatedProfit), 57.93);
});