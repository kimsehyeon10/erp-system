/**
 * hyundai.js - 현대 스톡 자재 페이지 로직
 *
 * 기능:
 *  1. 현대 자재 목록 조회 (일반 재고와 완전 분리)
 *  2. 현대 자재 등록/수정/삭제
 *  3. 재고 조정 (입고/출고) + 분실 패널티 적용
 *  4. 패널티 단가 계산 표시 (unitPrice × penaltyRate)
 */

import { apiGet, apiPost, apiPut, apiDelete, requireLoginOrRedirect } from "./api.js";
import { showToast } from "./utils.js";

// ─────────────────────── 상태 ────────────────────────────────

let hyundaiList   = [];    // 현대 자재 목록
let editTargetId  = null;  // 수정 대상 id

// ─────────────────────── DOM 참조 ────────────────────────────

function $id(id) { return document.getElementById(id); }

// ─────────────────────── 초기화 ──────────────────────────────

export async function initHyundai() {
  if (!requireLoginOrRedirect()) return;

  await loadHyundaiList();
  bindEvents();
}

// ─────────────────────── 목록 조회 ──────────────────────────

export async function loadHyundaiList() {
  const q = ($id("hyundaiSearch")?.value || "").trim();

  try {
    const url = q
      ? `/hyundai/products?q=${encodeURIComponent(q)}`
      : "/hyundai/products";
    const res = await apiGet(url);
    hyundaiList = res.products || [];
    renderHyundaiTable(hyundaiList);
  } catch (err) {
    showToast(err.message || "현대 자재 조회 실패", true);
    hyundaiList = [];
    renderHyundaiTable([]);
  }
}

// ─────────────────────── 이벤트 바인딩 ──────────────────────

function bindEvents() {
  // 검색
  const searchInput = $id("hyundaiSearch");
  if (searchInput) {
    searchInput.addEventListener("keydown", e => { if (e.key === "Enter") loadHyundaiList(); });
  }
  const searchBtn = $id("hyundaiSearchBtn");
  if (searchBtn) searchBtn.addEventListener("click", loadHyundaiList);

  // 신규 등록 버튼
  const addBtn = $id("openAddHyundaiBtn");
  if (addBtn) addBtn.addEventListener("click", () => openHyundaiModal(null));

  // 모달 닫기
  const closeBtn = $id("closeHyundaiModal");
  if (closeBtn) closeBtn.addEventListener("click", closeHyundaiModal);
  const cancelBtn = $id("cancelHyundaiModal");
  if (cancelBtn) cancelBtn.addEventListener("click", closeHyundaiModal);

  // 폼 제출
  const form = $id("hyundaiForm");
  if (form) form.addEventListener("submit", handleHyundaiFormSubmit);

  // 재고 조정 모달
  const closeAdjBtn = $id("closeHyundaiAdjustModal");
  if (closeAdjBtn) closeAdjBtn.addEventListener("click", closeAdjustModal);
  const cancelAdjBtn = $id("cancelHyundaiAdjustModal");
  if (cancelAdjBtn) cancelAdjBtn.addEventListener("click", closeAdjustModal);
  const adjForm = $id("hyundaiAdjustForm");
  if (adjForm) adjForm.addEventListener("submit", handleAdjustSubmit);

  // 분실 체크박스 → 패널티 금액 표시
  const lostChk = $id("hyundaiAdjustIsLost");
  if (lostChk) lostChk.addEventListener("change", updatePenaltyDisplay);
  const adjDelta = $id("hyundaiAdjustDelta");
  if (adjDelta) adjDelta.addEventListener("input", updatePenaltyDisplay);
}

// ─────────────────────── 테이블 렌더 ────────────────────────

function renderHyundaiTable(list) {
  const tbody = $id("hyundaiTableBody");
  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:20px;color:#888;">현대 자재가 없습니다. "+ 자재 추가" 버튼으로 등록하세요.</td></tr>`;
    return;
  }

  const fmt  = n => Number(n || 0).toLocaleString("ko-KR");
  const user = JSON.parse(localStorage.getItem("authUser") || "{}");

  tbody.innerHTML = list.map(p => {
    const statusClass = p.qty <= 0 ? "status-danger"
                      : p.qty < 10 ? "status-warning"
                      : "status-ok";
    const statusText  = p.qty <= 0 ? "재고없음"
                      : p.qty < 10 ? "부족"
                      : "정상";

    return `
    <tr>
      <td><strong>${escapeHtml(p.code)}</strong></td>
      <td>${escapeHtml(p.name)}</td>
      <td>${escapeHtml(p.category)}</td>
      <td>${escapeHtml(p.unit)}</td>
      <td><strong>${fmt(p.qty)}</strong></td>
      <td>${fmt(p.unitPrice)} 원</td>
      <td style="color:var(--danger,#dc2626);font-weight:600;">
        ${fmt(p.penaltyPrice)} 원
        <span style="font-size:11px;color:#888;">(×${p.penaltyRate}배)</span>
      </td>
      <td><span class="status-badge ${statusClass}">${statusText}</span></td>
      <td>
        <button class="btn-sm" onclick="window._hyundaiAdjust('${p.id}')">재고조정</button>
        ${user.role === "admin" || user.role === "manager"
          ? `<button class="btn-sm btn-edit" onclick="window._hyundaiEdit('${p.id}')">수정</button>`
          : ""}
        ${user.role === "admin"
          ? `<button class="btn-sm btn-danger-sm" onclick="window._hyundaiDelete('${p.id}')">삭제</button>`
          : ""}
      </td>
    </tr>`;
  }).join("");

  // 전역 핸들러 등록 (onclick 속성에서 사용)
  window._hyundaiEdit   = openHyundaiModal;
  window._hyundaiDelete = handleDelete;
  window._hyundaiAdjust = openAdjustModal;
}

// ─────────────────────── 등록/수정 모달 ─────────────────────

function openHyundaiModal(id) {
  editTargetId = id || null;

  const modal = $id("hyundaiModal");
  if (!modal) return;

  const titleEl = $id("hyundaiModalTitle");

  if (id) {
    // 수정 모드
    const target = hyundaiList.find(p => p.id === id);
    if (!target) return;
    if (titleEl) titleEl.textContent = "현대 자재 수정";

    setVal("hyundaiCode",        target.code);
    setVal("hyundaiName",        target.name);
    setVal("hyundaiCategory",    target.category);
    setVal("hyundaiUnit",        target.unit);
    setVal("hyundaiQty",         target.qty);
    setVal("hyundaiUnitPrice",   target.unitPrice);
    setVal("hyundaiPenaltyRate", target.penaltyRate);
    setVal("hyundaiLocation",    target.location);
    setVal("hyundaiSpec",        target.spec);
    setVal("hyundaiNote",        target.note);

    // 수정 시 코드 변경 잠금 (선택적)
    const codeInput = $id("hyundaiCode");
    if (codeInput) codeInput.readOnly = true;
  } else {
    // 등록 모드
    if (titleEl) titleEl.textContent = "현대 자재 등록";
    const form = $id("hyundaiForm");
    if (form) form.reset();
    setVal("hyundaiPenaltyRate", 3);
    setVal("hyundaiUnit",        "ea");
    const codeInput = $id("hyundaiCode");
    if (codeInput) codeInput.readOnly = false;
  }

  modal.style.display = "flex";
}

function closeHyundaiModal() {
  const modal = $id("hyundaiModal");
  if (modal) modal.style.display = "none";
  editTargetId = null;
}

async function handleHyundaiFormSubmit(e) {
  e.preventDefault();

  const body = {
    code:        getVal("hyundaiCode"),
    name:        getVal("hyundaiName"),
    category:    getVal("hyundaiCategory") || "원자재",
    unit:        getVal("hyundaiUnit")     || "ea",
    qty:         Number(getVal("hyundaiQty")         || 0),
    unitPrice:   Number(getVal("hyundaiUnitPrice")   || 0),
    penaltyRate: Number(getVal("hyundaiPenaltyRate") || 3),
    location:    getVal("hyundaiLocation"),
    spec:        getVal("hyundaiSpec"),
    note:        getVal("hyundaiNote"),
  };

  // 기본 검증
  if (!body.code) { showToast("코드는 필수입니다.", true); return; }
  if (!body.name) { showToast("자재명은 필수입니다.", true); return; }
  if (body.unitPrice < 0) { showToast("단가는 0 이상이어야 합니다.", true); return; }
  if (body.penaltyRate < 1) { showToast("패널티 배율은 1 이상이어야 합니다.", true); return; }

  try {
    if (editTargetId) {
      await apiPut(`/hyundai/products/${editTargetId}`, body);
      showToast("현대 자재가 수정되었습니다.");
    } else {
      await apiPost("/hyundai/products", body);
      showToast("현대 자재가 등록되었습니다.");
    }
    closeHyundaiModal();
    await loadHyundaiList();
  } catch (err) {
    showToast(err.message || "저장 실패", true);
  }
}

// ─────────────────────── 삭제 ────────────────────────────────

async function handleDelete(id) {
  const target = hyundaiList.find(p => p.id === id);
  if (!target) return;

  if (!confirm(`[현대자재] "${target.name}" (${target.code})을(를) 삭제하시겠습니까?`)) return;

  try {
    await apiDelete(`/hyundai/products/${id}`);
    showToast("삭제되었습니다.");
    await loadHyundaiList();
  } catch (err) {
    showToast(err.message || "삭제 실패", true);
  }
}

// ─────────────────────── 재고 조정 모달 ─────────────────────

let adjustTargetId = null;

function openAdjustModal(id) {
  adjustTargetId = id;
  const target = hyundaiList.find(p => p.id === id);
  if (!target) return;

  const modal = $id("hyundaiAdjustModal");
  if (!modal) return;

  setText("hyundaiAdjustProductName", `${target.code} - ${target.name}`);
  setText("hyundaiAdjustCurrentQty",  `현재 재고: ${target.qty} ${target.unit}`);
  setText("hyundaiAdjustPenaltyInfo",
    `패널티 단가: ${target.penaltyPrice.toLocaleString("ko-KR")}원 (단가 × ${target.penaltyRate}배)`);

  const form = $id("hyundaiAdjustForm");
  if (form) form.reset();
  setVal("hyundaiAdjustType", "IN");

  // 패널티 금액 초기화
  const penaltyAmtEl = $id("hyundaiAdjustPenaltyAmt");
  if (penaltyAmtEl) penaltyAmtEl.textContent = "";

  modal.style.display = "flex";
}

function closeAdjustModal() {
  const modal = $id("hyundaiAdjustModal");
  if (modal) modal.style.display = "none";
  adjustTargetId = null;
}

function updatePenaltyDisplay() {
  const target  = hyundaiList.find(p => p.id === adjustTargetId);
  if (!target) return;

  const isLost  = $id("hyundaiAdjustIsLost")?.checked;
  const delta   = Math.abs(Number($id("hyundaiAdjustDelta")?.value || 0));
  const penalty = isLost ? delta * target.unitPrice * target.penaltyRate : 0;

  const el = $id("hyundaiAdjustPenaltyAmt");
  if (el) {
    el.textContent = isLost
      ? `패널티 금액: ${penalty.toLocaleString("ko-KR")}원`
      : "";
    el.style.color = "#dc2626";
  }
}

async function handleAdjustSubmit(e) {
  e.preventDefault();

  const type    = getVal("hyundaiAdjustType");
  const delta   = Number(getVal("hyundaiAdjustDelta") || 0);
  const memo    = getVal("hyundaiAdjustMemo");
  const isLost  = $id("hyundaiAdjustIsLost")?.checked ?? false;

  if (!delta || delta === 0) {
    showToast("수량을 입력하세요.", true);
    return;
  }

  try {
    await apiPost(`/hyundai/products/${adjustTargetId}/adjust`, {
      type, delta, memo, isLost,
    });
    showToast(`재고 ${type} 처리 완료`);
    closeAdjustModal();
    await loadHyundaiList();
  } catch (err) {
    showToast(err.message || "재고 조정 실패", true);
  }
}

// ─────────────────────── 유틸 ────────────────────────────────

function getVal(id) {
  return ($id(id)?.value || "").trim();
}
function setVal(id, val) {
  const el = $id(id);
  if (el) el.value = val ?? "";
}
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
