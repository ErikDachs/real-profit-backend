export const DEFAULT_COST_PROFILE = {
    payment: {
        feePercent: 0.029,
        feeFixed: 0.3,
    },
    shipping: {
        costPerOrder: 0,
    },
    ads: {
        allocationMode: "BY_NET_SALES",
    },
    fixedCosts: {
        allocationMode: "PER_ORDER",
        daysInMonth: 30,
        monthlyItems: [],
    },
    derived: {
        fixedCostsMonthlyTotal: 0,
    },
    flags: {
        includeShippingCost: true,
        // ✅ recommended default: do not let gift cards distort profit KPIs
        excludeGiftCards: true,
    },
};
