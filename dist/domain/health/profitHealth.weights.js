// src/domain/health/profitHealth.weights.ts
import { round2 } from "../../utils/money.js";
import { clamp } from "./profitHealth.scoring.js";
export function normalizeWeights(weights) {
    const entries = Object.entries(weights).filter(([, v]) => Number.isFinite(v) && v > 0);
    const sum = entries.reduce((s, [, v]) => s + v, 0);
    const out = {};
    for (const [k, v] of entries)
        out[k] = sum > 0 ? v / sum : 0;
    for (const k of Object.keys(weights))
        if (out[k] === undefined)
            out[k] = 0;
    return out;
}
export function impactFrom(componentScore, normalizedWeight) {
    const deficit = clamp(100 - componentScore, 0, 100);
    return -round2(deficit * normalizedWeight);
}
export function mkDriver(params) {
    return {
        type: params.type,
        title: params.title,
        explanation: params.explanation,
        impact: round2(params.impact),
        ...(params.meta ? { meta: params.meta } : {}),
    };
}
