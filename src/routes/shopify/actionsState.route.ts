import type { FastifyInstance } from "fastify";
import type { ShopifyCtx } from "./ctx.js";
import { parseShop } from "./helpers.js";

import type { ActionStatus } from "../../storage/actionPlanStateStore.js";

function normalizeStatus(x: any): ActionStatus {
  const s = String(x || "").toUpperCase();
  if (s === "OPEN" || s === "IN_PROGRESS" || s === "DONE" || s === "DISMISSED") return s as ActionStatus;
  return "OPEN";
}

export function registerActionsStateRoutes(app: FastifyInstance, ctx: ShopifyCtx) {
  // List all persisted states (UI hydration)
  app.get("/api/actions/state", async (req, reply) => {
    try {
      const q = req.query as any;
      const shop = parseShop(q, ctx.shop);
      if (!shop) {
        return reply.status(400).send({ error: "shop is required (valid *.myshopify.com)" });
      }

      const actionPlanStateStore = shop === ctx.shop
        ? ctx.actionPlanStateStore
        : await ctx.getActionPlanStateStoreForShop(shop);

      await actionPlanStateStore.ensureLoaded();
      const items = await actionPlanStateStore.list();

      return reply.send({
        shop,
        updatedAt: actionPlanStateStore.getUpdatedAtSync(),
        states: items,
      });
    } catch (err: any) {
      const status = err?.status && Number.isFinite(err.status) ? err.status : 500;
      return reply.status(status).send({ error: "Unexpected error", details: String(err?.message ?? err) });
    }
  });

  // Upsert status/note/dueDate
  app.patch("/api/actions/state", async (req, reply) => {
    try {
      const q = req.query as any;
      const shop = parseShop(q, ctx.shop);
      if (!shop) {
        return reply.status(400).send({ error: "shop is required (valid *.myshopify.com)" });
      }

      const actionPlanStateStore = shop === ctx.shop
        ? ctx.actionPlanStateStore
        : await ctx.getActionPlanStateStoreForShop(shop);

      const body = (req.body ?? {}) as any;

      const actionId = String(body?.actionId ?? "").trim();
      if (!actionId) return reply.status(400).send({ error: "actionId is required" });

      const status = body?.status === undefined ? undefined : normalizeStatus(body.status);
      const note = body?.note === undefined ? undefined : (body.note === null ? null : String(body.note));
      const dueDate = body?.dueDate === undefined ? undefined : (body.dueDate === null ? null : String(body.dueDate));
      const dismissedReason =
        body?.dismissedReason === undefined ? undefined : (body.dismissedReason === null ? null : String(body.dismissedReason));

      const rec = await actionPlanStateStore.upsert({
        actionId,
        status,
        note,
        dueDate,
        dismissedReason,
      });

      return reply.send({ ok: true, shop, record: rec });
    } catch (err: any) {
      const status = err?.status && Number.isFinite(err.status) ? err.status : 500;
      return reply.status(status).send({ error: "Unexpected error", details: String(err?.message ?? err) });
    }
  });
}