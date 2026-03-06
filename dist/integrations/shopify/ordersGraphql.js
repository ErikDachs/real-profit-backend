// src/integrations/shopify/ordersGraphql.ts
import { createShopifyClient } from "./client.js";
function isoSince(days) {
    const ms = Math.max(0, Number(days) || 0) * 24 * 60 * 60 * 1000;
    return new Date(Date.now() - ms).toISOString();
}
function parseGidNumber(gid) {
    if (!gid)
        return 0;
    const m = String(gid).match(/\/(\d+)(\?.*)?$/);
    return m ? Number(m[1]) : 0;
}
function moneyAmount(node) {
    const a = node?.shopMoney?.amount;
    if (a === null || a === undefined)
        return "0";
    return String(a);
}
function buildMoneySet(node) {
    const shop = moneyAmount(node);
    const pres = node?.presentmentMoney?.amount ?? node?.shopMoney?.amount ?? "0";
    return {
        shop_money: { amount: String(shop), currency_code: node?.shopMoney?.currencyCode ?? null },
        presentment_money: { amount: String(pres), currency_code: node?.presentmentMoney?.currencyCode ?? null },
    };
}
function normalizeListOrConnection(input) {
    // Accept either:
    // - [ {..}, {..} ]
    // - { nodes: [ {...}, {...} ] }
    // - { edges: [ { node: {...} } ] }
    if (!input)
        return [];
    if (Array.isArray(input))
        return input;
    const nodes = input?.nodes;
    if (Array.isArray(nodes))
        return nodes.filter(Boolean);
    const edges = input?.edges;
    if (Array.isArray(edges))
        return edges.map((e) => e?.node).filter(Boolean);
    return [];
}
function toRestLikeOrder(gql) {
    const idNum = parseGidNumber(gql?.id);
    const totalPriceSet = gql?.totalPriceSet;
    const currentTotalPriceSet = gql?.currentTotalPriceSet;
    const totalShippingPriceSet = gql?.totalShippingPriceSet;
    const total_price = totalPriceSet?.shopMoney?.amount ?? "0";
    const current_total_price = currentTotalPriceSet?.shopMoney?.amount ?? total_price;
    // lineItems is a connection in Shopify GraphQL
    const lineNodes = normalizeListOrConnection(gql?.lineItems);
    const line_items = lineNodes.map((n) => {
        const variantId = parseGidNumber(n?.variant?.id);
        const productId = parseGidNumber(n?.variant?.product?.id);
        return {
            variant_id: variantId || null,
            product_id: productId || null,
            quantity: Number(n?.quantity ?? 0) || 0,
            title: n?.title ?? null,
            sku: n?.variant?.sku ?? null,
        };
    });
    // refunds: Shopify can surface as list or connection depending on context/version.
    // We'll accept both.
    const refundNodes = normalizeListOrConnection(gql?.refunds);
    const refunds = refundNodes.map((r) => {
        // Refund.transactions is documented as OrderTransactionConnection (connection),
        // but we support list/connection defensively anyway.
        const txNodes = normalizeListOrConnection(r?.transactions);
        let transactions = txNodes.map((t) => {
            // OrderTransaction.amountSet exists on the node; use shopMoney amount for deterministic accounting.
            const amt = t?.amountSet?.shopMoney?.amount ?? "0";
            return { amount: String(amt) };
        });
        // Defensive fallback:
        // If transactions are missing/empty but refund has a totalRefundedSet, synthesize one tx.
        // This keeps your Domain extractor working and avoids silent 0-refund bugs.
        if (transactions.length === 0) {
            const totalRefundedAmt = r?.totalRefundedSet?.shopMoney?.amount;
            if (totalRefundedAmt !== null && totalRefundedAmt !== undefined) {
                transactions = [{ amount: String(totalRefundedAmt) }];
            }
        }
        return { transactions };
    });
    return {
        id: idNum || gql?.id,
        name: gql?.name ?? null,
        created_at: gql?.createdAt ?? null,
        processed_at: gql?.processedAt ?? null,
        currency: gql?.currencyCode ?? null,
        financial_status: gql?.displayFinancialStatus ?? null,
        fulfillment_status: gql?.displayFulfillmentStatus ?? null,
        total_price: String(total_price ?? "0"),
        current_total_price: String(current_total_price ?? "0"),
        total_shipping_price_set: buildMoneySet(totalShippingPriceSet),
        line_items,
        refunds,
        // Keep compatibility with shipping extractor fallback
        shipping_lines: [],
    };
}
const ORDERS_QUERY = `
query OrdersSince($first: Int!, $after: String, $query: String!) {
  orders(first: $first, after: $after, query: $query, sortKey: CREATED_AT, reverse: true) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        id
        name
        createdAt
        processedAt
        currencyCode
        displayFinancialStatus
        displayFulfillmentStatus

        totalPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
        currentTotalPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
        totalShippingPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }

        lineItems(first: 250) {
          edges {
            node {
              title
              quantity
              variant {
                id
                sku
                product { id }
              }
            }
          }
        }

        refunds {
          totalRefundedSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
          transactions(first: 50) {
            nodes {
              amountSet {
                shopMoney { amount currencyCode }
                presentmentMoney { amount currencyCode }
              }
              status
            }
          }
        }
      }
    }
  }
}
`;
const ORDER_BY_ID_QUERY = `
query OrderById($id: ID!) {
  order(id: $id) {
    id
    name
    createdAt
    processedAt
    currencyCode
    displayFinancialStatus
    displayFulfillmentStatus

    totalPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
    currentTotalPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
    totalShippingPriceSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }

    lineItems(first: 250) {
      edges {
        node {
          title
          quantity
          variant {
            id
            sku
            product { id }
          }
        }
      }
    }

    refunds {
      totalRefundedSet { shopMoney { amount currencyCode } presentmentMoney { amount currencyCode } }
      transactions(first: 50) {
        nodes {
          amountSet {
            shopMoney { amount currencyCode }
            presentmentMoney { amount currencyCode }
          }
          status
        }
      }
    }
  }
}
`;
function ordersQueryString(params) {
    // Keep it simple & PII-free
    return `status:any created_at:>=${params.sinceIso}`;
}
export async function fetchOrdersGraphql(params) {
    const apiVersion = params.apiVersion ?? "2024-01";
    const shopify = createShopifyClient({ shopDomain: params.shop, accessToken: params.accessToken });
    const sinceIso = isoSince(params.days);
    const query = ordersQueryString({ sinceIso });
    const path = `/admin/api/${apiVersion}/graphql.json`;
    const out = [];
    let after = null;
    for (;;) {
        const data = await shopify.graphql(path, ORDERS_QUERY, {
            first: 250,
            after,
            query,
        });
        const edges = data?.orders?.edges ?? [];
        for (const e of edges)
            out.push(toRestLikeOrder(e.node));
        const pageInfo = data?.orders?.pageInfo;
        if (!pageInfo?.hasNextPage)
            break;
        after = pageInfo.endCursor ?? null;
        if (!after)
            break;
    }
    return out;
}
export async function fetchOrderByIdGraphql(params) {
    const apiVersion = params.apiVersion ?? "2024-01";
    const shopify = createShopifyClient({ shopDomain: params.shop, accessToken: params.accessToken });
    const gid = `gid://shopify/Order/${String(params.orderId).trim()}`;
    const path = `/admin/api/${apiVersion}/graphql.json`;
    const data = await shopify.graphql(path, ORDER_BY_ID_QUERY, { id: gid });
    if (!data?.order)
        return null;
    return toRestLikeOrder(data.order);
}
