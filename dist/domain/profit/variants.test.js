// src/domain/profit/variants.test.ts
import { describe, it, expect } from "vitest";
import { getOrderLineItemFacts } from "./variants.js";
describe("getOrderLineItemFacts (SSOT) - unmapped variants governance", () => {
    it("flags unmapped when relevant line items exist but no variant ids can be extracted (gift_card='false' string)", () => {
        const order = {
            id: "1002",
            line_items: [
                {
                    quantity: 1,
                    variant_id: null,
                    gift_card: "false", // <- critical: must NOT be treated as true
                },
            ],
        };
        const facts = getOrderLineItemFacts(order);
        expect(facts.rawLineItemsCount).toBe(1);
        expect(facts.relevantLineItemsCount).toBe(1);
        expect(facts.extractedVariantQty.length).toBe(0);
        expect(facts.hasUnmappedVariants).toBe(true);
    });
    it("does NOT flag unmapped when only gift cards exist (gift_card=true)", () => {
        const order = {
            id: "gc-only",
            line_items: [
                {
                    quantity: 1,
                    variant_id: null,
                    gift_card: true,
                },
            ],
        };
        const facts = getOrderLineItemFacts(order);
        expect(facts.rawLineItemsCount).toBe(1);
        expect(facts.relevantLineItemsCount).toBe(0);
        expect(facts.extractedVariantQty.length).toBe(0);
        expect(facts.hasUnmappedVariants).toBe(false);
    });
    it("extracts variant ids from GraphQL shape (gid) and is not unmapped", () => {
        const order = {
            id: "gql",
            lineItems: {
                edges: [
                    {
                        node: {
                            quantity: 2,
                            variant: { id: "gid://shopify/ProductVariant/44862408622134" },
                            giftCard: false,
                        },
                    },
                ],
            },
        };
        const facts = getOrderLineItemFacts(order);
        expect(facts.relevantLineItemsCount).toBe(1);
        expect(facts.extractedVariantQty).toEqual([{ variantId: 44862408622134, qty: 2 }]);
        expect(facts.hasUnmappedVariants).toBe(false);
    });
});
