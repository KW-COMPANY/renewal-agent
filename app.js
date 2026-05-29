const WORKER_ENDPOINT = "https://renewal-agent.gmo-k-watanabe.workers.dev/analyze";

// 固定NG理由カテゴリ
const NG_CATEGORIES = [
  "効果無し",
  "予算NG",
  "サポート対応不満",
  "倒産・不通",
  "クレーム",
  "その他"
];

// --- 現在の選択値取得 ---
function getCurrentPeriod() {
  const el = document.querySelector('input[name="period"]:checked');
  return el ? el.value : "monthly";
}
function getCurrentMetric() {
  const el = document.querySelector('input[name="metric"]:checked');
  return el ? el.value : "sales";
}
function metricLabel(metric) {
  return metric === "gross_profit" ? "粗利" : "売上";
}

// --- 期間ラベル入力欄HTML生成 ---
function buildLabelInputHTML(period, currentValue = "") {
  let yearPart = "";
  let monthPart = "";
  if (currentValue) {
    const m = String(currentValue).match(/(\d{4})[-/年]?(\d{1,2})?/);
    if (m) {
      yearPart = m[1];
      monthPart = m[2] ? m[2].padStart(2, "0") : "";
    }
  }
  if (period === "monthly") {
    const val = yearPart && monthPart ? `${yearPart}-${monthPart}` : "";
    return `<input type="month" class="s-label" value="${val}" />`;
  } else {
    const val = yearPart || "";
    return `<input type="number" class="s-label" min="2000" max="2100" step="1" placeholder="2026" value="${val}" />`;
  }
}

// --- 売上行追加 ---
function addSalesRow() {
  const tbody = document.querySelector("#salesTable tbody");
  const period = getCurrentPeriod();
  const metric = getCurrentMetric();

  // 粗利の方が一般的に小さい数値になるためプレースホルダを調整
  const basePh = metric === "gross_profit" ? "30" : "100";
  const actualPh = metric === "gross_profit" ? "25" : "85";

  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input type="text" class="s-id" placeholder="A" /></td>
    <td class="label-cell">${buildLabelInputHTML(period)}</td>
    <td><input type="number" class="s-base" min="0" step="1" placeholder="${basePh}" /> <span class="unit">万円</span></td>
    <td><input type="number" class="s-actual" min="0" step="1" placeholder="${actualPh}" /> <span class="unit">万円</span></td>
    <td><button type="button" class="del">×</button></td>
  `;
  tr.querySelector(".del").addEventListener("click", () => tr.remove());
  tbody.appendChild(tr);
}

// --- 期間タイプ切替：全行のラベル欄を作り直す ---
function refreshAllLabelInputs() {
  const period = getCurrentPeriod();
  document.querySelectorAll("#salesTable tbody tr").forEach((tr) => {
    const cell = tr.querySelector(".label-cell");
    if (!cell) return;
    const oldInput = cell.querySelector(".s-label");
    const oldValue = oldInput ? oldInput.value : "";
    cell.innerHTML = buildLabelInputHTML(period, oldValue);
  });
  const labelHeader = document.querySelector("#salesTable thead th.label-header");
  if (labelHeader) {
    labelHeader.textContent = period === "monthly" ? "期間ラベル（年月）" : "期間ラベル（年）";
  }
}

// --- 指標タイプ切替：ヘッダ＆プレースホルダを更新 ---
function refreshMetricLabels() {
  const metric = getCurrentMetric();
  const word = metricLabel(metric);

  // ヘッダ更新
  const baseHeader = document.querySelector("#salesTable thead th.base-header");
  const actualHeader = document.querySelector("#salesTable thead th.actual-header");
  if (baseHeader) baseHeader.textContent = `更新母数${word}（万円）`;
  if (actualHeader) actualHeader.textContent = `実際の更新${word}（万円）`;

  // セクション見出し更新
  const h2 = document.querySelector('section.card h2');
  // ※ セクション2のh2を狙うため、より安全にIDを使う場合はindex.htmlに id="metricSectionTitle" 等を付与してください

  // プレースホルダを既存行にも反映
  const basePh = metric === "gross_profit" ? "30" : "100";
  const actualPh = metric === "gross_profit" ? "25" : "85";
  document.querySelectorAll("#salesTable tbody tr").forEach((tr) => {
    const b = tr.querySelector(".s-base");
    const a = tr.querySelector(".s-actual");
    if (b) b.placeholder = basePh;
    if (a) a.placeholder = actualPh;
  });
}

// --- NG理由テーブル初期化 ---
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

// --- ラベル正規化 ---
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

// --- 入力データ収集 ---
function collectData() {
  const period = getCurrentPeriod();
  const metricType = getCurrentMetric();

  const sales = [];
  document.querySelectorAll("#salesTable tbody tr").forEach((tr) => {
    const id = tr.querySelector(".s-id").value.trim();
    const labelRaw = tr.querySelector(".s-label").value.trim();
    const label = normalizeLabel(period, labelRaw);
    const base = Math.floor(Number(tr.querySelector(".s-base").value));
    const actual = Math.floor(Number(tr.querySelector(".s-actual").value));
    if (id && label && base > 0) {
      sales.push({
        id,
        label,
        base,
        actual,
        unit: "万円",
        rate: Number(((actual / base) * 100).toFixed(2))
      });
    }
  });

  const ngReasons = [];
  document.querySelectorAll(".ng-cnt").forEach((input) => {
    const cnt = Math.floor(Number(input.value));
    const cat = input.dataset.category;
    if (cat && cnt > 0) ngReasons.push({ category: cat, count: cnt });
  });

  return {
    period,
    metricType,                         // "sales" or "gross_profit"
    metricLabel: metricLabel(metricType), // "売上" or "粗利"
    sales,
    ngReasons,
    amountUnit: "万円"
  };
}

// --- センシティブ情報チェック ---
function hasSensitive(data) {
  const pattern = /(株式会社|有限会社|合同会社|[A-Za-z]{3,}\s?(Inc|Ltd|Corp))/i;
  return pattern.test(JSON.stringify(data));
}

// --- 分析実行 ---
async function runAnalyze() {
  const status = document.getElementById("status");
  const resultSection = document.getElementById("resultSection");
  const resultBox = document.getElementById("result");

  const data = collectData();

  if (data.sales.length === 0) {
    status.textContent = `⚠ 更新数値を最低1行入力してください（更新母数${data.metricLabel}は1以上）。`;
    return;
  }
  if (data.ngReasons.length === 0) {
    status.textContent = "⚠ NG理由の件数を1つ以上入力してください。";
    return;
  }
  if (hasSensitive(data)) {
    status.textContent = "⚠ 企業名らしき文字列を検出しました。記号・番号に置き換えてください。";
    return;
  }

  status.textContent = `🤖 AIエージェントが「${data.metricLabel}」視点で多段分析中です…（10〜30秒）`;
  resultSection.hidden = true;

  try {
    const res = await fetch(WORKER_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data)
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

// --- 初期化 ---
document.getElementById("addRow").addEventListener("click", addSalesRow);
document.getElementById("analyzeBtn").addEventListener("click", runAnalyze);

document.querySelectorAll('input[name="period"]').forEach((radio) => {
  radio.addEventListener("change", refreshAllLabelInputs);
});
document.querySelectorAll('input[name="metric"]').forEach((radio) => {
  radio.addEventListener("change", refreshMetricLabels);
});

addSalesRow();
initNgTable();
refreshAllLabelInputs();
refreshMetricLabels();
