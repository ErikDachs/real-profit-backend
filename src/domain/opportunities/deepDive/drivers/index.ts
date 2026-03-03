// src/domain/opportunities/deepDive/drivers/index.ts
import type { OpportunityType } from "../../types.js";
import type { OrderProfitRow, ProductProfitRow } from "../../../insights/types.js";
import type { DeepDiveDriver } from "../types.js";

import { buildRefundDrivers } from "./refunds.js";
import { buildFeeDrivers } from "./fees.js";
import { buildShippingDrivers } from "./shipping.js";
import { buildMissingCogsDrivers } from "./missingCogs.js";
import { buildNegativeCmDrivers } from "./negativeCm.js";
import { buildLowMarginDrivers } from "./lowMargin.js";

export function mkDrivers(params: {
  type: OpportunityType;
  orders: OrderProfitRow[];
  products: ProductProfitRow[];
  limit: number;
}): { totalImpact: number; drivers: DeepDiveDriver[] } {
  const { type } = params;

  if (type === "HIGH_REFUNDS") return buildRefundDrivers(params);
  if (type === "HIGH_FEES") return buildFeeDrivers(params);
  if (type === "SHIPPING_SUBSIDY") return buildShippingDrivers(params);
  if (type === "MISSING_COGS") return buildMissingCogsDrivers(params);
  if (type === "NEGATIVE_CM") return buildNegativeCmDrivers(params);

  // default: LOW_MARGIN (and any future unknown falls back)
  return buildLowMarginDrivers(params);
}
