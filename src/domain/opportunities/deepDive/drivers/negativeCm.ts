// src/domain/opportunities/deepDive/drivers/negativeCm.ts
import { round2 } from "../../../../utils/money.js";
import type { OrderProfitRow, ProductProfitRow } from "../../../insights/types.js";
import type { DeepDiveDriver } from "../types.js";
import { finalizeShares } from "../deepDive.utils.js";

export function buildNegativeCmDrivers(params: {
  type: any;
  orders: OrderProfitRow[];
  products: ProductProfitRow[];
  limit: number;
}) {
  const { products, limit } = params;

  const rows: DeepDiveDriver[] = [...products].map((p: any) => {
    const profit = Number(p.profitAfterAds ?? p.profitAfterFees ?? 0);
    const loss = profit < 0 ? Math.abs(profit) : 0;

    return {
      key: `variant:${p.variantId}`,
      productId: p.productId,
      variantId: p.variantId,
      title: String(p.title || ""),
      sku: p.sku ?? null,
      variantTitle: p.variantTitle ?? null,
      impact: loss,
      impactSharePct: 0,
      metrics: {
        profit: round2(profit),
        netSales: round2(Number((p as any).netSales || 0)),
        marginPct: round2(Number((p as any).marginPct || 0)),
        allocatedAdSpend: p.allocatedAdSpend !== undefined ? round2(Number(p.allocatedAdSpend || 0)) : undefined,
      },
    } as DeepDiveDriver;
  });

  const totalLoss = rows.reduce((s, d) => s + Number(d.impact || 0), 0);

  const drivers = rows
    .filter((d) => Number(d.impact || 0) > 0)
    .sort((a, b) => Number(b.impact || 0) - Number(a.impact || 0))
    .slice(0, limit);

  return finalizeShares(drivers, totalLoss);
}
