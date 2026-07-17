// File: app.js
const WORKER_BASE = "https://renewal-agent.gmo-k-watanabe.workers.dev";
const WORKER_ENDPOINT = WORKER_BASE + "/analyze";
const FEEDBACK_ENDPOINT = WORKER_BASE + "/feedback";
const INSIGHTS_ENDPOINT = WORKER_BASE + "/insights";

const NG_CATEGORIES = [
  "効果無し", "費用NG", "サポート対応不満", "倒産・不通", "ご意見", "その他"
];

// Closed Loop 用の状態
let _lastAnalysisId = null;
let _selectedRating = null;

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

// 1行目の期間ラベル値を取得（type="month"はyyyy-MM、年次は4桁）
function getFirstRowLabelValue() {
  const first = document.querySelector("#salesTable tbody tr:first-child .s-label");
  return first ? first.value : "";
}

// 2行目以降のラベル欄を1行目に同期させる
function syncLabelsToFirstRow() {
  const period = getCurrentPeriod();
  const firstValue = getFirstRowLabelValue();
  const trs = document.querySelectorAll("#salesTable tbody tr");
  trs.forEach((tr, idx) => {
    if (idx === 0) return; // 1行目はスキップ
    const cell = tr.querySelector(".label-cell");
    if (!cell) return;
    cell.innerHTML = buildLabelInputHTML(period, firstValue, true);
  });
  refreshPreview();
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

  const isFirstRow = tbody.children.length === 0;
  const firstValue = isFirstRow ? "" : getFirstRowLabelValue();
  const labelHTML = buildLabelInputHTML(period, firstValue, !isFirstRow);

  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td>
      <div class="id-wrap">
        <input type="text" class="s-id" placeholder="${idPh}" />
        <span class="required-mark" title="必須入力">★</span>
        <span class="tooltip" hidden>必須入力です</span>
      </div>
    </td>
    <td class="label-cell">${labelHTML}</td>
    <td><input type="number" class="s-base" min="0" step="1" placeholder="${basePh}" /> <span class="unit">万円</span></td>
    <td><input type="number" class="s-actual" min="0" step="1" placeholder="${actualPh}" /> <span class="unit">万円</span></td>
    <td class="center"><span class="row-rate">―</span></td>
    <td><button type="button" class="del">×</button></td>
  `;

  tr.querySelector(".del").addEventListener("click", () => {
    tr.remove();
    relockRows();
    refreshPreview();
  });

  tr.querySelectorAll("input").forEach((inp) => inp.addEventListener("input", refreshPreview));

  // 識別記号のバリデーション
  const idInput = tr.querySelector(".s-id");
  idInput.addEventListener("blur", () => validateIdField(idInput));
  idInput.addEventListener("input", () => {
    if (idInput.value.trim()) clearIdError(idInput);
  });

  if (isFirstRow) {
    const labelInput = tr.querySelector(".s-label");
    if (labelInput) labelInput.addEventListener("input", syncLabelsToFirstRow);
  }

  tbody.appendChild(tr);
  refreshPreview();
}

function validateIdField(input) {
  const wrap = input.closest(".id-wrap");
  if (!wrap) return true;
  const tooltip = wrap.querySelector(".tooltip");
  const isEmpty = !input.value.trim();

  if (isEmpty) {
    wrap.classList.add("has-error");
    input.classList.add("error");
    if (tooltip) {
      tooltip.hidden = false;
      tooltip.textContent = "必須入力です";
    }
    return false;
  } else {
    clearIdError(input);
    return true;
  }
}

function clearIdError(input) {
  const wrap = input.closest(".id-wrap");
  if (!wrap) return;
  const tooltip = wrap.querySelector(".tooltip");
  wrap.classList.remove("has-error");
  input.classList.remove("error");
  if (tooltip) tooltip.hidden = true;
}

// 全行の識別記号を一括バリデート（分析ボタン押下時用）
// 戻り値: 最初に見つかった空欄input or null
function validateAllIdFields() {
  let firstEmpty = null;
  document.querySelectorAll("#salesTable tbody tr .s-id").forEach((inp) => {
    const ok = validateIdField(inp);
    if (!ok && !firstEmpty) firstEmpty = inp;
  });
  return firstEmpty;
}

// 1行目が編集可能、2行目以降がロックされている状態に再構成する
function relockRows() {
  const period = getCurrentPeriod();
  const trs = document.querySelectorAll("#salesTable tbody tr");
  if (trs.length === 0) return;

  // 1行目：既存値を保持しつつ編集可能に
  const firstCell = trs[0].querySelector(".label-cell");
  const firstOld = firstCell.querySelector(".s-label");
  const firstValue = firstOld ? firstOld.value : "";
  firstCell.innerHTML = buildLabelInputHTML(period, firstValue, false);
  const newFirstInput = firstCell.querySelector(".s-label");
  if (newFirstInput) {
    newFirstInput.addEventListener("input", () => { syncLabelsToFirstRow(); refreshPreview(); });
    newFirstInput.addEventListener("input", refreshPreview);
  }

  // 2行目以降：1行目に同期してロック
  syncLabelsToFirstRow();
}

function refreshAllLabelInputs() {
  const period = getCurrentPeriod();
  const trs = document.querySelectorAll("#salesTable tbody tr");

  trs.forEach((tr, idx) => {
    const cell = tr.querySelector(".label-cell");
    if (!cell) return;
    const oldInput = cell.querySelector(".s-label");
    const oldValue = oldInput ? oldInput.value : "";
    const isFirst = idx === 0;
    cell.innerHTML = buildLabelInputHTML(period, oldValue, !isFirst);

    const newInput = cell.querySelector(".s-label");
    if (newInput) {
      newInput.addEventListener("input", refreshPreview);
      if (isFirst) newInput.addEventListener("input", syncLabelsToFirstRow);
    }
  });

  const labelHeader = document.querySelector("#salesTable thead th.label-header");
  if (labelHeader) {
    labelHeader.textContent = period === "monthly" ? "該当月" : "該当年";
  }

  // 期間タイプ切替後も2行目以降を1行目に同期
  syncLabelsToFirstRow();
}

function refreshMetricLabels() {
  const metric = getCurrentMetric();
  const word = metricLabel(metric);
  const baseHeader = document.querySelector("#salesTable thead th.base-header");
  const actualHeader = document.querySelector("#salesTable thead th.actual-header");
  if (baseHeader) baseHeader.textContent = `母数${word}`;
  if (actualHeader) actualHeader.textContent = `実績${word}`;
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

// ========== 追加: 入力例のワンクリック投入（利便性向上） ==========
function fillSampleData() {
  // 月次モードに寄せてサンプルを作る（既存のUI挙動を尊重）
  const monthlyRadio = document.querySelector('input[name="period"][value="monthly"]');
  if (monthlyRadio && !monthlyRadio.checked) {
    monthlyRadio.checked = true;
    refreshAllLabelInputs();
  }

  // 既存行をクリアして3行に作り直す
  const tbody = document.querySelector("#salesTable tbody");
  tbody.innerHTML = "";
  addSalesRow();
  addSalesRow();
  addSalesRow();

  const trs = document.querySelectorAll("#salesTable tbody tr");
  const sample = [
    { id: "A", base: "120", actual: "108" },
    { id: "B", base: "80", actual: "60" },
    { id: "C", base: "50", actual: "47" }
  ];

  // 1行目の期間を今月に設定 → 2行目以降へ同期
  const firstLabel = trs[0]?.querySelector(".s-label");
  if (firstLabel) {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    firstLabel.value = ym;
    syncLabelsToFirstRow();
  }

  trs.forEach((tr, i) => {
    const s = sample[i];
    if (!s) return;
    const idEl = tr.querySelector(".s-id");
    const baseEl = tr.querySelector(".s-base");
    const actEl = tr.querySelector(".s-actual");
    if (idEl) { idEl.value = s.id; clearIdError(idEl); }
    if (baseEl) baseEl.value = s.base;
    if (actEl) actEl.value = s.actual;
  });

  // NG理由にもサンプルを投入
  const ngInputs = document.querySelectorAll(".ng-cnt");
  const ngSample = [3, 2, 1, 0, 1, 0];
  ngInputs.forEach((inp, i) => { inp.value = ngSample[i] ?? 0; });

  refreshPreview();
  const status = document.getElementById("status");
  if (status) status.textContent = "📝 入力例を投入しました。自由に書き換えて『分析させる』を押してください。";
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

// ========== 進行ステップ表示（多段処理の可視化） ==========
let _progressTimer = null;
function startProgress() {
  const box = document.getElementById("progressSteps");
  if (!box) return;
  box.hidden = false;
  const steps = box.querySelectorAll(".pstep");
  steps.forEach((s) => s.classList.remove("done", "active"));
  let idx = 0;
  const advance = () => {
    if (idx > 0) steps[idx - 1]?.classList.remove("active");
    if (idx < steps.length) {
      steps[idx]?.classList.add("active");
      if (idx > 0) steps[idx - 1]?.classList.add("done");
      idx++;
    }
  };
  advance();
  _progressTimer = setInterval(advance, 6000);
}
function finishProgress(success = true) {
  if (_progressTimer) { clearInterval(_progressTimer); _progressTimer = null; }
  const box = document.getElementById("progressSteps");
  if (!box) return;
  const steps = box.querySelectorAll(".pstep");
  steps.forEach((s) => {
    s.classList.remove("active");
    if (success) s.classList.add("done");
  });
}

// ========== CSVダウンロード（集計プレビューの保存） ==========
function downloadCsv() {
  const agg = _currentAggregation;
  if (!agg || agg.perService.length === 0) {
    const status = document.getElementById("status");
    if (status) status.textContent = "⚠ 保存できる集計データがありません。先にデータを入力してください。";
    return;
  }
  const word = metricLabel(getCurrentMetric());
  const rows = [];
  rows.push(["識別記号別サマリー"]);
  rows.push(["識別記号", `最新更新${word}率(%)`, `平均更新${word}率(%)`, "加重平均(%)", "推移差分(pt)", "データ数"]);
  agg.perService.forEach((s) => {
    rows.push([s.id, s.latestRate, s.avgRate, s.weightedRate, s.trendDelta, s.points.length]);
  });
  rows.push([]);
  rows.push(["全体推移"]);
  rows.push(["期間", `母数${word}(万円)`, `実績${word}(万円)`, `更新${word}率(%)`]);
  agg.overallTrend.forEach((t) => {
    rows.push([t.label, t.base, t.actual, t.rate]);
  });

  const csv = rows
    .map((r) => r.map((c) => {
      const v = String(c ?? "");
      return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    }).join(","))
    .join("\r\n");

  const bom = "\uFEFF"; // Excelで文字化けしないようBOM付与
  const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
  const a = document.createElement("a");
  const ts = new Date().toISOString().slice(0, 10);
  a.href = URL.createObjectURL(blob);
  a.download = `renext-集計_${ts}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

// ========== レポートコピー ==========
async function copyReport() {
  const box = document.getElementById("result");
  const btn = document.getElementById("copyReport");
  if (!box || !box.textContent.trim()) return;
  try {
    await navigator.clipboard.writeText(box.textContent);
    if (btn) {
      const orig = btn.textContent;
      btn.textContent = "✅ コピーしました";
      setTimeout(() => { btn.textContent = orig; }, 1800);
    }
  } catch (e) {
    // クリップボードAPI不可時のフォールバック
    const range = document.createRange();
    range.selectNodeContents(box);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
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
  const analyzeBtn = document.getElementById("analyzeBtn");

  const firstEmpty = validateAllIdFields();
  if (firstEmpty) {
    status.textContent = "⚠ 識別記号が未入力の行があります。赤枠の項目を入力してください。";
    firstEmpty.focus();
    firstEmpty.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }

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
  if (analyzeBtn) analyzeBtn.disabled = true;
  startProgress();

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
    finishProgress(true);

    // 追加: Closed Loop フィードバックUIを表示し、分析IDを保持
    _lastAnalysisId = json.analysisId || null;
    showFeedbackUI();

    const engineNote =
      json.engine === "workers-ai-fallback"
        ? "（予備エンジンで生成）"
        : "";
    status.textContent = `✅ 分析が完了しました。${engineNote}`;
    resultSection.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (e) {
    finishProgress(false);
    status.textContent = "❌ エラー: " + e.message;
  } finally {
    if (analyzeBtn) analyzeBtn.disabled = false;
  }
}

// ========== 追加: Closed Loop フィードバック処理 ==========
function showFeedbackUI() {
  const box = document.getElementById("feedbackBox");
  if (!box) return;
  box.hidden = false;
  _selectedRating = null;
  const up = document.getElementById("fbUp");
  const down = document.getElementById("fbDown");
  const send = document.getElementById("fbSend");
  const comment = document.getElementById("fbComment");
  const fbStatus = document.getElementById("fbStatus");
  if (up) up.classList.remove("selected");
  if (down) down.classList.remove("selected");
  if (send) send.disabled = true;
  if (comment) comment.value = "";
  if (fbStatus) fbStatus.textContent = "";
}

function selectRating(rating) {
  _selectedRating = rating;
  const up = document.getElementById("fbUp");
  const down = document.getElementById("fbDown");
  const send = document.getElementById("fbSend");
  if (up) up.classList.toggle("selected", rating === "up");
  if (down) down.classList.toggle("selected", rating === "down");
  if (send) send.disabled = false;
}

async function sendFeedback() {
  const send = document.getElementById("fbSend");
  const fbStatus = document.getElementById("fbStatus");
  const comment = document.getElementById("fbComment");
  if (!_selectedRating) {
    if (fbStatus) fbStatus.textContent = "👍か👎を選んでください。";
    return;
  }
  if (send) send.disabled = true;
  if (fbStatus) fbStatus.textContent = "送信中…";

  try {
    const res = await fetch(FEEDBACK_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        analysisId: _lastAnalysisId,
        rating: _selectedRating,
        comment: comment ? comment.value : "",
        metricType: getCurrentMetric()
      })
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || "送信エラー");
    if (fbStatus) fbStatus.textContent = "✅ ありがとうございます。次回以降の分析に反映されます。";
    loadInsightsBadge(); // 学習状況バッジを更新
  } catch (e) {
    if (fbStatus) fbStatus.textContent = "❌ 送信に失敗しました: " + e.message;
    if (send) send.disabled = false;
  }
}

// ========== 追加: 学習状況バッジ（Closed Loop の可視化） ==========
async function loadInsightsBadge() {
  const badge = document.getElementById("loopBadge");
  if (!badge) return;
  try {
    const res = await fetch(INSIGHTS_ENDPOINT, { method: "GET" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) return;
    const lbInsight = document.getElementById("lbInsight");
    const lbAnalyze = document.getElementById("lbAnalyze");
    const lbSat = document.getElementById("lbSat");
    if (lbInsight) lbInsight.textContent = json.insightCount ?? 0;
    if (lbAnalyze) lbAnalyze.textContent = json.analyzeCount ?? 0;
    if (lbSat) lbSat.textContent = json.satisfaction != null ? `${json.satisfaction}%` : "―";
    badge.hidden = false;
  } catch {
    // バッジ取得失敗はUIを止めない
  }
}

// ========== 初期化 ==========
document.getElementById("addRow").addEventListener("click", addSalesRow);
document.getElementById("analyzeBtn").addEventListener("click", runAnalyze);
document.querySelectorAll('input[name="period"]').forEach((r) => r.addEventListener("change", refreshAllLabelInputs));
document.querySelectorAll('input[name="metric"]').forEach((r) => r.addEventListener("change", refreshMetricLabels));

const _copyBtn = document.getElementById("copyReport");
if (_copyBtn) _copyBtn.addEventListener("click", copyReport);
const _csvBtn = document.getElementById("downloadCsv");
if (_csvBtn) _csvBtn.addEventListener("click", downloadCsv);

// 追加: 入力例投入ボタン
const _sampleBtn = document.getElementById("fillSample");
if (_sampleBtn) _sampleBtn.addEventListener("click", fillSampleData);

// 追加: フィードバックボタン群
const _fbUp = document.getElementById("fbUp");
if (_fbUp) _fbUp.addEventListener("click", () => selectRating("up"));
const _fbDown = document.getElementById("fbDown");
if (_fbDown) _fbDown.addEventListener("click", () => selectRating("down"));
const _fbSend = document.getElementById("fbSend");
if (_fbSend) _fbSend.addEventListener("click", sendFeedback);

setupTabs();
addSalesRow();
initNgTable();
refreshAllLabelInputs();
refreshMetricLabels();
refreshPreview();

// 追加: 起動時に学習状況バッジを取得（Closed Loop の稼働状況を表示）
loadInsightsBadge();
