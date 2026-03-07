import { round2 } from "../../utils/money.js";
import type { CogsService, VariantQty } from "../cogs.js";
import { extractRefundsFromOrder } from "./refunds.js";
import { allocateAdSpendForProducts, computeProfitAfterAds } from "./ads.js";
import { isMissingUnitCost } from "./cogsGovernance.js";
import type { CostProfile } from "../costModel/types.js";

function toNum(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseGidToId(maybeGid: any): number {
  if (typeof maybeGid !== "string") return toNum(maybeGid);
  const m = maybeGid.match(/(\d+)\s*$/);
  return m ? toNum(m[1]) : 0;
}

function parseStrictBool(v: any): boolean {
  if (v === true) return true;
  if (v === false || v == null) return false;

  if (typeof v === "number") return v === 1;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "1") return true;
    if (s === "false" || s === "0" || s === "") return false;
  }

  return false;
}

function isGiftCardLike(li: any): boolean {
  if (parseStrictBool(li?.gift_card ?? li?.giftCard ?? false)) return true;

  const title = String(li?.title ?? li?.name ?? "").trim().toLowerCase();
  const variantTitle = String(li?.variant_title ?? li?.variantTitle ?? li?.variant?.title ?? "").trim().toLowerCase();

  // harte Realität:
  // dein GraphQL-Normalizer liefert derzeit Gift Cards nicht als gift_card=true mit,
  // daher brauchen wir diese defensive Erkennung, sonst leakst du Gift Cards wieder
  // in die operative Produktprofit-Welt.
  if (title === "gift card") return true;
  if (title.includes("gift card")) return true;
  if (variantTitle.includes("gift card")) return true;

  return false;
}

function readMoneyAmount(v: any): number {
  if (v == null) return 0;

  if (typeof v === "number" || typeof v === "string") {
    return toNum(v);
  }

  return (
    toNum(v?.amount) ||
    toNum(v?.shopMoney?.amount) ||
    toNum(v?.presentmentMoney?.amount) ||
    toNum(v?.shop_money?.amount) ||
    toNum(v?.presentment_money?.amount) ||
    0
  );
}

function extractUnitPrice(li: any): number {
  return (
    toNum(li?.price) ||
    readMoneyAmount(li?.originalUnitPriceSet) ||
    readMoneyAmount(li?.discountedUnitPriceSet) ||
    readMoneyAmount(li?.originalUnitPrice) ||
    readMoneyAmount(li?.discountedUnitPrice) ||
    toNum(li?.variant?.price) ||
    0
  );
}

type NormalizedLine = {
  productId: number;
  variantId: number;
  qty: number;
  lineGross: number;
  title: string;
  variantTitle?: string;
  sku?: string;
};

function normalizeLineItem(li: any): NormalizedLine | null {
  if (!li || isGiftCardLike(li)) return null;

  const productId =
    toNum(li?.product_id) ||
    toNum(li?.productId) ||
    parseGidToId(li?.product?.id) ||
    0;

  const variantId =
    toNum(li?.variant_id) ||
    toNum(li?.variantId) ||
    parseGidToId(li?.variant?.id) ||
    parseGidToId(li?.variantId) ||
    0;

  const qty =
    toNum(li?.quantity) ||
    toNum(li?.qty) ||
    toNum(li?.currentQuantity) ||
    0;

  const unitPrice = extractUnitPrice(li);
  const lineGross = unitPrice * qty;

  if (!(variantId > 0) || !(qty > 0)) return null;

  return {
    productId,
    variantId,
    qty,
    lineGross,
    title: String(li?.title ?? li?.name ?? ""),
    variantTitle:
      li?.variant_title != null
        ? String(li.variant_title)
        : li?.variantTitle != null
          ? String(li.variantTitle)
          : li?.variant?.title != null
            ? String(li.variant.title)
            : undefined,
    sku:
      li?.sku != null
        ? String(li.sku)
        : li?.variant?.sku != null
          ? String(li.variant.sku)
          : undefined,
  };
}

function collectRawLineItems(order: any): any[] {
  const out: any[] = [];

  if (Array.isArray(order?.line_items)) out.push(...order.line_items);
  if (Array.isArray(order?.lineItems)) out.push(...order.lineItems);

  if (Array.isArray(order?.lineItems?.nodes)) out.push(...order.lineItems.nodes);
  if (Array.isArray(order?.line_items?.nodes)) out.push(...order.line_items.nodes);

  if (Array.isArray(order?.lineItems?.edges)) {
    for (const e of order.lineItems.edges) out.push(e?.node ?? e);
  }

  if (Array.isArray(order?.line_items?.edges)) {
    for (const e of order.line_items.edges) out.push(e?.node ?? e);
  }

  return out;
}

function extractOrderLines(order: any): NormalizedLine[] {
  return collectRawLineItems(order)
    .map(normalizeLineItem)
    .filter((x): x is NormalizedLine => x !== null);
}

export async function buildProductsProfit(params: {
  shop: string;
  days: number;
  orders: any[];

  costProfile: CostProfile;

  cogsService: CogsService;
  shopifyGET: (path: string) => Promise<any>;

  adSpend?: number;

  /**
   * Optional fast path / governance alignment
   */
  unitCostByVariant?: Map<number, number | undefined>;
  isIgnoredVariant?: (variantId: number) => boolean;
}) {
  const {
    shop,
    days,
    orders,
    costProfile,
    cogsService,
    shopifyGET,
    unitCostByVariant: unitCostByVariantInput,
    isIgnoredVariant,
  } = params;

  const orderCount = orders.length;

  const feePercent = Number(costProfile.payment.feePercent || 0);
  const feeFixed = Number(costProfile.payment.feeFixed || 0);

  // Fee base bleibt wie bisher auf Order-Level-Netto.
  // Das ist nicht perfekt, aber wir ändern hier NICHT stillschweigend das ökonomische Modell.
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
    hasMissingCogs: boolean;

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
    const orderLines = extractOrderLines(o);

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
          hasMissingCogs: false,

          paymentFeesAllocated: 0,
          profitAfterFees: 0,
          marginPct: 0,
        } as Agg);

      cur.qty += li.qty;
      cur.grossSales += li.lineGross;
      cur.refundsAllocated += refundAlloc;
      cur.netSales += net;

      // deterministic first-non-empty metadata wins
      if (!cur.title && li.title) cur.title = li.title;
      if (!cur.variantTitle && li.variantTitle) cur.variantTitle = li.variantTitle;
      if (!cur.sku && li.sku) cur.sku = li.sku;

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

  const variantQtyForCogs: VariantQty[] = allLineItems.map((x) => ({
    variantId: x.variantId,
    qty: x.qty,
  }));

  const variantIds = Array.from(
    new Set(
      variantQtyForCogs
        .map((x) => x.variantId)
        .filter((x) => Number.isFinite(x) && x > 0)
    )
  );

  const unitCostByVariant =
    unitCostByVariantInput ??
    (variantIds.length > 0 && typeof (cogsService as any).computeUnitCostsByVariant === "function"
      ? await (cogsService as any).computeUnitCostsByVariant(shopifyGET, variantIds)
      : new Map<number, number | undefined>());

  const hasUnitCostSupport =
    unitCostByVariantInput instanceof Map ||
    typeof (cogsService as any).computeUnitCostsByVariant === "function";

  const cogsByVariant = await cogsService.computeCogsByVariant(shopifyGET, variantQtyForCogs);

  for (const p of byKey.values()) {
    p.cogs = cogsByVariant.get(p.variantId) ?? 0;

    // Nur dann echte Missing-COGS-Governance anwenden,
    // wenn wir auch echte Unit-Cost-Daten haben.
    p.hasMissingCogs = hasUnitCostSupport
      ? isMissingUnitCost({
          unitCost: unitCostByVariant.get(p.variantId),
          variantId: p.variantId,
          isIgnoredVariant,
        })
      : false;
  }

  const totalNetSales = Array.from(byKey.values()).reduce((s, p) => s + p.netSales, 0);

  const paymentFeesTotal = netAfterRefundsTotal * feePercent + orderCount * feeFixed;

  for (const p of byKey.values()) {
    const feeAlloc = totalNetSales > 0 ? (p.netSales / totalNetSales) * paymentFeesTotal : 0;
    p.paymentFeesAllocated = feeAlloc;

    const profitAfterFees = p.netSales - p.cogs - feeAlloc;
    p.profitAfterFees = profitAfterFees;
    p.marginPct = p.netSales > 0 ? (profitAfterFees / p.netSales) * 100 : 0;
  }

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
      hasMissingCogs: Boolean(p.hasMissingCogs),

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
    .filter((p: any) => p.hasMissingCogs === true)
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