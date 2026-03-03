// src/domain/opportunities/deepDive/drivers/missingCogs.ts
import { round2 } from "../../../../utils/money";
import type { OrderProfitRow, ProductProfitRow } from "../../../insights/types";
import type { DeepDiveDriver } from "../types";
import { finalizeShares } from "../deepDive.utils";

export function buildMissingCogsDrivers(params: {
  type: any;
  orders: OrderProfitRow[];
  products: ProductProfitRow[];
  limit: number;
}) {
  const { products, limit } = params;

  const missing = [...products]
    .map((p: any) => {
      const cogs = Number(p.cogs || 0);
      const net = Number((p as any).netSales || 0);
      const qty = Number((p as any).qty || 0);
      return { p, cogs, net, qty };
    })
    .filter((x) => x.qty > 0 && x.net > 0 && x.cogs === 0);

  const totalExposure = missing.reduce((s, x) => s + Number(x.net || 0), 0);

  const drivers: DeepDiveDriver[] = missing
    .map(({ p, net, qty }) => {
      return {
        key: `variant:${p.variantId}`,
        productId: p.productId,
        variantId: p.variantId,
        title: String(p.title || ""),
        sku: p.sku ?? null,
        variantTitle: p.variantTitle ?? null,
        impact: Math.max(0, net), // exposure proxy
        impactSharePct: 0,
        metrics: {
          netSalesExposure: round2(net),
          qty: qty,
        },
      } as DeepDiveDriver;
    })
    .sort((a, b) => Number(b.impact || 0) - Number(a.impact || 0))
    .slice(0, limit);

  return finalizeShares(drivers, totalExposure);
}