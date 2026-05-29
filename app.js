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

// --- 現在の期間タイプ取得 ---
function getCurrentPeriod() {
  const el = document.querySelector('input[name="period"]:checked');
  return el ? el.value : "monthly";
}

// --- 期間ラベル入力欄のHTMLを生成 ---
function buildLabelInputHTML(period, currentValue = "") {
  // 既存値から年/月を抽出（切替時の値引き継ぎ用）
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
    // type="month" は yyyy-MM 形式
    const val = yearPart && monthPart ? `${yearPart}-${monthPart}` : "";
    return `<input type="month" class="s-label" value="${val}" />`;
  } else {
    // 年次：4桁の数値入力
    const val = yearPart || "";
    return `<input type="number" class="s-label" min="2000" max="2100" step="1" placeholder="2026" value="${val}" />`;
  }
}

// --- 売上行追加 ---
function addSalesRow() {
  const tbody = document.querySelector("#salesTable tbody");
  const period = getCurrentPeriod();
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input type="text" class="s-id" placeholder="A" /></td>
    <td class="label-cell">${buildLabelInputHTML(period)}</td>
    <td><input type="number" class="s-base" min="0" step="1" placeholder="100" /> <span class="unit">万円</span></td>
    <td><input type="number" class="s-actual" min="0" step="1" placeholder="85" /> <span class="unit">万円</span></td>
    <td><button type="button" class="del">×</button></td>
  `;
  tr.querySelector(".del").addEventListener("click", () => tr.remove());
  tbody.appendChild(tr);
}

// --- 期間タイプ切替時：全行のラベル欄を作り直す ---
function refreshAllLabelInputs() {
  const period = getCurrentPeriod();
  document.querySelectorAll("#salesTable tbody tr").forEach((tr) => {
    const cell = tr.querySelector(".label-cell");
    if (!cell) return;
    const oldInput = cell.querySelector(".s-label");
    const oldValue = oldInput ? oldInput.value : "";
    cell.innerHTML = buildLabelInputHTML(period, oldValue);
  });

  // 表ヘッダの表示も切り替え
  const labelHeader = document.querySelector("#salesTable thead th.label-header");
  if (labelHeader) {
    labelHeader.textContent = period === "monthly" ? "期間ラベル（年月）" : "期間ラベル（年）";
  }
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

// --- ラベル値を正規化（Workerへ送る前） ---
function normalizeLabel(period, raw) {
  if (!raw) return "";
  if (period === "monthly") {
    // yyyy-MM → "2026-05月"のような表示用に整形
    const m = String(raw).match(/(\d{4})-(\d{1,2})/);
    if (m) return `${m[1]}-${m[2].padStart(2, "0")}月`;
    return String(raw);
  } else {
    // 年次：4桁を "2026年" に
    const m = String(raw).match(/(\d{4})/);
    if (m) return `${m[1]}年`;
    return String(raw);
  }
}

// --- 入力データ収集 ---
function collectData() {
  const period = getCurrentPeriod();

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

  return { period, sales, ngReasons, amountUnit: "万円" };
}

// --- センシティブ情報の簡易チェック ---
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
    status.textContent = "⚠ 更新数値を最低1行入力してください（識別記号・期間ラベル・更新母数売上が必要）。";
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

  status.textContent = "🤖 AIエージェントが多段分析中です…（10〜30秒）";
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

// 期間タイプ切替の監視
document.querySelectorAll('input[name="period"]').forEach((radio) => {
  radio.addEventListener("change", refreshAllLabelInputs);
});

addSalesRow();
initNgTable();
refreshAllLabelInputs(); // 初期ヘッダ反映
