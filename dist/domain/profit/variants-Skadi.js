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
/**
 * ✅ Gift Card detection SSOT (REST + GraphQL)
 * REST: line_item.gift_card
 * GraphQL: lineItem.giftCard (sometimes)
 */
export function isGiftCardLineItem(li) {
    return parseStrictBool(li?.gift_card ?? li?.giftCard ?? false);
}
function extractVariantId(li) {
    return (toNum(li?.variant_id) ||
        toNum(li?.variantId) ||
        parseGidToId(li?.variant?.id) ||
        parseGidToId(li?.variantId) ||
        0);
}
function normalizeArrayLineItems(arr, out, counts, giftCardSeen) {
    for (const li of arr ?? []) {
        counts.raw += 1;
        const giftCard = isGiftCardLineItem(li);
        if (giftCard) {
            giftCardSeen.value = true;
            continue; // gift cards do NOT require COGS and must not affect extraction
        }
        // ✅ relevant = non-gift-card (matches tests + previous SSOT meaning)
        counts.relevant += 1;
        const variantId = extractVariantId(li);
        const qty = toNum(li?.quantity) || toNum(li?.qty) || toNum(li?.currentQuantity) || 0;
        if (variantId <= 0) {
            counts.nonVariant += 1;
            continue;
        }
        push(out, variantId, qty);
    }
}
function normalizeGraphqlLineItems(conn, out, counts, giftCardSeen) {
    const edges = conn?.edges ?? [];
    for (const e of edges) {
        const node = e?.node ?? e ?? {};
        counts.raw += 1;
        const giftCard = isGiftCardLineItem(node);
        if (giftCard) {
            giftCardSeen.value = true;
            continue;
        }
        counts.relevant += 1;
        const variantId = parseGidToId(node?.variant?.id) || toNum(node?.variantId) || 0;
        const qty = toNum(node?.quantity) || toNum(node?.currentQuantity) || toNum(node?.qty) || 0;
        if (variantId <= 0) {
            counts.nonVariant += 1;
            continue;
        }
        push(out, variantId, qty);
    }
}
function normalizeGraphqlLineItemsNodes(conn, out, counts, giftCardSeen) {
    const nodes = conn?.nodes ?? [];
    for (const node of nodes) {
        counts.raw += 1;
        const giftCard = isGiftCardLineItem(node);
        if (giftCard) {
            giftCardSeen.value = true;
            continue;
        }
        counts.relevant += 1;
        const variantId = parseGidToId(node?.variant?.id) || toNum(node?.variantId) || 0;
        const qty = toNum(node?.quantity) || toNum(node?.currentQuantity) || toNum(node?.qty) || 0;
        if (variantId <= 0) {
            counts.nonVariant += 1;
            continue;
        }
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
 * ✅ SSOT helper: does this order contain any gift card line item?
 * Deterministic across REST/camelCase/GraphQL shapes.
 */
export function orderHasGiftCardLineItems(order) {
    const giftCardSeen = { value: false };
    const dummyOut = [];
    const dummyCounts = { raw: 0, relevant: 0, nonVariant: 0 };
    // GraphQL nodes shape
    if (order?.lineItems?.nodes)
        normalizeGraphqlLineItemsNodes(order.lineItems, dummyOut, dummyCounts, giftCardSeen);
    if (order?.line_items?.nodes)
        normalizeGraphqlLineItemsNodes(order.line_items, dummyOut, dummyCounts, giftCardSeen);
    // REST shape
    if (Array.isArray(order?.line_items))
        normalizeArrayLineItems(order.line_items, dummyOut, dummyCounts, giftCardSeen);
    // camelCase
    if (Array.isArray(order?.lineItems))
        normalizeArrayLineItems(order.lineItems, dummyOut, dummyCounts, giftCardSeen);
    // GraphQL connection shape
    if (order?.lineItems?.edges)
        normalizeGraphqlLineItems(order.lineItems, dummyOut, dummyCounts, giftCardSeen);
    if (order?.line_items?.edges)
        normalizeGraphqlLineItems(order.line_items, dummyOut, dummyCounts, giftCardSeen);
    return giftCardSeen.value;
}
/**
 * SSOT: use this for "unmapped variants" detection (line items exist but variants cannot be extracted).
 * Deterministic across REST/camelCase/GraphQL shapes.
 */
export function getOrderLineItemFacts(order) {
    const out = [];
    const counts = { raw: 0, relevant: 0, nonVariant: 0 };
    const giftCardSeen = { value: false };
    // GraphQL nodes shape
    if (order?.lineItems?.nodes)
        normalizeGraphqlLineItemsNodes(order.lineItems, out, counts, giftCardSeen);
    if (order?.line_items?.nodes)
        normalizeGraphqlLineItemsNodes(order.line_items, out, counts, giftCardSeen);
    // REST shape
    if (Array.isArray(order?.line_items))
        normalizeArrayLineItems(order.line_items, out, counts, giftCardSeen);
    // camelCase
    if (Array.isArray(order?.lineItems))
        normalizeArrayLineItems(order.lineItems, out, counts, giftCardSeen);
    // GraphQL connection shape
    if (order?.lineItems?.edges)
        normalizeGraphqlLineItems(order.lineItems, out, counts, giftCardSeen);
    if (order?.line_items?.edges)
        normalizeGraphqlLineItems(order.line_items, out, counts, giftCardSeen);
    const extractedVariantQty = dedupeVariantQty(out);
    // ✅ Invariant for "unmapped variants":
    // Relevant (non-gift-card) items exist, but no variants could be extracted.
    const hasUnmappedVariants = counts.relevant > 0 && extractedVariantQty.length === 0;
    return {
        rawLineItemsCount: counts.raw,
        relevantLineItemsCount: counts.relevant,
        nonVariantLineItemsCount: counts.nonVariant,
        extractedVariantQty,
        hasUnmappedVariants,
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
