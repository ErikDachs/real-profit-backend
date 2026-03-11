(function () {
  const DEFAULT_DAYS = 30;
  const DEFAULT_AD_SPEND = 0;
  const DEFAULT_CURRENT_ROAS = 0;

  const loadingState = document.getElementById("loadingState");
  const errorState = document.getElementById("errorState");
  const errorMessage = document.getElementById("errorMessage");
  const appContent = document.getElementById("appContent");
  const refreshBtn = document.getElementById("refreshBtn");
  const tabButtons = Array.from(document.querySelectorAll(".tab-btn"));
  const tabPanels = Array.from(document.querySelectorAll(".tab-panel"));

  let currentShop = null;
  let currentData = null;

  function getQueryParam(name) {
    const url = new URL(window.location.href);
    return url.searchParams.get(name);
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = value;
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
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

  function formatDate(value) {
    if (!value) return "—";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return d.toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  }

  function showLoading() {
    loadingState.classList.remove("hidden");
    errorState.classList.add("hidden");
    appContent.classList.add("hidden");
    refreshBtn.disabled = true;
  }

  function showError(message) {
    loadingState.classList.add("hidden");
    appContent.classList.add("hidden");
    errorState.classList.remove("hidden");
    errorMessage.textContent = message || "Unknown error.";
    refreshBtn.disabled = false;
  }

  function showApp() {
    loadingState.classList.add("hidden");
    errorState.classList.add("hidden");
    appContent.classList.remove("hidden");
    refreshBtn.disabled = false;
  }

  function setActiveTab(tabName) {
    tabButtons.forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.tab === tabName);
    });

    tabPanels.forEach(function (panel) {
      panel.classList.toggle("active", panel.id === "tab-" + tabName);
    });
  }

  function getActionItems(actions) {
    if (!actions) return [];
    if (Array.isArray(actions.actions)) return actions.actions;
    if (Array.isArray(actions.top)) return actions.top;
    if (Array.isArray(actions)) return actions;
    return [];
  }

  function renderOverview(data) {
    const meta = data.meta || {};
    const totals = data.totals || {};
    const health = data.health || {};
    const opportunities = data.opportunities || {};
    const actions = data.actions || {};
    const currency = meta.currency || "USD";

    const ordersCount = totals.count ?? totals.orders ?? 0;
    const contributionMargin =
      totals.contributionMargin ?? totals.profitAfterFees ?? totals.profitAfterShipping ?? 0;
    const contributionMarginPct =
      totals.contributionMarginPct ?? totals.profitMarginAfterFeesPct ?? 0;

    const opportunityItems = Array.isArray(opportunities.top) ? opportunities.top : [];
    const actionItems = getActionItems(actions);

    setText("shopChip", "Shop: " + (data.shop || "—"));
    setText("periodLabel", meta.periodLabel || "Last 30 days");
    setText("currencyLabel", currency);
    setText("fingerprintLabel", meta.costModelFingerprint || "—");

    setText("ordersValue", formatNumber(ordersCount));
    setText("contributionValue", formatMoney(contributionMargin, currency));
    setText("contributionPctValue", formatPercent(contributionMarginPct));
    setText("roasValue", formatRoas(totals.breakEvenRoas));
    setText("netAfterRefundsValue", formatMoney(totals.netAfterRefunds, currency));
    setText("refundsValue", "Refunds: " + formatMoney(totals.refunds, currency));

    setText("grossSalesValue", formatMoney(totals.grossSales, currency));
    setText("refundsInlineValue", formatMoney(totals.refunds, currency));
    setText("netAfterRefundsInlineValue", formatMoney(totals.netAfterRefunds, currency));
    setText("cogsValue", formatMoney(totals.cogs, currency));
    setText("paymentFeesValue", formatMoney(totals.paymentFees, currency));
    setText(
      "profitAfterShippingValue",
      totals.profitAfterShipping == null ? "—" : formatMoney(totals.profitAfterShipping, currency)
    );

    setText("healthScoreValue", health.score == null ? "—" : formatNumber(health.score));
    setText("healthStatusValue", health.status || "—");
    setText("opportunitiesValue", formatNumber(opportunityItems.length));
    setText("actionsValue", formatNumber(actionItems.length));
  }

  function renderInsights(data) {
    const meta = data.meta || {};
    const insights = data.insights || {};
    const opportunities = data.opportunities || {};
    const actions = data.actions || {};
    const health = data.health || {};
    const currency = meta.currency || "USD";

    const opportunityItems = Array.isArray(opportunities.top) ? opportunities.top : [];
    const actionItems = getActionItems(actions);

    const opportunitiesList = document.getElementById("opportunitiesList");
    const actionsList = document.getElementById("actionsList");

    if (opportunityItems.length === 0) {
      opportunitiesList.innerHTML = '<div class="empty-state">No opportunities returned.</div>';
    } else {
      opportunitiesList.innerHTML = opportunityItems
        .slice(0, 6)
        .map(function (item) {
          const title = item.title || item.type || item.reason || "Opportunity";
          const subtitle = item.why || item.explanation || "";
          const value =
            item.estimatedMonthlyLoss != null
              ? formatMoney(item.estimatedMonthlyLoss, currency)
              : item.estimatedLoss != null
                ? formatMoney(item.estimatedLoss, currency)
                : "—";
          const metaText = item.confidence ? "Confidence: " + item.confidence : "";
          return (
            '<div class="stack-item">' +
            '<div class="stack-item-top">' +
            '<div>' +
            '<p class="stack-title">' + escapeHtml(title) + "</p>" +
            '<p class="stack-subtitle">' + escapeHtml(subtitle) + "</p>" +
            "</div>" +
            '<div class="stack-value">' + escapeHtml(value) + "</div>" +
            "</div>" +
            '<div class="stack-meta">' + escapeHtml(metaText) + "</div>" +
            "</div>"
          );
        })
        .join("");
    }

    if (actionItems.length === 0) {
      actionsList.innerHTML = '<div class="empty-state">No actions returned.</div>';
    } else {
      actionsList.innerHTML = actionItems
        .slice(0, 6)
        .map(function (item) {
          const title = item.label || item.code || "Action";
          const subtitle = item.why || item.description || "";
          const value =
            item.estimatedMonthlyGain != null
              ? formatMoney(item.estimatedMonthlyGain, currency)
              : "—";
          const metaParts = [];
          if (item.effort) metaParts.push("Effort: " + item.effort);
          if (item.confidence) metaParts.push("Confidence: " + item.confidence);

          return (
            '<div class="stack-item">' +
            '<div class="stack-item-top">' +
            '<div>' +
            '<p class="stack-title">' + escapeHtml(title) + "</p>" +
            '<p class="stack-subtitle">' + escapeHtml(subtitle) + "</p>" +
            "</div>" +
            '<div class="stack-value">' + escapeHtml(value) + "</div>" +
            "</div>" +
            '<div class="stack-meta">' + escapeHtml(metaParts.join(" • ")) + "</div>" +
            "</div>"
          );
        })
        .join("");
    }

    setText("shippingSubsidyValue", insights.shippingSubsidy ? "Yes" : "No");
    setText("marginDriftValue", insights.marginDrift ? "Yes" : "No");
    setText("breakEvenRiskValue", insights.breakEvenRisk ? "Yes" : "No");
    setText("healthStatusInsightsValue", health.status || "—");
    setText("opportunityCountValue", formatNumber(opportunityItems.length));
    setText("actionCountValue", formatNumber(actionItems.length));
    setText("healthScoreInsightsValue", health.score == null ? "—" : formatNumber(health.score));
    setText("currencyInsightsValue", currency);
  }

  function renderOrders(data) {
    const body = document.getElementById("ordersTableBody");
    const meta = data.meta || {};
    const ordersData = data.orders || {};
    const rows = Array.isArray(ordersData.orders) ? ordersData.orders : [];
    const currency = meta.currency || "USD";

    setText("ordersPanelMeta", meta.periodLabel || "Last 30 days");

    if (rows.length === 0) {
      body.innerHTML = '<tr><td colspan="7" class="empty-table">No orders returned.</td></tr>';
      return;
    }

    body.innerHTML = rows
      .map(function (row) {
        const orderName = row.name || row.orderId || "—";
        const orderId = row.orderId || "—";

        return (
          "<tr>" +
          "<td>" +
          '<div class="order-name">' + escapeHtml(orderName) + "</div>" +
          '<div class="order-id">' + escapeHtml(String(orderId)) + "</div>" +
          "</td>" +
          "<td>" + escapeHtml(formatDate(row.createdAt)) + "</td>" +
          "<td>" + escapeHtml(formatMoney(row.netAfterRefunds, currency)) + "</td>" +
          "<td>" + escapeHtml(formatMoney(row.cogs, currency)) + "</td>" +
          "<td>" + escapeHtml(formatMoney(row.paymentFees, currency)) + "</td>" +
          "<td>" + escapeHtml(formatMoney(row.contributionMargin, currency)) + "</td>" +
          "<td>" + escapeHtml(formatRoas(row.breakEvenRoas)) + "</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  async function fetchJson(url) {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    const text = await res.text();
    let data = null;

    try {
      data = text ? JSON.parse(text) : null;
    } catch (_err) {
      throw new Error("Invalid JSON response: " + text.slice(0, 300));
    }

    if (!res.ok) {
      throw new Error((data && (data.error || data.details || data.message)) || ("HTTP " + res.status));
    }

    return data;
  }

  async function loadApp() {
    const shop = getQueryParam("shop");

    if (!shop) {
      showError("Missing shop query parameter. Expected /app?shop=your-store.myshopify.com");
      return;
    }

    currentShop = shop;
    showLoading();

    const overviewParams = new URLSearchParams({
      shop: shop,
      days: String(DEFAULT_DAYS),
      adSpend: String(DEFAULT_AD_SPEND),
      currentRoas: String(DEFAULT_CURRENT_ROAS),
    });

    const ordersParams = new URLSearchParams({
      shop: shop,
      days: String(DEFAULT_DAYS),
    });

    try {
      const overviewPromise = fetchJson("/api/dashboard/overview?" + overviewParams.toString());
      const ordersPromise = fetchJson("/api/orders/profit?" + ordersParams.toString());

      const results = await Promise.all([overviewPromise, ordersPromise]);

      currentData = {
        overview: results[0],
        orders: results[1],
      };

      renderOverview(currentData.overview);
      renderInsights(currentData.overview);
      renderOrders({
        meta: currentData.overview.meta,
        orders: currentData.orders,
      });

      showApp();
    } catch (err) {
      showError(err && err.message ? err.message : String(err));
    }
  }

  tabButtons.forEach(function (btn) {
    btn.addEventListener("click", function () {
      setActiveTab(btn.dataset.tab || "overview");
    });
  });

  refreshBtn.addEventListener("click", loadApp);

  setActiveTab("overview");
  loadApp();
})();