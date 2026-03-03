// src/domain/opportunities/deepDive/drivers/fees.ts
import { round2 } from "../../../../utils/money.js";
import type { OrderProfitRow, ProductProfitRow } from "../../../insights/types.js";
import type { DeepDiveDriver } from "../types.js";
import { finalizeShares } from "../deepDive.utils.js";

export function buildFeeDrivers(params: {
  type: any;
  orders: OrderProfitRow[];
  products: ProductProfitRow[];
  limit: number;
}) {
  const { products, limit } = params;

  const totalFees = products.reduce((s, p: any) => s + Number((p as any).paymentFeesAllocated || 0), 0);

  const drivers: DeepDiveDriver[] = [...products]
    .map((p: any) => {
      const fees = Number(p.paymentFeesAllocated || 0);
      const net = Number((p as any).netSales || 0);
      const feePct = net > 0 ? (fees / net) * 100 : 0;

      return {
        key: `variant:${p.variantId}`,
        productId: p.productId,
        variantId: p.variantId,
        title: String(p.title || ""),
        sku: p.sku ?? null,
        variantTitle: p.variantTitle ?? null,
        impact: Math.max(0, fees),
        impactSharePct: 0,
        metrics: {
          paymentFeesAllocated: round2(fees),
          netSales: round2(net),
          feeRatePctOfNetSales: round2(feePct),
          qty: Number((p as any).qty || 0),
        },
      } as DeepDiveDriver;
    })
    .sort((a, b) => Number(b.impact || 0) - Number(a.impact || 0))
    .slice(0, limit);

  return finalizeShares(drivers, totalFees);
}
