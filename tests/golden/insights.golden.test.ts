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

const fixtures = loadFixtures();

function hasType(items: any[], type: string) {
  return items.some((x) => String(x?.type ?? "") === type);
}

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
    shippingTotals: { revenue: shippingRevenueTotal, cost: shippingCostTotal },
  };
}

function assertDeterministicRanking(items: any[], label: string) {
  for (let i = 1; i < items.length; i++) {
    const prevLoss = Number(items[i - 1]?.estimatedMonthlyLoss ?? 0);
    const curLoss = Number(items[i]?.estimatedMonthlyLoss ?? 0);

    assert.ok(
      curLoss <= prevLoss + 1e-9,
      `${label}: ranking not deterministic at i=${i} (${curLoss} > ${prevLoss})`
    );
  }
}

test("[golden] profitKillers insights: shape + deterministic ranking", async () => {
  for (const fx of fixtures) {
    const shop = "test-shop";
    const days = 30;
    const adSpend = fx.costConfig.ads?.periodTotal ?? 0;

    const { perOrderSummaries, missingCogsCount, shippingTotals } = await computePerOrderSummaries({
      fx,
      shop,
      days,
      adSpend,
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

    const items: any[] =
      (out.unifiedOpportunitiesAll?.length ? out.unifiedOpportunitiesAll : out.unifiedOpportunitiesTop5) ?? [];

    assert.ok(Array.isArray(items), `unified opportunities not array for fixture ${fx.name}`);

    if (items.length > 0) {
      for (const it of items) {
        assert.ok(typeof it.type === "string" && it.type.length > 0, `${fx.name}: item.type missing`);
        assert.ok(typeof it.title === "string" && it.title.length > 0, `${fx.name}: item.title missing`);
        assert.ok(typeof it.summary === "string" && it.summary.length > 0, `${fx.name}: item.summary missing`);

        const loss = Number(it.estimatedMonthlyLoss);
        assert.ok(Number.isFinite(loss), `${fx.name}: estimatedMonthlyLoss must be finite`);
        assert.ok(loss >= 0, `${fx.name}: estimatedMonthlyLoss must be >= 0`);

        if (it.actions != null) {
          assert.ok(Array.isArray(it.actions), `${fx.name}: actions must be array`);
          for (const a of it.actions) {
            assert.ok(typeof a.label === "string" && a.label.length > 0, `${fx.name}: action.label missing`);
            assert.ok(typeof a.code === "string" && a.code.length > 0, `${fx.name}: action.code missing`);
          }
        }

        if (it.meta != null) {
          assert.ok(typeof it.meta === "object", `${fx.name}: meta must be object if present`);
          assert.ok(typeof it.meta.why === "string" && it.meta.why.length > 0, `${fx.name}: meta.why missing`);
          assert.ok(it.meta.evidence && typeof it.meta.evidence === "object", `${fx.name}: meta.evidence missing`);
        }
      }

      assertDeterministicRanking(items, fx.name);
    }
  }
});

test("[golden] insights: over-refund case surfaces a severe loss opportunity", async () => {
  const fx = fixtures.find((f) => f.name === "case10_over_refund_negative_net");
  assert.ok(fx, "fixture not found: case10_over_refund_negative_net");

  const shop = "test-shop";
  const days = 30;
  const adSpend = fx.costConfig.ads?.periodTotal ?? 0;

  const { perOrderSummaries, missingCogsCount, shippingTotals } = await computePerOrderSummaries({
    fx,
    shop,
    days,
    adSpend,
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

  const items: any[] = out.unifiedOpportunitiesAll ?? [];

  const totalRefunds = perOrderSummaries.reduce((s, x) => s + Number(x?.refunds ?? 0), 0);
  const totalGross = perOrderSummaries.reduce((s, x) => s + Number(x?.grossSales ?? 0), 0);

  assert.ok(totalRefunds > 0, "case10 fixture broken: refunds must be > 0");
  assert.ok(totalRefunds > totalGross, "case10 fixture broken: refunds should exceed gross sales");
  assert.ok(items.length > 0, "case10 should produce at least one unified opportunity");

  const types = items.map((x) => String(x?.type ?? ""));
  const hasRefundLikeSignal =
    types.includes("HIGH_REFUNDS") ||
    types.includes("NEGATIVE_CM") ||
    types.includes("LOW_MARGIN");

  assert.ok(
    hasRefundLikeSignal,
    `case10 should surface a severe refund/economics signal, got: ${types.join(", ")}`
  );
});
test("[golden] insights: mixed gift-card/physical case does not create fake missing-COGS opportunity", async () => {
  const fx = fixtures.find((f) => f.name === "case11_mixed_gift_card_and_physical");
  assert.ok(fx, "fixture not found: case11_mixed_gift_card_and_physical");

  const shop = "test-shop";
  const days = 30;
  const adSpend = fx.costConfig.ads?.periodTotal ?? 0;

  const { perOrderSummaries, missingCogsCount, shippingTotals } = await computePerOrderSummaries({
    fx,
    shop,
    days,
    adSpend,
  });

  assert.equal(missingCogsCount, 0, "case11 missingCogsCount should stay 0");

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

  const items: any[] = out.unifiedOpportunitiesAll ?? [];
  assert.ok(!hasType(items, "MISSING_COGS"), "case11 must not create fake MISSING_COGS opportunity");
});

test("[golden] insights: partial-missing-COGS case preserves missing-COGS signal", async () => {
  const fx = fixtures.find((f) => f.name === "case12_partial_missing_cogs_multi_line");
  assert.ok(fx, "fixture not found: case12_partial_missing_cogs_multi_line");

  const shop = "test-shop";
  const days = 30;
  const adSpend = fx.costConfig.ads?.periodTotal ?? 0;

  const { perOrderSummaries, missingCogsCount, shippingTotals } = await computePerOrderSummaries({
    fx,
    shop,
    days,
    adSpend,
  });

  assert.ok(missingCogsCount > 0, "case12 must preserve missing COGS signal");

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

  // Current contract:
  // Missing COGS must survive into the insight payload/highlights.
  // A unified opportunity is only guaranteed if there is also a positive monetized loss.
  assert.equal(
    Number(out?.highlights?.missingCogsCount ?? 0),
    Number(missingCogsCount),
    "case12 highlights.missingCogsCount must preserve the missing-COGS signal"
  );

  // Optional stronger check:
  // If the ranking currently decides to emit MISSING_COGS, fine.
  // But we do NOT require it unless monetized missing-COGS loss is present.
  const items: any[] = out.unifiedOpportunitiesAll ?? [];
  if (items.length > 0) {
    assert.ok(
      items.every((x) => typeof x?.type === "string" && x.type.length > 0),
      "case12 unified items must have valid types"
    );
  }
});

test("[golden] insights: fixed-cost-pressure case preserves fixed-cost signal", async () => {
  const fx = fixtures.find((f) => f.name === "case14_fixed_cost_pressure");
  assert.ok(fx, "fixture not found: case14_fixed_cost_pressure");

  const shop = "test-shop";
  const days = 30;
  const adSpend = fx.costConfig.ads?.periodTotal ?? 0;

  const { perOrderSummaries, missingCogsCount, shippingTotals } = await computePerOrderSummaries({
    fx,
    shop,
    days,
    adSpend,
  });

  const fixedCosts = {
    lossInPeriod: Number(perOrderSummaries.reduce((s, x) => s + Number(x?.fixedCostsAllocatedInPeriod ?? 0), 0)),
    fixedCostRatePct: Number(perOrderSummaries[0]?.fixedCostRatioPct ?? 0),
  };

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

  assert.ok(Number(fixedCosts.lossInPeriod) > 0, "case14 fixedCosts.lossInPeriod must be > 0");

  const items: any[] = out.unifiedOpportunitiesAll ?? [];
  const types = items.map((x) => String(x?.type ?? ""));

  assert.ok(
    types.includes("HIGH_FIXED_COST_LOAD") || types.includes("OPERATING_LEVERAGE_RISK"),
    `case14 should preserve fixed-cost opportunity signal, got: ${types.join(", ")}`
  );
});

test("[golden] insights: margin-drift case preserves deteriorating margin signal", async () => {
  const fx = fixtures.find((f) => f.name === "case15_margin_drift_recent_drop");
  assert.ok(fx, "fixture not found: case15_margin_drift_recent_drop");

  const shop = "test-shop";
  const days = 30;
  const adSpend = fx.costConfig.ads?.periodTotal ?? 0;

  const { perOrderSummaries, missingCogsCount, shippingTotals } = await computePerOrderSummaries({
    fx,
    shop,
    days,
    adSpend,
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

  assert.ok(out, "case15 insights output missing");

const insights: any[] = Array.isArray(out.insights) ? out.insights : [];
const marginDrift = insights.find((x) => String(x?.type ?? "") === "marginDrift");

assert.ok(marginDrift, "case15 should produce marginDrift insight");
assert.equal(
  String(marginDrift.status ?? ""),
  "DETERIORATING",
  "case15 marginDrift should be DETERIORATING"
);

  const items: any[] = out.unifiedOpportunitiesAll ?? [];
  const types = items.map((x) => String(x?.type ?? ""));

  assert.ok(
    types.includes("MARGIN_DRIFT"),
    `case15 should preserve MARGIN_DRIFT into unified opportunities, got: ${types.join(", ")}`
  );
});