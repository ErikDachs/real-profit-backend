function baseChecklist(type) {
    switch (type) {
        case "HIGH_REFUNDS":
            return [
                { code: "collect_refund_reasons", label: "Collect refund reasons for top SKUs (support tags, return notes)." },
                { code: "audit_product_pages", label: "Audit product pages: claims, photos, sizing, shipping expectations." },
                { code: "fix_quality_and_fulfillment", label: "Fix quality / packaging / fulfillment issues causing returns." },
                { code: "tighten_policy_where_needed", label: "Review return policy and exceptions (without harming conversion)." },
            ];
        case "HIGH_FEES":
            return [
                { code: "check_fee_breakdown", label: "Check fee breakdown by payment method/provider/plan." },
                { code: "optimize_payment_mix", label: "Shift customers to cheaper payment methods (where possible)." },
                { code: "negotiate_or_switch", label: "Negotiate rates or switch provider if fee share stays high." },
            ];
        case "SHIPPING_SUBSIDY":
            return [
                { code: "measure_shipping_loss_by_zone", label: "Identify loss zones: country/zone, weight tiers, carriers." },
                { code: "adjust_thresholds", label: "Adjust free shipping thresholds / shipping prices." },
                { code: "reduce_costs", label: "Renegotiate carrier rates or reduce packaging/weights." },
            ];
        case "MISSING_COGS":
            return [
                { code: "fill_missing_unit_costs", label: "Add unit cost (COGS) for missing variants (overrides/import)." },
                { code: "setup_process", label: "Set a process so new SKUs always get costs." },
                { code: "rerun_insights", label: "Re-run insights after adding costs to confirm true profit." },
            ];
        case "LOW_MARGIN":
            return [
                { code: "audit_discounting", label: "Audit discounting and compare margin by discount codes." },
                { code: "review_pricing", label: "Review pricing on top-selling SKUs and bundles." },
                { code: "reduce_variable_costs", label: "Reduce variable costs: COGS, fulfillment, packaging, shipping." },
                { code: "focus_ads_on_margin", label: "Shift spend to higher-margin offers." },
            ];
        case "NEGATIVE_CM":
            return [
                { code: "stop_unprofitable_ads", label: "Pause ads for products/orders with negative profit after ads." },
                { code: "fix_unit_economics", label: "Fix unit economics: pricing, COGS, shipping, refunds, fees." },
                { code: "relaunch_with_guardrails", label: "Re-launch campaigns with ROAS guardrails above break-even." },
            ];
        case "MARGIN_DRIFT":
            return [
                { code: "identify_drift_period", label: "Identify the timeframe where the margin started dropping." },
                { code: "compare_top_drivers", label: "Compare top drivers: refunds, discounts, COGS, fees, shipping." },
                { code: "pinpoint_products", label: "Pinpoint products/SKUs causing the drop and take corrective action." },
            ];
        case "BREAK_EVEN_RISK":
            return [
                { code: "reduce_spend_now", label: "Reduce spend until ROAS is above break-even." },
                { code: "move_budget_to_margin", label: "Shift budget to higher-margin products / exclude high-refund SKUs." },
                { code: "monitor_be_roas", label: "Monitor break-even ROAS daily while scaling." },
            ];
        case "HIGH_FIXED_COST_LOAD":
            return [
                { code: "verify_fixed_costs", label: "Verify fixed costs inputs (rent, payroll, apps, agencies, tools)." },
                { code: "reduce_overhead", label: "Reduce overhead where possible or renegotiate recurring contracts." },
                { code: "increase_aov_or_margin", label: "Increase AOV and/or margin to cover fixed load." },
                { code: "monitor_fixed_ratio", label: "Track fixed cost ratio (% of net sales) weekly." },
            ];
        case "OPERATING_LEVERAGE_RISK":
            return [
                { code: "stabilize_profit_floor", label: "Set a profit floor: minimum net sales required per month." },
                { code: "improve_margin_mix", label: "Shift sales mix toward higher-margin SKUs and bundles." },
                { code: "scale_only_with_buffer", label: "Scale ads only with buffer above true break-even (incl fixed costs)." },
            ];
        default:
            return [{ code: "review", label: "Review this issue and take corrective action." }];
    }
}
function defaultEffort(type) {
    switch (type) {
        case "MISSING_COGS":
        case "HIGH_FEES":
            return "LOW";
        case "SHIPPING_SUBSIDY":
        case "HIGH_REFUNDS":
        case "MARGIN_DRIFT":
        case "HIGH_FIXED_COST_LOAD":
            return "MEDIUM";
        case "LOW_MARGIN":
        case "NEGATIVE_CM":
        case "BREAK_EVEN_RISK":
        case "OPERATING_LEVERAGE_RISK":
            return "HIGH";
        default:
            return "MEDIUM";
    }
}
function defaultConfidenceLabel(type) {
    switch (type) {
        case "MISSING_COGS":
        case "HIGH_FEES":
        case "SHIPPING_SUBSIDY":
            return "HIGH";
        case "HIGH_REFUNDS":
        case "LOW_MARGIN":
        case "HIGH_FIXED_COST_LOAD":
            return "MEDIUM";
        case "NEGATIVE_CM":
        case "MARGIN_DRIFT":
        case "BREAK_EVEN_RISK":
        case "OPERATING_LEVERAGE_RISK":
            return "MEDIUM";
        default:
            return "MEDIUM";
    }
}
/**
 * Canonical per-opportunity templates.
 * Codes should match what signals.ts emits (when present).
 */
function templatesForType(type) {
    const whyFromOpp = ({ opp }) => {
        const why = String(opp.meta?.why ?? "").trim();
        return why ? why : `This opportunity is detected from SSOT profit signals for type ${opp.type}.`;
    };
    switch (type) {
        case "LOW_MARGIN":
            return [
                {
                    code: "FIX_PRICING",
                    label: "Review pricing & discounting",
                    effort: defaultEffort(type),
                    confidenceLabel: defaultConfidenceLabel(type),
                    checklist: baseChecklist(type),
                    buildWhy: whyFromOpp,
                },
                {
                    code: "OPTIMIZE_ADS",
                    label: "Cut wasteful ad spend",
                    effort: defaultEffort(type),
                    confidenceLabel: defaultConfidenceLabel(type),
                    checklist: baseChecklist(type),
                    buildWhy: whyFromOpp,
                },
            ];
        case "NEGATIVE_CM":
            return [
                {
                    code: "PAUSE_LOSERS",
                    label: "Pause/limit unprofitable campaigns",
                    effort: defaultEffort(type),
                    confidenceLabel: defaultConfidenceLabel(type),
                    checklist: baseChecklist(type),
                    buildWhy: whyFromOpp,
                },
                {
                    code: "INCREASE_AOV",
                    label: "Increase AOV / upsells",
                    effort: defaultEffort(type),
                    confidenceLabel: defaultConfidenceLabel(type),
                    checklist: baseChecklist(type),
                    buildWhy: whyFromOpp,
                },
            ];
        case "HIGH_REFUNDS":
            return [
                {
                    code: "REDUCE_REFUNDS",
                    label: "Audit product quality & expectations",
                    effort: defaultEffort(type),
                    confidenceLabel: defaultConfidenceLabel(type),
                    checklist: baseChecklist(type),
                    buildWhy: whyFromOpp,
                },
                {
                    code: "IMPROVE_SUPPORT",
                    label: "Improve support & delivery clarity",
                    effort: defaultEffort(type),
                    confidenceLabel: defaultConfidenceLabel(type),
                    checklist: baseChecklist(type),
                    buildWhy: whyFromOpp,
                },
            ];
        case "HIGH_FEES":
            return [
                {
                    code: "NEGOTIATE_FEES",
                    label: "Negotiate payment provider rates",
                    effort: defaultEffort(type),
                    confidenceLabel: defaultConfidenceLabel(type),
                    checklist: baseChecklist(type),
                    buildWhy: whyFromOpp,
                },
                {
                    code: "PAYMENT_MIX",
                    label: "Shift customers to cheaper methods",
                    effort: defaultEffort(type),
                    confidenceLabel: defaultConfidenceLabel(type),
                    checklist: baseChecklist(type),
                    buildWhy: whyFromOpp,
                },
            ];
        case "MISSING_COGS":
            return [
                {
                    code: "ADD_COGS",
                    label: "Fill in COGS for missing variants",
                    effort: defaultEffort(type),
                    confidenceLabel: defaultConfidenceLabel(type),
                    checklist: baseChecklist(type),
                    buildWhy: whyFromOpp,
                },
                {
                    code: "COGS_ALERTS",
                    label: "Enable COGS alerts",
                    effort: defaultEffort(type),
                    confidenceLabel: defaultConfidenceLabel(type),
                    checklist: baseChecklist(type),
                    buildWhy: whyFromOpp,
                },
            ];
        case "SHIPPING_SUBSIDY":
            return [
                {
                    code: "FIX_SHIPPING_PRICING",
                    label: "Raise shipping fees / thresholds",
                    effort: defaultEffort(type),
                    confidenceLabel: defaultConfidenceLabel(type),
                    checklist: baseChecklist(type),
                    buildWhy: whyFromOpp,
                },
                {
                    code: "NEGOTIATE_SHIPPING",
                    label: "Renegotiate carrier rates",
                    effort: defaultEffort(type),
                    confidenceLabel: defaultConfidenceLabel(type),
                    checklist: baseChecklist(type),
                    buildWhy: whyFromOpp,
                },
            ];
        case "MARGIN_DRIFT":
            return [
                {
                    code: "DRIFT_ROOT_CAUSE",
                    label: "Find the products causing the drop",
                    effort: defaultEffort(type),
                    confidenceLabel: defaultConfidenceLabel(type),
                    checklist: baseChecklist(type),
                    buildWhy: whyFromOpp,
                },
                {
                    code: "AUDIT_MARGIN_DRIVERS",
                    label: "Check refunds, discounts, and COGS changes",
                    effort: defaultEffort(type),
                    confidenceLabel: defaultConfidenceLabel(type),
                    checklist: baseChecklist(type),
                    buildWhy: whyFromOpp,
                },
            ];
        case "BREAK_EVEN_RISK":
            return [
                {
                    code: "STOP_BURN",
                    label: "Reduce spend until ROAS is above break-even",
                    effort: defaultEffort(type),
                    confidenceLabel: defaultConfidenceLabel(type),
                    checklist: baseChecklist(type),
                    buildWhy: whyFromOpp,
                },
                {
                    code: "SHIFT_BUDGET",
                    label: "Shift budget to higher-margin products",
                    effort: defaultEffort(type),
                    confidenceLabel: defaultConfidenceLabel(type),
                    checklist: baseChecklist(type),
                    buildWhy: whyFromOpp,
                },
            ];
        case "HIGH_FIXED_COST_LOAD":
            return [
                {
                    code: "REDUCE_OVERHEAD",
                    label: "Cut non-essential overhead",
                    effort: defaultEffort(type),
                    confidenceLabel: defaultConfidenceLabel(type),
                    checklist: baseChecklist(type),
                    buildWhy: whyFromOpp,
                },
                {
                    code: "RAISE_CM_OR_AOV",
                    label: "Increase contribution margin / AOV",
                    effort: defaultEffort(type),
                    confidenceLabel: defaultConfidenceLabel(type),
                    checklist: baseChecklist(type),
                    buildWhy: whyFromOpp,
                },
            ];
        case "OPERATING_LEVERAGE_RISK":
            return [
                {
                    code: "STABILIZE_DEMAND",
                    label: "Stabilize demand (retention / repeat)",
                    effort: defaultEffort(type),
                    confidenceLabel: defaultConfidenceLabel(type),
                    checklist: baseChecklist(type),
                    buildWhy: whyFromOpp,
                },
                {
                    code: "LOWER_FIXED_BASELINE",
                    label: "Lower fixed baseline costs",
                    effort: defaultEffort(type),
                    confidenceLabel: defaultConfidenceLabel(type),
                    checklist: baseChecklist(type),
                    buildWhy: whyFromOpp,
                },
            ];
        default:
            return [
                {
                    code: `REVIEW_${type}`,
                    label: "Review and address this issue",
                    effort: defaultEffort(type),
                    confidenceLabel: defaultConfidenceLabel(type),
                    checklist: baseChecklist(type),
                    buildWhy: whyFromOpp,
                },
            ];
    }
}
/**
 * Build templates deterministically for an opportunity.
 * - Primary source: SSOT library templates by type.
 * - Secondary: if the opportunity contains action codes not covered by library, include them as fallback.
 */
export function buildTemplatesForOpportunity(opp) {
    const type = opp.type;
    const canonical = templatesForType(type);
    // Allow forward-compat: if opp.actions contains codes not in canonical, add fallback templates.
    const fromOpp = (opp.actions ?? []).map((a) => ({
        code: String(a.code || "").trim(),
        label: String(a.label || "").trim(),
    }));
    const seen = new Set(canonical.map((t) => t.code));
    const fallbacks = [];
    for (const a of fromOpp) {
        if (!a.code)
            continue;
        if (seen.has(a.code))
            continue;
        seen.add(a.code);
        fallbacks.push({
            code: a.code,
            label: a.label || a.code,
            effort: defaultEffort(type),
            confidenceLabel: defaultConfidenceLabel(type),
            checklist: baseChecklist(type),
            buildWhy: ({ opp }) => {
                const why = String(opp.meta?.why ?? "").trim();
                return why ? why : `Recommended action for ${opp.type} based on SSOT profit signals.`;
            },
        });
    }
    return [...canonical, ...fallbacks];
}
