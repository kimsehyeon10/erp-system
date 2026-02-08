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

function closeDetailModal() {
  document.getElementById("inventoryDetailModal").classList.remove("active");
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

  // m: 0.5 단위 허용 (0.5의 배수인지 체크)
  if (unitUpper === "M") {
    const doubled = delta * 2;
    const nearInt = Math.round(doubled);
    if (Math.abs(doubled - nearInt) > 1e-9) {
      return { ok: false, message: "m 단위는 0.5 단위로 입력하세요. (예: 0.5, 1, 1.5, 2)" };
    }
    return { ok: true };
  }

  // 기타 단위: 일단 숫자만 허용
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

  // 특정 제품이 지정되면 선택
  if (productCode) {
    select.value = productCode;
  }

  // 이벤트
  select.onchange = updateAdjustUnitAndHint;
  document.getElementById("adjustType").onchange = updateAdjustUnitAndHint;

  // 초기 표시
  updateAdjustUnitAndHint();
}

// 재고 상태 결정
function getStockStatus(qty, safetyStock) {
  if (qty === 0) return { class: 'critical', text: '품절', percentage: 0 };
  if (qty < safetyStock) return { class: 'critical', text: '부족', percentage: (qty / safetyStock) * 100 };
  if (qty < safetyStock * 2) return { class: 'low', text: '주의', percentage: (qty / (safetyStock * 2)) * 100 };
  if (qty > safetyStock * 3) return { class: 'excess', text: '과잉', percentage: 100 };
  return { class: 'normal', text: '정상', percentage: 100 };
}

// 요약 카드 업데이트
function updateSummaryCards(products) {
  const totalValue = products.reduce((sum, p) => sum + (Number(p.price || 0) * Number(p.qty || 0)), 0);
  const totalItems = products.length;
  const lowStockItems = products.filter(p => {
    const qty = Number(p.qty || 0);
    const safetyStock = Number(p.safetyStock || 0);
    return qty < safetyStock;
  }).length;
  const excessItems = products.filter(p => {
    const qty = Number(p.qty || 0);
    const safetyStock = Number(p.safetyStock || 0);
    return qty > safetyStock * 3;
  }).length;

  document.getElementById("inventoryTotalValue").textContent = fmtMoney(totalValue);
  document.getElementById("inventoryTotalItems").textContent = `${totalItems} 개`;
  document.getElementById("inventoryLowStock").textContent = `${lowStockItems} 개`;
  document.getElementById("inventoryExcess").textContent = `${excessItems} 개`;
}

// 카드 렌더링
function renderCards(products) {
  const grid = document.getElementById("inventoryGrid");
  const empty = document.getElementById("inventoryEmpty");
  
  if (products.length === 0) {
    grid.style.display = "none";
    empty.style.display = "block";
    return;
  }

  grid.style.display = "grid";
  empty.style.display = "none";
  grid.innerHTML = "";

  products.forEach((p) => {
    const qty = Number(p.qty || 0);
    const safetyStock = Number(p.safetyStock || 0);
    const status = getStockStatus(qty, safetyStock);
    const unitText = (p.unit ? String(p.unit).toUpperCase() : "EA");
    const categoryText = p.category || "기타";

    const card = document.createElement("div");
    card.className = "inventory-card";
    card.innerHTML = `
      <div class="inventory-card-header">
        <div class="inventory-card-code">${p.code}</div>
      </div>
      <div class="inventory-card-status">
        <span class="status-badge-new ${status.class}">${status.text}</span>
      </div>
      <div class="inventory-card-name">${p.name}</div>
      <div class="inventory-card-category">${categoryText}</div>
      <div class="inventory-card-info">
        <div class="inventory-info-item">
          <div class="inventory-info-label">현재 재고</div>
          <div class="inventory-info-value highlight">${qty}</div>
        </div>
        <div class="inventory-info-item">
          <div class="inventory-info-label">안전 재고</div>
          <div class="inventory-info-value">${safetyStock}</div>
        </div>
        <div class="inventory-info-item">
          <div class="inventory-info-label">단위</div>
          <div class="inventory-info-value">${unitText}</div>
        </div>
      </div>
      <div class="inventory-progress">
        <div class="inventory-progress-bar ${status.class}" style="width: ${status.percentage}%"></div>
      </div>
    `;

    card.addEventListener("click", () => showProductDetailModal(p));
    grid.appendChild(card);
  });
}

// 상품 상세 정보 표시 (export for use in other modules)
export function showProductDetailModal(product) {
  const modal = document.getElementById("inventoryDetailModal");
  
  document.getElementById("detailCode").textContent = product.code || "-";
  document.getElementById("detailName").textContent = product.name || "-";
  document.getElementById("detailCategory").textContent = product.category || "-";
  document.getElementById("detailLocation").textContent = product.location || "-";
  document.getElementById("detailUnit").textContent = product.unit ? String(product.unit).toUpperCase() : "EA";
  document.getElementById("detailQty").textContent = Number(product.qty || 0);
  document.getElementById("detailSafetyStock").textContent = Number(product.safetyStock || 0);
  document.getElementById("detailPrice").textContent = fmtMoney(product.price || 0);
  document.getElementById("detailDescription").textContent = product.description || "설명이 없습니다.";

  modal.classList.add("active");

  // 재고 조정 버튼
  document.getElementById("detailAdjustBtn").onclick = () => {
    closeDetailModal();
    openAdjustModal(product.code);
  };
}

// 필터링 및 검색
function applyFilters() {
  let filtered = [...cachedProducts];

  // 검색어 필터
  if (currentFilter.search) {
    const term = currentFilter.search.toLowerCase();
    filtered = filtered.filter((p) => {
      const searchStr = `${p.code} ${p.name} ${p.location || ""}`.toLowerCase();
      return searchStr.includes(term);
    });
  }

  // 카테고리 필터
  if (currentFilter.category) {
    filtered = filtered.filter(p => (p.category || "기타") === currentFilter.category);
  }

  renderCards(filtered);
}

// 카테고리 옵션 업데이트
function updateCategoryOptions(products) {
  const categories = new Set();
  products.forEach(p => {
    categories.add(p.category || "기타");
  });

  const select = document.getElementById("inventoryCategoryFilter");
  const currentValue = select.value;
  
  select.innerHTML = '<option value="">카테고리: 전체</option>';
  
  Array.from(categories).sort().forEach(cat => {
    const option = document.createElement("option");
    option.value = cat;
    option.textContent = cat;
    select.appendChild(option);
  });

  // 이전 선택값 복원
  if (currentValue && Array.from(categories).includes(currentValue)) {
    select.value = currentValue;
  }
}

async function handleAdjustSubmit(e) {
  e.preventDefault();

  const productCode = document.getElementById("adjustProductCode").value;
  const type = document.getElementById("adjustType").value;
  const delta = Number(document.getElementById("adjustDelta").value);
  const memo = document.getElementById("adjustMemo").value.trim();

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

  try {
    await apiPost("/products/adjust", { productCode, type, delta, memo });
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

// 요약 카드 클릭 핸들러
function setupSummaryCardHandlers(products) {
  // 총 재고 품목 카드
  document.getElementById("inventoryTotalItemsCard").onclick = () => {
    currentFilter.search = '';
    currentFilter.category = '';
    document.getElementById("inventorySearch").value = '';
    document.getElementById("inventoryCategoryFilter").value = '';
    applyFilters();
  };

  // 부족 재고 카드
  document.getElementById("inventoryLowStockCard").onclick = () => {
    const lowStockProducts = products.filter(p => {
      const qty = Number(p.qty || 0);
      const safetyStock = Number(p.safetyStock || 0);
      return qty < safetyStock;
    });
    renderCards(lowStockProducts);
  };

  // 과잉 재고 카드
  document.getElementById("inventoryExcessCard").onclick = () => {
    const excessProducts = products.filter(p => {
      const qty = Number(p.qty || 0);
      const safetyStock = Number(p.safetyStock || 0);
      return qty > safetyStock * 3;
    });
    renderCards(excessProducts);
  };
}

export async function loadInventoryPage(force = false) {
  try {
    if (force || cachedProducts.length === 0) {
      const data = await apiGet("/products");
      cachedProducts = data.products || [];
    }

    // 요약 카드 업데이트
    updateSummaryCards(cachedProducts);

    // 카테고리 옵션 업데이트
    updateCategoryOptions(cachedProducts);

    // 카드 렌더링
    renderCards(cachedProducts);

    // 요약 카드 클릭 핸들러
    setupSummaryCardHandlers(cachedProducts);

    // 검색 이벤트
    const searchInput = document.getElementById("inventorySearch");
    searchInput.value = currentFilter.search;
    searchInput.oninput = (e) => {
      currentFilter.search = e.target.value;
      applyFilters();
    };

    // 검색 버튼
    document.querySelector(".inventory-search-btn").onclick = () => {
      applyFilters();
    };

    // 엔터 키로 검색
    searchInput.onkeypress = (e) => {
      if (e.key === 'Enter') {
        applyFilters();
      }
    };

    // 카테고리 필터
    document.getElementById("inventoryCategoryFilter").onchange = (e) => {
      currentFilter.category = e.target.value;
      applyFilters();
    };

    // 모달 닫기 버튼
    document.getElementById("closeInventoryDetailModal").onclick = closeDetailModal;

    // 조정 모달 관련 (기존 코드 유지)
    document.getElementById("closeAdjustModal").onclick = closeAdjustModal;
    document.getElementById("cancelAdjustModal").onclick = closeAdjustModal;
    document.getElementById("adjustForm").onsubmit = handleAdjustSubmit;

  } catch (err) {
    showToast(err.message, true);
  }
}
