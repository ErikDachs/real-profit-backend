import type { VariantQty } from "../cogs.js";

function toNum(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function parseGidToId(maybeGid: any): number {
  // Shopify GID example: gid://shopify/ProductVariant/44862408622134
  if (typeof maybeGid !== "string") return toNum(maybeGid);
  const m = maybeGid.match(/(\d+)\s*$/);
  return m ? toNum(m[1]) : 0;
}

function push(out: VariantQty[], variantId: number, qty: number) {
  if (variantId > 0 && qty > 0) out.push({ variantId, qty });
}

/**
 * Strict boolean parsing:
 * - true / "true" / 1 / "1" => true
 * - false / "false" / 0 / "0" / undefined / null => false
 * Anything else => false (safe default)
 */
function parseStrictBool(v: any): boolean {
  if (v === true) return true;
  if (v === false || v == null) return false;

  if (typeof v === "number") return v === 1;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (s === "true" || s === "1") return true;
    if (s === "false" || s === "0" || s === "") return false;
    return false;
  }

  return false;
}

function looksLikeGiftCardByTitle(li: any): boolean {
  const title = String(li?.title ?? li?.name ?? "").trim().toLowerCase();
  const variantTitle = String(li?.variant_title ?? li?.variantTitle ?? li?.variant?.title ?? "").trim().toLowerCase();

  if (!title && !variantTitle) return false;

  if (title === "gift card") return true;
  if (title.includes("gift card")) return true;
  if (variantTitle.includes("gift card")) return true;

  return false;
}

function isGiftCardLike(li: any): boolean {
  // Primary signal
  if (parseStrictBool(li?.gift_card ?? li?.giftCard ?? false)) return true;

  // Defensive fallback for normalized GraphQL payloads where explicit gift_card is absent
  if (looksLikeGiftCardByTitle(li)) return true;

  return false;
}

/**
 * Canonical "Facts" about line items on an order (SSOT for downstream missing-COGS governance + gift-card handling).
 * - rawLineItemsCount: how many line items exist on the order payload
 * - relevantLineItemsCount: how many line items should require COGS (gift cards excluded)
 * - extractedVariantQty: mapped variants with qty > 0 (gift cards excluded)
 * - hasUnmappedVariants: relevant line items exist but no usable variant ids could be extracted
 * - giftCardLineItemsCount: how many gift-card line items exist
 */
export type OrderLineItemFacts = {
  rawLineItemsCount: number;
  relevantLineItemsCount: number;
  extractedVariantQty: VariantQty[];
  hasUnmappedVariants: boolean;
  giftCardLineItemsCount: number;
};

function normalizeArrayLineItems(
  arr: any[],
  out: VariantQty[],
  counts: { raw: number; relevant: number; gift: number }
) {
  for (const li of arr ?? []) {
    counts.raw += 1;

    const giftCard = isGiftCardLike(li);
    if (giftCard) {
      counts.gift += 1;
      continue; // gift cards do NOT require COGS and must not affect extraction
    }

    counts.relevant += 1;

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

    push(out, variantId, qty);
  }
}

function normalizeGraphqlLineItems(
  conn: any,
  out: VariantQty[],
  counts: { raw: number; relevant: number; gift: number }
) {
  const edges = conn?.edges ?? [];
  for (const e of edges) {
    const node = e?.node ?? e ?? {};

    counts.raw += 1;

    const giftCard = isGiftCardLike(node);
    if (giftCard) {
      counts.gift += 1;
      continue;
    }

    counts.relevant += 1;

    const variantId =
      parseGidToId(node?.variant?.id) ||
      toNum(node?.variantId) ||
      0;

    const qty =
      toNum(node?.quantity) ||
      toNum(node?.currentQuantity) ||
      toNum(node?.qty) ||
      0;

    push(out, variantId, qty);
  }
}

function normalizeGraphqlLineItemsNodes(
  conn: any,
  out: VariantQty[],
  counts: { raw: number; relevant: number; gift: number }
) {
  const nodes = conn?.nodes ?? [];
  for (const node of nodes) {
    counts.raw += 1;

    const giftCard = isGiftCardLike(node);
    if (giftCard) {
      counts.gift += 1;
      continue;
    }

    counts.relevant += 1;

    const variantId =
      parseGidToId(node?.variant?.id) ||
      toNum(node?.variantId) ||
      0;

    const qty =
      toNum(node?.quantity) ||
      toNum(node?.currentQuantity) ||
      toNum(node?.qty) ||
      0;

    push(out, variantId, qty);
  }
}

function dedupeVariantQty(out: VariantQty[]): VariantQty[] {
  const agg = new Map<number, number>();
  for (const x of out) agg.set(x.variantId, (agg.get(x.variantId) ?? 0) + x.qty);
  return Array.from(agg.entries()).map(([variantId, qty]) => ({ variantId, qty }));
}

export function extractVariantQtyFromOrder(order: any): VariantQty[] {
  return getOrderLineItemFacts(order).extractedVariantQty;
}

/**
 * Helper: does the order contain any gift card line items?
 */
export function orderHasGiftCardLineItems(order: any): boolean {
  return getOrderLineItemFacts(order).giftCardLineItemsCount > 0;
}

/**
 * Helper: gift-card-only order = has gift-card line items AND has no relevant (non-gift) line items.
 */
export function orderIsGiftCardOnly(order: any): boolean {
  const facts = getOrderLineItemFacts(order);
  return facts.giftCardLineItemsCount > 0 && facts.relevantLineItemsCount === 0;
}

/**
 * SSOT: use this for "unmapped variants" detection (line items exist but variants cannot be extracted).
 * Deterministic across REST/camelCase/GraphQL shapes.
 */
export function getOrderLineItemFacts(order: any): OrderLineItemFacts {
  const out: VariantQty[] = [];
  const counts = { raw: 0, relevant: 0, gift: 0 };

  // GraphQL nodes shape
  if (order?.lineItems?.nodes) normalizeGraphqlLineItemsNodes(order.lineItems, out, counts);
  if (order?.line_items?.nodes) normalizeGraphqlLineItemsNodes(order.line_items, out, counts);

  // REST shape
  if (Array.isArray(order?.line_items)) normalizeArrayLineItems(order.line_items, out, counts);

  // camelCase array shape
  if (Array.isArray(order?.lineItems)) normalizeArrayLineItems(order.lineItems, out, counts);

  // GraphQL connection shape
  if (order?.lineItems?.edges) normalizeGraphqlLineItems(order.lineItems, out, counts);
  if (order?.line_items?.edges) normalizeGraphqlLineItems(order.line_items, out, counts);

  const extractedVariantQty = dedupeVariantQty(out);

  const hasUnmappedVariants = counts.relevant > 0 && extractedVariantQty.length === 0;

  return {
    rawLineItemsCount: counts.raw,
    relevantLineItemsCount: counts.relevant,
    extractedVariantQty,
    hasUnmappedVariants,
    giftCardLineItemsCount: counts.gift,
  };
}

// Backwards compatible helper
export function getRawLineItemCount(order: any): number {
  return getOrderLineItemFacts(order).rawLineItemsCount;
}

// Explicit helper
export function getRelevantLineItemCount(order: any): number {
  return getOrderLineItemFacts(order).relevantLineItemsCount;
}