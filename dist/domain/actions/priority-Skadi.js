function clamp01(x) {
    if (!Number.isFinite(x))
        return 0;
    return Math.max(0, Math.min(1, x));
}
export function effortWeight(e) {
    // Lower effort => higher score
    if (e === "LOW")
        return 1.0;
    if (e === "MEDIUM")
        return 0.75;
    return 0.5;
}
/**
 * Deterministic "impact curve" that compresses big values but is monotonic.
 * 0 -> 0
 * 100 -> 50
 * 1000 -> ~90.9
 */
export function impactScoreFromGain(monthlyGain) {
    const g = Math.max(0, Number(monthlyGain || 0));
    if (g <= 0)
        return 0;
    // simple saturating curve (no log)
    const scaled = g / (g + 100); // 0..1
    return scaled * 100;
}
/**
 * Single SSOT priority score (0..100).
 * Inputs MUST already be SSOT-derived (impact from simulation; confidenceScore deterministic).
 */
export function computePriorityScore(params) {
    const impact = impactScoreFromGain(params.estimatedMonthlyGain);
    const wEffort = effortWeight(params.effort);
    const wConf = clamp01(params.confidenceScore);
    const raw = impact * wEffort * wConf;
    const clamped = Math.max(0, Math.min(100, raw));
    return Math.round(clamped * 10) / 10; // stable 0.1 resolution
}
