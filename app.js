const WORKER_ENDPOINT = "https://renewal-agent.gmo-k-watanabe.workers.dev/analyze";

const NG_CATEGORIES = [
  "効果無し", "費用NG", "サポート対応不満", "倒産・不通", "ご意見", "その他"
];

// ========== 取得ヘルパ ==========
function getCurrentPeriod() {
  const el = document.querySelector('input[name="period"]:checked');
  return el ? el.value : "monthly";
}
function getCurrentMetric() {
  const el = document.querySelector('input[name="metric"]:checked');
  return el ? el.value : "sales";
}
function metricLabel(m) { return m === "gross_profit" ? "粗利" : "売上"; }

// ========== 入力UI ==========
function buildLabelInputHTML(period, currentValue = "", readonly = false) {
  let yearPart = "", monthPart = "";
  if (currentValue) {
    const m = String(currentValue).match(/(\d{4})[-/年]?(\d{1,2})?/);
    if (m) { yearPart = m[1]; monthPart = m[2] ? m[2].padStart(2, "0") : ""; }
  }
  const ro = readonly ? "readonly" : "";
  const cls = readonly ? "s-label is-locked" : "s-label";

  if (period === "monthly") {
    const val = yearPart && monthPart ? `${yearPart}-${monthPart}` : "";
    return `<input type="month" class="${cls}" value="${val}" ${ro} />`;
  } else {
    const val = yearPart || "";
    return `<input type="number" class="${cls}" min="2000" max="2100" step="1" placeholder="2026" value="${val}" ${ro} />`;
  }
}

function nextIdPlaceholder() {
  // 既存行で使われている記号（入力値 or プレースホルダ）を収集
  const used = new Set();
  document.querySelectorAll("#salesTable tbody tr .s-id").forEach((inp) => {
    const v = (inp.value || inp.placeholder || "").trim().toUpperCase();
    if (v) used.add(v);
  });

  // A, B, C, ... Z, AA, AB, ... の順で未使用を探す
  const toLabel = (n) => {
    // n=0→A, 25→Z, 26→AA ...
    let s = "";
    n = n | 0;
    do {
      s = String.fromCharCode(65 + (n % 26)) + s;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return s;
  };

  for (let i = 0; i < 1000; i++) {
    const candidate = toLabel(i);
    if (!used.has(candidate)) return candidate;
  }
  return "X"; // フォールバック
}

function addSalesRow() {
  const tbody = document.querySelector("#salesTable tbody");
  const period = getCurrentPeriod();
  const metric = getCurrentMetric();
  const basePh = metric === "gross_profit" ? "30" : "100";
  const actualPh = metric === "gross_profit" ? "25" : "85";
  const idPh = nextIdPlaceholder();

  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input type="text" class="s-id" placeholder="${idPh}" /></td>
    <td class="label-cell">${buildLabelInputHTML(period)}</td>
    <td><input type="number" class="s-base" min="0" step="1" placeholder="${basePh}" /> <span class="unit">万円</span></td>
    <td><input type="number" class="s-actual" min="0" step="1" placeholder="${actualPh}" /> <span class="unit">万円</span></td>
    <td class="center"><span class="row-rate">―</span></td>
    <td><button type="button" class="del">×</button></td>
  `;
  tr.querySelector(".del").addEventListener("click", () => { tr.remove(); refreshPreview(); });
  tr.querySelectorAll("input").forEach((inp) => inp.addEventListener("input", refreshPreview));
  tbody.appendChild(tr);
  refreshPreview();
}

function refreshAllLabelInputs() {
  const period = getCurrentPeriod();
  document.querySelectorAll("#salesTable tbody tr").forEach((tr) => {
    const cell = tr.querySelector(".label-cell");
    if (!cell) return;
    const oldInput = cell.querySelector(".s-label");
    const oldValue = oldInput ? oldInput.value : "";
    cell.innerHTML = buildLabelInputHTML(period, oldValue);
    const newInput = cell.querySelector(".s-label");
    if (newInput) newInput.addEventListener("input", refreshPreview);
  });
  const labelHeader = document.querySelector("#salesTable thead th.label-header");
  if (labelHeader) labelHeader.textContent = period === "monthly" ? "該当月" : "該当年";
  refreshPreview();
}

function refreshMetricLabels() {
  const metric = getCurrentMetric();
  const word = metricLabel(metric);
  const baseHeader = document.querySelector("#salesTable thead th.base-header");
  const actualHeader = document.querySelector("#salesTable thead th.actual-header");
  if (baseHeader) baseHeader.textContent = `更新母数${word}`;
  if (actualHeader) actualHeader.textContent = `実績更新${word}`;
  const basePh = metric === "gross_profit" ? "30" : "100";
  const actualPh = metric === "gross_profit" ? "25" : "85";
  document.querySelectorAll("#salesTable tbody tr").forEach((tr) => {
    const b = tr.querySelector(".s-base");
    const a = tr.querySelector(".s-actual");
    if (b) b.placeholder = basePh;
    if (a) a.placeholder = actualPh;
  });
  refreshPreview();
}

function initNgTable() {
  const tbody = document.querySelector("#ngTable tbody");
  tbody.innerHTML = "";
  NG_CATEGORIES.forEach((cat) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${cat}</td>
      <td>
        <input type="number" class="ng-cnt" data-category="${cat}" min="0" step="1" placeholder="0" />
        <span class="unit">件</span>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

// ========== ラベル変換 ==========
function normalizeLabel(period, raw) {
  if (!raw) return "";
  if (period === "monthly") {
    const m = String(raw).match(/(\d{4})-(\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, "0")}月`;
    return String(raw);
  } else {
    const m = String(raw).match(/(\d{4})/);
    if (m) return `${m[1]}年`;
    return String(raw);
  }
}
// 並び順用にソートキー化
function labelSortKey(label) {
  const m = String(label).match(/(\d{4})(?:-(\d{1,2}))?/);
  if (!m) return label;
  const y = m[1];
  const mo = m[2] ? m[2].padStart(2, "0") : "00";
  return `${y}-${mo}`;
}
// 前年同月キー（月次のみ）
function prevYearLabel(label) {
  const m = String(label).match(/(\d{4})-(\d{1,2})月/);
  if (!m) return null;
  return `${Number(m[1]) - 1}-${m[2].padStart(2, "0")}月`;
}

// ========== 入力収集 ==========
function collectRows() {
  const period = getCurrentPeriod();
  const rows = [];
  document.querySelectorAll("#salesTable tbody tr").forEach((tr) => {
    const id = tr.querySelector(".s-id").value.trim();
    const labelRaw = tr.querySelector(".s-label").value.trim();
    const label = normalizeLabel(period, labelRaw);
    const base = Math.floor(Number(tr.querySelector(".s-base").value));
    const actual = Math.floor(Number(tr.querySelector(".s-actual").value));
    const rate = base > 0 ? Number(((actual / base) * 100).toFixed(2)) : null;
    rows.push({ tr, id, label, base, actual, rate });
  });
  return { period, rows };
}

// ========== 集計計算（フロント＆Worker共通仕様） ==========
function buildAggregation(period, rows) {
  const valid = rows.filter((r) => r.id && r.label && r.base > 0 && r.rate !== null);

  // 識別記号別
  const byId = {};
  valid.forEach((r) => {
    if (!byId[r.id]) byId[r.id] = [];
    byId[r.id].push(r);
  });

  const perService = Object.entries(byId).map(([id, list]) => {
    list.sort((a, b) => labelSortKey(a.label).localeCompare(labelSortKey(b.label)));
    const rates = list.map((r) => r.rate);
    const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
    const first = rates[0];
    const last = rates[rates.length - 1];
    const trend = last - first;
    const totalBase = list.reduce((a, b) => a + b.base, 0);
    const totalActual = list.reduce((a, b) => a + b.actual, 0);
    const weightedRate = totalBase > 0 ? (totalActual / totalBase) * 100 : 0;
    return {
      id,
      points: list.map((r) => ({ label: r.label, base: r.base, actual: r.actual, rate: r.rate })),
      avgRate: Number(avg.toFixed(2)),
      weightedRate: Number(weightedRate.toFixed(2)),
      latestRate: Number(last.toFixed(2)),
      firstRate: Number(first.toFixed(2)),
      trendDelta: Number(trend.toFixed(2))
    };
  });

  // 期間別合計（全体推移）
  const byLabel = {};
  valid.forEach((r) => {
    if (!byLabel[r.label]) byLabel[r.label] = { base: 0, actual: 0 };
    byLabel[r.label].base += r.base;
    byLabel[r.label].actual += r.actual;
  });
  const overallTrend = Object.entries(byLabel)
    .map(([label, v]) => ({
      label,
      base: v.base,
      actual: v.actual,
      rate: v.base > 0 ? Number(((v.actual / v.base) * 100).toFixed(2)) : 0
    }))
    .sort((a, b) => labelSortKey(a.label).localeCompare(labelSortKey(b.label)));

  const totalBase = valid.reduce((a, b) => a + b.base, 0);
  const totalActual = valid.reduce((a, b) => a + b.actual, 0);
  const overallWeighted = totalBase > 0 ? Number(((totalActual / totalBase) * 100).toFixed(2)) : 0;
  const overallSimple =
    perService.length > 0
      ? Number((perService.reduce((a, b) => a + b.avgRate, 0) / perService.length).toFixed(2))
      : 0;

  // 前年同月比較（月次のみ）
  const yoy = [];
  if (period === "monthly") {
    perService.forEach((svc) => {
      svc.points.forEach((p) => {
        const prev = prevYearLabel(p.label);
        if (!prev) return;
        const prevPoint = svc.points.find((q) => q.label === prev);
        if (prevPoint) {
          yoy.push({
            id: svc.id,
            current: p.label,
            previous: prev,
            currentRate: p.rate,
            previousRate: prevPoint.rate,
            delta: Number((p.rate - prevPoint.rate).toFixed(2))
          });
        }
      });
    });
  }

  // ランキング（最新更新率順）
  const ranking = [...perService].sort((a, b) => b.latestRate - a.latestRate);

  return {
    perService,
    overallTrend,
    overallWeighted,
    overallSimple,
    yoy,
    ranking,
    totalBase,
    totalActual
  };
}

// ========== ビュー描画 ==========
function deltaSpan(delta) {
  if (delta > 0.01) return `<span class="delta-up">▲ +${delta.toFixed(2)}pt</span>`;
  if (delta < -0.01) return `<span class="delta-down">▼ ${delta.toFixed(2)}pt</span>`;
  return `<span class="delta-flat">― 0pt</span>`;
}

function renderSummary(agg) {
  const el = document.getElementById("viewSummary");
  if (agg.perService.length === 0) {
    el.innerHTML = `<div class="empty">データを入力すると集計が表示されます。</div>`;
    return;
  }
  const word = metricLabel(getCurrentMetric());
  el.innerHTML = `
    <div class="metric-cards">
      <div class="metric-card">
        <div class="label">全体 更新${word}率（加重平均）</div>
        <div class="value">${agg.overallWeighted}%</div>
        <div class="sub">母数合計 ${agg.totalBase.toLocaleString()}万円</div>
      </div>
      <div class="metric-card">
        <div class="label">全体 更新${word}率（単純平均）</div>
        <div class="value">${agg.overallSimple}%</div>
        <div class="sub">識別記号 ${agg.perService.length}件の平均</div>
      </div>
      <div class="metric-card">
        <div class="label">実績${word}合計</div>
        <div class="value">${agg.totalActual.toLocaleString()}</div>
        <div class="sub">単位：万円</div>
      </div>
    </div>
    <table class="preview-table">
      <thead>
        <tr>
          <th class="center">識別記号</th>
          <th>最新更新率</th>
          <th>平均更新率</th>
          <th>加重平均</th>
          <th>推移差分</th>
          <th class="center">データ数</th>
        </tr>
      </thead>
      <tbody>
        ${agg.perService
          .map(
            (s) => `
          <tr>
            <td class="center"><strong>${s.id}</strong></td>
            <td>${s.latestRate}%</td>
            <td>${s.avgRate}%</td>
            <td>${s.weightedRate}%</td>
            <td>${deltaSpan(s.trendDelta)}</td>
            <td class="center">${s.points.length}</td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>
  `;
  // 各行の更新率を入力欄横にも反映
  const map = {};
  agg.perService.forEach((s) => s.points.forEach((p) => { map[`${s.id}__${p.label}`] = p.rate; }));
  document.querySelectorAll("#salesTable tbody tr").forEach((tr) => {
    const id = tr.querySelector(".s-id").value.trim();
    const labelRaw = tr.querySelector(".s-label").value.trim();
    const label = normalizeLabel(getCurrentPeriod(), labelRaw);
    const key = `${id}__${label}`;
    const span = tr.querySelector(".row-rate");
    if (span) span.textContent = map[key] !== undefined ? `${map[key]}%` : "―";
  });
}

function renderTrend(agg) {
  const el = document.getElementById("viewTrend");
  if (agg.overallTrend.length === 0) {
    el.innerHTML = `<div class="empty">推移データがありません。</div>`;
    return;
  }
  const labels = agg.overallTrend.map((t) => t.label);
  const word = metricLabel(getCurrentMetric());

  let html = `<table class="preview-table"><thead><tr><th class="center">期間</th>`;
  agg.perService.forEach((s) => { html += `<th>${s.id}</th>`; });
  html += `<th>全体更新${word}率</th></tr></thead><tbody>`;

  labels.forEach((lb) => {
    html += `<tr><td class="center"><strong>${lb}</strong></td>`;
    agg.perService.forEach((s) => {
      const p = s.points.find((x) => x.label === lb);
      html += `<td>${p ? p.rate + "%" : "―"}</td>`;
    });
    const overall = agg.overallTrend.find((x) => x.label === lb);
    html += `<td><strong>${overall ? overall.rate + "%" : "―"}</strong></td></tr>`;
  });
  html += `</tbody></table>`;
  el.innerHTML = html;
}

function renderYoy(agg) {
  const el = document.getElementById("viewYoy");
  if (getCurrentPeriod() !== "monthly") {
    el.innerHTML = `<div class="empty">前年同月比は「月次」モードで利用できます。</div>`;
    return;
  }
  if (agg.yoy.length === 0) {
    el.innerHTML = `<div class="empty">前年同月のデータがまだ揃っていません。<br />同じ識別記号で1年前の同月データを入力すると比較表示されます。</div>`;
    return;
  }
  let html = `<table class="preview-table"><thead><tr>
    <th class="center">識別記号</th><th>当月</th><th>当月率</th><th>前年同月</th><th>前年率</th><th>差分</th>
  </tr></thead><tbody>`;
  agg.yoy
    .sort((a, b) => a.id.localeCompare(b.id) || labelSortKey(a.current).localeCompare(labelSortKey(b.current)))
    .forEach((y) => {
      html += `<tr>
        <td class="center"><strong>${y.id}</strong></td>
        <td>${y.current}</td>
        <td>${y.currentRate}%</td>
        <td>${y.previous}</td>
        <td>${y.previousRate}%</td>
        <td>${deltaSpan(y.delta)}</td>
      </tr>`;
    });
  html += `</tbody></table>`;
  el.innerHTML = html;
}

function renderRanking(agg) {
  const el = document.getElementById("viewRanking");
  if (agg.ranking.length === 0) {
    el.innerHTML = `<div class="empty">ランキング表示用のデータがありません。</div>`;
    return;
  }
  let html = `<table class="preview-table"><thead><tr>
    <th class="center">順位</th><th class="center">識別記号</th>
    <th>最新更新率</th><th>平均</th><th>初回値</th><th>推移差分</th>
  </tr></thead><tbody>`;
  agg.ranking.forEach((s, i) => {
    const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}`;
    html += `<tr>
      <td class="center">${medal}</td>
      <td class="center"><strong>${s.id}</strong></td>
      <td><strong>${s.latestRate}%</strong></td>
      <td>${s.avgRate}%</td>
      <td>${s.firstRate}%</td>
      <td>${deltaSpan(s.trendDelta)}</td>
    </tr>`;
  });
  html += `</tbody></table>`;
  el.innerHTML = html;
}

// ========== プレビュー更新 ==========
let _currentAggregation = null;
function refreshPreview() {
  const { period, rows } = collectRows();
  const agg = buildAggregation(period, rows);
  _currentAggregation = agg;
  renderSummary(agg);
  renderTrend(agg);
  renderYoy(agg);
  renderRanking(agg);
}

// タブ切替
function setupTabs() {
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const view = btn.dataset.view;
      ["summary", "trend", "yoy", "ranking"].forEach((v) => {
        const el = document.getElementById("view" + v.charAt(0).toUpperCase() + v.slice(1));
        if (el) el.hidden = v !== view;
      });
    });
  });
}

// ========== Worker送信 ==========
function hasSensitive(data) {
  const pattern = /(株式会社|有限会社|合同会社|[A-Za-z]{3,}\s?(Inc|Ltd|Corp))/i;
  return pattern.test(JSON.stringify(data));
}

async function runAnalyze() {
  const status = document.getElementById("status");
  const resultSection = document.getElementById("resultSection");
  const resultBox = document.getElementById("result");

  const { period, rows } = collectRows();
  const agg = buildAggregation(period, rows);
  const metricType = getCurrentMetric();
  const sales = rows
    .filter((r) => r.id && r.label && r.base > 0)
    .map((r) => ({
      id: r.id, label: r.label, base: r.base, actual: r.actual, rate: r.rate, unit: "万円"
    }));

  const ngReasons = [];
  document.querySelectorAll(".ng-cnt").forEach((input) => {
    const cnt = Math.floor(Number(input.value));
    const cat = input.dataset.category;
    if (cat && cnt > 0) ngReasons.push({ category: cat, count: cnt });
  });

  const payload = {
    period,
    metricType,
    metricLabel: metricLabel(metricType),
    sales,
    ngReasons,
    amountUnit: "万円",
    aggregation: agg  // ★ フロントで計算した集計を一緒に送る
  };

  if (sales.length === 0) {
    status.textContent = `⚠ 更新数値を最低1行入力してください。`;
    return;
  }
  if (ngReasons.length === 0) {
    status.textContent = "⚠ NG理由の件数を1つ以上入力してください。";
    return;
  }
  if (hasSensitive(payload)) {
    status.textContent = "⚠ 企業名らしき文字列を検出しました。記号・番号に置き換えてください。";
    return;
  }

  status.textContent = `🤖 AIエージェントが「${payload.metricLabel}」視点で多段分析中です…（10〜30秒）`;
  resultSection.hidden = true;

  try {
    const res = await fetch(WORKER_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || ("Worker応答エラー: " + res.status));

    resultBox.textContent = json.report || "（結果が空でした）";
    resultSection.hidden = false;
    status.textContent = "✅ 分析が完了しました。";
  } catch (e) {
    status.textContent = "❌ エラー: " + e.message;
  }
}

// ========== 初期化 ==========
document.getElementById("addRow").addEventListener("click", addSalesRow);
document.getElementById("analyzeBtn").addEventListener("click", runAnalyze);
document.querySelectorAll('input[name="period"]').forEach((r) => r.addEventListener("change", refreshAllLabelInputs));
document.querySelectorAll('input[name="metric"]').forEach((r) => r.addEventListener("change", refreshMetricLabels));

setupTabs();
addSalesRow();
initNgTable();
refreshAllLabelInputs();
refreshMetricLabels();
refreshPreview();
