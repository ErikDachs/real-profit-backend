(function () {
  const DEFAULT_DAYS = 30;
  const DEFAULT_AD_SPEND = 0;
  const DEFAULT_CURRENT_ROAS = 0;

  const loadingState = document.getElementById("loadingState");
  const errorState = document.getElementById("errorState");
  const errorMessage = document.getElementById("errorMessage");
  const dashboardContent = document.getElementById("dashboardContent");
  const refreshBtn = document.getElementById("refreshBtn");

  function getQueryParam(name) {
    const url = new URL(window.location.href);
    return url.searchParams.get(name);
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = value;
  }

  function formatMoney(value, currency) {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n)) return "—";

    try {
      return new Intl.NumberFormat(undefined, {
        style: "currency",
        currency: currency || "USD",
        maximumFractionDigits: 2,
      }).format(n);
    } catch {
      return `${n.toFixed(2)} ${currency || ""}`.trim();
    }
  }

  function formatNumber(value) {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n)) return "—";
    return new Intl.NumberFormat(undefined, {
      maximumFractionDigits: 2,
    }).format(n);
  }

  function formatPercent(value) {
    const n = Number(value ?? 0);
    if (!Number.isFinite(n)) return "—";
    return `${n.toFixed(2)}%`;
  }

  function formatRoas(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    return n.toFixed(2);
  }

  function showLoading() {
    loadingState.classList.remove("hidden");
    errorState.classList.add("hidden");
    dashboardContent.classList.add("hidden");
    refreshBtn.disabled = true;
  }

  function showError(message) {
    loadingState.classList.add("hidden");
    dashboardContent.classList.add("hidden");
    errorState.classList.remove("hidden");
    errorMessage.textContent = message || "Unknown error.";
    refreshBtn.disabled = false;
  }

  function showDashboard() {
    loadingState.classList.add("hidden");
    errorState.classList.add("hidden");
    dashboardContent.classList.remove("hidden");
    refreshBtn.disabled = false;
  }

  async function loadDashboard() {
    const shop = getQueryParam("shop");

    if (!shop) {
      showError("Missing shop query parameter. Expected /app?shop=your-store.myshopify.com");
      return;
    }

    showLoading();

    const params = new URLSearchParams({
      shop,
      days: String(DEFAULT_DAYS),
      adSpend: String(DEFAULT_AD_SPEND),
      currentRoas: String(DEFAULT_CURRENT_ROAS),
    });

    try {
      const res = await fetch(`/api/dashboard/overview?${params.toString()}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
        },
      });

      const text = await res.text();
      let data = null;

      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        throw new Error(`Invalid JSON response: ${text.slice(0, 300)}`);
      }

      if (!res.ok) {
        throw new Error(data?.error || data?.details || `HTTP ${res.status}`);
      }

      renderDashboard(data);
      showDashboard();
    } catch (err) {
      showError(err && err.message ? err.message : String(err));
    }
  }

  function renderDashboard(data) {
    const meta = data?.meta || {};
    const totals = data?.totals || {};
    const health = data?.health || {};
    const opportunities = data?.opportunities || {};
    const actions = data?.actions || {};

    const currency = meta.currency || "USD";
    const ordersCount = totals.count ?? totals.orders ?? 0;
    const contributionMargin =
      totals.contributionMargin ?? totals.profitAfterFees ?? totals.profitAfterShipping ?? 0;
    const contributionMarginPct =
      totals.contributionMarginPct ?? totals.profitMarginAfterFeesPct ?? 0;
    const breakEvenRoas = totals.breakEvenRoas;
    const topOpportunities = Array.isArray(opportunities.top) ? opportunities.top.length : 0;
    const topActions = Array.isArray(actions.actions)
      ? actions.actions.length
      : Array.isArray(actions.top)
        ? actions.top.length
        : 0;

    setText("shopChip", `Shop: ${data.shop || "—"}`);
    setText("periodLabel", meta.periodLabel || `Last ${DEFAULT_DAYS} days`);
    setText("currencyLabel", currency);
    setText("fingerprintLabel", meta.costModelFingerprint || "—");

    setText("ordersValue", formatNumber(ordersCount));
    setText("contributionValue", formatMoney(contributionMargin, currency));
    setText("contributionPctValue", formatPercent(contributionMarginPct));
    setText("roasValue", formatRoas(breakEvenRoas));
    setText("netAfterRefundsValue", formatMoney(totals.netAfterRefunds, currency));
    setText("refundsValue", `Refunds: ${formatMoney(totals.refunds, currency)}`);

    setText("grossSalesValue", formatMoney(totals.grossSales, currency));
    setText("refundsInlineValue", formatMoney(totals.refunds, currency));
    setText("netAfterRefundsInlineValue", formatMoney(totals.netAfterRefunds, currency));
    setText("cogsValue", formatMoney(totals.cogs, currency));
    setText("paymentFeesValue", formatMoney(totals.paymentFees, currency));
    setText(
      "profitAfterShippingValue",
      totals.profitAfterShipping == null ? "—" : formatMoney(totals.profitAfterShipping, currency)
    );

    setText(
      "healthScoreValue",
      health?.score == null ? "—" : formatNumber(health.score)
    );
    setText("healthStatusValue", health?.status || "—");
    setText("opportunitiesValue", formatNumber(topOpportunities));
    setText("actionsValue", formatNumber(topActions));
  }

  refreshBtn.addEventListener("click", loadDashboard);
  loadDashboard();
})();