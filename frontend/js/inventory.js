import { apiGet, apiPost } from "./api.js";
import { showToast, badgeStatus } from "./utils.js";
import { loadDashboard } from "./dashboard.js";
import { loadProductsPage } from "./products.js";
import { loadHistoryPage } from "./history.js";

let cachedProducts = [];

function closeAdjustModal() {
  document.getElementById("adjustModal").classList.remove("active");
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
}

async function renderTable(products) {
  const tbody = document.getElementById("inventoryTableBody");
  tbody.innerHTML = "";

  products.forEach((p) => {
    const status = badgeStatus(Number(p.qty || 0), Number(p.safetyStock || 0));

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${p.code}</td>
      <td>${p.name}</td>
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
      document.getElementById("adjustProductCode").value = btn.getAttribute("data-code");
    });
  });
}

function applySearch(term) {
  const t = (term || "").toLowerCase();
  const filtered = cachedProducts.filter((p) => {
    const s = `${p.code} ${p.name}`.toLowerCase();
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

  if (!Number.isFinite(delta) || delta === 0) {
    showToast("수량(delta)은 0이 아니어야 합니다.", true);
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
