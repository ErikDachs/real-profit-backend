// src/domain/opportunities/deepDive/drivers/index.ts
import type { OpportunityType } from "../../types";
import type { OrderProfitRow, ProductProfitRow } from "../../../insights/types";
import type { DeepDiveDriver } from "../types";

import { buildRefundDrivers } from "./refunds";
import { buildFeeDrivers } from "./fees";
import { buildShippingDrivers } from "./shipping";
import { buildMissingCogsDrivers } from "./missingCogs";
import { buildNegativeCmDrivers } from "./negativeCm";
import { buildLowMarginDrivers } from "./lowMargin";

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