import { apiGet, apiPost } from "./api.js";
import { showToast } from "./utils.js";
import { loadInventoryPage } from "./inventory.js";
import { loadProductsPage } from "./products.js";

let cachedHistory = [];

function canCancel() {
  const role = JSON.parse(localStorage.getItem("authUser") || "{}").role;
  return ["admin", "manager"].includes(role);
}

function isCancelable(item) {
  return ["IN", "OUT", "ADJUST"].includes(item.type) && !item.canceledAt;
}

function renderTable(items) {
  const tbody = document.getElementById("historyTableBody");
  tbody.innerHTML = "";

  items.forEach((h) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${new Date(h.at).toLocaleString()}</td>
      <td>${h.productCode}</td>
      <td>${h.type}${h.canceledAt ? "(취소됨)" : ""}</td>
      <td>${h.delta > 0 ? "+" : ""}${h.delta}</td>
      <td>${h.user}</td>
      <td>${h.memo || ""}</td>
      <td class="action-btns"><button class="btn-edit" data-id="${h.id}" ${!canCancel() || !isCancelable(h) ? "disabled" : ""}>취소</button></td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll(".btn-edit").forEach((btn) => {
    btn.onclick = async () => {
      try {
        await apiPost(`/history/${btn.dataset.id}/cancel`, {});
        showToast("이력 취소 완료");
        await loadHistoryPage(true);
        await loadInventoryPage(true);
        await loadProductsPage(true);
      } catch (err) {
        showToast(err.message, true);
      }
    };
  });
}

function applyFilters() {
  const term = document.getElementById("historySearch").value.trim().toLowerCase();
  const type = document.getElementById("historyTypeFilter").value;
  const filtered = cachedHistory.filter((h) => `${h.productCode}`.toLowerCase().includes(term) && (!type || h.type === type));
  renderTable(filtered);
}

export async function loadHistoryPage(force = false) {
  try {
    if (force || cachedHistory.length === 0) {
      const data = await apiGet("/history");
      cachedHistory = data.history || [];
    }
    renderTable(cachedHistory);
    document.getElementById("historySearch").oninput = applyFilters;
    document.getElementById("historyTypeFilter").onchange = applyFilters;
  } catch (err) {
    showToast(err.message, true);
  }
}
