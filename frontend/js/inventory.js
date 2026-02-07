import { apiGet, apiPost } from "./api.js";
import { showToast, badgeStatus } from "./utils.js";
import { loadDashboard } from "./dashboard.js";
import { loadProductsPage } from "./products.js";
import { loadHistoryPage } from "./history.js";

let cachedProducts = [];

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

function openAdjustModal() {
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

  // 이벤트
  select.onchange = updateAdjustUnitAndHint;
  document.getElementById("adjustType").onchange = updateAdjustUnitAndHint;

  // 초기 표시
  updateAdjustUnitAndHint();
}

async function renderTable(products) {
  const tbody = document.getElementById("inventoryTableBody");
  tbody.innerHTML = "";

  products.forEach((p) => {
    const status = badgeStatus(Number(p.qty || 0), Number(p.safetyStock || 0));
    const unitText = (p.unit ? String(p.unit).toUpperCase() : "EA");
    const locationText = p.location ? String(p.location) : "-";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${p.code}</td>
      <td>${p.name}</td>
      <td>${unitText}</td>
      <td>${locationText}</td>
      <td>${Number(p.qty || 0)}</td>
      <td>${Number(p.safetyStock || 0)}</td>
      <td><span class="badge ${status.cls}">${status.text}</span></td>
      <td class="action-btns">
        <button class="btn-edit" data-code="${p.code}">조정</button>
      </td>
    `;

    tbody.appendChild(tr);
  });

  tbody.querySelectorAll(".btn-edit").forEach((btn) => {
    btn.addEventListener("click", () => {
      openAdjustModal();
      const code = btn.getAttribute("data-code");
      document.getElementById("adjustProductCode").value = code;
      updateAdjustUnitAndHint();
    });
  });
}

function applySearch(term) {
  const t = (term || "").toLowerCase();
  const filtered = cachedProducts.filter((p) => {
    const s = `${p.code} ${p.name} ${p.location || ""}`.toLowerCase();
    return s.includes(t);
  });
  renderTable(filtered);
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

export async function loadInventoryPage(force = false) {
  try {
    if (force || cachedProducts.length === 0) {
      const data = await apiGet("/products");
      cachedProducts = data.products || [];
    }

    await renderTable(cachedProducts);

    const search = document.getElementById("inventorySearch");
    search.oninput = () => applySearch(search.value);

    document.getElementById("openAdjustBtn").onclick = openAdjustModal;

    document.getElementById("closeAdjustModal").onclick = closeAdjustModal;
    document.getElementById("cancelAdjustModal").onclick = closeAdjustModal;
    document.getElementById("adjustForm").onsubmit = handleAdjustSubmit;
  } catch (err) {
    showToast(err.message, true);
  }
}
