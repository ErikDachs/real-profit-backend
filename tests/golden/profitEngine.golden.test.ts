/// <reference types="node" />

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { buildOrdersSummary } from "../../src/domain/profit/ordersSummary";
import { runOpportunityScenarioSimulations } from "../../src/domain/simulations/runScenarioPresets";

// ----------------------------
// Fixture Types
// ----------------------------
type Fixture = {
  name: string;
  costConfig: {
    feePercent: number; // 0.02 = 2%
    feeFixed: number; // 0.30
    shipping?: { costPerOrder?: number };
    flags?: { includeShippingCost?: boolean };
    ads?: { periodTotal?: number };
  };

  orders: Array<{
    id: string;
    name?: string;
    createdAt: string;
    currency: string;
    lineItems: Array<{ variantId: number; qty: number; unitPrice: number }>;
    shippingRevenue?: number;
    refunds?: number;
  }>;

  cogs: Record<string, number>;

  expected?: {
    ordersSummary?: {
      orders: number;
      grossSales: number;
      refunds: number;
      netAfterRefunds: number;

      shippingRevenue?: number;
      shippingCost?: number;

      cogs?: number;
      paymentFees?: number;

      contributionMargin?: number;

      profitAfterShipping?: number;
      profitAfterAds?: number;
      profitAfterAdsAndShipping?: number;

      missingCogsCount?: number;
    };
  };
};

// ----------------------------
// Helpers
// ----------------------------
function round2(n: number) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

function loadFixtures(): Fixture[] {
  const dir = path.join(process.cwd(), "tests", "golden", "fixtures");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  return files.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")));
}

/**
 * ordersSummary nutzt:
 * - order.total_price
 * - order.line_items[].variant_id, quantity, price
 * - order.refunds[].transactions[].amount
 * - order.shipping_lines[].price
 */
function toDomainOrders(fx: Fixture) {
  return fx.orders.map((o) => {
    const totalPrice = o.lineItems.reduce((s, li) => s + li.qty * li.unitPrice, 0);

    return {
      id: o.id,
      name: o.name ?? o.id,
      created_at: o.createdAt,
      createdAt: o.createdAt,
      currency: o.currency,

      total_price: String(totalPrice),

      line_items: o.lineItems.map((li) => ({
        variant_id: li.variantId,
        quantity: li.qty,
        price: String(li.unitPrice),
      })),

      refunds: o.refunds
        ? [
            {
              transactions: [{ amount: String(o.refunds) }],
            },
          ]
        : [],

      shipping_lines: [{ price: String(o.shippingRevenue ?? 0) }],
    };
  });
}

/**
 * FakeCogsService: deterministisch aus fx.cogs
 */
function makeFakeCogsService(fx: Fixture) {
  return {
    async computeUnitCostsByVariant(_shopifyGET: (path: string) => Promise<any>, variantIds: number[]) {
      const m = new Map<number, number | undefined>();

      for (const id of variantIds) {
        const key = String(id);

        // ✅ Missing key => unknown cost
        const hasKey = Object.prototype.hasOwnProperty.call(fx.cogs, key);
        if (!hasKey) {
          m.set(id, undefined);
          continue;
        }

        // ✅ Explicit values (including 0) are respected
        const unitCostRaw = (fx.cogs as any)[key];
        const unitCost = Number(unitCostRaw);

        m.set(id, Number.isFinite(unitCost) ? unitCost : undefined);
      }

      return m;
    },
  };
}

async function dummyShopifyGET(_path: string) {
  return {};
}

/**
 * Minimal CostProfile stub for ordersSummary
 * (shape matches what ordersSummary reads: payment/shipping/flags)
 */
function costProfileFromFixture(fx: Fixture) {
  return {
    payment: {
      feePercent: fx.costConfig.feePercent,
      feeFixed: fx.costConfig.feeFixed,
    },
    shipping: {
      costPerOrder: fx.costConfig.shipping?.costPerOrder ?? 0,
    },
    flags: {
      includeShippingCost: fx.costConfig.flags?.includeShippingCost ?? true,
    },

    // keep extra fields harmless if required by broader CostProfile type
    ads: {
      // the ordersSummary code does not read these fields; only included for type completeness
      allocationMode: "PERIOD_TOTAL",
    },
    meta: {
      fingerprint: "test-fingerprint-orders-summary",
    },
  } as any;
}

/**
 * Minimal "ResolvedCostProfile" stub for simulations.
 * runOpportunityScenarioSimulations only needs:
 * - baseCostProfile.meta.fingerprint
 * - baseCostProfile.payment/shipping/flags used by scenarioToCostOverrides(...)
 */
function resolvedBaseProfileFromFixture(fx: Fixture) {
  const baseCostProfile = {
    payment: {
      feePercent: fx.costConfig.feePercent,
      feeFixed: fx.costConfig.feeFixed,
    },
    shipping: {
      costPerOrder: fx.costConfig.shipping?.costPerOrder ?? 0,
    },
    flags: {
      includeShippingCost: fx.costConfig.flags?.includeShippingCost ?? true,
    },
    meta: {
      fingerprint: `golden:${fx.name}:baseline`,
    },
  } as any;

  // config/baseOverrides are required params, but for this golden test
  // they only need to be "something" deterministic.
  const config = {} as any;
  const baseOverrides = {} as any;

  return { baseCostProfile, config, baseOverrides };
}

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
    const adSpend = fx.costConfig.ads?.periodTotal ?? 0;

    const summary: any = await buildOrdersSummary({
      shop: "test-shop",
      days: 30,
      adSpend,
      orders,
      costProfile,
      cogsService: makeFakeCogsService(fx) as any,
      shopifyGET: dummyShopifyGET,
    });

    assert.ok(summary, "summary should exist");

    // must exist
    assert.equal(typeof summary.grossSales, "number");
    assert.equal(typeof summary.refunds, "number");
    assert.equal(typeof summary.netAfterRefunds, "number");
    assert.equal(typeof summary.cogs, "number");
    assert.equal(typeof summary.paymentFees, "number");
    assert.equal(typeof summary.contributionMargin, "number");

    // optional expected checks
    const exp = fx.expected?.ordersSummary;
    if (!exp) return;

    assert.equal(summary.count, exp.orders);

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

    if (exp.missingCogsCount != null) {
      assert.equal((summary as any).missingCogsCount, exp.missingCogsCount);
    }
  });
}

// ----------------------------
// Golden Test (Scenario Simulation: fees_-10)
// ----------------------------
test("[golden] scenario fees_-10 reduces fees & increases profit", async () => {
  const fx = fixtures.find((x) => x.name === "case07_scenario_fee_minus_10pct");
  assert.ok(fx, "fixture case07_scenario_fee_minus_10pct not found");

  const orders = toDomainOrders(fx);
  const adSpend = fx.costConfig.ads?.periodTotal ?? 0;

  const fakeCogsService = makeFakeCogsService(fx);

  const { baseCostProfile, config, baseOverrides } = resolvedBaseProfileFromFixture(fx);

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
    cogsService: fakeCogsService as any,
    shopifyGET: dummyShopifyGET,
    unitCostByVariant: undefined,
    opportunities,
  });

  assert.ok(out?.baselineSummary, "baselineSummary missing");
  assert.ok(Array.isArray(out?.simulationsByOpportunity), "simulationsByOpportunity missing");
  assert.ok(out.simulationsByOpportunity.length === 1, "expected exactly 1 opportunity simulation");

  const simForOpp = out.simulationsByOpportunity[0];
  assert.ok(Array.isArray(simForOpp.scenarios), "scenarios missing");

  // Hard assert preset key exists (from scenarioPresets.ts)
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

  // HARD Golden Assertions (case07_scenario_fee_minus_10pct)

assert.equal(Math.round(baselineFees * 100) / 100, 2.3);
assert.equal(Math.round(simulatedFees * 100) / 100, 2.07);

assert.equal(Math.round(baselineProfit * 100) / 100, 57.7);
assert.equal(Math.round(simulatedProfit * 100) / 100, 57.93);
});