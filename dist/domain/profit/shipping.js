// src/domain/profit/shipping.ts
/**
 * Shipping Revenue = what the customer paid for shipping (already included in order.total_price).
 * We extract it explicitly for transparency + later insights.
 */
export function extractShippingRevenueFromOrder(order) {
    // Most reliable
    const a = order?.total_shipping_price_set?.shop_money?.amount;
    if (a !== undefined && a !== null)
        return Number(a) || 0;
    // Sometimes presentment_money exists
    const b = order?.total_shipping_price_set?.presentment_money?.amount;
    if (b !== undefined && b !== null)
        return Number(b) || 0;
    // Fallbacks (older fields)
    const c = order?.total_shipping_price;
    if (c !== undefined && c !== null)
        return Number(c) || 0;
    // Sometimes only shipping_lines exist
    const lines = order?.shipping_lines ?? [];
    if (Array.isArray(lines) && lines.length > 0) {
        const sum = lines.reduce((s, l) => s + Number(l?.price || 0), 0);
        return Number(sum) || 0;
    }
    return 0;
}
