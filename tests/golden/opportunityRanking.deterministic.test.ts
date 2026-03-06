/// <reference types="node" />

import test from "node:test";
import assert from "node:assert/strict";

import { buildOrdersSummary } from "../../src/domain/profit/ordersSummary";
import { buildProfitKillersInsights } from "../../src/domain/insights/profitKillers";

import {
  loadFixtures,
  toDomainOrders,
  makeFakeCogsService,
  costProfileFromFixture,
  dummyShopifyGET,
  computeUnitCostByVariantOnce,
} from "./_helpers";

async function computePerOrderSummaries(params: {
  fx: any;
  shop: string;
  days: number;
  adSpend: number;
}) {
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

    perOrderSummaries.push({
      ...s,
      id: String(o.id),
      name: o.name ?? String(o.id),
      createdAt: o.createdAt ?? o.created_at,
      created_at: o.created_at ?? o.createdAt,
      currency: o.currency ?? s.currency ?? "USD",
    });

    missingCogsCount += Number(s.missingCogsCount ?? 0);
    shippingRevenueTotal += Number(s.shippingRevenue ?? 0);
    shippingCostTotal += Number(s.shippingCost ?? 0);
  }

  return {
    perOrderSummaries,
    missingCogsCount,
    shippingTotals: {
      revenue: shippingRevenueTotal,
      cost: shippingCostTotal,
    },
  };
}

test("[golden] opportunity ranking is deterministic", async () => {
  const fixtures = loadFixtures();

  const fx = fixtures.find((f) => f.name === "case14_fixed_cost_pressure");
  assert.ok(fx, "fixture not found: case14_fixed_cost_pressure");

  const shop = "test-shop";
  const days = 30;
  const adSpend = fx.costConfig.ads?.periodTotal ?? 0;

  const { perOrderSummaries, missingCogsCount, shippingTotals } =
    await computePerOrderSummaries({
      fx,
      shop,
      days,
      adSpend,
    });

  const fixedCosts = {
    lossInPeriod: Number(
      perOrderSummaries.reduce(
        (s, x) => s + Number(x?.fixedCostsAllocatedInPeriod ?? 0),
        0
      )
    ),
    fixedCostRatePct: Number(perOrderSummaries[0]?.fixedCostRatioPct ?? 0),
  };

  const results: string[] = [];

  for (let i = 0; i < 5; i++) {
    const out: any = buildProfitKillersInsights({
      shop,
      days,
      orders: perOrderSummaries,
      products: [],
      missingCogsCount,
      adSpend,
      currentRoas: 2.0,
      shippingTotals,
      fixedCosts,
      limit: 10,
    } as any);

    results.push(JSON.stringify(out.unifiedOpportunitiesAll ?? []));
  }

  for (let i = 1; i < results.length; i++) {
    assert.equal(
      results[i],
      results[0],
      `unified opportunities changed between run 0 and run ${i}`
    );
  }
});