import { apiGet, apiPost } from "./api.js";
import { showToast } from "./utils.js";

let currentProduct = null;

function el(id) {
  return document.getElementById(id);
}

function renderProduct(p) {
  if (!p) {
    el("barcodeResult").innerHTML = "";
    return;
  }

  const unit = p.unit || "ea";
  const location = p.location || "-";
  const barcode = p.barcode || "-";
  const condition = p.condition === "used" ? "중고" : "신품";
  const type = p.type === "bom" ? "BOM" : "기성품";

  el("barcodeResult").innerHTML = `
    <div style="font-weight:700; margin-bottom:6px;">${p.name}</div>
    <div style="font-size:14px;">
      코드: ${p.code} | 바코드: ${barcode}<br/>
      재고: ${p.qty} ${unit} | 위치: ${location}<br/>
      상태: ${condition} | 유형: ${type}
    </div>
  `;
}

async function onSearch() {
  const barcode = (el("barcodeInput").value || "").trim();
  if (!barcode) {
    showToast("바코드를 입력하세요.", true);
    return;
  }

  try {
    const data = await apiGet(`/products/barcode/${encodeURIComponent(barcode)}`);
    if (!data.ok) throw new Error(data.message || "바코드 조회 실패");

    currentProduct = data.product;
    renderProduct(currentProduct);
    showToast("상품 조회 완료");
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

  const type = el("barcodeActionType").value;
  const delta = Number(el("barcodeDelta").value);
  const memo = (el("barcodeMemo").value || "").trim();

  if (!Number.isFinite(delta) || delta === 0) {
    showToast("수량(delta)을 올바르게 입력하세요. (0 불가)", true);
    return;
  }

  try {
    const payload = {
      productCode: currentProduct.code,
      type,
      delta,
      memo,
    };

    const data = await apiPost("/products/adjust", payload);
    if (!data.ok) throw new Error(data.message || "재고 반영 실패");

    showToast("적용 완료");

    // 최신 상태 재조회
    const refreshed = await apiGet(`/products/barcode/${encodeURIComponent(currentProduct.barcode)}`);
    if (refreshed.ok) {
      currentProduct = refreshed.product;
      renderProduct(currentProduct);
    }

    el("barcodeDelta").value = "";
    el("barcodeMemo").value = "";
  } catch (e) {
    showToast(e.message || "적용 실패", true);
  }
}

function onClear() {
  currentProduct = null;
  el("barcodeInput").value = "";
  el("barcodeDelta").value = "";
  el("barcodeMemo").value = "";
  renderProduct(null);
}

function bind() {
  const input = el("barcodeInput");
  const btnSearch = el("barcodeSearchBtn");
  const btnApply = el("barcodeApplyBtn");
  const btnClear = el("barcodeClearBtn");

  if (!input || !btnSearch || !btnApply || !btnClear) return;

  btnSearch.addEventListener("click", onSearch);

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      onSearch();
    }
  });

  btnApply.addEventListener("click", onApply);
  btnClear.addEventListener("click", onClear);
}

document.addEventListener("DOMContentLoaded", bind);
