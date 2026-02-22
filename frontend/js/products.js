/**
 * products.js  ―  ERP v6 프론트엔드 (엑셀 I/O 개선판)
 *
 * 변경 사항 (엑셀 기능만):
 *  - handleExportExcel : 진행 중 토스트 + 완료/실패 메시지 개선
 *  - handleImportExcel : 파일 크기 사전 검증 + 진행 중 UI + 결과 메시지 상세화
 *  - 가져오기 모드 선택 UI: confirm() → 명확한 다이얼로그 텍스트
 *  - import 응답 필드 통일: created/updated/adjusted (서버와 동일)
 */

import { apiGet, apiPost, apiPut, apiDelete, API_BASE_URL } from "./api.js";
import { showToast, badgeStatus, fmtMoney, showConfirm } from "./utils.js";
import { loadDashboard } from "./dashboard.js";
import { loadInventoryPage, showProductDetailModal } from "./inventory.js";
import { loadHistoryPage } from "./history.js";

let cachedProducts = [];
let pendingImageDataUrl = "";

function getUser() {
  try { return JSON.parse(localStorage.getItem("authUser") || "{}"); }
  catch { return {}; }
}

function canEdit() {
  const u = getUser(); return u.role === "admin" || u.role === "manager";
}
function canDelete() {
  const u = getUser(); return u.role === "admin";
}
function canViewPrice() {
  const u = getUser(); return u.role === "admin" || u.role === "manager";
}

function openImageModal(product) {
  const modal = document.getElementById("imageModal");
  document.getElementById("imageModalTitle").textContent = `${product.code} - ${product.name}`;
  document.getElementById("imageModalImg").src = product.image || "";
  modal.classList.add("active");
}
function closeImageModal() {
  document.getElementById("imageModal").classList.remove("active");
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload  = () => resolve(fr.result);
    fr.onerror = () => reject(new Error("이미지 읽기 실패"));
    fr.readAsDataURL(file);
  });
}

function el(id) { return document.getElementById(id); }

/** BOM UI */
function setBomVisible(isBom) {
  const box = el("bomBox");
  box.style.display = isBom ? "block" : "none";
  if (!isBom) el("bomTableBody").innerHTML = "";
}

function addBomRow(item = { code: "", qty: 1 }) {
  const tbody = el("bomTableBody");
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td><input class="bom-code" type="text" placeholder="구성품 코드" value="${item.code || ""}"/></td>
    <td><input class="bom-qty" type="number" min="1" value="${Number(item.qty || 1)}"/></td>
    <td><button type="button" class="btn-cancel bom-remove">삭제</button></td>
  `;
  tr.querySelector(".bom-remove").addEventListener("click", () => tr.remove());
  tbody.appendChild(tr);
}

function collectBomItems() {
  const rows  = Array.from(el("bomTableBody").querySelectorAll("tr"));
  const items = [];
  for (const tr of rows) {
    const code = (tr.querySelector(".bom-code")?.value || "").trim();
    const qty  = Number(tr.querySelector(".bom-qty")?.value || 0);
    if (!code) continue;
    if (!Number.isFinite(qty) || qty <= 0) continue;
    items.push({ code, qty });
  }
  return items;
}

async function fetchProducts() {
  const data     = await apiGet("/products");
  cachedProducts = data.products || [];
}

function applySearch(term) {
  const t        = (term || "").toLowerCase();
  const filtered = cachedProducts.filter(p => {
    const s = `${p.code} ${p.name} ${p.category || ""} ${p.location || ""} ${p.barcode || ""}`.toLowerCase();
    return s.includes(t);
  });
  renderTable(filtered);
}

function openModal(mode, product = null) {
  const modal = el("productModal");
  modal.classList.add("active");
  el("productMode").value = mode;
  pendingImageDataUrl = "";
  el("productImageFile").value = "";
  el("productType").onchange = () => setBomVisible(el("productType").value === "bom");
  el("addBomRowBtn").onclick  = () => addBomRow();

  if (mode === "create") {
    el("productModalTitle").textContent = "상품 추가";
    el("productCode").value    = "";
    el("productCode").disabled = false;
    el("productName").value        = "";
    el("productCategory").value    = "";
    el("productUnit").value        = "ea";
    el("productBarcode").value     = "";
    el("productLocation").value    = "";
    el("productSpec").value        = "";
    el("productDescription").value = "";
    el("productCondition").value   = "new";
    el("productType").value        = "standard";
    setBomVisible(false);
    el("productPrice").value       = 0;
    el("productSafetyStock").value = 10;
    el("productQty").value         = 0;
  } else {
    el("productModalTitle").textContent = "상품 수정";
    el("productCode").value    = product.code;
    el("productCode").disabled = true;
    el("productName").value        = product.name        || "";
    el("productCategory").value    = product.category    || "";
    el("productUnit").value        = product.unit        || "ea";
    el("productBarcode").value     = product.barcode     || "";
    el("productLocation").value    = product.location    || "";
    el("productSpec").value        = product.spec        || "";
    el("productDescription").value = product.description || "";
    el("productCondition").value   = product.condition === "used" ? "used" : "new";
    el("productType").value        = product.type === "bom" ? "bom" : "standard";
    setBomVisible(el("productType").value === "bom");
    if (el("productType").value === "bom") {
      el("bomTableBody").innerHTML = "";
      const items = Array.isArray(product.bomItems) ? product.bomItems : [];
      if (items.length === 0) addBomRow();
      else items.forEach(it => addBomRow({ code: it.code, qty: it.qty }));
    }
    el("productPrice").value       = canViewPrice() ? (product.price || 0) : 0;
    el("productSafetyStock").value = product.safetyStock ?? 10;
    el("productQty").value         = product.qty ?? 0;
  }
  el("productPrice").disabled = !canViewPrice();
}

function closeModal() { el("productModal").classList.remove("active"); }

function badgeTextCondition(p) { return p.condition === "used" ? "중고" : "신품"; }
function badgeTextType(p)      { return p.type === "bom" ? "BOM" : "기성품"; }

async function renderTable(products) {
  const tbody = el("productTableBody");
  tbody.innerHTML = "";

  products.forEach(p => {
    const status    = badgeStatus(Number(p.qty || 0), Number(p.safetyStock || 0));
    const hasImg    = !!(p.image && p.image.length > 20);
    const imgHtml   = hasImg
      ? `<img class="thumb" data-action="img" data-code="${p.code}" src="${p.image}" alt="img"/>`
      : `<img class="thumb empty" src="" alt="noimg"/>`;
    const priceText = canViewPrice() ? fmtMoney(Number(p.price || 0)) : "-";
    const unitText  = ((p.unit || "ea") + "").toUpperCase();

    const categoryClass = `category-${(p.category || "기타").replace(/\s/g, "")}`;
    const categoryBadge = p.category
      ? `<span class="category-badge ${categoryClass}">${p.category}</span>`
      : `<span class="category-badge">-</span>`;

    const condBadge = `<span class="badge">${badgeTextCondition(p)}</span>`;
    const typeBadge = `<span class="badge">${badgeTextType(p)}</span>`;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${imgHtml}</td>
      <td>${p.barcode || "-"}</td>
      <td>${p.name}</td>
      <td>${categoryBadge}</td>
      <td>${unitText}</td>
      <td>${p.location || "-"}</td>
      <td>${condBadge}</td>
      <td>${typeBadge}</td>
      <td>${priceText}</td>
      <td>${Number(p.qty || 0)}</td>
      <td><span class="badge ${status.cls}">${status.text}</span></td>
      <td class="action-btns">
        <button class="btn-edit"   data-action="edit" data-code="${p.code}">수정</button>
        <button class="btn-delete" data-action="del"  data-code="${p.code}">삭제</button>
      </td>
    `;

    tr.style.cursor = "pointer";
    tr.addEventListener("click", e => {
      if (e.target.closest("button") || e.target.closest('[data-action="img"]')) return;
      showProductDetailModal(p);
    });

    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("[data-action]").forEach(node => {
    const act     = node.getAttribute("data-action");
    const code    = node.getAttribute("data-code");
    const product = cachedProducts.find(x => x.code === code);
    if (!product) return;

    if (act === "img")  node.addEventListener("click", () => openImageModal(product));

    if (act === "edit") node.addEventListener("click", () => {
      if (!canEdit()) { showToast("수정 권한이 없습니다(admin/manager만 가능).", true); return; }
      openModal("update", product);
    });

    if (act === "del")  node.addEventListener("click", async () => {
      if (!canDelete()) { showToast("삭제 권한이 없습니다(admin만 가능).", true); return; }
      const confirmed = await showConfirm(
        `상품 "${product.name}" (${product.code})을(를) 정말 삭제하시겠습니까?\n\n이 작업은 되돌릴 수 없습니다.`,
        "⚠️ 상품 삭제"
      );
      if (!confirmed) return;
      try {
        await apiDelete(`/products/${product.code}`);
        showToast("삭제 완료");
        await loadProductsPage(true);
        await loadInventoryPage(true);
        await loadHistoryPage(true);
        await loadDashboard();
      } catch (err) { showToast(err.message, true); }
    });
  });

  if (!canDelete()) tbody.querySelectorAll(".btn-del").forEach(b => (b.style.display = "none"));
}

async function handleSubmit(e) {
  e.preventDefault();
  if (!canEdit()) { showToast("상품 저장 권한이 없습니다(admin/manager만 가능).", true); return; }

  const mode = el("productMode").value;
  const code = el("productCode").value.trim();
  const name = el("productName").value.trim();

  const category    = el("productCategory").value.trim();
  const unit        = el("productUnit").value;
  const barcode     = el("productBarcode").value.trim();
  const location    = el("productLocation").value.trim();
  const spec        = el("productSpec").value.trim();
  const description = el("productDescription").value.trim();
  const condition   = el("productCondition").value;
  const type        = el("productType").value;
  const bomItems    = type === "bom" ? collectBomItems() : [];
  const price       = Number(el("productPrice").value || 0);
  const safetyStock = Number(el("productSafetyStock").value || 0);
  const qty         = Number(el("productQty").value || 0);

  if (!code || !name) { showToast("상품코드/상품명은 필수입니다.", true); return; }

  if (barcode) {
    const isDuplicate = cachedProducts.some(p => p.barcode === barcode && p.code !== code);
    if (isDuplicate) { showToast("이미 사용 중인 바코드는 등록할 수 없습니다.", true); return; }
  }

  const imgFile = el("productImageFile").files[0];
  if (imgFile) {
    try { pendingImageDataUrl = await readFileAsDataURL(imgFile); }
    catch (err) { showToast(err.message, true); return; }
  }

  try {
    if (mode === "create") {
      if (barcode) {
        try {
          const chk = await apiGet(`/products/check-barcode/${encodeURIComponent(barcode)}`);
          if (chk && chk.ok && chk.available === false) {
            showToast("이미 사용 중인 바코드는 등록할 수 없습니다.", true);
            el("productBarcode").focus(); el("productBarcode").select(); return;
          }
        } catch { /* 폴백 */ }
      }
      const body   = { code, name, category, unit, price, safetyStock, qty,
                       image: pendingImageDataUrl, barcode, location, spec, description, condition, type, bomItems };
      const result = await apiPost("/products", body);
      if (!result.ok) {
        if (result.message && result.message.includes("바코드")) {
          showToast(`❌ ${result.message}`, true);
          el("productBarcode").focus(); el("productBarcode").select(); return;
        }
        throw new Error(result.message || "상품 추가 실패");
      }
      showToast("✅ 상품 추가 완료");
    } else {
      if (barcode) {
        try {
          const chk = await apiGet(`/products/check-barcode/${encodeURIComponent(barcode)}?excludeCode=${encodeURIComponent(code)}`);
          if (chk && chk.ok && chk.available === false) {
            showToast("이미 사용 중인 바코드는 등록할 수 없습니다.", true);
            el("productBarcode").focus(); el("productBarcode").select(); return;
          }
        } catch { /* 폴백 */ }
      }
      const body = { name, category, unit, safetyStock, barcode, location, spec, description, condition, type, bomItems, qty };
      if (canViewPrice()) body.price = price;
      if (pendingImageDataUrl) body.image = pendingImageDataUrl;
      const result = await apiPut(`/products/${code}`, body);
      if (!result.ok) {
        if (result.message && result.message.includes("바코드")) {
          showToast(`❌ ${result.message}`, true);
          el("productBarcode").focus(); el("productBarcode").select(); return;
        }
        throw new Error(result.message || "상품 수정 실패");
      }
      showToast("✅ 상품 수정 완료");
    }

    closeModal();
    await loadProductsPage(true);
    await loadInventoryPage(true);
    await loadHistoryPage(true);
    await loadDashboard();
  } catch (err) { showToast(`❌ ${err.message}`, true); }
}

// ═══════════════════════════════════════════════════════
//  엑셀 내보내기 (EXPORT)
//  - 진행 중 토스트 표시
//  - 완료 후 파일명에 날짜 포함
//  - 실패 시 서버 에러 메시지 표시
// ═══════════════════════════════════════════════════════
async function handleExportExcel() {
  const user = getUser();
  if (!user.username) { showToast("로그인이 필요합니다.", true); return; }

  showToast("⏳ 엑셀 파일 생성 중... 이미지 포함 시 수 초 소요될 수 있습니다.", false);

  try {
    const res = await fetch(`${API_BASE_URL}/products/export.xlsx`, {
      method:  "GET",
      headers: { "x-user": user.username, "x-role": user.role },
    });

    if (!res.ok) {
      let msg = "엑셀 내보내기 실패";
      try { const j = await res.json(); msg = j.message || msg; } catch { msg = await res.text() || msg; }
      showToast(`❌ ${msg}`, true);
      return;
    }

    const blob = await res.blob();

    // 파일명에 날짜 포함: products_2025-01-15.xlsx
    const today    = new Date().toISOString().slice(0, 10);
    const filename = `products_${today}.xlsx`;

    const url = window.URL.createObjectURL(blob);
    const a   = document.createElement("a");
    a.href     = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);

    showToast(`✅ 엑셀 내보내기 완료 (${filename})`);
  } catch (err) {
    showToast(`❌ 엑셀 내보내기 실패: ${err.message}`, true);
  }
}

// ═══════════════════════════════════════════════════════
//  엑셀 가져오기 (IMPORT)
//  - 파일 크기 사전 검증 (50MB 제한)
//  - 진행 중 버튼 비활성화
//  - 결과 메시지 상세화 (신규/수정/수량조정 건수)
//  - 서버 응답 필드: created / updated / adjusted
// ═══════════════════════════════════════════════════════
async function handleImportExcel(file, mode) {
  const user = getUser();
  if (!user.username) { showToast("로그인이 필요합니다.", true); return; }

  // 파일 크기 사전 검증 (50MB)
  const MAX_SIZE = 50 * 1024 * 1024;
  if (file.size > MAX_SIZE) {
    showToast("❌ 파일 크기가 너무 큽니다 (최대 50MB).", true);
    return;
  }

  // 확장자 검증
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    showToast("❌ .xlsx 파일만 가져올 수 있습니다.", true);
    return;
  }

  showToast(`⏳ 엑셀 가져오는 중 (${mode} 모드)... 잠시 기다려 주세요.`, false);

  // 가져오기 버튼 비활성화 (중복 클릭 방지)
  const importBtn = el("importExcelBtn");
  if (importBtn) importBtn.disabled = true;

  try {
    const base64 = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        const dataUrl  = String(fr.result || "");
        const commaIdx = dataUrl.indexOf(",");
        if (commaIdx === -1) return reject(new Error("파일 읽기 실패"));
        resolve(dataUrl.slice(commaIdx + 1));
      };
      fr.onerror = () => reject(new Error("파일 읽기 실패"));
      fr.readAsDataURL(file);
    });

    const res = await fetch(`${API_BASE_URL}/products/import?mode=${encodeURIComponent(mode)}`, {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user":       user.username,
        "x-role":       user.role,
      },
      body: JSON.stringify({ base64 }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok || !data.ok) {
      showToast(`❌ ${data.message || "엑셀 가져오기 실패"}`, true);
      return;
    }

    // 결과 메시지 상세화
    const created  = data.created  || 0;
    const updated  = data.updated  || 0;
    const adjusted = data.adjusted || 0;

    let resultMsg = `✅ 엑셀 가져오기 완료 (${mode} 모드)`;
    const details = [];
    if (created  > 0) details.push(`신규 ${created}건`);
    if (updated  > 0) details.push(`수정 ${updated}건`);
    if (adjusted > 0) details.push(`수량조정 ${adjusted}건`);
    if (details.length > 0) resultMsg += ` — ${details.join(", ")}`;

    showToast(resultMsg);

    await loadProductsPage(true);
    await loadInventoryPage(true);
    await loadHistoryPage(true);
    await loadDashboard();
  } catch (err) {
    showToast(`❌ ${err.message || "엑셀 가져오기 실패"}`, true);
  } finally {
    if (importBtn) importBtn.disabled = false;
  }
}

export async function loadProductsPage(force = false) {
  try {
    if (force || cachedProducts.length === 0) await fetchProducts();
    renderTable(cachedProducts);

    el("productSearch").oninput = () => applySearch(el("productSearch").value);

    el("openAddProductBtn").onclick = () => {
      if (!canEdit()) { showToast("추가 권한이 없습니다(admin/manager만 가능).", true); return; }
      openModal("create", null);
    };

    el("closeProductModal").onclick  = closeModal;
    el("cancelProductModal").onclick = closeModal;
    el("productForm").onsubmit       = handleSubmit;

    el("closeImageModal").onclick = closeImageModal;
    el("imageModal").addEventListener("click", e => {
      if (e.target && e.target.id === "imageModal") closeImageModal();
    });

    el("exportExcelBtn").onclick = handleExportExcel;

    const input = el("excelFileInput");
    el("importExcelBtn").onclick = () => {
      if (!canEdit()) { showToast("엑셀 가져오기는 admin/manager만 가능합니다.", true); return; }
      input.value = "";
      input.click();
    };

    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;

      // 모드 선택 다이얼로그 개선
      const confirmed = confirm(
        "【엑셀 가져오기 모드 선택】\n\n" +
        "✅ 확인  →  Merge(병합) 모드\n" +
        "    동일 코드는 업데이트, 없는 코드는 신규 추가합니다.\n" +
        "    기존 상품은 보존됩니다.\n\n" +
        "❌ 취소  →  Replace(전체 교체) 모드\n" +
        "    기존 상품 전체를 삭제하고 엑셀 내용으로 교체합니다.\n" +
        "    ⚠️ 되돌릴 수 없습니다!"
      );
      const mode = confirmed ? "merge" : "replace";

      if (mode === "replace") {
        const confirm2 = confirm("⚠️ 경고: Replace 모드는 기존 상품 전체를 삭제합니다.\n정말 계속하시겠습니까?");
        if (!confirm2) {
          showToast("가져오기 취소됨", false);
          return;
        }
      }

      await handleImportExcel(file, mode);
    };
  } catch (err) {
    showToast(err.message, true);
  }
}

// 이미지 미리보기 기능
document.addEventListener("DOMContentLoaded", () => {
  const imageFileInput        = document.getElementById("productImageFile");
  const imagePreviewContainer = document.getElementById("imagePreviewContainer");
  const imagePreview          = document.getElementById("imagePreview");

  if (imageFileInput && imagePreviewContainer && imagePreview) {
    imageFileInput.addEventListener("change", async e => {
      const file = e.target.files[0];
      if (!file) { imagePreviewContainer.style.display = "none"; return; }
      try {
        const dataUrl = await readFileAsDataURL(file);
        imagePreview.src = dataUrl;
        imagePreviewContainer.style.display = "block";
      } catch {
        imagePreviewContainer.style.display = "none";
      }
    });
  }
});

// Backward-compatible: expose for non-module callers
window.loadProductsPage = loadProductsPage;
