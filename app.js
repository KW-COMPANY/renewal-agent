// File: app.js

// ★ ここをご自身のWorkers URLに書き換えてください
const WORKER_ENDPOINT = "https://your-worker-name.your-subdomain.workers.dev/analyze";

// --- 行追加：売上テーブル ---
function addSalesRow() {
  const tbody = document.querySelector("#salesTable tbody");
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input type="text" class="s-id" placeholder="A" /></td>
    <td><input type="text" class="s-label" placeholder="2026-01" /></td>
    <td><input type="number" class="s-base" min="0" placeholder="1000000" /></td>
    <td><input type="number" class="s-actual" min="0" placeholder="850000" /></td>
    <td><button type="button" class="del">×</button></td>
  `;
  tr.querySelector(".del").addEventListener("click", () => tr.remove());
  tbody.appendChild(tr);
}

// --- 行追加：NG理由 ---
function addNgRow() {
  const wrap = document.getElementById("ngReasons");
  const div = document.createElement("div");
  div.className = "ng-row";
  div.innerHTML = `
    <input type="text" placeholder="理由カテゴリ" class="ng-cat" />
    <input type="number" placeholder="件数" class="ng-cnt" min="0" />
    <button type="button" class="del">×</button>
  `;
  div.querySelector(".del").addEventListener("click", () => div.remove());
  wrap.appendChild(div);
}

// --- 入力データの収集 ---
function collectData() {
  const period = document.querySelector('input[name="period"]:checked').value;

  const sales = [];
  document.querySelectorAll("#salesTable tbody tr").forEach((tr) => {
    const id = tr.querySelector(".s-id").value.trim();
    const label = tr.querySelector(".s-label").value.trim();
    const base = Number(tr.querySelector(".s-base").value);
    const actual = Number(tr.querySelector(".s-actual").value);
    if (id && label && base > 0) {
      sales.push({
        id, label, base, actual,
        rate: Number(((actual / base) * 100).toFixed(2))
      });
    }
  });

  const ngReasons = [];
  document.querySelectorAll(".ng-row").forEach((row) => {
    const cat = row.querySelector(".ng-cat").value.trim();
    const cnt = Number(row.querySelector(".ng-cnt").value);
    if (cat && cnt > 0) ngReasons.push({ category: cat, count: cnt });
  });

  return { period, sales, ngReasons };
}

// --- センシティブ情報の簡易チェック ---
function hasSensitive(data) {
  const pattern = /(株式会社|有限会社|[A-Za-z]{3,}\s?(Inc|Ltd|Corp))/i;
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
    status.textContent = "⚠ 更新数値を最低1行入力してください。";
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
document.getElementById("addNg").addEventListener("click", addNgRow);
document.getElementById("analyzeBtn").addEventListener("click", runAnalyze);
addSalesRow(); // 初期1行
