// src/domain/cogs.ts
import { chunk } from "../utils/math";
/**
 * SSOT COGS Service
 * - Shopify InventoryItem cost (cached)
 * - Manual overrides (store) MUST be wired into this service
 * - Governance helpers (ignoreCogs) live here (no shadow logic in routes)
 */
export class CogsService {
    overridesStore;
    // Simple in-memory caches (MVP). Später Redis/DB.
    variantToInventoryItemId = new Map();
    /**
     * IMPORTANT:
     * - undefined => cost is unknown/missing
     * - number (including 0) => cost is known (0 can be "by design")
     */
    inventoryItemCost = new Map();
    overridesLoaded = false;
    constructor(overridesStore) {
        this.overridesStore = overridesStore;
    }
    /**
     * Wire/replace overrides store (useful for ctx init ordering).
     * Keeps SSOT: service remains the only place reading overrides for profit logic.
     */
    setOverridesStore(store) {
        this.overridesStore = store;
        this.overridesLoaded = false;
    }
    async ensureOverridesLoaded() {
        if (!this.overridesStore)
            return;
        if (this.overridesLoaded)
            return;
        await this.overridesStore.ensureLoaded();
        this.overridesLoaded = true;
    }
    /**
     * Normalize store return types:
     * - treat null as "no override"
     */
    getOverrideUnitCost(variantId) {
        const raw = this.overridesStore?.getUnitCostSync(variantId);
        if (raw === null || raw === undefined)
            return undefined;
        const n = Number(raw);
        return Number.isFinite(n) ? n : undefined;
    }
    /**
     * Governance SSOT: ignoreCogs flag (Option C uses this via isMissingUnitCost)
     */
    isIgnoredVariantSync(variantId) {
        const v = this.overridesStore?.isIgnoredSync?.(variantId);
        return Boolean(v);
    }
    parseShopifyCost(value) {
        // Shopify REST inventory_items.cost is often a string like "12.34"
        // Could be null/undefined/"" => treat as missing/unknown
        if (value === null || value === undefined)
            return undefined;
        if (typeof value === "string" && value.trim() === "")
            return undefined;
        const n = Number(value);
        return Number.isFinite(n) ? n : undefined;
    }
    async ensureCachesForVariants(shopifyGET, variantIds) {
        // Only fetch Shopify cost for variants without manual override.
        const variantIdsNeedingShopify = variantIds.filter((vid) => this.getOverrideUnitCost(vid) === undefined);
        // 1) variants -> inventory_item_id (only missing)
        const missingVariantIds = variantIdsNeedingShopify.filter((id) => !this.variantToInventoryItemId.has(id));
        for (const ids of chunk(missingVariantIds, 50)) {
            if (ids.length === 0)
                continue;
            const variantsJson = await shopifyGET(`/admin/api/2024-01/variants.json?ids=${ids.join(",")}&fields=id,inventory_item_id`);
            const variants = variantsJson.variants ?? [];
            for (const v of variants) {
                const vid = Number(v.id);
                const invId = Number(v.inventory_item_id || 0);
                if (vid && invId)
                    this.variantToInventoryItemId.set(vid, invId);
            }
        }
        // 2) inventory items -> cost (only missing)
        const inventoryItemIds = Array.from(new Set(variantIdsNeedingShopify
            .map((vid) => this.variantToInventoryItemId.get(vid))
            .filter(Boolean)));
        const missingInventoryItemIds = inventoryItemIds.filter((id) => !this.inventoryItemCost.has(id));
        for (const ids of chunk(missingInventoryItemIds, 50)) {
            if (ids.length === 0)
                continue;
            const invJson = await shopifyGET(`/admin/api/2024-01/inventory_items.json?ids=${ids.join(",")}&fields=id,cost`);
            const invItems = invJson.inventory_items ?? [];
            for (const it of invItems) {
                const iid = Number(it.id);
                if (!iid)
                    continue;
                const cost = this.parseShopifyCost(it.cost);
                // store undefined when missing; store number (including 0) when present
                this.inventoryItemCost.set(iid, cost);
            }
        }
    }
    /**
     * Returns unit cost per variant (override wins).
     * IMPORTANT:
     * - Map value can be undefined => unknown/missing cost
     * - 0 is a valid explicit cost
     */
    async computeUnitCostsByVariant(shopifyGET, variantIds) {
        await this.ensureOverridesLoaded();
        const uniqueVariantIds = Array.from(new Set(variantIds)).filter((x) => Number.isFinite(x) && x > 0);
        await this.ensureCachesForVariants(shopifyGET, uniqueVariantIds);
        const out = new Map();
        for (const variantId of uniqueVariantIds) {
            const overrideCost = this.getOverrideUnitCost(variantId);
            if (overrideCost !== undefined) {
                out.set(variantId, overrideCost);
                continue;
            }
            const invId = this.variantToInventoryItemId.get(variantId);
            if (!invId) {
                // unknown inventory item => unknown cost
                out.set(variantId, undefined);
                continue;
            }
            out.set(variantId, this.inventoryItemCost.get(invId));
        }
        return out;
    }
    async computeCogsForVariants(shopifyGET, lineItems) {
        await this.ensureOverridesLoaded();
        const uniqueVariantIds = Array.from(new Set(lineItems.map((x) => x.variantId)));
        await this.ensureCachesForVariants(shopifyGET, uniqueVariantIds);
        // compute Σ(qty * unitCost) – unknown costs contribute 0 here,
        // but missing-COGS governance must be handled by callers via unit-cost map.
        let cogs = 0;
        for (const li of lineItems) {
            const overrideCost = this.getOverrideUnitCost(li.variantId);
            if (overrideCost !== undefined) {
                cogs += li.qty * overrideCost;
                continue;
            }
            const invId = this.variantToInventoryItemId.get(li.variantId);
            if (!invId)
                continue;
            const cost = this.inventoryItemCost.get(invId);
            if (cost === undefined)
                continue; // unknown cost => 0 contribution
            cogs += li.qty * cost;
        }
        return cogs;
    }
    async computeCogsByVariant(shopifyGET, lineItems) {
        await this.ensureOverridesLoaded();
        const uniqueVariantIds = Array.from(new Set(lineItems.map((x) => x.variantId)));
        await this.ensureCachesForVariants(shopifyGET, uniqueVariantIds);
        // Aggregate qty per variant
        const qtyByVariant = new Map();
        for (const li of lineItems) {
            qtyByVariant.set(li.variantId, (qtyByVariant.get(li.variantId) ?? 0) + li.qty);
        }
        // Compute per-variant cogs (override wins). Unknown cost => 0 cogs (but caller should flag missing separately)
        const out = new Map();
        for (const [variantId, qty] of qtyByVariant.entries()) {
            const overrideCost = this.getOverrideUnitCost(variantId);
            if (overrideCost !== undefined) {
                out.set(variantId, qty * overrideCost);
                continue;
            }
            const invId = this.variantToInventoryItemId.get(variantId);
            if (!invId) {
                out.set(variantId, 0);
                continue;
            }
            const cost = this.inventoryItemCost.get(invId);
            if (cost === undefined) {
                out.set(variantId, 0);
                continue;
            }
            out.set(variantId, qty * cost);
        }
        return out;
    }
    async explainUnitCosts(shopifyGET, variantIds) {
        await this.ensureOverridesLoaded();
        const ids = Array.from(new Set(variantIds)).filter((x) => Number.isFinite(x) && x > 0);
        await this.ensureCachesForVariants(shopifyGET, ids);
        return ids.map((variantId) => {
            const override = this.getOverrideUnitCost(variantId);
            const ignoreCogs = this.isIgnoredVariantSync(variantId);
            if (override !== undefined) {
                return {
                    variantId,
                    overrideUnitCost: override,
                    ignoreCogs,
                    inventoryItemId: null,
                    shopifyUnitCostCached: null,
                    resolvedUnitCost: override,
                    source: "OVERRIDE",
                };
            }
            const inventoryItemId = this.variantToInventoryItemId.get(variantId) ?? null;
            const cached = inventoryItemId ? this.inventoryItemCost.get(inventoryItemId) : undefined;
            return {
                variantId,
                overrideUnitCost: null,
                ignoreCogs,
                inventoryItemId,
                shopifyUnitCostCached: cached === undefined ? null : cached,
                resolvedUnitCost: cached === undefined ? null : cached,
                source: cached === undefined ? "MISSING" : "SHOPIFY",
            };
        });
    }
}
