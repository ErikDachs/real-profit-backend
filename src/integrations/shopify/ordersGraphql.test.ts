import { beforeEach, describe, expect, it, vi } from "vitest";

const graphqlMock = vi.fn();

vi.mock("./client.js", () => {
  return {
    createShopifyClient: vi.fn(() => ({
      graphql: (...args: any[]) => graphqlMock(...args),
    })),
  };
});

import { fetchOrdersGraphql, fetchOrderByIdGraphql } from "./ordersGraphql.js";

describe("ordersGraphql", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetchOrdersGraphql paginates and normalizes REST-like orders", async () => {
    graphqlMock
      .mockResolvedValueOnce({
        orders: {
          pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
          edges: [
            {
              node: {
                id: "gid://shopify/Order/111",
                name: "#111",
                createdAt: "2026-03-01T10:00:00Z",
                processedAt: "2026-03-01T10:05:00Z",
                currencyCode: "EUR",
                displayFinancialStatus: "PAID",
                displayFulfillmentStatus: "FULFILLED",

                totalPriceSet: {
                  shopMoney: { amount: "100.00", currencyCode: "EUR" },
                  presentmentMoney: { amount: "100.00", currencyCode: "EUR" },
                },
                currentTotalPriceSet: {
                  shopMoney: { amount: "100.00", currencyCode: "EUR" },
                  presentmentMoney: { amount: "100.00", currencyCode: "EUR" },
                },
                totalShippingPriceSet: {
                  shopMoney: { amount: "5.00", currencyCode: "EUR" },
                  presentmentMoney: { amount: "5.00", currencyCode: "EUR" },
                },

                lineItems: {
                  edges: [
                    {
                      node: {
                        title: "Product A",
                        variantTitle: "Default",
                        quantity: 2,
                        originalUnitPriceSet: {
                          shopMoney: { amount: "12.50", currencyCode: "EUR" },
                          presentmentMoney: { amount: "12.50", currencyCode: "EUR" },
                        },
                        discountedUnitPriceSet: {
                          shopMoney: { amount: "10.00", currencyCode: "EUR" },
                          presentmentMoney: { amount: "10.00", currencyCode: "EUR" },
                        },
                        originalTotalSet: {
                          shopMoney: { amount: "25.00", currencyCode: "EUR" },
                          presentmentMoney: { amount: "25.00", currencyCode: "EUR" },
                        },
                        discountedTotalSet: {
                          shopMoney: { amount: "20.00", currencyCode: "EUR" },
                          presentmentMoney: { amount: "20.00", currencyCode: "EUR" },
                        },
                        variant: {
                          id: "gid://shopify/ProductVariant/10",
                          title: "Default",
                          sku: "SKU-10",
                          product: { id: "gid://shopify/Product/1000" },
                        },
                      },
                    },
                  ],
                },

                refunds: [
                  {
                    totalRefundedSet: {
                      shopMoney: { amount: "3.00", currencyCode: "EUR" },
                      presentmentMoney: { amount: "3.00", currencyCode: "EUR" },
                    },
                    transactions: {
                      nodes: [
                        {
                          amountSet: {
                            shopMoney: { amount: "3.00", currencyCode: "EUR" },
                            presentmentMoney: { amount: "3.00", currencyCode: "EUR" },
                          },
                          status: "SUCCESS",
                        },
                      ],
                    },
                  },
                ],
              },
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        orders: {
          pageInfo: { hasNextPage: false, endCursor: null },
          edges: [
            {
              node: {
                id: "gid://shopify/Order/222",
                name: "#222",
                createdAt: "2026-03-02T10:00:00Z",
                processedAt: "2026-03-02T10:02:00Z",
                currencyCode: "USD",
                displayFinancialStatus: "PAID",
                displayFulfillmentStatus: "UNFULFILLED",

                totalPriceSet: {
                  shopMoney: { amount: "200.00", currencyCode: "USD" },
                  presentmentMoney: { amount: "200.00", currencyCode: "USD" },
                },
                currentTotalPriceSet: {
                  shopMoney: { amount: "180.00", currencyCode: "USD" },
                  presentmentMoney: { amount: "180.00", currencyCode: "USD" },
                },
                totalShippingPriceSet: {
                  shopMoney: { amount: "0.00", currencyCode: "USD" },
                  presentmentMoney: { amount: "0.00", currencyCode: "USD" },
                },

                lineItems: {
                  edges: [
                    {
                      node: {
                        title: "Product B",
                        variantTitle: "Blue",
                        quantity: 2,
                        originalUnitPriceSet: null,
                        discountedUnitPriceSet: {
                          shopMoney: { amount: "40.00", currencyCode: "USD" },
                          presentmentMoney: { amount: "40.00", currencyCode: "USD" },
                        },
                        originalTotalSet: null,
                        discountedTotalSet: {
                          shopMoney: { amount: "80.00", currencyCode: "USD" },
                          presentmentMoney: { amount: "80.00", currencyCode: "USD" },
                        },
                        variant: {
                          id: "gid://shopify/ProductVariant/20",
                          title: "Blue",
                          sku: "SKU-20",
                          product: { id: "gid://shopify/Product/2000" },
                        },
                      },
                    },
                    {
                      node: {
                        title: "Product C",
                        variantTitle: "Red",
                        quantity: 4,
                        originalUnitPriceSet: null,
                        discountedUnitPriceSet: null,
                        originalTotalSet: {
                          shopMoney: { amount: "60.00", currencyCode: "USD" },
                          presentmentMoney: { amount: "60.00", currencyCode: "USD" },
                        },
                        discountedTotalSet: null,
                        variant: {
                          id: "gid://shopify/ProductVariant/30",
                          title: "Red",
                          sku: "SKU-30",
                          product: { id: "gid://shopify/Product/3000" },
                        },
                      },
                    },
                    {
                      node: {
                        title: "Product D",
                        variantTitle: "Green",
                        quantity: 5,
                        originalUnitPriceSet: null,
                        discountedUnitPriceSet: null,
                        originalTotalSet: null,
                        discountedTotalSet: {
                          shopMoney: { amount: "55.00", currencyCode: "USD" },
                          presentmentMoney: { amount: "55.00", currencyCode: "USD" },
                        },
                        variant: {
                          id: "gid://shopify/ProductVariant/40",
                          title: "Green",
                          sku: "SKU-40",
                          product: { id: "gid://shopify/Product/4000" },
                        },
                      },
                    },
                  ],
                },

                refunds: [
                  {
                    totalRefundedSet: {
                      shopMoney: { amount: "9.99", currencyCode: "USD" },
                      presentmentMoney: { amount: "9.99", currencyCode: "USD" },
                    },
                    transactions: {
                      nodes: [],
                    },
                  },
                ],
              },
            },
          ],
        },
      });

    const out = await fetchOrdersGraphql({
      shop: "test-shop.myshopify.com",
      accessToken: "token_123",
      days: 30,
      apiVersion: "2024-01",
    });

    expect(graphqlMock).toHaveBeenCalledTimes(2);

    const firstCall = graphqlMock.mock.calls[0];
    expect(firstCall[0]).toBe("/admin/api/2024-01/graphql.json");
    expect(firstCall[2]).toMatchObject({
      first: 250,
      after: null,
    });
    expect(String(firstCall[2].query)).toContain("status:any created_at:>=");

    const secondCall = graphqlMock.mock.calls[1];
    expect(secondCall[2]).toMatchObject({
      first: 250,
      after: "cursor-1",
    });

    expect(out).toHaveLength(2);

    const order1 = out[0];
    expect(order1.id).toBe(111);
    expect(order1.name).toBe("#111");
    expect(order1.created_at).toBe("2026-03-01T10:00:00Z");
    expect(order1.currency).toBe("EUR");
    expect(order1.total_price).toBe("100.00");
    expect(order1.current_total_price).toBe("100.00");
    expect(order1.total_shipping_price_set.shop_money.amount).toBe("5.00");
    expect(order1.line_items).toHaveLength(1);
    expect(order1.line_items[0].variant_id).toBe(10);
    expect(order1.line_items[0].product_id).toBe(1000);
    expect(order1.line_items[0].price).toBe("12.50");
    expect(order1.refunds[0].transactions).toEqual([{ amount: "3.00" }]);

    const order2 = out[1];
    expect(order2.id).toBe(222);
    expect(order2.currency).toBe("USD");
    expect(order2.total_price).toBe("200.00");
    expect(order2.current_total_price).toBe("180.00");
    expect(order2.line_items).toHaveLength(3);

    expect(order2.line_items[0].price).toBe("40.00");
    expect(order2.line_items[1].price).toBe("15");
    expect(order2.line_items[2].price).toBe("11");
    expect(order2.refunds[0].transactions).toEqual([{ amount: "9.99" }]);
  });

  it("fetchOrderByIdGraphql returns null when order missing", async () => {
    graphqlMock.mockResolvedValueOnce({
      order: null,
    });

    const out = await fetchOrderByIdGraphql({
      shop: "test-shop.myshopify.com",
      accessToken: "token_123",
      orderId: "999",
      apiVersion: "2024-01",
    });

    expect(out).toBeNull();

    const call = graphqlMock.mock.calls[0];
    expect(call[0]).toBe("/admin/api/2024-01/graphql.json");
    expect(call[2]).toEqual({
      id: "gid://shopify/Order/999",
    });
  });

  it("fetchOrderByIdGraphql normalizes single order payload", async () => {
    graphqlMock.mockResolvedValueOnce({
      order: {
        id: "gid://shopify/Order/777",
        name: "#777",
        createdAt: "2026-03-05T12:00:00Z",
        processedAt: "2026-03-05T12:05:00Z",
        currencyCode: "GBP",
        displayFinancialStatus: "PAID",
        displayFulfillmentStatus: "FULFILLED",

        totalPriceSet: {
          shopMoney: { amount: "77.00", currencyCode: "GBP" },
          presentmentMoney: { amount: "77.00", currencyCode: "GBP" },
        },
        currentTotalPriceSet: {
          shopMoney: { amount: "70.00", currencyCode: "GBP" },
          presentmentMoney: { amount: "70.00", currencyCode: "GBP" },
        },
        totalShippingPriceSet: {
          shopMoney: { amount: "7.00", currencyCode: "GBP" },
          presentmentMoney: { amount: "7.00", currencyCode: "GBP" },
        },

        lineItems: {
          edges: [
            {
              node: {
                title: "Single Product",
                variantTitle: "XL",
                quantity: 1,
                originalUnitPriceSet: {
                  shopMoney: { amount: "70.00", currencyCode: "GBP" },
                  presentmentMoney: { amount: "70.00", currencyCode: "GBP" },
                },
                discountedUnitPriceSet: null,
                originalTotalSet: {
                  shopMoney: { amount: "70.00", currencyCode: "GBP" },
                  presentmentMoney: { amount: "70.00", currencyCode: "GBP" },
                },
                discountedTotalSet: null,
                variant: {
                  id: "gid://shopify/ProductVariant/700",
                  title: "XL",
                  sku: "SKU-700",
                  product: { id: "gid://shopify/Product/7000" },
                },
              },
            },
          ],
        },

        refunds: [],
      },
    });

    const out = await fetchOrderByIdGraphql({
      shop: "test-shop.myshopify.com",
      accessToken: "token_123",
      orderId: "777",
      apiVersion: "2024-01",
    });

    expect(out).not.toBeNull();
    expect(out.id).toBe(777);
    expect(out.name).toBe("#777");
    expect(out.currency).toBe("GBP");
    expect(out.total_price).toBe("77.00");
    expect(out.current_total_price).toBe("70.00");
    expect(out.line_items).toHaveLength(1);
    expect(out.line_items[0].variant_id).toBe(700);
    expect(out.line_items[0].product_id).toBe(7000);
    expect(out.line_items[0].sku).toBe("SKU-700");
    expect(out.line_items[0].price).toBe("70.00");
    expect(out.refunds).toEqual([]);
    expect(out.shipping_lines).toEqual([]);
  });

  it("fetchOrdersGraphql handles empty pages", async () => {
    graphqlMock.mockResolvedValueOnce({
      orders: {
        pageInfo: { hasNextPage: false, endCursor: null },
        edges: [],
      },
    });

    const out = await fetchOrdersGraphql({
      shop: "test-shop.myshopify.com",
      accessToken: "token_123",
      days: 7,
      apiVersion: "2024-01",
    });

    expect(out).toEqual([]);
    expect(graphqlMock).toHaveBeenCalledTimes(1);
  });

  it("fetchOrdersGraphql tolerates missing optional structures", async () => {
    graphqlMock.mockResolvedValueOnce({
      orders: {
        pageInfo: { hasNextPage: false, endCursor: null },
        edges: [
          {
            node: {
              id: "gid://shopify/Order/333",
              name: "#333",
              createdAt: null,
              processedAt: null,
              currencyCode: null,
              displayFinancialStatus: null,
              displayFulfillmentStatus: null,
              totalPriceSet: null,
              currentTotalPriceSet: null,
              totalShippingPriceSet: null,
              lineItems: null,
              refunds: null,
            },
          },
        ],
      },
    });

    const out = await fetchOrdersGraphql({
      shop: "test-shop.myshopify.com",
      accessToken: "token_123",
      days: 7,
      apiVersion: "2024-01",
    });

    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 333,
      name: "#333",
      created_at: null,
      processed_at: null,
      currency: null,
      total_price: "0",
      current_total_price: "0",
      line_items: [],
      refunds: [],
      shipping_lines: [],
    });
  });
});