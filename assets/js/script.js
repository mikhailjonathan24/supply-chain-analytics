(() => {
  "use strict";

  const DATA_URL = "data/processed/cleaned_dataco.csv";
  const COLORS = {
    blue: "#4b9be5",
    navy: "#183b64",
    teal: "#43a6a0",
    green: "#2eb882",
    amber: "#f0a64a",
    red: "#df5d64",
    violet: "#8173b9",
    slate: "#90a0b2",
    grid: "#e8edf3",
  };
  const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const CHART_FONT = { family: 'Inter, "Segoe UI", Arial, sans-serif', size: 9 };
  const doughnutTotalPlugin = {
    id: "doughnutTotal",
    afterDraw(chart) {
      if (chart.config.type !== "doughnut" || !chart.chartArea) return;
      const { left, right, top, bottom } = chart.chartArea;
      const context = chart.ctx;
      const total = chart.data.datasets[0].data.reduce((sum, value) => sum + Number(value || 0), 0);
      const centerX = (left + right) / 2;
      const centerY = (top + bottom) / 2;
      context.save();
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillStyle = "#26384a";
      context.font = "700 8px Inter, Segoe UI, Arial, sans-serif";
      context.fillText("Total", centerX, centerY - 7);
      context.font = "800 14px Inter, Segoe UI, Arial, sans-serif";
      context.fillText(formatShort(total), centerX, centerY + 8);
      context.restore();
    },
  };
  const $ = (selector) => document.querySelector(selector);
  const chartInstances = new Map();
  let rows = [];
  let minDate = "";
  let maxDate = "";

  const filterElements = {
    from: $("#date-from"),
    to: $("#date-to"),
    category: $("#category-filter"),
    product: $("#product-filter"),
    market: $("#market-filter"),
    region: $("#region-filter"),
    warehouse: $("#warehouse-filter"),
    shipping: $("#shipping-filter"),
    type: $("#type-filter"),
  };

  const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
  const moneyFormat = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
  const compactMoneyFormat = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 2,
  });
  const percentFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

  function showError(title, detail) {
    const overlay = $("#loading-overlay");
    overlay.classList.add("error");
    $("#loading-title").textContent = title;
    $("#loading-detail").textContent = detail;
    $("#data-status").textContent = detail;
    $("#data-status").className = "data-status error";
  }

  function setStatus(message, state = "") {
    $("#data-status").textContent = message;
    $("#data-status").className = `data-status ${state}`.trim();
  }

  function asNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function asOptionalNumber(value) {
    if (value === "" || value === null || value === undefined) return NaN;
    const number = Number(value);
    return Number.isFinite(number) ? number : NaN;
  }

  function asBoolean(value) {
    return value === true || value === "True" || value === "true" || value === "1" || value === 1;
  }

  function formatShort(value) {
    return numberFormat.format(Math.round(value));
  }

  function compareText(current, previous) {
    if (!Number.isFinite(previous)) return "No prior period";
    if (previous === 0) return current === 0 ? "No change vs prior" : "No prior period";
    const change = ((current - previous) / Math.abs(previous)) * 100;
    const arrow = change > 0 ? "▲" : change < 0 ? "▼" : "•";
    return `${arrow} ${percentFormat.format(Math.abs(change))}% vs prior`;
  }

  function setCompare(id, current, previous, inverse = false) {
    const element = $(`#compare-${id}`);
    element.textContent = compareText(current, previous);
    element.classList.remove("compare-positive", "compare-negative");
    if (current === previous || !Number.isFinite(previous)) return;
    const improved = inverse ? current < previous : current > previous;
    element.classList.add(improved ? "compare-positive" : "compare-negative");
  }

  function populateSelect(element, values, placeholder) {
    const priorValue = element.value;
    element.replaceChildren(new Option(placeholder, ""));
    values.forEach((value) => element.add(new Option(value, value)));
    if (values.includes(priorValue)) element.value = priorValue;
  }

  function uniqueValues(field) {
    return [...new Set(rows.map((row) => row[field]).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
    );
  }

  function populateFilters() {
    populateSelect(filterElements.category, uniqueValues("category"), "All categories");
    populateProducts();
    populateSelect(filterElements.market, uniqueValues("market"), "All markets");
    populateSelect(filterElements.region, uniqueValues("region"), "All regions");
    populateSelect(filterElements.warehouse, uniqueValues("warehouse_proxy"), "All warehouse proxies");
    populateSelect(filterElements.shipping, uniqueValues("shipping_mode"), "All shipping modes");
    populateSelect(filterElements.type, uniqueValues("order_type"), "All order types");
    filterElements.from.value = minDate;
    filterElements.to.value = maxDate;
  }

  function populateProducts() {
    const selectedCategory = filterElements.category.value;
    const products = [...new Set(
      rows
        .filter((row) => !selectedCategory || row.category === selectedCategory)
        .map((row) => row.product)
        .filter(Boolean),
    )].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }));
    populateSelect(filterElements.product, products, "All products");
  }

  function rowMatchesDimensions(row, filters) {
    return (
      (!filters.category || row.category === filters.category)
      && (!filters.product || row.product === filters.product)
      && (!filters.market || row.market === filters.market)
      && (!filters.region || row.region === filters.region)
      && (!filters.warehouse || row.warehouse_proxy === filters.warehouse)
      && (!filters.shipping || row.shipping_mode === filters.shipping)
      && (!filters.type || row.order_type === filters.type)
    );
  }

  function collectPeriodRows(filters) {
    const from = filters.from || minDate;
    const to = filters.to || maxDate;
    const periodDurationMs = Date.parse(`${to}T23:59:59.999Z`) - Date.parse(`${from}T00:00:00.000Z`) + 1;
    const previousTo = new Date(Date.parse(`${from}T00:00:00.000Z`) - 1).toISOString().slice(0, 10);
    const previousFrom = new Date(
      Date.parse(`${from}T00:00:00.000Z`) - Math.max(periodDurationMs, 86_400_000),
    ).toISOString().slice(0, 10);
    const currentRows = [];
    const previousRows = [];

    if (from > to) return { currentRows, previousRows, from, to };
    for (const row of rows) {
      if (!rowMatchesDimensions(row, filters)) continue;
      if (row.order_date_key >= from && row.order_date_key <= to) currentRows.push(row);
      else if (row.order_date_key >= previousFrom && row.order_date_key <= previousTo) previousRows.push(row);
    }
    return { currentRows, previousRows, from, to };
  }

  function emptyCategory() {
    return { units: 0, sales: 0, stockoutRiskOrders: new Set() };
  }

  function aggregate(periodRows) {
    const monthlyTotals = new Map(
      MONTH_LABELS.map((label, index) => [index + 1, { label, units: 0, orderIds: new Set() }]),
    );
    const result = {
      sales: 0,
      units: 0,
      orders: new Map(),
      categories: new Map(),
      products: new Map(),
      shippingValue: new Map(),
      monthlyTotals,
      monthlySeries: new Map(),
      categoryWarehouseUnits: new Map(),
      availableProducts: new Set(),
      unavailableProducts: new Set(),
      stockoutRiskOrders: new Set(),
      netOrderValue: 0,
    };

    for (const row of periodRows) {
      result.sales += row.sales;
      result.units += row.quantity;
      result.netOrderValue += row.net_order_total;
      if (!result.categories.has(row.category)) result.categories.set(row.category, emptyCategory());
      const category = result.categories.get(row.category);
      category.units += row.quantity;
      category.sales += row.sales;
      if (row.order_status.toLowerCase() === "canceled" || row.late_risk >= 1) {
        category.stockoutRiskOrders.add(row.order_id);
      }

      if (!result.categoryWarehouseUnits.has(row.category)) {
        result.categoryWarehouseUnits.set(row.category, new Map());
      }
      const warehouseUnits = result.categoryWarehouseUnits.get(row.category);
      warehouseUnits.set(row.warehouse_proxy, (warehouseUnits.get(row.warehouse_proxy) || 0) + row.quantity);

      if (row.product_available) {
        if (!result.unavailableProducts.has(row.product_id)) {
          result.availableProducts.add(row.product_id);
        }
      } else {
        result.availableProducts.delete(row.product_id);
        result.unavailableProducts.add(row.product_id);
      }

      const product = result.products.get(row.product) || { sales: 0, units: 0 };
      product.sales += row.sales;
      product.units += row.quantity;
      result.products.set(row.product, product);

      result.shippingValue.set(
        row.shipping_mode,
        (result.shippingValue.get(row.shipping_mode) || 0) + row.net_order_total,
      );
      const month = monthlyTotals.get(row.month_index);
      month.units += row.quantity;
      month.orderIds.add(row.order_id);
      const monthKey = row.order_date_key.slice(0, 7);
      const monthlySeries = result.monthlySeries.get(monthKey) || { monthKey, units: 0 };
      monthlySeries.units += row.quantity;
      result.monthlySeries.set(monthKey, monthlySeries);

      if (!result.orders.has(row.order_id)) {
        result.orders.set(row.order_id, {
          status: row.order_status,
          delivery: row.delivery_status,
          lateRisk: row.late_risk,
          market: row.market,
          region: row.region,
          monthIndex: row.month_index,
          duration: row.shipping_duration_days,
        });
      }
    }

    result.statusCounts = new Map();
    result.marketStats = new Map();
    result.deliveryByMonth = new Map(
      MONTH_LABELS.map((label, index) => [index + 1, { label, days: 0, orders: 0 }]),
    );
    result.matrix = new Map();
    result.ontimeOrders = 0;
    result.deliveredOrders = 0;
    result.lateOrders = 0;

    for (const [orderId, order] of result.orders) {
      const status = order.status.toUpperCase();
      const statusGroup = ["COMPLETE", "CLOSED"].includes(status)
        ? "Completed"
        : ["PENDING", "PENDING_PAYMENT", "PAYMENT_REVIEW"].includes(status)
          ? "Pending"
          : ["PROCESSING", "ON_HOLD"].includes(status)
            ? "Processing"
            : status === "CANCELED"
              ? "Canceled"
              : "Review";
      result.statusCounts.set(statusGroup, (result.statusCounts.get(statusGroup) || 0) + 1);
      if (order.status.toLowerCase() === "canceled" || order.lateRisk >= 1) {
        result.stockoutRiskOrders.add(orderId);
      }
      const onTime = order.delivery === "Advance shipping" || order.delivery === "Shipping on time";
      const late = order.delivery === "Late delivery";
      if (onTime || late) {
        result.deliveredOrders += 1;
        if (onTime) result.ontimeOrders += 1;
        if (late) result.lateOrders += 1;
      }

      const market = result.marketStats.get(order.market) || { orders: 0, ontime: 0, delivered: 0 };
      market.orders += 1;
      if (onTime || late) market.delivered += 1;
      if (onTime) market.ontime += 1;
      result.marketStats.set(order.market, market);

      if (Number.isFinite(order.duration)) {
        const monthStats = result.deliveryByMonth.get(order.monthIndex);
        monthStats.days += order.duration;
        monthStats.orders += 1;
      }
      if (!result.matrix.has(order.market)) result.matrix.set(order.market, new Map());
      const regions = result.matrix.get(order.market);
      regions.set(order.region, (regions.get(order.region) || 0) + 1);
    }

    for (const month of result.monthlyTotals.values()) {
      month.orders = month.orderIds.size;
      delete month.orderIds;
    }

    result.onTimeRate = result.deliveredOrders
      ? (result.ontimeOrders / result.deliveredOrders) * 100
      : 0;
    result.lateRate = result.deliveredOrders
      ? (result.lateOrders / result.deliveredOrders) * 100
      : 0;
    return result;
  }

  function updateKpis(current, previous) {
    $("#kpi-inventory").textContent = compactMoneyFormat.format(current.sales);
    $("#kpi-logistics").textContent = compactMoneyFormat.format(current.netOrderValue);
    $("#kpi-orders").textContent = formatShort(current.orders.size);
    $("#kpi-units").textContent = formatShort(current.units);
    $("#kpi-stockouts").textContent = formatShort(current.stockoutRiskOrders.size);
    $("#kpi-ontime").textContent = `${percentFormat.format(current.onTimeRate)}%`;
    setCompare("inventory", current.sales, previous.sales);
    setCompare("orders", current.orders.size, previous.orders.size);
    setCompare("units", current.units, previous.units);
    setCompare("stockouts", current.stockoutRiskOrders.size, previous.stockoutRiskOrders.size, true);
    setCompare("ontime", current.onTimeRate, previous.onTimeRate);
    setCompare("logistics", current.netOrderValue, previous.netOrderValue);
  }

  function shortLabel(value, length = 20) {
    return value.length > length ? `${value.slice(0, length - 1)}…` : value;
  }

  function inventoryHeatColor(value, maximum) {
    const ratio = maximum ? value / maximum : 0;
    const low = [86, 185, 128];
    const middle = [241, 208, 100];
    const high = [231, 112, 105];
    const start = ratio < 0.5 ? low : middle;
    const end = ratio < 0.5 ? middle : high;
    const step = ratio < 0.5 ? ratio * 2 : (ratio - 0.5) * 2;
    const rgb = start.map((channel, index) => Math.round(channel + (end[index] - channel) * step));
    return `rgb(${rgb.join(", ")})`;
  }

  function chartOptions(extra = {}) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: {
          display: false,
          labels: { boxWidth: 8, boxHeight: 8, padding: 8, font: { ...CHART_FONT, size: 8 } },
        },
        tooltip: { titleFont: CHART_FONT, bodyFont: CHART_FONT, padding: 7 },
      },
      scales: {
        x: {
          grid: { display: false },
          border: { display: false },
          ticks: { color: "#78889b", font: { ...CHART_FONT, size: 7 }, maxRotation: 0, autoSkip: true },
        },
        y: {
          beginAtZero: true,
          grid: { color: COLORS.grid },
          border: { display: false },
          ticks: { color: "#78889b", font: { ...CHART_FONT, size: 7 }, maxTicksLimit: 4 },
        },
      },
      ...extra,
    };
  }

  function renderChart(canvasId, config, emptyMessage = "No matching records for these filters.") {
    const canvas = $(`#${canvasId}`);
    const card = canvas.closest(".chart-wrap");
    const empty = card.querySelector(".chart-empty");
    const hasData = config.data.labels.length > 0;
    canvas.classList.toggle("hidden", !hasData);
    empty.classList.toggle("hidden", hasData);
    empty.textContent = emptyMessage;
    if (!hasData) return;

    const existing = chartInstances.get(canvasId);
    if (!existing) {
      chartInstances.set(canvasId, new Chart(canvas, config));
      return;
    }
    existing.config.type = config.type;
    existing.data = config.data;
    existing.options = config.options;
    existing.update("none");
  }

  function renderDemandChart(stats) {
    const months = [...stats.monthlyTotals.values()];
    renderChart("chart-demand", {
      type: "bar",
      data: {
        labels: months.map(({ label }) => label),
        datasets: [
          { type: "bar", label: "Units sold (inventory proxy)", data: months.map(({ units }) => units), backgroundColor: COLORS.blue, borderRadius: 2, yAxisID: "y" },
          { type: "line", label: "Order count (demand)", data: months.map(({ orders }) => orders), borderColor: COLORS.red, backgroundColor: COLORS.red, pointRadius: 2, pointHoverRadius: 3, borderWidth: 2, tension: 0.2, yAxisID: "y1" },
        ],
      },
      options: chartOptions({
        plugins: {
          legend: { display: true, position: "bottom", labels: { boxWidth: 7, boxHeight: 7, padding: 7, font: { ...CHART_FONT, size: 7 } } },
          tooltip: {
            titleFont: CHART_FONT,
            bodyFont: CHART_FONT,
            padding: 7,
            callbacks: {
              label: (context) => context.dataset.yAxisID === "y"
                ? ` Units sold (proxy): ${formatShort(context.raw)}`
                : ` Orders (demand): ${formatShort(context.raw)}`,
            },
          },
        },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: "#78889b", font: { ...CHART_FONT, size: 7 }, maxRotation: 0 } },
          y: { beginAtZero: true, grid: { color: COLORS.grid }, border: { display: false }, ticks: { color: "#78889b", font: { ...CHART_FONT, size: 7 }, maxTicksLimit: 4, callback: (value) => formatShort(value) } },
          y1: { beginAtZero: true, position: "right", grid: { display: false }, border: { display: false }, ticks: { color: COLORS.red, font: { ...CHART_FONT, size: 7 }, maxTicksLimit: 4, callback: (value) => formatShort(value) } },
        },
      }),
    });
  }

  function renderStockoutsChart(stats) {
    const categories = [...stats.categories.entries()]
      .sort((a, b) => b[1].stockoutRiskOrders.size - a[1].stockoutRiskOrders.size)
      .slice(0, 8);
    renderChart("chart-stockouts", {
      type: "bar",
      data: {
        labels: categories.map(([category]) => shortLabel(category, 18)),
        datasets: [{ label: "At-risk orders (proxy)", data: categories.map(([, item]) => item.stockoutRiskOrders.size), backgroundColor: "#e76a6b", borderRadius: 2, barPercentage: 0.72, categoryPercentage: 0.8 }],
      },
      options: chartOptions({
        indexAxis: "y",
        plugins: {
          legend: { display: false },
          tooltip: { titleFont: CHART_FONT, bodyFont: CHART_FONT, padding: 7, callbacks: { label: (context) => ` ${formatShort(context.raw)} canceled or high-risk orders` } },
        },
        scales: {
          x: { beginAtZero: true, grid: { color: COLORS.grid }, border: { display: false }, ticks: { color: "#78889b", font: { ...CHART_FONT, size: 7 }, maxTicksLimit: 4 } },
          y: { reverse: true, grid: { display: false }, border: { display: false }, ticks: { color: "#66788c", font: { ...CHART_FONT, size: 7 } } },
        },
      }),
      },
      "No category-level risk orders match these filters.",
    );
  }

  function renderStatusChart(stats) {
    const entries = [...stats.statusCounts.entries()].sort((a, b) => b[1] - a[1]);
    const statusColors = {
      Completed: "#2eb882",
      Pending: "#4b9be5",
      Processing: "#f0a64a",
      Canceled: "#df5d64",
      Review: "#a7b3c2",
    };
    renderChart("chart-status", {
      type: "doughnut",
      data: {
        labels: entries.map(([status]) => status),
        datasets: [{
          data: entries.map(([, count]) => count),
          backgroundColor: entries.map(([status]) => statusColors[status] || COLORS.slate),
          borderColor: "#fff",
          borderWidth: 2,
          hoverOffset: 3,
        }],
      },
      options: chartOptions({
        cutout: "65%",
        plugins: {
          legend: { display: true, position: "right", labels: { boxWidth: 8, boxHeight: 8, padding: 7, font: { ...CHART_FONT, size: 8 } } },
          tooltip: { titleFont: CHART_FONT, bodyFont: CHART_FONT, padding: 7 },
        },
      }),
    });
  }

  function renderSupplierProxy(stats) {
    const markets = [...stats.marketStats.entries()]
      .sort((a, b) => b[1].orders - a[1].orders)
      .slice(0, 7);
    renderChart("chart-supplier", {
      type: "bar",
      data: {
        labels: markets.map(([market]) => shortLabel(market, 14)),
        datasets: [
          { type: "bar", label: "Order count (market proxy)", data: markets.map(([, item]) => item.orders), backgroundColor: COLORS.blue, borderRadius: 2, yAxisID: "y" },
          { type: "line", label: "On-time delivery %", data: markets.map(([, item]) => item.delivered ? (item.ontime / item.delivered) * 100 : 0), borderColor: COLORS.red, backgroundColor: COLORS.red, pointRadius: 2, tension: 0.2, yAxisID: "y1" },
        ],
      },
      options: chartOptions({
        plugins: {
          legend: { display: true, position: "bottom", labels: { boxWidth: 7, boxHeight: 7, padding: 7, font: { ...CHART_FONT, size: 7 } } },
          tooltip: { titleFont: CHART_FONT, bodyFont: CHART_FONT, padding: 7 },
        },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: "#78889b", font: { ...CHART_FONT, size: 7 }, maxRotation: 0 } },
          y: { beginAtZero: true, grid: { color: COLORS.grid }, border: { display: false }, ticks: { color: "#78889b", font: { ...CHART_FONT, size: 7 }, maxTicksLimit: 4 } },
          y1: { beginAtZero: true, max: 100, position: "right", grid: { display: false }, border: { display: false }, ticks: { color: COLORS.green, font: { ...CHART_FONT, size: 7 }, maxTicksLimit: 3, callback: (value) => `${value}%` } },
        },
      }),
    });
  }

  function renderProductsChart(stats) {
    const products = [...stats.products.entries()].sort((a, b) => b[1].sales - a[1].sales).slice(0, 10);
    renderChart("chart-products", {
      type: "bar",
      data: {
        labels: products.map(([product]) => shortLabel(product, 23)),
        datasets: [{ label: "Sales value (inventory proxy, USD)", data: products.map(([, item]) => item.sales), backgroundColor: COLORS.blue, borderRadius: 2, barPercentage: 0.72, categoryPercentage: 0.82 }],
      },
      options: chartOptions({
        indexAxis: "y",
        scales: {
          x: { beginAtZero: true, grid: { color: COLORS.grid }, border: { display: false }, ticks: { color: "#78889b", font: { ...CHART_FONT, size: 7 }, maxTicksLimit: 4, callback: (value) => moneyFormat.format(value) } },
          y: { reverse: true, grid: { display: false }, border: { display: false }, ticks: { color: "#66788c", font: { ...CHART_FONT, size: 7 } } },
        },
      }),
    });
  }

  function renderShippingChart(stats) {
    const shipping = [...stats.shippingValue.entries()].sort((a, b) => b[1] - a[1]);
    renderChart("chart-shipping", {
      type: "bar",
      data: {
        labels: shipping.map(([mode]) => shortLabel(mode, 15)),
        datasets: [{ label: "Order Item Total (logistics cost proxy, USD)", data: shipping.map(([, value]) => value), backgroundColor: ["#e76a6b", "#f0a64a", "#55a4e8", "#45b783"], borderRadius: 2, barPercentage: 0.7, categoryPercentage: 0.78 }],
      },
      options: chartOptions({
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: "#78889b", font: { ...CHART_FONT, size: 7 }, maxRotation: 15 } },
          y: { beginAtZero: true, grid: { color: COLORS.grid }, border: { display: false }, ticks: { color: "#78889b", font: { ...CHART_FONT, size: 7 }, maxTicksLimit: 4, callback: (value) => moneyFormat.format(value) } },
        },
      }),
    });
  }

  function renderDeliveryChart(stats) {
    const months = [...stats.deliveryByMonth.values()];
    renderChart("chart-delivery", {
      type: "line",
      data: {
        labels: months.map(({ label }) => label),
        datasets: [{
          label: "Average shipping days",
          data: months.map((item) => item.orders ? item.days / item.orders : null),
          borderColor: COLORS.blue,
          backgroundColor: "#4b9be51f",
          pointRadius: 2,
          pointBackgroundColor: COLORS.blue,
          borderWidth: 2,
          fill: true,
          tension: 0.3,
        }],
      },
      options: chartOptions({
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: "#78889b", font: { ...CHART_FONT, size: 7 }, maxRotation: 0 } },
          y: { beginAtZero: true, grid: { color: COLORS.grid }, border: { display: false }, ticks: { color: "#78889b", font: { ...CHART_FONT, size: 7 }, maxTicksLimit: 4, callback: (value) => `${value} d` } },
        },
      }),
    });
  }

  function shiftMonth(monthKey, offset) {
    const [year, month] = monthKey.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1 + offset, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
  }

  function monthDisplayLabel(monthKey) {
    const [year, month] = monthKey.split("-").map(Number);
    return `${MONTH_LABELS[month - 1]} '${String(year).slice(-2)}`;
  }

  function renderForecastChart(stats) {
    const months = [...stats.monthlySeries.values()]
      .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
      .slice(-6);
    if (!months.length) {
      renderChart("chart-forecast", { type: "bar", data: { labels: [], datasets: [] } });
      return;
    }

    const historyPadding = Array.from({ length: 6 - months.length }, (_, index) => {
      const monthKey = shiftMonth(months[0].monthKey, index - (6 - months.length));
      return { monthKey, units: null };
    });
    const history = [...historyPadding, ...months];
    const values = months.slice(-3).map(({ units }) => units);
    const meanX = (values.length - 1) / 2;
    const meanY = values.reduce((sum, value) => sum + value, 0) / values.length;
    const denominator = values.reduce((sum, _, index) => sum + (index - meanX) ** 2, 0);
    const slope = denominator
      ? values.reduce((sum, value, index) => sum + (index - meanX) * (value - meanY), 0) / denominator
      : 0;
    const forecast = Array(6).fill(null).concat(
      Array.from({ length: 6 }, (_, index) => Math.max(0, months[months.length - 1].units + slope * (index + 1))),
    );
    const labels = [
      ...history.map(({ monthKey }) => monthDisplayLabel(monthKey)),
      ...Array.from({ length: 6 }, (_, index) => monthDisplayLabel(shiftMonth(months[months.length - 1].monthKey, index + 1))),
    ];
    renderChart("chart-forecast", {
      type: "bar",
      data: {
        labels,
        datasets: [
          { label: "Historical demand (units)", data: [...history.map(({ units }) => units), ...Array(6).fill(null)], backgroundColor: COLORS.blue, borderRadius: 2, barPercentage: 0.72, categoryPercentage: 0.78 },
          { label: "Forecast demand (6-month trend)", data: forecast, backgroundColor: COLORS.red, borderRadius: 2, barPercentage: 0.72, categoryPercentage: 0.78 },
        ],
      },
      options: chartOptions({
        plugins: {
          legend: { display: true, position: "bottom", labels: { boxWidth: 8, boxHeight: 8, padding: 7, font: { ...CHART_FONT, size: 8 } } },
          tooltip: { titleFont: CHART_FONT, bodyFont: CHART_FONT, padding: 7, callbacks: { label: (context) => ` ${context.dataset.label}: ${formatShort(context.raw)} units` } },
        },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: "#78889b", font: { ...CHART_FONT, size: 7 }, maxRotation: 0, autoSkip: false } },
          y: { beginAtZero: true, grid: { color: COLORS.grid }, border: { display: false }, ticks: { color: "#78889b", font: { ...CHART_FONT, size: 7 }, maxTicksLimit: 4 } },
        },
      }),
    });
  }

  function renderMatrix(stats) {
    const table = $("#warehouse-table");
    const head = table.querySelector("thead");
    const body = table.querySelector("tbody");
    const wrapper = table.parentElement;
    const empty = wrapper.querySelector(".chart-empty");
    const warehouses = [...new Set(
      [...stats.categoryWarehouseUnits.values()].flatMap((warehouseUnits) => [...warehouseUnits.keys()]),
    )].sort((a, b) => a.localeCompare(b));
    const categories = [...stats.categories.entries()]
      .sort((a, b) => b[1].units - a[1].units)
      .slice(0, 6);
    if (!categories.length || !warehouses.length) {
      head.replaceChildren();
      body.replaceChildren();
      empty.textContent = "No matching orders for this selection.";
      empty.classList.remove("hidden");
      table.classList.add("hidden");
      return;
    }
    table.classList.remove("hidden");
    empty.classList.add("hidden");

    const theadRow = document.createElement("tr");
    ["Product category", ...warehouses.map((warehouse) => shortLabel(warehouse, 12)), "Total units"].forEach((label) => {
      const th = document.createElement("th");
      th.textContent = label;
      th.title = label;
      theadRow.append(th);
    });
    head.replaceChildren(theadRow);

    const maxCount = Math.max(
      1,
      ...categories.flatMap(([category]) => [...(stats.categoryWarehouseUnits.get(category)?.values() || [])]),
    );
    const totals = new Map(warehouses.map((warehouse) => [warehouse, 0]));
    const bodyRows = categories.map(([category, categoryStats]) => {
      const tr = document.createElement("tr");
      const label = document.createElement("td");
      label.textContent = shortLabel(category, 22);
      label.title = category;
      tr.append(label);
      const warehouseUnits = stats.categoryWarehouseUnits.get(category) || new Map();
      warehouses.forEach((warehouse) => {
        const units = warehouseUnits.get(warehouse) || 0;
        totals.set(warehouse, totals.get(warehouse) + units);
        const td = document.createElement("td");
        td.className = "matrix-cell";
        td.textContent = units ? formatShort(units) : "—";
        td.style.backgroundColor = units ? inventoryHeatColor(units, maxCount) : "#f8fafc";
        td.title = `${formatShort(units)} units sold in ${warehouse} (market proxy)`;
        tr.append(td);
      });
      const totalCell = document.createElement("td");
      totalCell.className = "matrix-total";
      totalCell.textContent = formatShort(categoryStats.units);
      tr.append(totalCell);
      return tr;
    });
    const totalRow = document.createElement("tr");
    totalRow.className = "matrix-total-row";
    const totalLabel = document.createElement("td");
    totalLabel.textContent = `Top ${categories.length} total`;
    totalRow.append(totalLabel);
    let grandTotal = 0;
    warehouses.forEach((warehouse) => {
      const total = totals.get(warehouse);
      grandTotal += total;
      const cell = document.createElement("td");
      cell.textContent = formatShort(total);
      totalRow.append(cell);
    });
    const grandTotalCell = document.createElement("td");
    grandTotalCell.textContent = formatShort(grandTotal);
    totalRow.append(grandTotalCell);
    body.replaceChildren(...bodyRows, totalRow);
  }

  function renderInsights(stats) {
    const list = $("#insights-list");
    const items = [];
    if (!stats.orders.size) {
      items.push("No records match the selected filters and date range.");
    } else {
      const lateText = `${percentFormat.format(stats.lateRate)}% late-delivery risk across ${formatShort(stats.orders.size)} orders`;
      const leader = [...stats.marketStats.entries()].sort((a, b) => b[1].orders - a[1].orders)[0];
      const category = [...stats.categories.entries()].sort((a, b) => b[1].sales - a[1].sales)[0];
      items.push(lateText);
      if (leader) items.push(`${leader[0]} leads filtered order volume (${formatShort(leader[1].orders)} orders)`);
      if (category) items.push(`${category[0]} leads category sales (${moneyFormat.format(category[1].sales)})`);
      items.push(
        stats.unavailableProducts.size
          ? `${formatShort(stats.unavailableProducts.size)} catalog products are marked unavailable; this is not on-hand stock.`
          : "No unavailable catalog products are flagged; inventory balances are not in this dataset.",
      );
    }
    list.replaceChildren(...items.map((text) => {
      const item = document.createElement("li");
      item.textContent = text;
      return item;
    }));
  }

  function renderDashboard() {
    const filters = {
      from: filterElements.from.value || minDate,
      to: filterElements.to.value || maxDate,
      category: filterElements.category.value,
      product: filterElements.product.value,
      market: filterElements.market.value,
      region: filterElements.region.value,
      warehouse: filterElements.warehouse.value,
      shipping: filterElements.shipping.value,
      type: filterElements.type.value,
    };
    const { currentRows, previousRows, from, to } = collectPeriodRows(filters);
    const current = aggregate(currentRows);
    const previous = aggregate(previousRows);

    updateKpis(current, previous);
    renderDemandChart(current);
    renderStockoutsChart(current);
    renderStatusChart(current);
    renderSupplierProxy(current);
    renderProductsChart(current);
    renderShippingChart(current);
    renderDeliveryChart(current);
    renderForecastChart(current);
    renderMatrix(current);
    renderInsights(current);

    $("#period-label").textContent = from && to ? `${from}  —  ${to}` : "All available dates";
    if (from > to) setStatus("Start date must be on or before end date.", "error");
    else setStatus(`${formatShort(currentRows.length)} line items · ${formatShort(current.orders.size)} distinct orders`, "ready");
  }

  function normalizeRows(sourceRows) {
    return sourceRows
      .filter((row) => row.order_id && row.order_date)
      .map((row) => ({
        ...row,
        order_id: String(row.order_id),
        order_date_key: String(row.order_date).slice(0, 10),
        month: row.month || String(row.order_date).slice(0, 7),
        month_index: Number(String(row.order_date).slice(5, 7)),
        sales: asNumber(row.sales),
        quantity: asNumber(row.quantity),
        net_order_total: row.order_total === "" || row.order_total === undefined
          ? Math.max(0, asNumber(row.sales) - asNumber(row.item_discount))
          : asNumber(row.order_total),
        shipping_duration_days: asOptionalNumber(row.shipping_duration_days),
        product_id: String(row.product_id || row.product || "Unknown"),
        product_available: asBoolean(row.product_available),
        delivery_status: row.delivery_status || "Unknown",
        late_risk: row.late_risk === "" || row.late_risk === undefined
          ? (row.delivery_status === "Late delivery" ? 1 : 0)
          : asNumber(row.late_risk),
        order_status: row.order_status || "Unknown",
        category: row.category || "Unknown",
        product: row.product || "Unknown",
        market: row.market || "Unknown",
        region: row.region || "Unknown",
        warehouse_proxy: row.warehouse_proxy || row.market || row.region || "Unknown",
        shipping_mode: row.shipping_mode || "Unknown",
        order_type: row.order_type || "Unknown",
      }));
  }

  function initialize() {
    if (!window.Papa || !window.Chart) {
      showError("Dashboard libraries failed to load.", "Check internet access to load Chart.js and PapaParse from their CDNs.");
      return;
    }
    Chart.defaults.font.family = CHART_FONT.family;
    Chart.defaults.color = "#718198";
    Chart.register(doughnutTotalPlugin);
    const dataUrl = new URL(DATA_URL, window.location.href).href;
    $("#loading-detail").textContent = `Reading ${DATA_URL}`;

    Papa.parse(dataUrl, {
      download: true,
      header: true,
      dynamicTyping: false,
      skipEmptyLines: "greedy",
      worker: true,
      complete: (result) => {
        try {
          if (result.errors.length) {
            console.warn("CSV parser reported row issues:", result.errors.slice(0, 10));
          }
          const parsed = normalizeRows(result.data);
          if (!parsed.length) throw new Error("CSV contains no usable records.");
          rows = parsed;
          minDate = rows.reduce((minimum, row) => row.order_date_key < minimum ? row.order_date_key : minimum, rows[0].order_date_key);
          maxDate = rows.reduce((maximum, row) => row.order_date_key > maximum ? row.order_date_key : maximum, rows[0].order_date_key);
          populateFilters();
          renderDashboard();
          $("#loading-overlay").classList.add("hidden");
          setStatus(
            `${formatShort(rows.length)} cleaned line items · ${formatShort(new Set(rows.map((row) => row.order_id)).size)} distinct orders`,
            "ready",
          );
        } catch (error) {
          console.error(error);
          showError("Unable to process the cleaned dataset.", error.message || "Check the CSV headers and formatting.");
        }
      },
      error: (error) => {
        console.error("Dataset load failed:", error);
        showError(
          "Could not load the cleaned dataset.",
          "Run `python scripts/data_cleaning.py`, then open this folder with VS Code Live Server.",
        );
      },
    });
  }

  Object.values(filterElements).forEach((element) => {
    element.addEventListener("change", () => {
      if (element === filterElements.category) populateProducts();
      renderDashboard();
    });
  });
  $("#reset-filters").addEventListener("click", () => {
    filterElements.category.value = "";
    populateProducts();
    filterElements.product.value = "";
    filterElements.market.value = "";
    filterElements.region.value = "";
    filterElements.warehouse.value = "";
    filterElements.shipping.value = "";
    filterElements.type.value = "";
    filterElements.from.value = minDate;
    filterElements.to.value = maxDate;
    renderDashboard();
  });

  initialize();
})();
