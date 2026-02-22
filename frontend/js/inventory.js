import { apiGet, apiPost } from "./api.js";
import { showToast, badgeStatus, fmtMoney } from "./utils.js";
import { loadDashboard } from "./dashboard.js";
import { loadProductsPage } from "./products.js";
import { loadHistoryPage } from "./history.js";

let cachedProducts = [];
let currentFilter = {
  search: '',
  category: ''
};

function closeAdjustModal() {
  document.getElementById("adjustModal").classList.remove("active");
}

function getProductByCode(code) {
  return cachedProducts.find((x) => x.code === code) || null;
}

function getUnitByCode(code) {
  const p = getProductByCode(code);
  return p && p.unit ? String(p.unit).toUpperCase() : "-";
}

function updateAdjustUnitAndHint() {
  const code = document.getElementById("adjustProductCode").value;
  const type = document.getElementById("adjustType").value;
  const unit = getUnitByCode(code);

  document.getElementById("adjustUnitDisplay").value = unit;

  // 입고단가 입력 필드: IN일 때만 표시
  const unitCostGroup = document.getElementById("adjustUnitCostGroup");
  if (unitCostGroup) unitCostGroup.style.display = type === "IN" ? "block" : "none";

  const hint = document.getElementById("adjustUnitHint");
  if (type === "OUT") {
    if (unit === "M") {
      hint.textContent = "출고(OUT): m 단위는 0.5 같은 소수 단위도 가능합니다. (예: 0.5, 1.5)";
    } else {
      hint.textContent = "출고(OUT): ea 단위는 정수만 입력하세요. (예: 1, 2, 3)";
    }
  } else if (type === "IN") {
    hint.textContent = unit === "M"
      ? "입고(IN): m 단위는 0.5 같은 소수 단위도 가능합니다."
      : "입고(IN): ea 단위는 정수만 입력하세요.";
  } else {
    hint.textContent = unit === "M"
      ? "조정(ADJUST): m 단위는 소수 입력이 가능합니다."
      : "조정(ADJUST): ea 단위는 정수만 입력하세요.";
  }
}

function validateDeltaByUnit(delta, unitUpper) {
  if (!Number.isFinite(delta) || delta === 0) {
    return { ok: false, message: "수량(delta)은 0이 아니어야 합니다." };
  }

  // ea: 정수만 허용
  if (unitUpper === "EA") {
    if (!Number.isInteger(delta)) {
      return { ok: false, message: "ea 단위는 정수만 입력 가능합니다. (예: 1, 2, 3)" };
    }
    return { ok: true };
  }

  // m: 0.5 단위 허용
  if (unitUpper === "M") {
    const doubled = delta * 2;
    const nearInt = Math.round(doubled);
    if (Math.abs(doubled - nearInt) > 1e-9) {
      return { ok: false, message: "m 단위는 0.5 단위로 입력하세요. (예: 0.5, 1, 1.5, 2)" };
    }
    return { ok: true };
  }

  return { ok: true };
}

function openAdjustModal(productCode = null) {
  const modal = document.getElementById("adjustModal");
  modal.classList.add("active");

  const select = document.getElementById("adjustProductCode");
  select.innerHTML = "";

  cachedProducts.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.code;
    opt.textContent = `${p.code} - ${p.name}`;
    select.appendChild(opt);
  });

  document.getElementById("adjustForm").reset();

  if (productCode) {
    select.value = productCode;
  }

  select.onchange = updateAdjustUnitAndHint;
  document.getElementById("adjustType").onchange = updateAdjustUnitAndHint;

  updateAdjustUnitAndHint();
}

// 재고 상태 결정 (부족/긴급/과다 표시)
function getStockStatusBadge(qty, safetyStock) {
  if (qty === 0) return '<span class="badge badge-danger">품절</span>';
  if (qty < safetyStock * 0.5) return '<span class="badge badge-danger">긴급</span>';
  if (qty < safetyStock) return '<span class="badge badge-warning">부족</span>';
  if (qty > safetyStock * 3) return '<span class="badge badge-info">과다</span>';
  return '<span class="badge badge-success">정상</span>';
}

// 테이블 렌더링 (재고 관리 탭)
function renderInventoryTable(products) {
  const tbody = document.getElementById("inventoryTableBody");
  
  if (products.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8" style="text-align:center; padding:40px; color:var(--text-secondary);">
          표시할 상품이 없습니다.
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = "";

  products.forEach((p) => {
    const qty = Number(p.qty || 0);
    const safetyStock = Number(p.safetyStock || 0);
    const unitText = (p.unit ? String(p.unit).toUpperCase() : "EA");
    const statusBadge = getStockStatusBadge(qty, safetyStock);

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${(p.barcode || p.code || '-')}</td>
      <td>${p.name}</td>
      <td>${unitText}</td>
      <td>${p.location || "-"}</td>
      <td><strong>${qty}</strong></td>
      <td>${safetyStock}</td>
      <td>${statusBadge}</td>
      <td>
        <button class="btn-small btn-adjust" data-code="${p.code}">조정</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  // 이벤트 위임: 조정 버튼 클릭
  tbody.querySelectorAll(".btn-adjust").forEach(btn => {
    btn.onclick = () => {
      const code = btn.getAttribute("data-code");
      openAdjustModal(code);
    };
  });
}

// 필터링 및 검색
function applyFilters() {
  let filtered = [...cachedProducts];

  if (currentFilter.search) {
    const term = currentFilter.search.toLowerCase();
    filtered = filtered.filter((p) => {
      const searchStr = `${p.code} ${p.name} ${p.location || ""}`.toLowerCase();
      return searchStr.includes(term);
    });
  }

  renderInventoryTable(filtered);
}

async function handleAdjustSubmit(e) {
  e.preventDefault();

  const productCode = document.getElementById("adjustProductCode").value;
  const type        = document.getElementById("adjustType").value;
  const delta       = Number(document.getElementById("adjustDelta").value);
  const memo        = document.getElementById("adjustMemo").value.trim();
  const unitCost    = Number(document.getElementById("adjustUnitCost")?.value || 0);

  if (!productCode) {
    showToast("상품을 선택하세요.", true);
    return;
  }

  const unitUpper = getUnitByCode(productCode);
  const v = validateDeltaByUnit(delta, unitUpper);
  if (!v.ok) {
    showToast(v.message, true);
    return;
  }

  const body = { productCode, type, delta, memo };
  if (type === "IN" && unitCost > 0) body.unitCost = unitCost;

  try {
    await apiPost("/products/adjust", body);
    showToast("재고 조정 완료");

    closeAdjustModal();
    await loadInventoryPage(true);
    await loadProductsPage(true);
    await loadHistoryPage(true);
    await loadDashboard();
  } catch (err) {
    showToast(err.message, true);
  }
}

export async function loadInventoryPage(force = false) {
  try {
    if (force || cachedProducts.length === 0) {
      const data = await apiGet("/products");
      cachedProducts = data.products || [];
    }

    // 테이블 렌더링
    renderInventoryTable(cachedProducts);

    // 검색 이벤트
    const searchInput = document.getElementById("inventorySearch");
    searchInput.value = currentFilter.search;
    searchInput.oninput = (e) => {
      currentFilter.search = e.target.value;
      applyFilters();
    };

    // 엔터 키로 검색
    searchInput.onkeypress = (e) => {
      if (e.key === 'Enter') {
        applyFilters();
      }
    };

    // 재고 조정 버튼 (헤더)
    document.getElementById("openAdjustBtn").onclick = () => openAdjustModal();

    // 조정 모달 관련
    document.getElementById("closeAdjustModal").onclick = closeAdjustModal;
    document.getElementById("cancelAdjustModal").onclick = closeAdjustModal;
    document.getElementById("adjustForm").onsubmit = handleAdjustSubmit;

  } catch (err) {
    showToast(err.message, true);
  }
}

// 다른 모듈에서 사용 (products.js export용 더미)
export function showProductDetailModal(product) {
  // 필요시 구현
}


// Backward-compatible: expose for non-module callers
window.loadInventoryPage = loadInventoryPage;
