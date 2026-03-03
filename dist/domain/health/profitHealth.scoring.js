export function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
}
export function pctOrNaN(numer, denom) {
    if (!Number.isFinite(numer) || !Number.isFinite(denom) || denom <= 0)
        return Number.NaN;
    return (numer / denom) * 100;
}
export function scoreHigherIsBetter(value, t) {
    if (!Number.isFinite(value))
        return 0;
    if (value <= t.low)
        return 0;
    if (value <= t.ok) {
        const k = (value - t.low) / (t.ok - t.low);
        return 60 * clamp(k, 0, 1);
    }
    if (value <= t.good) {
        const k = (value - t.ok) / (t.good - t.ok);
        return 60 + 25 * clamp(k, 0, 1);
    }
    if (value <= t.great) {
        const k = (value - t.good) / (t.great - t.good);
        return 85 + 15 * clamp(k, 0, 1);
    }
    return 100;
}
export function scoreLowerIsBetter(value, t) {
    if (!Number.isFinite(value))
        return 0;
    if (value <= t.low)
        return 100;
    if (value <= t.ok) {
        const k = (value - t.low) / (t.ok - t.low);
        return 100 - 20 * clamp(k, 0, 1);
    }
    if (value <= t.bad) {
        const k = (value - t.ok) / (t.bad - t.ok);
        return 80 - 40 * clamp(k, 0, 1);
    }
    if (value <= t.awful) {
        const k = (value - t.bad) / (t.awful - t.bad);
        return 40 - 40 * clamp(k, 0, 1);
    }
    return 0;
}
export function gradeFromScore(score) {
    if (score >= 85)
        return "A";
    if (score >= 70)
        return "B";
    if (score >= 55)
        return "C";
    if (score >= 40)
        return "D";
    return "F";
}
export function statusFromScore(score, cfg) {
    if (score >= cfg.status.healthyMin)
        return "HEALTHY";
    if (score >= cfg.status.unstableMin)
        return "UNSTABLE";
    return "CRITICAL";
}
