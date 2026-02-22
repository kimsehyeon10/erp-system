/**
 * history.js  ―  ERP v6 (UI 즉시 반영 수정판)
 *
 * 수정 사항:
 *  ① undo() 완료 후 window.loadInventoryPage(true) / window.loadProductsPage(true) 로
 *    force=true 전달 → 캐시 무효화 후 서버에서 최신 데이터 재조회
 *  ② 기존 코드에서 await 없이 fire-and-forget 으로 호출하던 다른 탭 갱신을
 *    await 로 처리하여 순서 보장
 */

import { apiGet, apiPost } from "./api.js";
import { showToast, showConfirm } from "./utils.js";

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

  const confirmed = await showConfirm(
    "이 재고 변동을 취소하시겠습니까?\n\n이 작업은 재고 수량을 이전 상태로 되돌립니다.",
    "📦 재고 변동 취소"
  );

  if (!confirmed) return;

  try {
    const data = await apiPost(`/history/${historyId}/cancel`, {});
    if (!data.ok) throw new Error(data.message || "취소 실패");

    showToast("✅ 취소(undo) 완료");

    // ① 이력 탭 즉시 갱신 (항상 서버 재조회)
    await loadHistoryPage();

    // ② 다른 탭도 force=true 로 캐시 무효화 후 재조회
    //    - loadInventoryPage(force=false) 는 cachedProducts가 있으면 fetch를 건너뜀
    //    - force=true 를 명시해야 서버에서 최신 재고를 가져옴
    if (typeof window.loadInventoryPage === "function") {
      await window.loadInventoryPage(true);
    }
    if (typeof window.loadProductsPage === "function") {
      await window.loadProductsPage(true);
    }
    if (typeof window.loadDashboard === "function") {
      await window.loadDashboard();
    }
  } catch (e) {
    showToast(e.message || "취소 실패", true);
  }
}

function renderTable(items) {
  const tbody = document.getElementById("historyTableBody");
  if (!tbody) return;

  tbody.innerHTML = "";

  const allowUndo = canUndoByRole();

  items.forEach((h) => {
    const tr = document.createElement("tr");

    const canCancel =
      allowUndo &&
      ["IN", "OUT", "ADJUST"].includes(h.type) &&
      !h.canceledAt;

    const undoBtn = canCancel
      ? `<button class="btn-add undo-btn" data-undo="${h.id}" style="padding:6px 10px; z-index:10; position:relative;">취소</button>`
      : `<span style="opacity:.6;">-</span>`;

    const cancelInfo = h.canceledAt
      ? `<br/><small style="color:#999;">(취소됨: ${new Date(h.canceledAt).toLocaleString()})</small>`
      : "";

    // 📝 변경 내역 표시 (beforeState가 있는 경우)
    let detailsHtml = "";
    if (h.beforeState && Object.keys(h.beforeState).length > 0) {
      const changesHtml = Object.entries(h.beforeState)
        .map(([key, val]) => {
          const before = val.before !== undefined ? val.before : "";
          const after  = val.after  !== undefined ? val.after  : "";
          return `<li><strong>${key}:</strong> <code>${before}</code> → <code>${after}</code></li>`;
        })
        .join("");
      detailsHtml = `<details style="margin-top:4px;"><summary style="cursor:pointer; color:#0066cc; font-size:12px;">📋 변경 상세 보기</summary><ul style="font-size:12px; margin:4px 0; padding-left:20px;">${changesHtml}</ul></details>`;
    }

    tr.innerHTML = `
      <td>${new Date(h.at).toLocaleString()}</td>
      <td>${h.productCode}</td>
      <td>${h.type}${cancelInfo}</td>
      <td>${h.delta > 0 ? "+" : ""}${h.delta}</td>
      <td>${h.user}</td>
      <td>${h.memo || ""}${detailsHtml}</td>
      <td class="undo-cell">${undoBtn}</td>
    `;

    tbody.appendChild(tr);
  });

  // 이벤트 위임: tbody에 한 번만 바인딩 (테이블 재렌더링 대응)
  tbody.removeEventListener("click", handleUndoClick);
  tbody.addEventListener("click", handleUndoClick);
}

let undoInFlight = new Set();

function handleUndoClick(e) {
  const btn = e.target.closest("[data-undo]");
  if (!btn) return;

  e.stopPropagation();
  e.preventDefault();

  const historyId = btn.getAttribute("data-undo");

  // 중복 클릭 방지
  if (undoInFlight.has(historyId)) return;
  undoInFlight.add(historyId);
  btn.disabled = true;

  undo(historyId).finally(() => {
    undoInFlight.delete(historyId);
    // 버튼은 테이블 재렌더링 후 사라지므로 disabled 복구 불필요
  });
}

function applyFilters() {
  const searchInput = document.getElementById("historySearch");
  const typeFilter  = document.getElementById("historyTypeFilter");

  if (!searchInput || !typeFilter) return;

  const term = searchInput.value.trim().toLowerCase();
  const type = typeFilter.value;

  const filtered = cachedHistory.filter((h) => {
    const matchSearch = `${h.productCode}`.toLowerCase().includes(term);
    const matchType   = !type || h.type === type;
    return matchSearch && matchType;
  });

  renderTable(filtered);
}

export async function loadHistoryPage() {
  try {
    // 이력은 캐시 없이 항상 서버에서 최신 데이터를 조회
    const data = await apiGet("/history");
    if (!data.ok) throw new Error(data.message || "load failed");
    cachedHistory = data.history || [];
    applyFilters();
  } catch (e) {
    showToast("이력 로드 실패", true);
  }
}

window.addEventListener("DOMContentLoaded", () => {
  const searchInput = document.getElementById("historySearch");
  const typeFilter  = document.getElementById("historyTypeFilter");

  if (searchInput) searchInput.addEventListener("input", applyFilters);
  if (typeFilter)  typeFilter.addEventListener("change", applyFilters);
});

// Backward-compatible: expose for non-module callers
window.loadHistoryPage = loadHistoryPage;
