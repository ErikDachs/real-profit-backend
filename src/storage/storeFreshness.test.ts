import { describe, it, expect } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { CogsOverridesStore } from "./cogsOverridesStore.js";
import { CostModelOverridesStore } from "./costModelOverridesStore.js";
import { ActionPlanStateStore } from "./actionPlanStateStore.js";

describe("file-backed stores freshness / stale reload protection", () => {
  it("CogsOverridesStore reloads changes written by another instance", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "rp-cogs-fresh-"));
    const shop = "fresh-cogs.myshopify.com";

    const a = new CogsOverridesStore({ shop, dataDir });
    const b = new CogsOverridesStore({ shop, dataDir });

    await a.ensureLoaded();
    expect(await a.list()).toEqual([]);

    await b.upsert({
      variantId: 111,
      unitCost: 12.34,
      ignoreCogs: false,
    });

    await a.ensureFresh();

    const rows = await a.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.variantId).toBe(111);
    expect(rows[0]?.unitCost).toBe(12.34);
    expect(rows[0]?.ignoreCogs).toBe(false);
  });

  it("CostModelOverridesStore reloads changes written by another instance", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "rp-cost-fresh-"));
    const shop = "fresh-cost.myshopify.com";

    const a = new CostModelOverridesStore({ shop, dataDir });
    const b = new CostModelOverridesStore({ shop, dataDir });

    await a.ensureLoaded();
    expect(a.getOverridesSync()).toBeUndefined();

    await b.setOverrides({
      payment: {
        feePercent: 0.05,
        feeFixed: 0.5,
      },
      shipping: {
        costPerOrder: 7,
      },
    } as any);

    await a.ensureFresh();

    const out = a.getOverridesSync() as any;
    expect(out?.payment?.feePercent).toBe(0.05);
    expect(out?.payment?.feeFixed).toBe(0.5);
    expect(out?.shipping?.costPerOrder).toBe(7);
  });

  it("ActionPlanStateStore reloads changes written by another instance", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "rp-action-fresh-"));
    const shop = "fresh-actions.myshopify.com";

    const a = new ActionPlanStateStore({ shop, dataDir });
    const b = new ActionPlanStateStore({ shop, dataDir });

    await a.ensureLoaded();
    expect(await a.list()).toEqual([]);

    await b.upsert({
      actionId: "fix-refunds",
      status: "IN_PROGRESS",
      note: "Started",
      dueDate: "2026-03-31",
    });

    await a.ensureFresh();

    const rows = await a.list();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.actionId).toBe("fix-refunds");
    expect(rows[0]?.status).toBe("IN_PROGRESS");
    expect(rows[0]?.note).toBe("Started");
    expect(rows[0]?.dueDate).toBe("2026-03-31");
  });

  it("stores observe deletion after clear from another instance", async () => {
    const dataDir = await mkdtemp(path.join(tmpdir(), "rp-clear-fresh-"));
    const shop = "fresh-clear.myshopify.com";

    const cogsA = new CogsOverridesStore({ shop, dataDir });
    const cogsB = new CogsOverridesStore({ shop, dataDir });

    await cogsB.upsert({ variantId: 999, unitCost: 3.21 });
    await cogsA.ensureFresh();
    expect((await cogsA.list()).length).toBe(1);

    await cogsB.clearAll();
    await cogsA.ensureFresh();

    expect(await cogsA.list()).toEqual([]);
  });
});