/**
 * cost.js - 원가 계산 페이지 로직
 *
 * 기능:
 *  1. 상품 선택 또는 직접 입력으로 단가 불러오기
 *  2. 수량 + 부가 비용(운송비/인건비/가공비 등) 입력
 *  3. 마진율 입력 시 판매가 자동 계산
 *  4. 계산 결과 저장 (API: POST /cost/save)
 *  5. 저장된 원가 기록 조회 (API: GET /cost/:productCode)
 */

import { apiGet, apiPost, apiDelete, requireLoginOrRedirect } from "./api.js";
import { showToast } from "./utils.js";

// ─────────────────────── 상태 ────────────────────────────────

let allProducts    = [];   // 전체 상품 목록 (드롭다운용)
let additionalRows = [];   // 부가 비용 행 목록 [{ label, amount }]
let lastResult     = null; // 마지막 계산 결과

// ─────────────────────── DOM 참조 ────────────────────────────

function $id(id) { return document.getElementById(id); }

// ─────────────────────── 초기화 ──────────────────────────────

export async function initCost() {
  if (!requireLoginOrRedirect()) return;

  await loadProductOptions();
  bindEvents();
  renderAdditionalRows();
}

// 상품 목록 불러오기 (드롭다운)
async function loadProductOptions() {
  try {
    const res = await apiGet("/products");
    allProducts = res.products || [];
  } catch {
    allProducts = [];
  }

  const sel = $id("costProductSelect");
  if (!sel) return;

  sel.innerHTML = `<option value="">-- 상품 선택 (선택사항) --</option>`;
  allProducts.forEach(p => {
    const opt = document.createElement("option");
    opt.value       = p.code;
    opt.textContent = `${p.code} - ${p.name}`;
    opt.dataset.price = p.unitCost || p.price || 0;
    sel.appendChild(opt);
  });
}

// ─────────────────────── 이벤트 바인딩 ──────────────────────

function bindEvents() {
  // 상품 선택 시 단가 자동 입력
  const sel = $id("costProductSelect");
  if (sel) {
    sel.addEventListener("change", () => {
      const opt = sel.options[sel.selectedIndex];
      if (opt && opt.dataset.price) {
        const priceField = $id("costUnitPrice");
        if (priceField) priceField.value = opt.dataset.price;
      }
      // 기존 기록 조회
      const code = sel.value;
      if (code) loadCostHistory(code);
      else clearHistoryTable();
    });
  }

  // 부가 비용 행 추가
  const addRowBtn = $id("costAddRowBtn");
  if (addRowBtn) addRowBtn.addEventListener("click", () => {
    additionalRows.push({ label: "", amount: 0 });
    renderAdditionalRows();
  });

  // 계산 버튼
  const calcBtn = $id("costCalcBtn");
  if (calcBtn) calcBtn.addEventListener("click", handleCalculate);

  // 저장 버튼
  const saveBtn = $id("costSaveBtn");
  if (saveBtn) saveBtn.addEventListener("click", handleSave);

  // 마진율 입력 시 실시간 계산
  const marginInput = $id("costMarginRate");
  if (marginInput) marginInput.addEventListener("input", () => {
    if (lastResult) updateSellingPriceDisplay();
  });
}

// ─────────────────────── 부가 비용 행 렌더 ──────────────────

function renderAdditionalRows() {
  const tbody = $id("costAdditionalBody");
  if (!tbody) return;

  tbody.innerHTML = "";
  additionalRows.forEach((row, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>
        <input type="text" class="cost-additional-label" data-idx="${i}"
          value="${escapeHtml(row.label)}" placeholder="예: 운송비, 인건비, 가공비"
          style="width:100%;padding:4px 6px;border:1px solid #ddd;border-radius:4px;" />
      </td>
      <td>
        <input type="number" class="cost-additional-amount" data-idx="${i}"
          value="${row.amount}" min="0" placeholder="0"
          style="width:100%;padding:4px 6px;border:1px solid #ddd;border-radius:4px;" />
      </td>
      <td style="text-align:center;">
        <button type="button" class="cost-remove-row btn-danger-sm" data-idx="${i}">삭제</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // 행 내 이벤트 위임
  tbody.querySelectorAll(".cost-additional-label").forEach(input => {
    input.addEventListener("input", e => {
      additionalRows[Number(e.target.dataset.idx)].label = e.target.value;
    });
  });
  tbody.querySelectorAll(".cost-additional-amount").forEach(input => {
    input.addEventListener("input", e => {
      additionalRows[Number(e.target.dataset.idx)].amount = Number(e.target.value) || 0;
    });
  });
  tbody.querySelectorAll(".cost-remove-row").forEach(btn => {
    btn.addEventListener("click", e => {
      additionalRows.splice(Number(e.target.dataset.idx), 1);
      renderAdditionalRows();
    });
  });
}

// ─────────────────────── 계산 처리 ──────────────────────────

async function handleCalculate() {
  const productCode = ($id("costProductSelect")?.value || "").trim();
  const unitPrice   = Number($id("costUnitPrice")?.value || 0);
  const qty         = Number($id("costQty")?.value       || 1);
  const marginRate  = Number($id("costMarginRate")?.value || 0) / 100;

  // 프론트 사이드 기본 검증
  if (unitPrice < 0) { showToast("단가는 0 이상이어야 합니다.", true); return; }
  if (qty < 1)       { showToast("수량은 1 이상이어야 합니다.", true); return; }
  if (marginRate < 0){ showToast("마진율은 0% 이상이어야 합니다.", true); return; }

  const body = {
    productCode: productCode || undefined,
    unitPrice,
    qty,
    additionalCosts: additionalRows.filter(r => r.label.trim()),
    marginRate,
  };

  try {
    const res = await apiPost("/cost/calculate", body);
    lastResult = { ...res, marginRate };
    renderResult(res);
    showToast("원가 계산 완료");
  } catch (err) {
    showToast(err.message || "계산 실패", true);
  }
}

// ─────────────────────── 결과 렌더 ──────────────────────────

function renderResult(data) {
  const el = $id("costResultBox");
  if (!el) return;

  el.style.display = "block";

  const fmt = n => Number(n || 0).toLocaleString("ko-KR");

  $id("costResUnitPrice")?.setAttribute("data-value", data.unitPrice);
  $id("costResQty")?.setAttribute("data-value", data.qty);
  $id("costResMaterialCost")?.setAttribute("data-value", data.materialCost);
  $id("costResTotalAdditional")?.setAttribute("data-value", data.totalAdditionalCost);
  $id("costResTotalCost")?.setAttribute("data-value", data.totalCost);
  $id("costResUnitCost")?.setAttribute("data-value", data.unitCostCalculated);
  $id("costResSellingPrice")?.setAttribute("data-value", data.sellingPrice);

  setText("costResUnitPrice",       `${fmt(data.unitPrice)} 원`);
  setText("costResQty",             `${fmt(data.qty)} 개`);
  setText("costResMaterialCost",    `${fmt(data.materialCost)} 원`);
  setText("costResTotalAdditional", `${fmt(data.totalAdditionalCost)} 원`);
  setText("costResTotalCost",       `${fmt(data.totalCost)} 원`);
  setText("costResUnitCost",        `${fmt(data.unitCostCalculated)} 원`);
  setText("costResSellingPrice",    `${fmt(data.sellingPrice)} 원`);

  // 부가 비용 상세 표시
  const addDetail = $id("costResAdditionalDetail");
  if (addDetail) {
    if ((data.additionalCosts || []).length === 0) {
      addDetail.textContent = "(없음)";
    } else {
      addDetail.innerHTML = data.additionalCosts
        .map(c => `<span style="margin-right:12px">${escapeHtml(c.label)}: ${fmt(c.amount)}원</span>`)
        .join("");
    }
  }
}

function updateSellingPriceDisplay() {
  if (!lastResult) return;
  const margin    = Number($id("costMarginRate")?.value || 0) / 100;
  const newSell   = lastResult.totalCost * (1 + margin);
  setText("costResSellingPrice", `${Math.round(newSell).toLocaleString("ko-KR")} 원`);
}

// ─────────────────────── 저장 처리 ──────────────────────────

async function handleSave() {
  const productCode = ($id("costProductSelect")?.value || "").trim();
  const unitPrice   = Number($id("costUnitPrice")?.value || 0);
  const qty         = Number($id("costQty")?.value       || 1);
  const marginRate  = Number($id("costMarginRate")?.value || 0) / 100;
  const memo        = ($id("costMemo")?.value || "").trim();

  if (!productCode) {
    showToast("저장하려면 상품을 선택하세요.", true);
    return;
  }

  const body = {
    productCode,
    unitPrice,
    qty,
    additionalCosts: additionalRows.filter(r => r.label.trim()),
    marginRate,
    memo,
  };

  try {
    await apiPost("/cost/save", body);
    showToast("원가 기록이 저장되었습니다.");
    loadCostHistory(productCode);
  } catch (err) {
    showToast(err.message || "저장 실패", true);
  }
}

// ─────────────────────── 이력 조회 ──────────────────────────

async function loadCostHistory(productCode) {
  const tbody = $id("costHistoryBody");
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:12px;">조회 중...</td></tr>`;

  try {
    const res = await apiGet(`/cost/${encodeURIComponent(productCode)}`);
    renderHistoryTable(res.records || []);
  } catch {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;color:red;padding:12px;">조회 실패</td></tr>`;
  }
}

function renderHistoryTable(records) {
  const tbody = $id("costHistoryBody");
  if (!tbody) return;

  if (records.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:12px;color:#888;">저장된 원가 기록이 없습니다.</td></tr>`;
    return;
  }

  const fmt  = n => Number(n || 0).toLocaleString("ko-KR");
  const date = s => s ? new Date(s).toLocaleString("ko-KR") : "-";

  tbody.innerHTML = records.map(r => `
    <tr>
      <td style="font-size:11px;color:#888;">${date(r.savedAt)}</td>
      <td>${escapeHtml(r.productName || r.productCode)}</td>
      <td>${fmt(r.unitPrice)} 원</td>
      <td>${fmt(r.qty)}</td>
      <td>${fmt(r.totalAdditionalCost)} 원</td>
      <td>${fmt(r.totalCost)} 원</td>
      <td style="color:var(--success,#16a34a);font-weight:600;">${fmt(r.sellingPrice)} 원</td>
      <td>${escapeHtml(r.memo || "")}</td>
    </tr>
  `).join("");
}

function clearHistoryTable() {
  const tbody = $id("costHistoryBody");
  if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:12px;color:#888;">상품을 선택하면 기록이 표시됩니다.</td></tr>`;
}

// ─────────────────────── 유틸 ────────────────────────────────

function setText(id, text) {
  const el = $id(id);
  if (el) el.textContent = text;
}

function escapeHtml(str) {
  return String(str || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
