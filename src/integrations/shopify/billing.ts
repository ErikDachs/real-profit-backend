import type { ShopifyClient } from "./client.js";
import type { BillingPlanDef, BillingPlanKey } from "../../domain/billing/plans.js";
import { planFromSubscriptionName } from "../../domain/billing/plans.js";

export type ActiveSubscriptionInfo = {
  id: string;
  name: string;
  status: string;
  test: boolean;
  trialDays: number;
  currentPeriodEnd: string | null;
  lineItems: Array<{
    plan: {
      pricingDetails?: {
        __typename?: string;
        interval?: string;
        price?: {
          amount?: number | string;
          currencyCode?: string;
        };
      };
    };
  }>;
  planKey: BillingPlanKey | null;
};

type CurrentAppInstallationResponse = {
  currentAppInstallation: {
    activeSubscriptions: Array<{
      id: string;
      name: string;
      status: string;
      test: boolean;
      trialDays: number;
      currentPeriodEnd: string | null;
      lineItems: Array<{
        plan: {
          pricingDetails?: {
            __typename?: string;
            interval?: string;
            price?: {
              amount?: number | string;
              currencyCode?: string;
            };
          };
        };
      }>;
    }>;
  } | null;
};

type AppSubscriptionCreateResponse = {
  appSubscriptionCreate: {
    confirmationUrl: string | null;
    appSubscription: {
      id: string;
      name: string;
      status: string;
      test: boolean;
      trialDays: number;
    } | null;
    userErrors: Array<{
      field?: string[];
      message: string;
    }>;
  };
};

function graphqlPath(apiVersion: string) {
  return `/admin/api/${apiVersion}/graphql.json`;
}

export async function getActiveSubscriptions(params: {
  shopify: ShopifyClient;
  apiVersion: string;
}): Promise<ActiveSubscriptionInfo[]> {
  const query = `
    query CurrentAppInstallationBilling {
      currentAppInstallation {
        activeSubscriptions {
          id
          name
          status
          test
          trialDays
          currentPeriodEnd
          lineItems {
            plan {
              pricingDetails {
                __typename
                ... on AppRecurringPricing {
                  interval
                  price {
                    amount
                    currencyCode
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const data = await params.shopify.graphql<CurrentAppInstallationResponse>(
    graphqlPath(params.apiVersion),
    query
  );

  const rows = data?.currentAppInstallation?.activeSubscriptions ?? [];

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    test: Boolean(row.test),
    trialDays: Number(row.trialDays ?? 0),
    currentPeriodEnd: row.currentPeriodEnd ?? null,
    lineItems: Array.isArray(row.lineItems) ? row.lineItems : [],
    planKey: planFromSubscriptionName(row.name),
  }));
}

export async function getPrimaryActiveSubscription(params: {
  shopify: ShopifyClient;
  apiVersion: string;
}): Promise<ActiveSubscriptionInfo | null> {
  const subs = await getActiveSubscriptions(params);

  const prioritized =
    subs.find((s) => s.planKey === "scale") ||
    subs.find((s) => s.planKey === "pro") ||
    subs.find((s) => s.planKey === "starter") ||
    subs[0] ||
    null;

  return prioritized;
}

export async function createRecurringSubscription(params: {
  shopify: ShopifyClient;
  apiVersion: string;
  plan: BillingPlanDef;
  returnUrl: string;
  trialDays: number;
  test: boolean;
}) {
  const mutation = `
    mutation AppSubscriptionCreate(
      $name: String!,
      $returnUrl: URL!,
      $lineItems: [AppSubscriptionLineItemInput!]!,
      $trialDays: Int,
      $test: Boolean
    ) {
      appSubscriptionCreate(
        name: $name,
        returnUrl: $returnUrl,
        lineItems: $lineItems,
        trialDays: $trialDays,
        test: $test
      ) {
        userErrors {
          field
          message
        }
        appSubscription {
          id
          name
          status
          test
          trialDays
        }
        confirmationUrl
      }
    }
  `;

  const variables = {
    name: params.plan.name,
    returnUrl: params.returnUrl,
    trialDays: params.trialDays,
    test: params.test,
    lineItems: [
      {
        plan: {
          appRecurringPricingDetails: {
            price: {
              amount: params.plan.priceUsd,
              currencyCode: "USD",
            },
            interval: "EVERY_30_DAYS",
          },
        },
      },
    ],
  };

  const data = await params.shopify.graphql<AppSubscriptionCreateResponse>(
    graphqlPath(params.apiVersion),
    mutation,
    variables
  );

  const payload = data?.appSubscriptionCreate;
  if (!payload) {
    const err: any = new Error("Missing appSubscriptionCreate payload");
    err.status = 502;
    throw err;
  }

  if (payload.userErrors?.length) {
    const msg = payload.userErrors.map((e) => e.message).join(" | ");
    const err: any = new Error(msg || "Shopify billing user error");
    err.status = 400;
    throw err;
  }

  if (!payload.confirmationUrl) {
    const err: any = new Error("Missing Shopify confirmationUrl");
    err.status = 502;
    throw err;
  }

  return {
    confirmationUrl: payload.confirmationUrl,
    appSubscription: payload.appSubscription,
  };
}