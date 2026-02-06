import { apiGet, apiPost } from "./api.js";
import { showToast, badgeStatus } from "./utils.js";
import { loadDashboard } from "./dashboard.js";
import { loadProductsPage } from "./products.js";
import { loadHistoryPage } from "./history.js";

let cachedProducts = [];

function closeAdjustModal() {
  document.getElementById("adjustModal").classList.remove("active");
}

function openAdjustModal(defaultCode = "") {
  document.getElementById("adjustModal").classList.add("active");
  const select = document.getElementById("adjustProductCode");
  select.innerHTML = "";
  cachedProducts.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.code;
    opt.textContent = `${p.code} - ${p.name}`;
    select.appendChild(opt);
  });
  document.getElementById("adjustForm").reset();
  if (defaultCode) select.value = defaultCode;
}

function renderTable(products) {
  const tbody = document.getElementById("inventoryTableBody");
  tbody.innerHTML = "";

  products.forEach((p) => {
    const status = badgeStatus(Number(p.qty || 0), Number(p.safetyStock || 0));
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${p.code}<div class="hint small">${p.barcode || ""}</div></td>
      <td>${p.name}</td>
      <td>${p.location || "-"}</td>
      <td>${Number(p.qty || 0)} ${p.unit || "ea"}</td>
      <td>${Number(p.safetyStock || 0)} ${p.unit || "ea"}</td>
      <td><span class="badge ${status.cls}">${status.text}</span></td>
      <td class="action-btns"><button class="btn-edit" data-code="${p.code}">조정</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll(".btn-edit").forEach((btn) => btn.addEventListener("click", () => openAdjustModal(btn.dataset.code)));
}

function applySearch(term) {
  const t = (term || "").toLowerCase();
  renderTable(cachedProducts.filter((p) => `${p.code} ${p.barcode || ""} ${p.name}`.toLowerCase().includes(t)));
}

async function handleAdjustSubmit(e) {
  e.preventDefault();
  const productCode = document.getElementById("adjustProductCode").value;
  const type = document.getElementById("adjustType").value;
  const delta = Number(document.getElementById("adjustDelta").value);
  const memo = document.getElementById("adjustMemo").value.trim();

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

function handleBarcodeScan() {
  const term = document.getElementById("barcodeScanInput").value.trim().toLowerCase();
  if (!term) return;
  const found = cachedProducts.find((p) => (p.barcode || p.code || "").toLowerCase() === term || p.code.toLowerCase() === term);
  if (!found) return showToast("바코드에 해당하는 상품이 없습니다.", true);
  showToast(`${found.name} 선택됨. 입/출고/조정을 진행하세요.`);
  openAdjustModal(found.code);
}

export async function loadInventoryPage(force = false) {
  try {
    if (force || cachedProducts.length === 0) {
      const data = await apiGet("/products");
      cachedProducts = data.products || [];
    }

    renderTable(cachedProducts);
    document.getElementById("inventorySearch").oninput = (e) => applySearch(e.target.value);
    document.getElementById("openAdjustBtn").onclick = () => openAdjustModal();
    document.getElementById("scanBarcodeBtn").onclick = handleBarcodeScan;
    document.getElementById("barcodeScanInput").onkeydown = (e) => e.key === "Enter" && handleBarcodeScan();

    document.getElementById("closeAdjustModal").onclick = closeAdjustModal;
    document.getElementById("cancelAdjustModal").onclick = closeAdjustModal;
    document.getElementById("adjustForm").onsubmit = handleAdjustSubmit;
  } catch (err) {
    showToast(err.message, true);
  }
}
