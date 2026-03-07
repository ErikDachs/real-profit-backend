import { round2 } from "../../../../utils/money.js";
import type { OrderProfitRow, ProductProfitRow } from "../../../insights/types.js";
import type { DeepDiveDriver } from "../types.js";
import { finalizeShares } from "../deepDive.utils.js";

export function buildMissingCogsDrivers(params: {
  type: any;
  orders: OrderProfitRow[];
  products: ProductProfitRow[];
  limit: number;
}) {
  const { products, limit } = params;

  const missing = [...products]
    .map((p) => {
      const net = Number(p.netSales || 0);
      const qty = Number(p.qty || 0);
      const hasMissingCogs = Boolean(p.hasMissingCogs);

      return { p, net, qty, hasMissingCogs };
    })
    .filter((x) => x.hasMissingCogs && x.qty > 0 && x.net > 0);

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
        impact: Math.max(0, net),
        impactSharePct: 0,
        metrics: {
          netSalesExposure: round2(net),
          qty,
          missingCogsFlag: 1,
        },
      };
    })
    .sort((a, b) => Number(b.impact || 0) - Number(a.impact || 0))
    .slice(0, limit);

  return finalizeShares(drivers, totalExposure);
}