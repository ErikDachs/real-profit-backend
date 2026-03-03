// src/domain/cogs.ts
import { chunk } from "../utils/math";
import type { CogsOverridesStore } from "../storage/cogsOverridesStore";

export type VariantQty = { variantId: number; qty: number };

export class CogsService {
  // Simple in-memory caches (MVP). Später Redis/DB.
  private variantToInventoryItemId = new Map<number, number>();

  /**
   * IMPORTANT:
   * - undefined => cost is unknown/missing
   * - number (including 0) => cost is known (0 can be "by design")
   */
  private inventoryItemCost = new Map<number, number | undefined>();

  constructor(private overridesStore?: CogsOverridesStore) {}

  private async ensureOverridesLoaded() {
    if (!this.overridesStore) return;
    await this.overridesStore.ensureLoaded();
  }

  private getOverrideUnitCost(variantId: number): number | undefined {
    return this.overridesStore?.getUnitCostSync(variantId);
  }

  private parseShopifyCost(value: any): number | undefined {
    // Shopify REST inventory_items.cost is often a string like "12.34"
    // Could be null/undefined/"" => treat as missing/unknown
    if (value === null || value === undefined) return undefined;
    if (typeof value === "string" && value.trim() === "") return undefined;

    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }

  private async ensureCachesForVariants(
    shopifyGET: (path: string) => Promise<any>,
    variantIds: number[]
  ) {
    // Only fetch Shopify cost for variants without manual override.
    const variantIdsNeedingShopify = variantIds.filter((vid) => this.getOverrideUnitCost(vid) === undefined);

    // 1) variants -> inventory_item_id (only missing)
    const missingVariantIds = variantIdsNeedingShopify.filter((id) => !this.variantToInventoryItemId.has(id));

    for (const ids of chunk(missingVariantIds, 50)) {
      if (ids.length === 0) continue;
      const variantsJson = await shopifyGET(
        `/admin/api/2024-01/variants.json?ids=${ids.join(",")}&fields=id,inventory_item_id`
      );
      const variants = variantsJson.variants ?? [];
      for (const v of variants) {
        const vid = Number(v.id);
        const invId = Number(v.inventory_item_id || 0);
        if (vid && invId) this.variantToInventoryItemId.set(vid, invId);
      }
    }

    // 2) inventory items -> cost (only missing)
    const inventoryItemIds = Array.from(
      new Set(
        variantIdsNeedingShopify
          .map((vid) => this.variantToInventoryItemId.get(vid))
          .filter(Boolean) as number[]
      )
    );

    const missingInventoryItemIds = inventoryItemIds.filter((id) => !this.inventoryItemCost.has(id));

    for (const ids of chunk(missingInventoryItemIds, 50)) {
      if (ids.length === 0) continue;
      const invJson = await shopifyGET(
        `/admin/api/2024-01/inventory_items.json?ids=${ids.join(",")}&fields=id,cost`
      );
      const invItems = invJson.inventory_items ?? [];
      for (const it of invItems) {
        const iid = Number(it.id);
        if (!iid) continue;

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
  async computeUnitCostsByVariant(
    shopifyGET: (path: string) => Promise<any>,
    variantIds: number[]
  ): Promise<Map<number, number | undefined>> {
    await this.ensureOverridesLoaded();

    const uniqueVariantIds = Array.from(new Set(variantIds)).filter((x) => Number.isFinite(x) && x > 0);

    await this.ensureCachesForVariants(shopifyGET, uniqueVariantIds);

    const out = new Map<number, number | undefined>();
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

  async computeCogsForVariants(
    shopifyGET: (path: string) => Promise<any>,
    lineItems: VariantQty[]
  ): Promise<number> {
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
      if (!invId) continue;

      const cost = this.inventoryItemCost.get(invId);
      if (cost === undefined) continue; // unknown cost => 0 contribution
      cogs += li.qty * cost;
    }

    return cogs;
  }

  async computeCogsByVariant(
    shopifyGET: (path: string) => Promise<any>,
    lineItems: VariantQty[]
  ): Promise<Map<number, number>> {
    await this.ensureOverridesLoaded();

    const uniqueVariantIds = Array.from(new Set(lineItems.map((x) => x.variantId)));

    await this.ensureCachesForVariants(shopifyGET, uniqueVariantIds);

    // Aggregate qty per variant
    const qtyByVariant = new Map<number, number>();
    for (const li of lineItems) {
      qtyByVariant.set(li.variantId, (qtyByVariant.get(li.variantId) ?? 0) + li.qty);
    }

    // Compute per-variant cogs (override wins). Unknown cost => 0 cogs (but caller should flag missing separately)
    const out = new Map<number, number>();
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
}