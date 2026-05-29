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

// --- 行追加：売上テーブル ---
function addSalesRow() {
  const tbody = document.querySelector("#salesTable tbody");
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input type="text" class="s-id" placeholder="A" /></td>
    <td><input type="text" class="s-label" placeholder="2026-01" /></td>
    <td><input type="number" class="s-base" min="0" step="1" placeholder="100" /> <span class="unit">万円</span></td>
    <td><input type="number" class="s-actual" min="0" step="1" placeholder="85" /> <span class="unit">万円</span></td>
    <td><button type="button" class="del">×</button></td>
  `;
  tr.querySelector(".del").addEventListener("click", () => tr.remove());
  tbody.appendChild(tr);
}

// --- NG理由テーブルの初期化（固定カテゴリ） ---
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

// --- 入力データの収集 ---
function collectData() {
  const period = document.querySelector('input[name="period"]:checked').value;

  // 売上データ（単位：万円のまま送信）
  const sales = [];
  document.querySelectorAll("#salesTable tbody tr").forEach((tr) => {
    const id = tr.querySelector(".s-id").value.trim();
    const label = tr.querySelector(".s-label").value.trim();
    const base = Math.floor(Number(tr.querySelector(".s-base").value));   // 万円
    const actual = Math.floor(Number(tr.querySelector(".s-actual").value)); // 万円
    if (id && label && base > 0) {
      sales.push({
        id,
        label,
        base,           // 万円
        actual,         // 万円
        unit: "万円",
        rate: Number(((actual / base) * 100).toFixed(2))
      });
    }
  });

  // NG理由（固定カテゴリのうち件数 > 0 のみ）
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
  const all = JSON.stringify(data);
  return pattern.test(all);
}

// --- 分析実行 ---
async function runAnalyze() {
  const status = document.getElementById("status");
  const resultSection = document.getElementById("resultSection");
  const resultBox = document.getElementById("result");

  const data = collectData();

  if (data.sales.length === 0) {
    status.textContent = "⚠ 更新数値を最低1行入力してください（更新母数売上は1以上）。";
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
    if (!res.ok) throw new Error("Worker応答エラー: " + res.status);
    const json = await res.json();

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
addSalesRow();   // 売上テーブル初期1行
initNgTable();   // NG理由テーブル固定生成
