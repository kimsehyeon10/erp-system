/**
 * barcode.js  ―  ERP v6 (UI 즉시 반영 수정판)
 *
 * 수정 사항:
 *  ① onApply() 완료 후 window.loadInventoryPage(true) / window.loadHistoryPage()
 *    호출 시 await 보장 및 force=true 전달
 *  ② window.refreshBarcodeProduct 등록
 *    → socket.js syncAllTabs() 에서 호출할 수 있도록 노출
 *    → 현재 바코드 탭에 상품이 조회된 상태라면 최신 재고로 즉시 갱신
 *  ③ erp:inventoryUpdate CustomEvent 리스너 유지 (내부 이벤트용)
 *  ④ 탭 전환 시 기존 조회 결과 유지 (초기화하지 않음)
 */

import { apiGet, apiPost } from "./api.js";
import { showToast } from "./utils.js";

let currentProduct = null;

function el(id) {
  return document.getElementById(id);
}

function renderProduct(p) {
  const resultDiv      = el("barcodeResult");
  const imageContainer = el("barcodeImageContainer");
  const barcodeCanvas  = el("barcodeCanvas");
  const barcodeLabel   = el("barcodeLabel");

  if (!p) {
    if (resultDiv)      resultDiv.innerHTML = "";
    if (imageContainer) imageContainer.style.display = "none";
    if (barcodeCanvas)  barcodeCanvas.innerHTML = "";
    if (barcodeLabel)   barcodeLabel.textContent = "";
    return;
  }

  const unit      = p.unit      || "ea";
  const location  = p.location  || "-";
  const barcode   = p.barcode   || p.code || "-";
  const condition = p.condition === "used" ? "중고" : "신품";
  const type      = p.productType === "bom" ? "BOM" : "기성품";

  if (resultDiv) {
    resultDiv.innerHTML = `
      <div style="font-weight:700; margin-bottom:6px; font-size:16px;">${p.name}</div>
      <div style="font-size:14px; line-height:1.6;">
        <strong>코드:</strong> ${p.code} | <strong>바코드:</strong> ${barcode}<br/>
        <strong>재고:</strong> ${p.qty} ${unit} | <strong>위치:</strong> ${location}<br/>
        <strong>상태:</strong> ${condition} | <strong>유형:</strong> ${type}
      </div>
    `;
  }

  // 📊 바코드 이미지 생성
  try {
    if (typeof JsBarcode === "undefined") {
      console.warn("⚠️  JsBarcode 라이브러리가 로드되지 않았습니다.");
      if (imageContainer) imageContainer.style.display = "none";
      return;
    }

    if (!imageContainer || !barcodeCanvas || !barcodeLabel) {
      console.warn("⚠️  바코드 UI 엘리먼트가 없습니다.");
      return;
    }

    imageContainer.style.display = "block";

    JsBarcode(barcodeCanvas, barcode, {
      format:       "CODE128",
      width:        3,
      height:       100,
      displayValue: false,
      margin:       15,
      background:   "#ffffff",
      lineColor:    "#000000",
    });

    barcodeLabel.textContent = barcode;
  } catch (error) {
    console.error("❌ 바코드 생성 오류:", error);
    if (imageContainer) imageContainer.style.display = "none";
    showToast("바코드 이미지 생성 실패", true);
  }
}

async function onSearch() {
  const barcodeInput = el("barcodeInput");
  if (!barcodeInput) return;

  const barcode = barcodeInput.value.trim();
  if (!barcode) return;

  try {
    const data = await apiGet(`/products/barcode/${encodeURIComponent(barcode)}`);
    if (!data.ok) throw new Error(data.message || "바코드 조회 실패");

    currentProduct = data.product;
    renderProduct(currentProduct);
    showToast("✅ 상품 조회 완료");
  } catch (e) {
    currentProduct = null;
    renderProduct(null);
    showToast(e.message || "조회 실패", true);
  }
}

async function onApply() {
  if (!currentProduct) {
    showToast("먼저 바코드로 상품을 조회하세요.", true);
    return;
  }

  const type  = el("barcodeActionType")?.value;
  const delta = Number(el("barcodeDelta")?.value);
  const memo  = (el("barcodeMemo")?.value || "").trim();

  if (!Number.isFinite(delta) || delta === 0) {
    showToast("수량(delta)을 올바르게 입력하세요. (0 불가)", true);
    return;
  }

  // 적용 버튼 비활성화 (중복 클릭 방지)
  const applyBtn = el("barcodeApplyBtn");
  if (applyBtn) applyBtn.disabled = true;

  try {
    const payload = {
      productCode: currentProduct.code,
      type,
      delta,
      memo,
    };

    const data = await apiPost("/products/adjust", payload);
    if (!data.ok) throw new Error(data.message || "재고 반영 실패");

    showToast("✅ 적용 완료");

    // ① 바코드 탭: 현재 상품 최신 재고 즉시 갱신
    const refreshed = await apiGet(
      `/products/barcode/${encodeURIComponent(currentProduct.barcode || currentProduct.code)}`
    );
    if (refreshed.ok) {
      currentProduct = refreshed.product;
      renderProduct(currentProduct);
    }

    // 입력 필드 초기화
    const deltaInput = el("barcodeDelta");
    const memoInput  = el("barcodeMemo");
    if (deltaInput) deltaInput.value = "";
    if (memoInput)  memoInput.value  = "";

    // ② 다른 탭 force=true 로 캐시 무효화 후 즉시 재조회
    //    - loadInventoryPage(true) : 재고 관리 탭 최신화
    //    - loadHistoryPage()       : 이력 탭 최신화 (항상 fetch)
    //    - loadDashboard()         : 대시보드 최신화
    if (typeof window.loadInventoryPage === "function") {
      await window.loadInventoryPage(true);
    }
    if (typeof window.loadHistoryPage === "function") {
      await window.loadHistoryPage();
    }
    if (typeof window.loadDashboard === "function") {
      await window.loadDashboard();
    }
  } catch (e) {
    showToast(e.message || "적용 실패", true);
  } finally {
    if (applyBtn) applyBtn.disabled = false;
  }
}

function onClear() {
  currentProduct = null;
  const barcodeInput = el("barcodeInput");
  const deltaInput   = el("barcodeDelta");
  const memoInput    = el("barcodeMemo");

  if (barcodeInput) barcodeInput.value = "";
  if (deltaInput)   deltaInput.value   = "";
  if (memoInput)    memoInput.value    = "";
  renderProduct(null);
}

function bind() {
  const input     = el("barcodeInput");
  const btnSearch = el("barcodeSearchBtn");
  const btnApply  = el("barcodeApplyBtn");
  const btnClear  = el("barcodeClearBtn");

  if (!input || !btnSearch || !btnApply || !btnClear) {
    console.warn("⚠️  바코드 탭 UI 엘리먼트를 찾을 수 없습니다.");
    return;
  }

  btnSearch.addEventListener("click", onSearch);

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onSearch();
    }
  });

  // 입력 즉시 조회(디바운스): 스캐너/타이핑 모두 대응
  let debounceTimer = null;
  input.addEventListener("input", () => {
    const v = input.value.trim();
    if (debounceTimer) clearTimeout(debounceTimer);
    if (v.length < 3) return;
    debounceTimer = setTimeout(() => onSearch(), 200);
  });

  btnApply.addEventListener("click", onApply);
  btnClear.addEventListener("click", onClear);
}

document.addEventListener("DOMContentLoaded", bind);

// ─────────────────────────────────────────────────────────────
//  window.refreshBarcodeProduct
//  socket.js syncAllTabs() 에서 호출하여 바코드 탭 즉시 갱신
//  - 현재 상품이 조회된 상태(currentProduct != null)일 때만 재조회
//  - 바코드 탭이 비어있으면 아무 작업도 하지 않음
// ─────────────────────────────────────────────────────────────
window.refreshBarcodeProduct = async function () {
  if (!currentProduct) return; // 조회된 상품이 없으면 아무것도 안 함

  try {
    const input = el("barcodeInput");
    const query = (input && input.value.trim()) || currentProduct.barcode || currentProduct.code;
    if (!query) return;

    const res = await apiGet(`/products/barcode/${encodeURIComponent(query)}`);
    if (res && res.ok && res.product) {
      currentProduct = res.product;
      renderProduct(currentProduct);
    }
  } catch {
    // 실시간 갱신 실패는 조용히 무시
  }
};

// erp:inventoryUpdate CustomEvent 리스너 (내부 이벤트 / 레거시 호환)
window.addEventListener("erp:inventoryUpdate", async () => {
  await window.refreshBarcodeProduct();
});
