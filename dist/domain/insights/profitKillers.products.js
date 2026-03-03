// src/domain/insights/profitKillers.products.ts
function productProfitValue(p) {
    return Number(p.profitAfterAds ?? p.profitAfterFees ?? 0);
}
export function pickWorstProducts(products, limit) {
    return [...products]
        .sort((a, b) => productProfitValue(a) - productProfitValue(b))
        .slice(0, limit);
}
export function pickBestProducts(products, limit) {
    return [...products]
        .sort((a, b) => productProfitValue(b) - productProfitValue(a))
        .slice(0, limit);
}
