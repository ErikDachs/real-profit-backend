// src/routes/shopify/actionsState.route.ts
import type { FastifyInstance } from "fastify";
import type { ShopifyCtx } from "./ctx.js";

import type { ActionStatus } from "../../storage/actionPlanStateStore.js";

function normalizeStatus(x: any): ActionStatus {
  const s = String(x || "").toUpperCase();
  if (s === "OPEN" || s === "IN_PROGRESS" || s === "DONE" || s === "DISMISSED") return s as ActionStatus;
  return "OPEN";
}

export function registerActionsStateRoutes(app: FastifyInstance, ctx: ShopifyCtx) {
  // List all persisted states (UI hydration)
  app.get("/api/actions/state", async (_req, reply) => {
    try {
      await ctx.actionPlanStateStore.ensureLoaded();
      const items = await ctx.actionPlanStateStore.list();

      return reply.send({
        shop: ctx.shop,
        updatedAt: ctx.actionPlanStateStore.getUpdatedAtSync(),
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
      const body = (req.body ?? {}) as any;

      const actionId = String(body?.actionId ?? "").trim();
      if (!actionId) return reply.status(400).send({ error: "actionId is required" });

      const status = body?.status === undefined ? undefined : normalizeStatus(body.status);
      const note = body?.note === undefined ? undefined : (body.note === null ? null : String(body.note));
      const dueDate = body?.dueDate === undefined ? undefined : (body.dueDate === null ? null : String(body.dueDate));
      const dismissedReason =
        body?.dismissedReason === undefined ? undefined : (body.dismissedReason === null ? null : String(body.dismissedReason));

      const rec = await ctx.actionPlanStateStore.upsert({
        actionId,
        status,
        note,
        dueDate,
        dismissedReason,
      });

      return reply.send({ ok: true, record: rec });
    } catch (err: any) {
      const status = err?.status && Number.isFinite(err.status) ? err.status : 500;
      return reply.status(status).send({ error: "Unexpected error", details: String(err?.message ?? err) });
    }
  });
}
