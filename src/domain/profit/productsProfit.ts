// src/domain/profit/productsProfit.ts
import { round2 } from "../../utils/money.js";
import type { CogsService, VariantQty } from "../cogs.js";
import { extractRefundsFromOrder } from "./refunds.js";
import { allocateAdSpendForProducts, computeProfitAfterAds } from "./ads.js";

// ✅ NEW
import type { CostProfile } from "../costModel/types.js";

export async function buildProductsProfit(params: {
  shop: string;
  days: number;
  orders: any[];

  costProfile: CostProfile;

  cogsService: CogsService;
  shopifyGET: (path: string) => Promise<any>;

  // optional
  adSpend?: number;
}) {
  const { shop, days, orders, costProfile, cogsService, shopifyGET } = params;

  const orderCount = orders.length;

  const feePercent = Number(costProfile.payment.feePercent || 0);
  const feeFixed = Number(costProfile.payment.feeFixed || 0);

  // Fee base = netAfterRefunds (includes shipping revenue)
  const grossSalesTotal = orders.reduce((s: number, o: any) => s + Number(o.total_price || 0), 0);
  const refundsTotal = orders.reduce((s: number, o: any) => s + extractRefundsFromOrder(o), 0);
  const netAfterRefundsTotal = grossSalesTotal - refundsTotal;

  type Agg = {
    productId: number;
    variantId: number;
    title: string;
    variantTitle?: string;
    sku?: string;

    qty: number;
    grossSales: number;
    refundsAllocated: number;
    netSales: number;

    cogs: number;

    paymentFeesAllocated: number;
    profitAfterFees: number;
    marginPct: number;

    allocatedAdSpend?: number;
    profitAfterAds?: number;
  };

  const byKey = new Map<string, Agg>();

  const allLineItems: Array<{
    productId: number;
    variantId: number;
    qty: number;
    lineGross: number;
    title: string;
    variantTitle?: string;
    sku?: string;
  }> = [];

  for (const o of orders) {
    const items = o.line_items ?? [];

    const orderLines = items
      .map((li: any) => {
        const productId = Number(li.product_id || 0);
        const variantId = Number(li.variant_id || 0);
        const qty = Number(li.quantity || 0);

        const unitPrice = Number(li.price || 0);
        const lineGross = unitPrice * qty;

        return {
          productId,
          variantId,
          qty,
          lineGross,
          title: String(li.title ?? ""),
          variantTitle: li.variant_title ? String(li.variant_title) : undefined,
          sku: li.sku ? String(li.sku) : undefined,
        };
      })
      .filter((x: any) => x.variantId > 0 && x.qty > 0);

    const orderLinesGross = orderLines.reduce((s: number, x: any) => s + x.lineGross, 0);
    const orderRefund = extractRefundsFromOrder(o);

    for (const li of orderLines) {
      const refundAlloc = orderLinesGross > 0 ? (li.lineGross / orderLinesGross) * orderRefund : 0;
      const net = li.lineGross - refundAlloc;

      const key = `${li.productId}:${li.variantId}`;
      const cur =
        byKey.get(key) ??
        ({
          productId: li.productId,
          variantId: li.variantId,
          title: li.title,
          variantTitle: li.variantTitle,
          sku: li.sku,

          qty: 0,
          grossSales: 0,
          refundsAllocated: 0,
          netSales: 0,

          cogs: 0,

          paymentFeesAllocated: 0,
          profitAfterFees: 0,
          marginPct: 0,
        } as Agg);

      cur.qty += li.qty;
      cur.grossSales += li.lineGross;
      cur.refundsAllocated += refundAlloc;
      cur.netSales += net;

      byKey.set(key, cur);

      allLineItems.push({
        productId: li.productId,
        variantId: li.variantId,
        qty: li.qty,
        lineGross: li.lineGross,
        title: li.title,
        variantTitle: li.variantTitle,
        sku: li.sku,
      });
    }
  }

  // COGS compute once per variant aggregation
  const variantQtyForCogs: VariantQty[] = allLineItems.map((x) => ({
    variantId: x.variantId,
    qty: x.qty,
  }));

  const cogsByVariant = await cogsService.computeCogsByVariant(shopifyGET, variantQtyForCogs);

  for (const p of byKey.values()) {
    p.cogs = cogsByVariant.get(p.variantId) ?? 0;
  }

  // Allocate payment fees by netSales share
  const totalNetSales = Array.from(byKey.values()).reduce((s, p) => s + p.netSales, 0);

  const paymentFeesTotal = netAfterRefundsTotal * feePercent + orderCount * feeFixed;

  for (const p of byKey.values()) {
    const feeAlloc = totalNetSales > 0 ? (p.netSales / totalNetSales) * paymentFeesTotal : 0;
    p.paymentFeesAllocated = feeAlloc;

    const profitAfterFees = p.netSales - p.cogs - feeAlloc;
    p.profitAfterFees = profitAfterFees;

    p.marginPct = p.netSales > 0 ? (profitAfterFees / p.netSales) * 100 : 0;
  }

  // Ad spend allocation (optional)
  const spend = Number(params.adSpend ?? 0);
  if (Number.isFinite(spend) && spend > 0) {
    const allocated = allocateAdSpendForProducts({
      rows: Array.from(byKey.values()).map((p) => ({ ...p })),
      adSpend: spend,
    });

    byKey.clear();
    for (const p of allocated) {
      p.allocatedAdSpend = p.allocatedAdSpend ?? 0;
      p.profitAfterAds = computeProfitAfterAds({
        profitBeforeAds: p.profitAfterFees,
        allocatedAdSpend: p.allocatedAdSpend,
      });
      byKey.set(`${p.productId}:${p.variantId}`, p);
    }
  }

  const products = Array.from(byKey.values())
    .map((p) => ({
      productId: p.productId,
      variantId: p.variantId,
      title: p.title,
      variantTitle: p.variantTitle ?? null,
      sku: p.sku ?? null,

      qty: p.qty,

      grossSales: round2(p.grossSales),
      refundsAllocated: round2(p.refundsAllocated),
      netSales: round2(p.netSales),

      cogs: round2(p.cogs),

      paymentFeesAllocated: round2(p.paymentFeesAllocated),
      profitAfterFees: round2(p.profitAfterFees),
      marginPct: round2(p.marginPct),

      allocatedAdSpend: p.allocatedAdSpend !== undefined ? round2(p.allocatedAdSpend) : undefined,
      profitAfterAds: p.profitAfterAds !== undefined ? round2(p.profitAfterAds) : undefined,
    }))
    .sort((a: any, b: any) => {
      const av = a.profitAfterAds ?? a.profitAfterFees;
      const bv = b.profitAfterAds ?? b.profitAfterFees;
      return av - bv;
    });

  const topWinners = [...products]
    .sort((a: any, b: any) => (b.profitAfterAds ?? b.profitAfterFees) - (a.profitAfterAds ?? a.profitAfterFees))
    .slice(0, 3);

  const topLosers = [...products]
    .sort((a: any, b: any) => (a.profitAfterAds ?? a.profitAfterFees) - (b.profitAfterAds ?? b.profitAfterFees))
    .slice(0, 3);

  const missingCogs = products
    .filter((p: any) => p.cogs === 0 && p.qty > 0 && p.netSales > 0)
    .map((p: any) => ({
      productId: p.productId,
      variantId: p.variantId,
      title: p.title,
      variantTitle: p.variantTitle,
      sku: p.sku,
      qty: p.qty,
      netSales: p.netSales,
    }));

  return {
    shop,
    days,
    orderCount,
    totals: {
      totalNetSales: round2(totalNetSales),
      paymentFeesTotal: round2(paymentFeesTotal),
      uniqueVariants: products.length,
      adSpend: Number.isFinite(spend) ? round2(spend) : undefined,
    },
    highlights: {
      topWinners,
      topLosers,
      missingCogsCount: missingCogs.length,
      missingCogs: missingCogs.slice(0, 20),
    },
    products,
  };
}
