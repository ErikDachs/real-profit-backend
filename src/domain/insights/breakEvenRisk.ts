// src/domain/insights/breakEvenRisk.ts
import { round2 } from "../../utils/money.js";

export type BreakEvenRiskResult = {
  type: "breakEvenRisk";
  currency: string;
  periodDays: number;

  adSpend: number | null;
  currentRoas: number | null;
  breakEvenRoas: number | null;

  status: "BURNING_CASH" | "BREAK_EVEN" | "PROFITABLE" | "INSUFFICIENT_INPUT";

  // deterministic loss in period when burning cash (>=0)
  lossInPeriod: number;

  meta: {
    roasGap: number | null; // current - breakEven
  };
};

export function computeBreakEvenRisk(params: {
  currency: string;
  days: number;

  adSpend?: number | null;
  currentRoas?: number | null;
  breakEvenRoas?: number | null;

  // If you already have it (from buildAdIntelligence), you can pass it
  monthlyLeakIfBelowBreakEven?: number | null;
  status?: BreakEvenRiskResult["status"] | null;
}): BreakEvenRiskResult | null {
  const currency = params.currency || "USD";
  const periodDays = Math.max(1, Number(params.days || 0));

  const spend = params.adSpend ?? null;
  const roas = params.currentRoas ?? null;
  const be = params.breakEvenRoas ?? null;

  const status = (params.status ?? null) as BreakEvenRiskResult["status"] | null;

  // If there is no spend+roas (or no status), we can’t determine burn reliably.
  if (!status || status === "INSUFFICIENT_INPUT") {
    // only return something if user provided enough to be meaningful
    if (!(Number.isFinite(Number(spend)) && Number.isFinite(Number(roas)) && Number.isFinite(Number(be)))) return null;
  }

  const roasGap =
    Number.isFinite(Number(roas)) && Number.isFinite(Number(be)) ? round2(Number(roas) - Number(be)) : null;

  const leak =
    status === "BURNING_CASH"
      ? round2(Math.max(0, Number(params.monthlyLeakIfBelowBreakEven ?? 0)))
      : 0;

  return {
    type: "breakEvenRisk",
    currency,
    periodDays,
    adSpend: Number.isFinite(Number(spend)) ? round2(Number(spend)) : null,
    currentRoas: Number.isFinite(Number(roas)) ? round2(Number(roas)) : null,
    breakEvenRoas: be === null ? null : round2(Number(be)),
    status: status ?? "INSUFFICIENT_INPUT",
    lossInPeriod: leak,
    meta: { roasGap },
  };
}
