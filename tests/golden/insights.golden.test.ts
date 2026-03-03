/// <reference types="node" />

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { buildOrdersSummary } from "../../src/domain/profit/ordersSummary";
import { buildProfitKillersInsights } from "../../src/domain/insights/profitKillers";

type Fixture = {
  name: string;
  costConfig: {
    feePercent: number;
    feeFixed: number;
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
};

function loadFixtures(): Fixture[] {
  const dir = path.join(process.cwd(), "tests", "golden", "fixtures");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  return files.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")));
}

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

function makeFakeCogsService(fx: Fixture) {
  return {
    async computeUnitCostsByVariant(_shopifyGET: (path: string) => Promise<any>, variantIds: number[]) {
      const m = new Map<number, number>();
      for (const id of variantIds) {
        const unitCost = Number(fx.cogs[String(id)] ?? 0);
        m.set(id, Number.isFinite(unitCost) ? unitCost : 0);
      }
      return m;
    },
  };
}

async function dummyShopifyGET(_path: string) {
  return {};
}

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
    meta: {
      fingerprint: `golden:${fx.name}:costprofile`,
    },
  } as any;
}

/**
 * Helper: compute per-order summaries (SSOT) and feed into insights.
 * This keeps insights tests independent from Shopify API and deterministic.
 */
async function computePerOrderSummaries(params: {
  fx: Fixture;
  shop: string;
  days: number;
  adSpend: number;
}) {
  const { fx, shop, days, adSpend } = params;

  const costProfile = costProfileFromFixture(fx);
  const cogsService = makeFakeCogsService(fx);

  const domainOrders = toDomainOrders(fx);

  const perOrderSummaries: any[] = [];
  let missingCogsCount = 0;

  let shippingRevenueTotal = 0;
  let shippingCostTotal = 0;

  // Optional perf fast-path: compute unit costs once per fixture
  const allVariantIds = domainOrders
    .flatMap((o: any) => (o.line_items ?? []).map((li: any) => Number(li.variant_id)))
    .filter((x: number) => Number.isFinite(x) && x > 0);

  const unitCostByVariant = await (cogsService as any).computeUnitCostsByVariant(dummyShopifyGET, allVariantIds);

  for (const o of domainOrders) {
    const s: any = await buildOrdersSummary({
      shop,
      days,
      adSpend: 0, // important: insights gets period adSpend separately; per-order adSpend would be shadow logic
      orders: [o],
      costProfile,
      cogsService: cogsService as any,
      shopifyGET: dummyShopifyGET,
      unitCostByVariant,
    });

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

function assertDeterministicRanking(items: any[]) {
  // ensure sorted by estimatedMonthlyLoss desc (stable ranking)
  for (let i = 1; i < items.length; i++) {
    const prev = Number(items[i - 1]?.estimatedMonthlyLoss ?? 0);
    const cur = Number(items[i]?.estimatedMonthlyLoss ?? 0);

    // If equal, we can't enforce tie-break unless you define one,
    // but we can at least ensure "not increasing".
    assert.ok(cur <= prev + 1e-9, `ranking not deterministic: item[${i}] loss ${cur} > previous ${prev}`);
  }
}

const fixtures = loadFixtures();

test("[golden] profitKillers insights shape + deterministic ranking", async () => {
  // We run across ALL fixtures (including scenario one is fine; it behaves like a normal order set)
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

    // NOTE: buildProfitKillersInsights expects "orders" (orderProfit-like rows).
    // We pass per-order summaries because they contain the same SSOT financial fields.
    const out: any = buildProfitKillersInsights({
      shop,
      days,
      orders: perOrderSummaries,
      products: [], // keep deterministic; product layer gets its own golden tests later
      missingCogsCount,
      adSpend,
      currentRoas: 2.0,
      shippingTotals,
      limit: 10,
    } as any);

    assert.ok(out, `profitKillers output missing for fixture ${fx.name}`);

    // it should expose items (your domain uses out.items)
    const items: any[] = (out.unifiedOpportunitiesAll?.length ? out.unifiedOpportunitiesAll : out.unifiedOpportunitiesTop5) ?? [];
   assert.ok(Array.isArray(items), `unified opportunities not array for fixture ${fx.name}`);
// HARD ranking assertions (current deterministic behavior)
if (fx.name === "case03_missing_cogs") {
  if (items.length > 0) {
    assert.equal(items[0].type, "HIGH_FEES");
  }
}

if (fx.name === "case04_shipping_subsidy") {
  if (items.length > 0) {
    assert.equal(items[0].type, "HIGH_FEES");
  }
}
    // If there are items, validate shape + deterministic ranking
    if (items.length > 0) {
      for (const it of items) {
        assert.ok(typeof it.type === "string" && it.type.length > 0, "item.type missing");
        assert.ok(typeof it.title === "string" && it.title.length > 0, "item.title missing");
        assert.ok(typeof it.summary === "string" && it.summary.length > 0, "item.summary missing");

        const loss = Number(it.estimatedMonthlyLoss);
        assert.ok(Number.isFinite(loss), "estimatedMonthlyLoss must be finite");
        assert.ok(loss >= 0, "estimatedMonthlyLoss must be >= 0");

        // actions optional but if present must be stable objects
        if (it.actions != null) {
          assert.ok(Array.isArray(it.actions), "actions must be array");
          for (const a of it.actions) {
            assert.ok(typeof a.label === "string" && a.label.length > 0, "action.label missing");
            assert.ok(typeof a.code === "string" && a.code.length > 0, "action.code missing");
          }
        }

        // meta optional
        if (it.meta != null) {
          assert.ok(typeof it.meta === "object", "meta must be object if present");
        }
      }

      assertDeterministicRanking(items);
    }
  }
});