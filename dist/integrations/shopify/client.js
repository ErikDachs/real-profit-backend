// src/integrations/shopify/client.ts
import fetch from "node-fetch";
export function createShopifyClient(params) {
    const { shopDomain, accessToken } = params;
    return {
        async get(path) {
            const url = `https://${shopDomain}${path}`;
            const res = await fetch(url, {
                headers: {
                    "X-Shopify-Access-Token": accessToken,
                    "Content-Type": "application/json",
                },
            });
            if (!res.ok) {
                const text = await res.text();
                const err = new Error(`Shopify API error ${res.status}: ${text}`);
                err.status = res.status;
                throw err;
            }
            return res.json();
        },
    };
}
