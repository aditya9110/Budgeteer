// ── CONSTANTS ──────────────────────────────────────────────────────────────

const PURPLE       = "#7030A0";
const PURPLE_LIGHT = "#9B59B6";
const BG_CARD      = "#16161d";
const TEXT_SEC     = "#8b87a0";
const GREEN        = "#27ae60";
const RED          = "#e74c3c";

const PLOTLY_BASE = {
    paper_bgcolor: "rgba(0,0,0,0)",
    plot_bgcolor:  "rgba(0,0,0,0)",
    font:          { family: "Consolas, monospace", color: "#8b87a0", size: 11 },
    margin:        { t: 10, b: 10, l: 10, r: 10 },
    showlegend:    false,
};

const MONTHS = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December"
];

// ── BRIDGE (PyQt6 QWebChannel) ───────────────────────────────────────────────

let _bridge = null;
let _callId = 0;
const _pending = {};

window.__resolveCall = function(callId, jsonResult) {
    const resolve = _pending[callId];
    if (resolve) {
        delete _pending[callId];
        resolve(JSON.parse(jsonResult));
    }
};

function callPython(method, ...args) {
    return new Promise((resolve) => {
        const id = String(_callId++);
        _pending[id] = resolve;
        _bridge.call(id, method, JSON.stringify(args));
    });
}

// ── STATE ────────────────────────────────────────────────────────────────────

let currentView    = "dashboard";
let selectedFile   = null;
let currentYear    = null;
let currentMonth   = null;
let pendingConfirm = null;  // function to call on modal confirm

// ── DOM REFS ─────────────────────────────────────────────────────────────────

// Custom dropdowns
const monthDropdown   = document.getElementById("month-dropdown");
const monthLabel      = document.getElementById("month-label");
const monthOptions    = document.getElementById("month-options");
const yearDropdown    = document.getElementById("year-dropdown");
const yearLabel       = document.getElementById("year-label");
const yearOptions     = document.getElementById("year-options");
const btnLoad         = document.getElementById("btn-load");
const periodControls  = document.getElementById("period-controls");
const toast           = document.getElementById("toast");
const modalOverlay    = document.getElementById("modal-overlay");
const modalTitle      = document.getElementById("modal-title");
const modalBody       = document.getElementById("modal-body");
const modalConfirm    = document.getElementById("modal-confirm");
const modalCancel     = document.getElementById("modal-cancel");
const txModalOverlay  = document.getElementById("tx-modal-overlay");
const txModalTitle    = document.getElementById("tx-modal-title");
const txModalCancel   = document.getElementById("tx-modal-cancel");
const txModalSave     = document.getElementById("tx-modal-save");
const dropZone        = document.getElementById("drop-zone");
const fileInput       = document.getElementById("file-input");
const btnBrowse       = document.getElementById("btn-browse");
const fileInfo        = document.getElementById("file-info");
const fileName        = document.getElementById("file-name");
const btnClear        = document.getElementById("btn-clear");
const btnImport       = document.getElementById("btn-import");
const importProgress  = document.getElementById("import-progress");
const progressFill    = document.getElementById("progress-fill");
const progressLabel   = document.getElementById("progress-label");
const btnAddTx        = document.getElementById("btn-add-transaction");

// ── INIT ─────────────────────────────────────────────────────────────────────

function init() {
    populatePeriodDropdowns();
    setupNavigation();
    setupPeriodControls();
    setupImport();
    setupModals();
    setupTransactionForm();
    setupSettings();
    setupDatePicker(); 
}

// ── CUSTOM DROPDOWN LOGIC ────────────────────────────────────────────────────

let selectedMonth = null;
let selectedYear  = null;

function buildDropdown(dropdown, optionsList, items, onSelect) {
    // Toggle open/close
    dropdown.querySelector(".custom-select-trigger").addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = dropdown.classList.contains("open");
        closeAllDropdowns();
        if (!isOpen) dropdown.classList.add("open");
    });

    // Build options
    items.forEach(item => {
        const el = document.createElement("div");
        el.className   = "custom-option";
        el.textContent = item;
        el.dataset.value = item;
        el.addEventListener("click", (e) => {
            e.stopPropagation();
            dropdown.querySelectorAll(".custom-option").forEach(o => o.classList.remove("selected"));
            el.classList.add("selected");
            onSelect(item);
            dropdown.classList.remove("open");
        });
        optionsList.appendChild(el);
    });
}

function closeAllDropdowns() {
    document.querySelectorAll(".custom-select.open").forEach(d => d.classList.remove("open"));
    document.querySelectorAll(".date-picker.open").forEach(d => d.classList.remove("open"));
}

// Close dropdowns when clicking outside
document.addEventListener("click", closeAllDropdowns);

function populatePeriodDropdowns() {
    const currentYear = new Date().getFullYear();
    const years = [];
    for (let y = currentYear; y >= 2026; y--) years.push(String(y));

    buildDropdown(monthDropdown, monthOptions, MONTHS, (val) => {
        selectedMonth    = val;
        monthLabel.textContent = val;
    });

    buildDropdown(yearDropdown, yearOptions, years, (val) => {
        selectedYear    = val;
        yearLabel.textContent = val;
    });

    // Default to current month/year
    const defaultMonth = MONTHS[new Date().getMonth()];
    const defaultYear  = String(currentYear);

    selectedMonth = defaultMonth;
    selectedYear  = defaultYear;
    monthLabel.textContent = defaultMonth;
    yearLabel.textContent  = defaultYear;

    // Mark defaults as selected
    setTimeout(() => {
        monthOptions.querySelectorAll(".custom-option").forEach(o => {
            if (o.dataset.value === defaultMonth) o.classList.add("selected");
        });
        yearOptions.querySelectorAll(".custom-option").forEach(o => {
            if (o.dataset.value === defaultYear) o.classList.add("selected");
        });
    }, 0);
}


// ── NAVIGATION ───────────────────────────────────────────────────────────────

const VIEWS_WITH_PERIOD = new Set(["dashboard", "transactions"]);

function setupNavigation() {
    document.querySelectorAll(".nav-item").forEach(btn => {
        btn.addEventListener("click", () => switchView(btn.dataset.view));
    });
}

function switchView(view) {
    currentView = view;

    document.querySelectorAll(".nav-item").forEach(btn => {
        btn.classList.toggle("active", btn.dataset.view === view);
    });

    document.querySelectorAll(".view").forEach(v => {
        v.classList.toggle("active", v.id === `view-${view}`);
    });

    const titles = {
        dashboard:    "📊 Dashboard",
        import:       "📂 Import Statement",
        transactions: "📋 Transactions",
        settings:     "⚙️ Settings"
    };
    document.getElementById("page-title").textContent = titles[view] || view;

    // Show/hide period controls
    if (VIEWS_WITH_PERIOD.has(view)) {
        periodControls.classList.remove("hidden");
    } else {
        periodControls.classList.add("hidden");
    }

    if (view === "settings") loadSettings();
}

// ── PERIOD CONTROLS ───────────────────────────────────────────────────────────

function setupPeriodControls() {
    btnLoad.addEventListener("click", handleLoad);
}

async function handleLoad() {
    const year  = selectedYear;
    const month = selectedMonth;
    if (!year || !month) { showToast("Select a month and year", "info"); return; }

    currentYear  = year;
    currentMonth = month;

    if (currentView === "dashboard") await loadDashboard(year, month);
    if (currentView === "transactions") await loadTransactions(year, month);
}

// ── DASHBOARD ────────────────────────────────────────────────────────────────

async function loadDashboard(year, month) {
    btnLoad.disabled = true;
    btnLoad.textContent = "Loading...";

    try {
        const result = await callPython("get_dashboard_data", year, month);
        if (!result.ok) { showToast(result.error, "error"); return; }

        const { transactions, categories, daily_spend, budget_status, top_transactions, source_breakdown } = result.data;

        if (!transactions.length) {
            showToast("No data found for this period. Import first.", "info");
            return;
        }

        // Show content, hide empty state
        document.getElementById("dashboard-empty").classList.add("hidden");
        document.getElementById("dashboard-content").classList.remove("hidden");
        document.getElementById("dashboard-loaded-period").innerHTML = `<span class="loaded-period-value">${month} ${year}</span>`;

        renderKPIs(transactions, categories, budget_status);
        renderTopTransactions(top_transactions);

        setTimeout(() => {
            renderBarChart(categories);
            renderSourceDonutChart(source_breakdown);
            renderDailyChart(daily_spend);
            renderCumulativeChart(daily_spend);
            renderFamilyDonutChart(categories);
            renderTreemap(transactions);
        }, 100);

        showToast(`${month} ${year} loaded`, "success");

    } catch (e) {
        showToast("Error loading dashboard", "error");
    } finally {
        btnLoad.disabled = false;
        btnLoad.textContent = "Load";
    }
}

// ── KPIs ─────────────────────────────────────────────────────────────────────

function renderKPIs(transactions, categories, budgetStatus) {
    const total  = transactions.reduce((s, t) => s + t.spend, 0);
    const topCat = categories.length ? categories[0].type : "—";
    const days   = [...new Set(transactions.map(t => t.date))].length || 1;
    const avgDay = total / days;
    const count  = transactions.length;

    document.querySelector("#kpi-total .kpi-value").textContent = fmt(total);
    document.querySelector("#kpi-top .kpi-value").textContent   = topCat || "—";
    document.querySelector("#kpi-avg .kpi-value").textContent   = fmt(avgDay);
    document.querySelector("#kpi-count .kpi-value").textContent = count;

    const budgetEl = document.querySelector("#kpi-budget .kpi-value");
    if (budgetStatus) {
        const sign = budgetStatus.status === "surplus" ? "▲" : "▼";
        budgetEl.textContent = `${sign} ${fmt(Math.abs(budgetStatus.diff))}`;
        budgetEl.className   = `kpi-value ${budgetStatus.status}`;
    } else {
        budgetEl.textContent = "—";
        budgetEl.className   = "kpi-value";
    }
}

// ── CHARTS ───────────────────────────────────────────────────────────────────

function renderBarChart(categories) {
    const sorted = [...categories].sort((a, b) => a.total_spend - b.total_spend);
    Plotly.newPlot("chart-bar", [{
        type: "bar", orientation: "h",
        x: sorted.map(c => c.total_spend),
        y: sorted.map(c => c.type),
        text: sorted.map(c => fmt(c.total_spend)),
        textposition: "outside",
        textfont: { color: TEXT_SEC, size: 10 },
        marker: {
            color: sorted.map(c => c.total_spend),
            colorscale: [[0, "#2a1a3e"], [1, PURPLE]],
            line: { width: 0 }
        },
        hovertemplate: "<b>%{y}</b><br>%{x:,.0f}<extra></extra>"
    }], {
        ...PLOTLY_BASE,
        margin: { t: 10, b: 30, l: 110, r: 80 },
        xaxis: { visible: false, showgrid: false },
        yaxis: { showgrid: false, tickfont: { size: 10, color: TEXT_SEC } },
        height: 280,
    }, { displayModeBar: false, responsive: true });
}

function renderSourceDonutChart(sourceBreakdown) {
    Plotly.newPlot("chart-source-donut", [{
        type: "pie",
        labels: sourceBreakdown.map(s => s.source),
        values: sourceBreakdown.map(s => s.spend),
        hole: 0.55,
        marker: { colors: ["#7030A0", "#9B59B6", "#C39BD3"], line: { color: BG_CARD, width: 2 } },
        textinfo: "label+percent",
        textfont: { size: 11 },
        hovertemplate: "<b>%{label}</b><br>%{value:,.0f}<br>%{percent}<extra></extra>"
    }], {
        ...PLOTLY_BASE,
        margin: { t: 10, b: 10, l: 10, r: 10 },
        height: 280,
    }, { displayModeBar: false, responsive: true });
}

function renderDailyChart(dailySpend) {
    const dates  = dailySpend.map(d => d.date);
    const spends = dailySpend.map(d => d.total_spend);
    const avg7   = spends.map((_, i) => {
        const slice = spends.slice(Math.max(0, i - 6), i + 1);
        return slice.reduce((a, b) => a + b, 0) / slice.length;
    });

    Plotly.newPlot("chart-daily", [
        {
            type: "bar", x: dates, y: spends, name: "Daily",
            marker: { color: "rgba(112,48,160,0.4)" },
            hovertemplate: "%{x}<br>%{y:,.0f}<extra></extra>"
        },
        {
            type: "scatter", x: dates, y: avg7, name: "7-day Avg",
            line: { color: PURPLE_LIGHT, width: 2 },
            hovertemplate: "%{x}<br>Avg %{y:,.0f}<extra></extra>"
        }
    ], {
        ...PLOTLY_BASE,
        margin: { t: 20, b: 40, l: 50, r: 10 },
        xaxis: { showgrid: false, tickfont: { size: 9 } },
        yaxis: { showgrid: true, gridcolor: "rgba(255,255,255,0.04)", tickfont: { size: 9 } },
        barmode: "overlay", height: 280,
        showlegend: true,
        legend: { orientation: "h", y: 1.1, font: { size: 10 } }
    }, { displayModeBar: false, responsive: true });
}

function renderCumulativeChart(dailySpend) {
    const sorted = [...dailySpend].sort((a, b) => a.date.localeCompare(b.date));
    let cum = 0;
    const dates  = sorted.map(d => d.date);
    const cumArr = sorted.map(d => { cum += d.total_spend; return cum; });

    Plotly.newPlot("chart-cumulative", [{
        type: "scatter", x: dates, y: cumArr,
        fill: "tozeroy", fillcolor: "rgba(112,48,160,0.12)",
        line: { color: PURPLE, width: 2 },
        hovertemplate: "%{x}<br>Total: %{y:,.0f}<extra></extra>"
    }], {
        ...PLOTLY_BASE,
        margin: { t: 10, b: 40, l: 60, r: 10 },
        xaxis: { showgrid: false, tickfont: { size: 9 } },
        yaxis: { showgrid: true, gridcolor: "rgba(255,255,255,0.04)", tickfont: { size: 9 } },
        height: 280,
    }, { displayModeBar: false, responsive: true });
}

function renderFamilyDonutChart(categories) {
    const PARENTS_CATS = new Set(["Bills (P)", "Parents", "Medicines (P)"]);
    const FAMILY_CATS  = new Set([
        "Cash Withdrawal","EMI","Rent","Food","Entertainment",
        "Groceries","Bills","Personal","Shopping","Investment",
        "Insurance","Fuel","Travel","Medicines"
    ]);

    let parentsTotal = 0, familyTotal = 0;
    categories.forEach(c => {
        if (PARENTS_CATS.has(c.type))     parentsTotal += c.total_spend;
        else if (FAMILY_CATS.has(c.type)) familyTotal  += c.total_spend;
    });

    Plotly.newPlot("chart-family-donut", [{
        type: "pie",
        labels: ["Family", "Parents"],
        values: [familyTotal, parentsTotal],
        hole: 0.55,
        marker: { colors: [PURPLE, "#C39BD3"], line: { color: BG_CARD, width: 2 } },
        textinfo: "label+percent",
        textfont: { size: 11 },
        hovertemplate: "<b>%{label}</b><br>%{value:,.0f}<br>%{percent}<extra></extra>"
    }], {
        ...PLOTLY_BASE,
        margin: { t: 10, b: 10, l: 10, r: 10 },
        height: 280,
    }, { displayModeBar: false, responsive: true });
}

function renderTreemap(transactions) {
    const filtered  = transactions.filter(t => t.spend > 0);
    const ids       = filtered.map((_, i) => `tx_${i}`);
    const labels    = filtered.map(t => t.description ? t.description.slice(0, 35) : "Unknown");
    const parents   = filtered.map(t => t.type || "Others");
    const values    = filtered.map(t => t.spend);
    const catSet    = [...new Set(parents)];
    const allIds     = [...catSet, ...ids];
    const allLabels  = [...catSet, ...labels];
    const allParents = [...catSet.map(() => ""), ...parents];
    const catTotals = catSet.map(cat =>
        values.reduce((sum, v, i) => parents[i] === cat ? sum + v : sum, 0)
    );
    const allValues = [...catTotals, ...values];

    Plotly.newPlot("chart-treemap", [{
        type: "treemap",
        ids: allIds, labels: allLabels, parents: allParents, values: allValues,
        branchvalues: "total",
        texttemplate: "<b>%{label}</b><br>₹%{value:,.0f}",
        hovertemplate: "<b>%{label}</b><br>₹%{value:,.0f}<extra></extra>",
        marker: {
            colorscale: [[0, "#1e0a2e"], [1, PURPLE]],
            colors: allValues,
            line: { color: BG_CARD, width: 1 }
        }
    }], {
        ...PLOTLY_BASE,
        margin: { t: 10, b: 10, l: 10, r: 10 },
        height: 420,
    }, { displayModeBar: false, responsive: true });
}

// ── TOP TRANSACTIONS ─────────────────────────────────────────────────────────

function renderTopTransactions(transactions) {
    document.getElementById("top-transactions").innerHTML =
        buildTable(transactions, ["date","description","type","source","spend"], false);
}

// ── IMPORT ───────────────────────────────────────────────────────────────────

function setupImport() {
    // Browse button
    btnBrowse.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
        if (fileInput.files[0]) setSelectedFile(fileInput.files[0]);
    });

    // Drag and drop
    dropZone.addEventListener("dragover", (e) => {
        e.preventDefault();
        dropZone.classList.add("dragover");
    });
    dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
    dropZone.addEventListener("drop", (e) => {
        e.preventDefault();
        dropZone.classList.remove("dragover");
        const file = e.dataTransfer.files[0];
        if (file && (file.name.endsWith(".xlsx") || file.name.endsWith(".xls"))) {
            setSelectedFile(file);
        } else {
            showToast("Only .xlsx or .xls files supported", "error");
        }
    });

    // Clear selection
    btnClear.addEventListener("click", clearSelectedFile);

    // Import
    btnImport.addEventListener("click", handleImport);
}

function setSelectedFile(file) {
    selectedFile = file;
    fileName.textContent = file.name;
    fileInfo.classList.remove("hidden");
    btnImport.classList.remove("hidden");
    dropZone.style.opacity = "0.5";
}

function clearSelectedFile() {
    selectedFile = null;
    fileInput.value = "";
    fileInfo.classList.add("hidden");
    btnImport.classList.add("hidden");
    dropZone.style.opacity = "1";
}

async function handleImport() {
    if (!selectedFile) return;

    const base64 = await fileToBase64(selectedFile);
    const fname  = selectedFile.name;

    setImportLoading(true);

    try {
        const result = await callPython("import_statement", fname, base64);

        if (!result.ok) {
            // Data already exists — show overwrite confirmation
            if (result.error.startsWith("DATA_EXISTS:")) {
                const [, year, month] = result.error.split(":");
                setImportLoading(false);
                showConfirmModal(
                    "Data Already Exists",
                    `Data for ${month} ${year} already exists. Overwrite?`,
                    () => runImportForce(fname, base64)
                );
                return;
            }
            showToast(result.error, "error");
            return;
        }

        finishImport(result.data);

    } catch (e) {
        showToast("Unexpected error during import", "error");
    } finally {
        setImportLoading(false);
    }
}

async function runImportForce(fname, base64) {
    setImportLoading(true);
    try {
        const result = await callPython("import_statement_force", fname, base64);
        if (result.ok) finishImport(result.data);
        else showToast(result.error, "error");
    } catch (e) {
        showToast("Unexpected error during import", "error");
    } finally {
        setImportLoading(false);
    }
}

function finishImport(data) {
    const { count, year, month } = data;
    showToast(`${count} transactions imported`, "success");
    selectedYear  = String(year);
    selectedMonth = month;
    yearLabel.textContent  = year;
    monthLabel.textContent = month;
    currentYear  = String(year);
    currentMonth = month;
    clearSelectedFile();
    switchView("transactions");
    loadTransactions(year, month);
}

function setImportLoading(loading) {
    btnImport.disabled    = loading;
    btnImport.textContent = loading ? "Importing..." : "Import & Categorize";
    if (loading) {
        importProgress.classList.remove("hidden");
        animateProgress();
    } else {
        importProgress.classList.add("hidden");
        progressFill.style.width = "0%";
    }
}

function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload  = () => resolve(reader.result.split(",")[1]);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function animateProgress() {
    let pct = 0;
    progressLabel.textContent = "Processing...";
    const interval = setInterval(() => {
        pct = Math.min(pct + Math.random() * 12, 90);
        progressFill.style.width = pct + "%";
        if (pct >= 90) clearInterval(interval);
    }, 300);
}

// ── TRANSACTIONS ─────────────────────────────────────────────────────────────

let allTransactions  = [];   // full unfiltered data
let filterType       = "All";
let filterSource     = "All";
let sortCol          = "date";
let sortDir          = "asc";

async function loadTransactions(year, month) {
    const result = await callPython("get_transactions", year, month);
    if (!result.ok) { showToast(result.error, "error"); return; }

    allTransactions = result.data;

    // Reset filters and sort on fresh load
    filterType   = "All";
    filterSource = "All";
    sortCol      = "date";
    sortDir      = "asc";

    document.getElementById("transactions-empty").classList.add("hidden");
    document.getElementById("transactions-content").classList.remove("hidden");
    document.getElementById("transactions-loaded-period").innerHTML = `<span class="loaded-period-value">${month} ${year}</span>`;

    renderTransactionsTable();
}

function getFilteredSorted() {
    let rows = [...allTransactions];

    // Filter
    if (filterType   !== "All") rows = rows.filter(r => r.type   === filterType);
    if (filterSource !== "All") rows = rows.filter(r => r.source === filterSource);

    // Sort
    rows.sort((a, b) => {
        let valA = sortCol === "spend" ? a.spend : a.date;
        let valB = sortCol === "spend" ? b.spend : b.date;
        if (valA < valB) return sortDir === "asc" ? -1 : 1;
        if (valA > valB) return sortDir === "asc" ? 1 : -1;
        return 0;
    });

    return rows;
}

function renderTransactionsTable() {
    const rows    = getFilteredSorted();
    const cols    = ["date", "description", "source", "type", "spend", "remarks"];
    const el      = document.getElementById("all-transactions");

    // Unique values for filter dropdowns
    const uniqueTypes   = ["All", ...new Set(allTransactions.map(r => r.type).filter(Boolean))];
    const uniqueSources = ["All", ...new Set(allTransactions.map(r => r.source).filter(Boolean))];

    const headers = cols.map(c => {
        if (c === "date") {
            const arrow = sortCol === "date" ? (sortDir === "asc" ? "↑" : "↓") : "";
            return `<th class="sortable" onclick="toggleSort('date')">DATE <span class="col-arrow">${arrow}</span></th>`;
        }
        if (c === "spend") {
            const arrow = sortCol === "spend" ? (sortDir === "asc" ? "↑" : "↓") : "";
            return `<th class="sortable" onclick="toggleSort('spend')">SPEND <span class="col-arrow">${arrow}</span></th>`;
        }
        if (c === "type") {
            const active = filterType !== "All" ? `color:var(--purple-light)` : "";
            return `<th class="filterable" style="${active}" data-field="type" data-options='${JSON.stringify(uniqueTypes)}'>TYPE ▾</th>`;
        }
        if (c === "source") {
            const active = filterSource !== "All" ? `color:var(--purple-light)` : "";
            return `<th class="filterable" style="${active}" data-field="source" data-options='${JSON.stringify(uniqueSources)}'>SOURCE ▾</th>`;
        }
        return `<th>${c.toUpperCase()}</th>`;
    }).join("");

    const actionsHeader = `<th style="width:80px"></th>`;

    const body = rows.length ? rows.map(row => {
        const cells = cols.map(c => {
            let val = row[c] ?? "—";
            let cls = "";
            if (c === "spend") { val = fmt(val); cls = "amount"; }
            if (c === "type")  { cls = "category"; }
            if (c === "date")  { val = formatDate(val); }
            if (c === "description" && typeof val === "string") val = val.slice(0, 55);
            return `<td class="${cls}">${val}</td>`;
        }).join("");

        return `<tr>
            ${cells}
            <td class="actions">
                <button class="btn-edit"   onclick='openTxModal(${JSON.stringify(row)})'>✎</button>
                <button class="btn-delete" onclick='deleteTx(${row.id})'>✕</button>
            </td>
        </tr>`;
    }).join("") : `<tr><td colspan="${cols.length + 1}" style="padding:24px;text-align:center;color:var(--text-muted);">No transactions found</td></tr>`;

    el.innerHTML = `<table><thead><tr>${headers}${actionsHeader}</tr></thead><tbody>${body}</tbody></table>`;

    el.querySelectorAll("th.filterable").forEach(th => {
        th.addEventListener("click", (e) => {
            const field   = th.dataset.field;
            const options = JSON.parse(th.dataset.options);
            openColFilter(e, field, options);
        });
    });
}

function toggleSort(col) {
    if (sortCol === col) {
        sortDir = sortDir === "asc" ? "desc" : "asc";
    } else {
        sortCol = col;
        sortDir = "asc";
    }
    renderTransactionsTable();
}

function openColFilter(event, field, options) {
    event.stopPropagation();

    // Remove existing dropdown
    document.querySelectorAll(".col-filter-dropdown").forEach(d => d.remove());

    const th = event.currentTarget;
    const rect = th.getBoundingClientRect();

    const dropdown = document.createElement("div");
    dropdown.className = "col-filter-dropdown";
    dropdown.style.position = "fixed";
    dropdown.style.top    = (rect.bottom) + "px";
    dropdown.style.left   = (rect.left) + "px";
    dropdown.style.minWidth = rect.width + "px";

    const currentVal = field === "type" ? filterType : filterSource;

    options.forEach(opt => {
        const el = document.createElement("div");
        el.className  = "col-filter-option" + (opt === currentVal ? " selected" : "");
        el.textContent = opt;
        el.addEventListener("click", (e) => {
            e.stopPropagation();
            if (field === "type")   filterType   = opt;
            if (field === "source") filterSource = opt;
            dropdown.remove();
            renderTransactionsTable();
        });
        dropdown.appendChild(el);
    });

    document.body.appendChild(dropdown);

    // Close on outside click
    setTimeout(() => {
        document.addEventListener("click", () => dropdown.remove(), { once: true });
    }, 0);
}

// ── TRANSACTION FORM (Add / Edit / Delete) ────────────────────────────────────

function setupTransactionForm() {
    btnAddTx.addEventListener("click", () => openTxModal(null));
    txModalCancel.addEventListener("click", () => txModalOverlay.classList.add("hidden"));
    txModalSave.addEventListener("click", saveTx);
}

let datePickerViewDate = new Date();

function setupDatePicker() {
    const input   = document.getElementById("tx-date");
    const wrapper = document.getElementById("tx-date-picker");

    input.addEventListener("click", (e) => {
        e.stopPropagation();
        const isOpen = wrapper.classList.contains("open");
        closeAllDropdowns();
        if (!isOpen) {
            datePickerViewDate = parseDMY(input.value) || getSelectedPeriodDate();
            renderCalendar();
            wrapper.classList.add("open");
        }
    });
}

function parseDMY(str) {
    const m = str && str.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    return m ? new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1])) : null;
}

function formatDMY(date) {
    const d = String(date.getDate()).padStart(2, "0");
    const m = String(date.getMonth() + 1).padStart(2, "0");
    return `${d}-${m}-${date.getFullYear()}`;
}

function getSelectedPeriodDate() {
    const monthIndex = MONTHS.indexOf(currentMonth);
    const year = parseInt(currentYear);
    if (monthIndex >= 0 && !isNaN(year)) {
        return new Date(year, monthIndex, 1);
    }
    // fallback if no period loaded yet
    return new Date();
}

function renderCalendar() {
    const calendar = document.getElementById("tx-date-calendar");
    const year  = datePickerViewDate.getFullYear();
    const month = datePickerViewDate.getMonth();
    const selected = parseDMY(document.getElementById("tx-date").value);
    const today = new Date();

    const startOffset  = new Date(year, month, 1).getDay();
    const daysInMonth  = new Date(year, month + 1, 0).getDate();

    let cells = "";
    for (let i = 0; i < startOffset; i++) cells += `<div class="cal-cell empty"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
        const isSelected = selected && selected.getDate() === d && selected.getMonth() === month && selected.getFullYear() === year;
        const isToday = today.getDate() === d && today.getMonth() === month && today.getFullYear() === year;
        cells += `<div class="cal-cell${isSelected ? " selected" : ""}${isToday ? " today" : ""}" data-day="${d}">${d}</div>`;
    }

    calendar.innerHTML = `
        <div class="cal-header">
            <button type="button" class="cal-nav" id="cal-prev">‹</button>
            <span class="cal-title">${MONTHS[month]} ${year}</span>
            <button type="button" class="cal-nav" id="cal-next">›</button>
        </div>
        <div class="cal-weekdays">${["S","M","T","W","T","F","S"].map(d => `<div>${d}</div>`).join("")}</div>
        <div class="cal-grid">${cells}</div>
    `;

    calendar.querySelector("#cal-prev").addEventListener("click", (e) => {
        e.stopPropagation();
        datePickerViewDate = new Date(year, month - 1, 1);
        renderCalendar();
    });
    calendar.querySelector("#cal-next").addEventListener("click", (e) => {
        e.stopPropagation();
        datePickerViewDate = new Date(year, month + 1, 1);
        renderCalendar();
    });
    calendar.querySelectorAll(".cal-cell:not(.empty)").forEach(cell => {
        cell.addEventListener("click", (e) => {
            e.stopPropagation();
            const picked = new Date(year, month, parseInt(cell.dataset.day));
            const input  = document.getElementById("tx-date");
            input.value = formatDMY(picked);
            input.classList.remove("invalid");
            document.getElementById("err-date").textContent = "";
            document.getElementById("tx-date-picker").classList.remove("open");
        });
    });
}

async function openTxModal(row) {
    // Clear previous errors
    ["err-date","err-spend","err-description","err-type","err-source"].forEach(id => {
        document.getElementById(id).textContent = "";
    });
    ["tx-date","tx-spend","tx-description"].forEach(id => {
        document.getElementById(id).classList.remove("invalid");
    });

    txModalTitle.textContent = row ? "Edit Transaction" : "Add Transaction";
    document.getElementById("tx-id").value          = row ? row.id : "";
    document.getElementById("tx-date").value         = row ? row.date : "";
    document.getElementById("tx-spend").value        = row ? row.spend : "";
    document.getElementById("tx-description").value  = row ? row.description : "";
    document.getElementById("tx-remarks").value      = row ? row.remarks : "";

    // Load categories and sources for dropdowns
    const result = await callPython("get_categories_and_sources");
    const categories = result.ok ? result.data.categories : [];
    const sources    = result.ok ? result.data.sources : [];

    buildTxDropdown("tx-type-dropdown", "tx-type-label", categories, row ? row.type : null);
    buildTxDropdown("tx-source-dropdown", "tx-source-label", sources, row ? row.source : null);

    txModalOverlay.classList.remove("hidden");
}

function validateTxForm() {
    const fields = [
        { id: "tx-date",        errId: "err-date",        rule: v => /^\d{2}-\d{2}-\d{4}$/.test(v),  msg: "Enter a valid date (DD-MM-YYYY)" },
        { id: "tx-spend",       errId: "err-spend",       rule: v => !isNaN(v) && Number(v) > 0,      msg: "Enter a positive amount" },
        { id: "tx-description", errId: "err-description", rule: v => v.trim().length >= 3,             msg: "Min 3 characters required" },
    ];

    let valid = true;

    fields.forEach(({ id, errId, rule, msg }) => {
        const input = document.getElementById(id);
        const err   = document.getElementById(errId);
        const val   = input.value;

        if (!rule(val)) {
            input.classList.add("invalid");
            err.textContent = msg;
            valid = false;
        } else {
            input.classList.remove("invalid");
            err.textContent = "";
        }
    });

    // Validate category dropdown
    const typeErr = document.getElementById("err-type");
    const typeVal = document.getElementById("tx-type-dropdown").dataset.value;
    if (!typeVal) {
        typeErr.textContent = "Category is required";
        valid = false;
    } else {
        typeErr.textContent = "";
    }
    
    // Validate source dropdown
    const sourceErr = document.getElementById("err-source");
    const sourceVal = document.getElementById("tx-source-dropdown").dataset.value;
    if (!sourceVal) {
        sourceErr.textContent = "Source is required";
        valid = false;
    } else {
        sourceErr.textContent = "";
    }

    return valid;
}

async function saveTx() {
    if (!validateTxForm()) return;

    const id = document.getElementById("tx-id").value;
    const payload = {
        date:        document.getElementById("tx-date").value,
        spend:       parseFloat(document.getElementById("tx-spend").value) || 0,
        description: document.getElementById("tx-description").value,
        type:        document.getElementById("tx-type-dropdown").dataset.value,
        source:      document.getElementById("tx-source-dropdown").dataset.value,
        remarks:     document.getElementById("tx-remarks").value,
        year:        currentYear,
        month:       currentMonth,
    };

    const method = id ? "update_transaction" : "add_transaction";
    if (id) payload.id = parseInt(id);

    const result = await callPython(method, payload);
    if (result.ok) {
        txModalOverlay.classList.add("hidden");
        showToast(id ? "Transaction updated" : "Transaction added", "success");
        await loadTransactions(currentYear, currentMonth);
    } else {
        showToast(result.error, "error");
    }
}

async function deleteTx(id) {
    showConfirmModal("Delete Transaction", "Are you sure you want to delete this transaction?", async () => {
        const result = await callPython("delete_transaction", id);
        if (result.ok) {
            showToast("Transaction deleted", "success");
            await loadTransactions(currentYear, currentMonth);
        } else {
            showToast(result.error, "error");
        }
    });
}

// ── MODALS ───────────────────────────────────────────────────────────────────

function setupModals() {
    modalCancel.addEventListener("click",  () => modalOverlay.classList.add("hidden"));
    modalConfirm.addEventListener("click", () => {
        modalOverlay.classList.add("hidden");
        if (pendingConfirm) { pendingConfirm(); pendingConfirm = null; }
    });
    
    document.addEventListener("keydown", (e) => {
        if (e.key !== "Escape") return;
        modalOverlay.classList.add("hidden");
        txModalOverlay.classList.add("hidden");
    });
}

function showConfirmModal(title, body, onConfirm) {
    modalTitle.textContent = title;
    modalBody.textContent  = body;
    pendingConfirm = onConfirm;
    modalOverlay.classList.remove("hidden");
}

// ── TABLE BUILDER ─────────────────────────────────────────────────────────────

function buildTable(rows, cols, withActions) {
    if (!rows.length) return `<div style="padding:24px;text-align:center;color:#4a4760;font-size:13px;">No transactions found</div>`;

    const headerCols = withActions ? [...cols, "actions"] : cols;
    const headers = headerCols.map(c =>
        `<th>${c.replace(/_/g," ").toUpperCase()}</th>`
    ).join("");

    const body = rows.map(row => {
        const cells = cols.map(c => {
            let val = row[c] ?? "—";
            let cls = "";
            if (c === "spend") { val = fmt(val); cls = "amount"; }
            if (c === "type")  { cls = "category"; }
            if (c === "date")  { val = formatDate(val); }
            if (c === "description" && typeof val === "string") val = val.slice(0, 55);
            return `<td class="${cls}">${val}</td>`;
        }).join("");

        const actions = withActions
            ? `<td class="actions">
                <button class="btn-edit"   onclick='openTxModal(${JSON.stringify(row)})'>✎</button>
                <button class="btn-delete" onclick='deleteTx(${row.id})'>✕</button>
               </td>`
            : "";

        return `<tr>${cells}${actions}</tr>`;
    }).join("");

    return `<table><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table>`;
}

function buildTxDropdown(dropdownId, labelId, items, selectedValue) {
    const dropdown = document.getElementById(dropdownId);
    const label    = document.getElementById(labelId);
    const optsList = dropdown.querySelector(".custom-select-options");

    // Set label
    label.textContent = selectedValue || "Select...";
    dropdown.dataset.value = selectedValue || "";

    // Clear and rebuild options
    optsList.innerHTML = "";
    items.forEach(item => {
        const opt = document.createElement("div");
        opt.className = "custom-option" + (item === selectedValue ? " selected" : "");
        opt.textContent  = item;
        opt.dataset.value = item;
        opt.addEventListener("click", (e) => {
            e.stopPropagation();
            optsList.querySelectorAll(".custom-option").forEach(o => o.classList.remove("selected"));
            opt.classList.add("selected");
            label.textContent      = item;
            dropdown.dataset.value = item;
            dropdown.classList.remove("open");
            // Clear error if any
            const err = document.getElementById("err-type");
            if (err) err.textContent = "";
        });
        optsList.appendChild(opt);
    });

    // Toggle open/close
    const trigger = dropdown.querySelector(".custom-select-trigger");
    trigger.onclick = (e) => {
        e.stopPropagation();
        const isOpen = dropdown.classList.contains("open");
        closeAllDropdowns();
        if (!isOpen) dropdown.classList.add("open");
    };
}

// ── SETTINGS ─────────────────────────────────────────────────────────────────
function setupSettings() {
    document.getElementById("btn-add-category").addEventListener("click", addCategoryRow);
    document.getElementById("btn-add-source").addEventListener("click", addSourceRow);
}

const GROUPS = ["None", "Family", "Parents"];

async function loadSettings() {
    await Promise.all([
        loadCategoriesSettings(),
        loadSourcesSettings()
    ]);
}

// ── CATEGORIES SETTINGS ───────────────────────────────────────────────────────

async function loadCategoriesSettings() {
    const result = await callPython("get_categories_settings");
    if (!result.ok) { showToast(result.error, "error"); return; }
    renderCategoriesTable(result.data);
}

function renderCategoriesTable(rows) {
    const el = document.getElementById("categories-table");

    if (!rows.length) {
        el.innerHTML = `<div style="padding:16px;color:var(--text-muted);font-size:13px;">No categories yet. Add one above.</div>`;
        return;
    }

    const headers = `<thead><tr>
        <th>Name</th>
        <th>Keywords <span style="font-weight:400;text-transform:none;letter-spacing:0">(comma separated)</span></th>
        <th>Group</th>
        <th style="width:132px"></th>
    </tr></thead>`;

    const bodyRows = rows.map((row, i) => buildCategoryRow(row, false, i, rows.length)).join("");
    el.innerHTML = `<table>${headers}<tbody>${bodyRows}</tbody></table>`;
}

function buildCategoryRow(row, isEditing, index = 0, total = 1) {
    const groupOptions = GROUPS.map(g =>
        `<option value="${g}" ${row.grp === g ? "selected" : ""}>${g}</option>`
    ).join("");

    if (isEditing) {
        return `<tr data-id="${row.id || ''}" data-mode="edit">
            <td><input class="settings-input" data-field="name" value="${row.name || ''}" /></td>
            <td><input class="settings-input" data-field="keywords" value="${row.keywords || ''}" /></td>
            <td>
                <div class="custom-select settings-group-select" data-value="${row.grp || 'None'}">
                    <div class="custom-select-trigger">
                        <span class="group-label">${row.grp || 'None'}</span>
                        <span class="custom-select-arrow">▾</span>
                    </div>
                    <div class="custom-select-options">
                        ${GROUPS.map(g => `<div class="custom-option ${row.grp === g ? 'selected' : ''}" data-value="${g}">${g}</div>`).join("")}
                    </div>
                </div>
            </td>
            <td class="actions">
                <button class="btn-save-row" onclick="saveCategoryRow(this)">✓</button>
                <button class="btn-delete"   onclick="cancelCategoryRow(this)">✕</button>
            </td>
        </tr>`;
    } else {
        return `<tr data-id="${row.id}" data-mode="view">
            <td style="color:var(--text-primary);font-family:var(--font-mono);font-size:12px;padding:10px 12px;">${row.name}</td>
            <td style="color:var(--text-secondary);font-family:var(--font-mono);font-size:12px;padding:10px 12px;">${row.keywords || '—'}</td>
            <td style="color:var(--purple-light);font-family:var(--font-mono);font-size:12px;padding:10px 12px;">${row.grp || 'None'}</td>
            <td class="actions actions-wide">
                <button class="btn-move" ${index === 0 ? "disabled" : ""} onclick="moveCategoryRow(this,'up')">▲</button>
                <button class="btn-move" ${index === total - 1 ? "disabled" : ""} onclick="moveCategoryRow(this,'down')">▼</button>
                <button class="btn-edit"   onclick="editCategoryRow(this)">✎</button>
                <button class="btn-delete" onclick="deleteCategoryRow(this)">✕</button>
            </td>
        </tr>`;
    }
}

function editCategoryRow(btn) {
    const tr = btn.closest("tr");
    const id = tr.dataset.id;
    const cells = tr.querySelectorAll("td");
    const row = {
        id,
        name:     cells[0].textContent.trim(),
        keywords: cells[1].textContent.trim() === '—' ? '' : cells[1].textContent.trim(),
        grp:      cells[2].textContent.trim()
    };
    tr.outerHTML = buildCategoryRow(row, true);
    setupGroupDropdowns();
}

function cancelCategoryRow(btn) {
    const tr = btn.closest("tr");
    const id = tr.dataset.id;

    // Unsaved new row (from "+ Add") — discard by just removing it from the DOM
    if (!id) { tr.remove(); return; }

    // Existing row being edited — discard changes, re-fetch from DB to restore original values
    loadCategoriesSettings();
}

async function saveCategoryRow(btn) {
    const tr       = btn.closest("tr");
    const id       = tr.dataset.id;
    const name     = tr.querySelector("[data-field='name']").value.trim();
    const keywords = tr.querySelector("[data-field='keywords']").value.trim();
    const grp      = tr.querySelector(".settings-group-select").dataset.value;

    if (!name) { showToast("Category name is required", "error"); return; }

    let result;
    if (id) {
        result = await callPython("update_category", { id, name, keywords, grp });
    } else {
        result = await callPython("add_category", { name, keywords, grp });
    }

    if (result.ok) {
        showToast("Category saved", "success");
        loadCategoriesSettings();
    } else {
        showToast(result.error, "error");
    }
}

async function deleteCategoryRow(btn) {
    const tr = btn.closest("tr");
    const id = tr.dataset.id;

    // New unsaved row — just remove from DOM
    if (!id) { tr.remove(); return; }

    showConfirmModal("Delete Category", "Delete this category?", async () => {
        const result = await callPython("delete_category", id);
        if (result.ok) { showToast("Category deleted", "success"); loadCategoriesSettings(); }
        else showToast(result.error, "error");
    });
}

async function moveCategoryRow(btn, direction) {
    const tr = btn.closest("tr");
    const sibling = direction === "up" ? tr.previousElementSibling : tr.nextElementSibling;
    if (!sibling) return;

    const tbody = tr.parentElement;
    if (direction === "up") {
        tbody.insertBefore(tr, sibling);
    } else {
        tbody.insertBefore(sibling, tr);
    }

    const orderedIds = Array.from(tbody.querySelectorAll("tr"))
        .map(row => row.dataset.id)
        .filter(id => id); // skip unsaved new rows without an id

    const result = await callPython("reorder_categories", orderedIds);
    if (result.ok) {
        loadCategoriesSettings(); // re-render so ▲/▼ disabled states refresh at the new boundaries
    } else {
        showToast(result.error, "error");
        loadCategoriesSettings(); // revert to server truth
    }
}

function addCategoryRow() {
    const el = document.getElementById("categories-table");

    // If table doesn't exist, create it with empty tbody
    if (!el.querySelector("tbody")) {
        el.innerHTML = `<table>
            <thead><tr>
                <th>Name</th>
                <th>Keywords <span style="font-weight:400;text-transform:none;letter-spacing:0">(comma separated)</span></th>
                <th>Group</th>
                <th style="width:132px"></th>
            </tr></thead>
            <tbody></tbody>
        </table>`;
    }

    const tbody  = el.querySelector("tbody");
    const newRow = document.createElement("tr");
    newRow.dataset.id   = "";
    newRow.dataset.mode = "edit";
    newRow.innerHTML = buildCategoryRow({ id: "", name: "", keywords: "", grp: "None" }, true)
        .replace(/^<tr[^>]*>/, "").replace(/<\/tr>$/, "");
    tbody.appendChild(newRow);
    setupGroupDropdowns();
    newRow.querySelector("[data-field='name']").focus();
}

// ── SOURCES SETTINGS ─────────────────────────────────────────────────────────

async function loadSourcesSettings() {
    const result = await callPython("get_sources");
    if (!result.ok) { showToast(result.error, "error"); return; }
    renderSourcesTable(result.data);
}

function renderSourcesTable(rows) {
    const el = document.getElementById("sources-table");

    if (!rows.length) {
        el.innerHTML = `<div style="padding:16px;color:var(--text-muted);font-size:13px;">No sources yet. Add one above.</div>`;
        return;
    }

    const headers = `<thead><tr><th>Name</th><th style="width:80px"></th></tr></thead>`;
    const bodyRows = rows.map(row => buildSourceRow(row, false)).join("");
    el.innerHTML = `<table>${headers}<tbody>${bodyRows}</tbody></table>`;
}

function buildSourceRow(row, isEditing) {
    if (isEditing) {
        return `<tr data-id="${row.id || ''}" data-mode="edit">
            <td><input class="settings-input" data-field="name" value="${row.name || ''}" /></td>
            <td class="actions">
                <button class="btn-save-row" onclick="saveSourceRow(this)">✓</button>
                <button class="btn-delete"   onclick="cancelSourceRow(this)">✕</button>
            </td>
        </tr>`;
    } else {
        return `<tr data-id="${row.id}" data-mode="view">
            <td style="color:var(--text-primary);font-family:var(--font-mono);font-size:12px;padding:10px 12px;">${row.name}</td>
            <td class="actions">
                <button class="btn-edit"   onclick="editSourceRow(this)">✎</button>
                <button class="btn-delete" onclick="deleteSourceRow(this)">✕</button>
            </td>
        </tr>`;
    }
}

function editSourceRow(btn) {
    const tr   = btn.closest("tr");
    const id   = tr.dataset.id;
    const name = tr.querySelector("td").textContent.trim();
    tr.outerHTML = buildSourceRow({ id, name }, true);
}

function cancelSourceRow(btn) {
    const tr = btn.closest("tr");
    const id = tr.dataset.id;

    // Unsaved new row — discard by removing it from the DOM
    if (!id) { tr.remove(); return; }

    // Existing row being edited — discard changes, re-fetch from DB to restore original value
    loadSourcesSettings();
}

async function saveSourceRow(btn) {
    const tr   = btn.closest("tr");
    const id   = tr.dataset.id;
    const name = tr.querySelector("[data-field='name']").value.trim();

    if (!name) { showToast("Source name is required", "error"); return; }

    let result;
    if (id) {
        result = await callPython("update_source", { id, name });
    } else {
        result = await callPython("add_source", { name });
    }

    if (result.ok) {
        showToast("Source saved", "success");
        loadSourcesSettings();
    } else {
        showToast(result.error, "error");
    }
}

async function deleteSourceRow(btn) {
    const tr = btn.closest("tr");
    const id = tr.dataset.id;

    if (!id) { tr.remove(); return; }

    showConfirmModal("Delete Source", "Delete this source?", async () => {
        const result = await callPython("delete_source", id);
        if (result.ok) { showToast("Source deleted", "success"); loadSourcesSettings(); }
        else showToast(result.error, "error");
    });
}

function addSourceRow() {
    const el = document.getElementById("sources-table");

    // If table doesn't exist, create it with empty tbody
    if (!el.querySelector("tbody")) {
        el.innerHTML = `<table>
            <thead><tr>
                <th>Name</th>
                <th style="width:80px"></th>
            </tr></thead>
            <tbody></tbody>
        </table>`;
    }

    const tbody  = el.querySelector("tbody");
    const newRow = document.createElement("tr");
    newRow.dataset.id   = "";
    newRow.dataset.mode = "edit";
    newRow.innerHTML = buildSourceRow({ id: "", name: "" }, true)
        .replace(/^<tr[^>]*>/, "").replace(/<\/tr>$/, "");
    tbody.appendChild(newRow);
    newRow.querySelector("[data-field='name']").focus();
}

// ── GROUP DROPDOWN SETUP ──────────────────────────────────────────────────────

function setupGroupDropdowns() {
    document.querySelectorAll(".settings-group-select").forEach(dropdown => {
        const trigger = dropdown.querySelector(".custom-select-trigger");
        const options = dropdown.querySelector(".custom-select-options");
        const label   = dropdown.querySelector(".group-label");

        trigger.addEventListener("click", (e) => {
            e.stopPropagation();
            const isOpen = dropdown.classList.contains("open");
            document.querySelectorAll(".settings-group-select.open")
                .forEach(d => d.classList.remove("open"));
            if (!isOpen) dropdown.classList.add("open");
        });

        options.querySelectorAll(".custom-option").forEach(opt => {
            opt.addEventListener("click", (e) => {
                e.stopPropagation();
                options.querySelectorAll(".custom-option")
                    .forEach(o => o.classList.remove("selected"));
                opt.classList.add("selected");
                label.textContent    = opt.dataset.value;
                dropdown.dataset.value = opt.dataset.value;
                dropdown.classList.remove("open");
            });
        });
    });
}

// ── HELPERS ──────────────────────────────────────────────────────────────────

function fmt(n) {
    return `₹${Number(n).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function formatDate(str) {
    if (!str) return "—";
    const parts = str.split("-");
    if (parts.length === 3) {
        const m = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
        return `${parts[0]} ${m[parseInt(parts[1]) - 1]}`;
    }
    return str;
}

// ── TOAST ────────────────────────────────────────────────────────────────────

let toastTimer = null;

function showToast(message, type = "info") {
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 3000);
}

// ── BRIDGE SETUP ─────────────────────────────────────────────────────────────

function setupBridge() {
    const script = document.createElement("script");
    script.src = "qrc:///qtwebchannel/qwebchannel.js";
    script.onload = () => {
        new QWebChannel(qt.webChannelTransport, (channel) => {
            _bridge = channel.objects.bridge;
            init();
        });
    };
    document.head.appendChild(script);
}

window.addEventListener("load", setupBridge);
