// src/routes/shopify.ts
import { FastifyInstance } from "fastify";
import { createShopifyCtx } from "./shopify/ctx";

import { registerOrdersSummaryRoute } from "./shopify/ordersSummary.route";
import { registerOrdersProfitRoute } from "./shopify/ordersProfit.route";
import { registerDailyProfitRoute } from "./shopify/dailyProfit.route";
import { registerProductsProfitRoute } from "./shopify/productsProfit.route";
import { registerProfitKillersRoute } from "./shopify/profitKillers.route";
import { registerCogsOverridesRoutes } from "./shopify/cogsOverrides.route";
import { registerProfitScenariosRoute } from "./shopify/profitScenarios.route";

import { registerOpportunityDeepDiveRoute } from "./shopify/opportunityDeepDive.route";
import { registerOrderAuditRoute } from "./shopify/orderAudit.route";

import { registerActionsPlanRoute } from "./shopify/actionsPlan.route";
import { registerActionsStateRoutes } from "./shopify/actionsState.route";

import { registerCostModelRoutes } from "./shopify/costModel.route";
import { registerDashboardOverviewRoute } from "./shopify/dashboardOverview.route";

// ✅ NEW
import { registerShopifyOAuthRoutes } from "./shopify/oauth.route";
import { registerShopifyWebhooksRoutes } from "./shopify/webhooks.route";

export async function registerShopifyRoutes(app: FastifyInstance) {
  // ✅ OAuth + Webhooks first (no domain impact)
  await registerShopifyOAuthRoutes(app);
  await registerShopifyWebhooksRoutes(app);

  // existing ctx-based routes
  const ctx = await createShopifyCtx(app);

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