/// <reference types="node" />

import fs from "node:fs";
import path from "node:path";

export type Fixture = {
  name: string;

  costConfig: {
    feePercent: number;
    feeFixed: number;
    shipping?: { costPerOrder?: number };
    flags?: { includeShippingCost?: boolean; excludeGiftCards?: boolean };
    ads?: { periodTotal?: number };
  };

  /**
   * Optional fixed-cost support for golden fixtures.
   * This is test-only schema support that maps into costProfile.derived/fixedCosts.
   */
  fixedCosts?: {
    monthlyTotal?: number;
    daysInMonth?: number;
    allocationMode?: "PER_ORDER" | "BY_NET_SALES";
  };

  orders: Array<{
    id: string;
    name?: string;
    createdAt: string;
    currency: string;

    lineItems: Array<{
      variantId: number;
      qty: number;
      unitPrice: number;

      /**
       * Allows mixed orders with both physical and gift-card line items.
       * This is test-only schema support.
       */
      giftCard?: boolean;
    }>;

    shippingRevenue?: number;

    // legacy simple refund
    refunds?: number;

    // advanced: refund split into multiple transactions
    refundTransactions?: number[];

    // legacy order-wide shortcut:
    // mark all line items as gift cards
    giftCardOnly?: boolean;
  }>;

  cogs: Record<string, number>;

  expected?: any;
};

export function round2(n: number) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

export function loadFixtures(): Fixture[] {
  const dir = path.join(process.cwd(), "tests", "golden", "fixtures");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"));
  return files.map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8")));
}

export async function dummyShopifyGET(_path: string) {
  return {};
}

export function costProfileFromFixture(fx: Fixture) {
  return {
    payment: {
      feePercent: fx.costConfig.feePercent,
      feeFixed: fx.costConfig.feeFixed,
    },
    shipping: {
      costPerOrder: fx.costConfig.shipping?.costPerOrder ?? 0,
    },
    fixedCosts: fx.fixedCosts
      ? {
          daysInMonth: fx.fixedCosts.daysInMonth ?? 30,
          allocationMode: fx.fixedCosts.allocationMode ?? "PER_ORDER",
        }
      : undefined,
    derived: fx.fixedCosts
      ? {
          fixedCostsMonthlyTotal: fx.fixedCosts.monthlyTotal ?? 0,
        }
      : undefined,
    flags: {
      includeShippingCost: fx.costConfig.flags?.includeShippingCost ?? true,
      excludeGiftCards: fx.costConfig.flags?.excludeGiftCards ?? false,
    },
    meta: {
      fingerprint: `golden:${fx.name}:costprofile`,
    },
  } as any;
}

export function makeFakeCogsService(fx: Fixture) {
  return {
    async computeUnitCostsByVariant(_shopifyGET: (path: string) => Promise<any>, variantIds: number[]) {
      const m = new Map<number, number | undefined>();

      for (const id of variantIds) {
        const key = String(id);
        const hasKey = Object.prototype.hasOwnProperty.call(fx.cogs, key);

        if (!hasKey) {
          m.set(id, undefined);
          continue;
        }

        const unitCostRaw = (fx.cogs as any)[key];
        const unitCost = Number(unitCostRaw);
        m.set(id, Number.isFinite(unitCost) ? unitCost : undefined);
      }

      return m;
    },
  };
}

export function toDomainOrders(fx: Fixture) {
  return fx.orders.map((o) => {
    const totalPrice = o.lineItems.reduce((s, li) => s + li.qty * li.unitPrice, 0);

    const refundsAmount =
      Array.isArray(o.refundTransactions) && o.refundTransactions.length > 0
        ? o.refundTransactions.reduce((s, x) => s + Number(x || 0), 0)
        : Number(o.refunds || 0);

    const refunds =
      refundsAmount > 0
        ? [
            {
              transactions:
                Array.isArray(o.refundTransactions) && o.refundTransactions.length > 0
                  ? o.refundTransactions.map((amt) => ({ amount: String(amt) }))
                  : [{ amount: String(refundsAmount) }],
            },
          ]
        : [];

    /**
     * Gift-card mapping:
     * - legacy shortcut: giftCardOnly=true => ALL line items gift_card:true
     * - line-level support: li.giftCard=true => only that line is a gift card
     */
    const line_items = o.lineItems.map((li) => ({
      variant_id: li.variantId,
      quantity: li.qty,
      price: String(li.unitPrice),
      ...((o.giftCardOnly || li.giftCard === true) ? { gift_card: true } : {}),
    }));

    return {
      id: o.id,
      name: o.name ?? o.id,
      created_at: o.createdAt,
      createdAt: o.createdAt,
      currency: o.currency,
      total_price: String(totalPrice),
      line_items,
      refunds,
      shipping_lines: [{ price: String(o.shippingRevenue ?? 0) }],
    };
  });
}

export async function computeUnitCostByVariantOnce(params: {
  fx: Fixture;
  orders: any[];
  cogsService: any;
}) {
  const { orders, cogsService } = params;

  const allVariantIds = orders
    .flatMap((o: any) => (o.line_items ?? []).map((li: any) => Number(li.variant_id)))
    .filter((x: number) => Number.isFinite(x) && x > 0);

  return (cogsService as any).computeUnitCostsByVariant(dummyShopifyGET, allVariantIds);
}