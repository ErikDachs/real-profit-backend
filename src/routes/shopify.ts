import { FastifyInstance } from "fastify";
import { createShopifyCtx } from "./shopify/ctx.js";

import { registerOrdersSummaryRoute } from "./shopify/ordersSummary.route.js";
import { registerOrdersProfitRoute } from "./shopify/ordersProfit.route.js";
import { registerDailyProfitRoute } from "./shopify/dailyProfit.route.js";
import { registerProductsProfitRoute } from "./shopify/productsProfit.route.js";
import { registerProfitKillersRoute } from "./shopify/profitKillers.route.js";
import { registerCogsOverridesRoutes } from "./shopify/cogsOverrides.route.js";
import { registerProfitScenariosRoute } from "./shopify/profitScenarios.route.js";

import { registerOpportunityDeepDiveRoute } from "./shopify/opportunityDeepDive.route.js";
import { registerOrderAuditRoute } from "./shopify/orderAudit.route.js";

import { registerActionsPlanRoute } from "./shopify/actionsPlan.route.js";
import { registerActionsStateRoutes } from "./shopify/actionsState.route.js";

import { registerCostModelRoutes } from "./shopify/costModel.route.js";
import { registerDashboardOverviewRoute } from "./shopify/dashboardOverview.route.js";

import { registerShopifyOAuthRoutes } from "./shopify/oauth.route.js";
import { registerShopifyWebhooksRoutes } from "./shopify/webhooks.route.js";
import { registerBillingRoutes } from "./shopify/billing.route.js";

export async function registerShopifyRoutes(app: FastifyInstance) {
  await registerShopifyOAuthRoutes(app);
  await registerShopifyWebhooksRoutes(app);

  const ctx = await createShopifyCtx(app);

  registerBillingRoutes(app, ctx);

  registerCostModelRoutes(app, ctx);
  registerDashboardOverviewRoute(app, ctx);

  registerOrdersSummaryRoute(app, ctx);
  registerOrdersProfitRoute(app, ctx);
  registerDailyProfitRoute(app, ctx);
  registerProductsProfitRoute(app, ctx);

  registerProfitKillersRoute(app, ctx);
  registerProfitScenariosRoute(app, ctx);

  registerOpportunityDeepDiveRoute(app, ctx);
  registerOrderAuditRoute(app, ctx);

  registerActionsPlanRoute(app, ctx);
  registerActionsStateRoutes(app, ctx);

  registerCogsOverridesRoutes(app, ctx);
}