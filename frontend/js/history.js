import { apiGet, apiPost } from "./api.js";
import { showToast } from "./utils.js";

let cachedHistory = [];

function canUndoByRole() {
  try {
    const user = JSON.parse(localStorage.getItem("authUser") || "{}");
    return user.role === "admin" || user.role === "manager";
  } catch {
    return false;
  }
}

async function undo(historyId) {
  if (!canUndoByRole()) {
    showToast("권한이 없습니다 (admin/manager)", true);
    return;
  }

  try {
    const data = await apiPost(`/history/${historyId}/undo`, {});
    if (!data.ok) throw new Error(data.message || "취소 실패");
    showToast("취소(undo) 완료");
    await loadHistoryPage();
  } catch (e) {
    showToast(e.message || "취소 실패", true);
  }
}

function renderTable(items) {
  const tbody = document.getElementById("historyTableBody");
  tbody.innerHTML = "";

  const allowUndo = canUndoByRole();

  items.forEach((h) => {
    const tr = document.createElement("tr");

    const undoBtn = allowUndo && ["IN", "OUT", "ADJUST"].includes(h.type) && !h.undoneAt
      ? `<button class="btn-add" data-undo="${h.id}" style="padding:6px 10px;">취소</button>`
      : `<span style="opacity:.6;">-</span>`;

    tr.innerHTML = `
      <td>${new Date(h.at).toLocaleString()}</td>
      <td>${h.productCode}</td>
      <td>${h.type}</td>
      <td>${h.delta > 0 ? "+" : ""}${h.delta}</td>
      <td>${h.user}</td>
      <td>${h.memo || ""}</td>
      <td>${undoBtn}</td>
    `;

    tbody.appendChild(tr);
  });

  // 이벤트 바인딩
  tbody.querySelectorAll("[data-undo]").forEach((btn) => {
    btn.addEventListener("click", () => undo(btn.getAttribute("data-undo")));
  });
}

function applyFilters() {
  const term = document.getElementById("historySearch").value.trim().toLowerCase();
  const type = document.getElementById("historyTypeFilter").value;

  const filtered = cachedHistory.filter((h) => {
    const matchSearch = `${h.productCode}`.toLowerCase().includes(term);
    const matchType = !type || h.type === type;
    return matchSearch && matchType;
  });

  renderTable(filtered);
}

export async function loadHistoryPage() {
  try {
    const data = await apiGet("/history");
    if (!data.ok) throw new Error(data.message || "load failed");
    cachedHistory = data.history || [];
    applyFilters();
  } catch (e) {
    showToast("이력 로드 실패", true);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("historySearch").addEventListener("input", applyFilters);
  document.getElementById("historyTypeFilter").addEventListener("change", applyFilters);
});
