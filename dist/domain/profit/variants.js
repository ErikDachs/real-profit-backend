function toNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}
function parseGidToId(maybeGid) {
    // Shopify GID example: gid://shopify/ProductVariant/44862408622134
    if (typeof maybeGid !== "string")
        return toNum(maybeGid);
    const m = maybeGid.match(/(\d+)\s*$/);
    return m ? toNum(m[1]) : 0;
}
function push(out, variantId, qty) {
    if (variantId > 0 && qty > 0)
        out.push({ variantId, qty });
}
/**
 * Strict boolean parsing:
 * - true / "true" / 1 / "1" => true
 * - false / "false" / 0 / "0" / undefined / null => false
 * Anything else => false (safe default)
 */
function parseStrictBool(v) {
    if (v === true)
        return true;
    if (v === false || v == null)
        return false;
    if (typeof v === "number")
        return v === 1;
    if (typeof v === "string") {
        const s = v.trim().toLowerCase();
        if (s === "true" || s === "1")
            return true;
        if (s === "false" || s === "0" || s === "")
            return false;
        return false; // safe default
    }
    return false;
}
function isGiftCardLike(li) {
    // REST: gift_card
    // GraphQL (sometimes): giftCard
    return parseStrictBool(li?.gift_card ?? li?.giftCard ?? false);
}
function normalizeArrayLineItems(arr, out, counts) {
    for (const li of arr ?? []) {
        counts.raw += 1;
        const giftCard = isGiftCardLike(li);
        if (giftCard) {
            counts.gift += 1;
            continue; // gift cards do NOT require COGS and must not affect extraction
        }
        counts.relevant += 1;
        const variantId = toNum(li?.variant_id) ||
            toNum(li?.variantId) ||
            parseGidToId(li?.variant?.id) ||
            parseGidToId(li?.variantId) ||
            0;
        const qty = toNum(li?.quantity) || toNum(li?.qty) || toNum(li?.currentQuantity) || 0;
        push(out, variantId, qty);
    }
}
function normalizeGraphqlLineItems(conn, out, counts) {
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
        const variantId = parseGidToId(node?.variant?.id) || toNum(node?.variantId) || 0;
        const qty = toNum(node?.quantity) || toNum(node?.currentQuantity) || toNum(node?.qty) || 0;
        push(out, variantId, qty);
    }
}
function normalizeGraphqlLineItemsNodes(conn, out, counts) {
    const nodes = conn?.nodes ?? [];
    for (const node of nodes) {
        counts.raw += 1;
        const giftCard = isGiftCardLike(node);
        if (giftCard) {
            counts.gift += 1;
            continue;
        }
        counts.relevant += 1;
        const variantId = parseGidToId(node?.variant?.id) || toNum(node?.variantId) || 0;
        const qty = toNum(node?.quantity) || toNum(node?.currentQuantity) || toNum(node?.qty) || 0;
        push(out, variantId, qty);
    }
}
function dedupeVariantQty(out) {
    // Merge duplicate variantIds (same variant appears multiple times)
    const agg = new Map();
    for (const x of out)
        agg.set(x.variantId, (agg.get(x.variantId) ?? 0) + x.qty);
    return Array.from(agg.entries()).map(([variantId, qty]) => ({ variantId, qty }));
}
export function extractVariantQtyFromOrder(order) {
    return getOrderLineItemFacts(order).extractedVariantQty;
}
/**
 * Helper: does the order contain any gift card line items?
 */
export function orderHasGiftCardLineItems(order) {
    return getOrderLineItemFacts(order).giftCardLineItemsCount > 0;
}
/**
 * Helper: gift-card-only order = has gift-card line items AND has no relevant (non-gift) line items.
 */
export function orderIsGiftCardOnly(order) {
    const facts = getOrderLineItemFacts(order);
    return facts.giftCardLineItemsCount > 0 && facts.relevantLineItemsCount === 0;
}
/**
 * SSOT: use this for "unmapped variants" detection (line items exist but variants cannot be extracted).
 * Deterministic across REST/camelCase/GraphQL shapes.
 */
export function getOrderLineItemFacts(order) {
    const out = [];
    const counts = { raw: 0, relevant: 0, gift: 0 };
    // GraphQL nodes shape (common in Shopify GraphQL)
    if (order?.lineItems?.nodes)
        normalizeGraphqlLineItemsNodes(order.lineItems, out, counts);
    if (order?.line_items?.nodes)
        normalizeGraphqlLineItemsNodes(order.line_items, out, counts);
    // REST shape
    if (Array.isArray(order?.line_items))
        normalizeArrayLineItems(order.line_items, out, counts);
    // Some code/fixtures use camelCase
    if (Array.isArray(order?.lineItems))
        normalizeArrayLineItems(order.lineItems, out, counts);
    // GraphQL connection shape
    if (order?.lineItems?.edges)
        normalizeGraphqlLineItems(order.lineItems, out, counts);
    if (order?.line_items?.edges)
        normalizeGraphqlLineItems(order.line_items, out, counts);
    const extractedVariantQty = dedupeVariantQty(out);
    // ✅ Invariante für "unmapped variants":
    // Wenn relevante Items existieren, aber keine Variant IDs extrahiert werden konnten => missing
    const hasUnmappedVariants = counts.relevant > 0 && extractedVariantQty.length === 0;
    return {
        rawLineItemsCount: counts.raw,
        relevantLineItemsCount: counts.relevant,
        extractedVariantQty,
        hasUnmappedVariants,
        giftCardLineItemsCount: counts.gift,
    };
}
// Backwards compatible helper (still useful sometimes)
export function getRawLineItemCount(order) {
    return getOrderLineItemFacts(order).rawLineItemsCount;
}
// New helper (explicit)
export function getRelevantLineItemCount(order) {
    return getOrderLineItemFacts(order).relevantLineItemsCount;
}
