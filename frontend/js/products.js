import { apiGet, apiPost, apiPut, apiDelete, API_BASE_URL } from "./api.js";
import { showToast, badgeStatus, fmtMoney } from "./utils.js";
import { loadDashboard } from "./dashboard.js";
import { loadInventoryPage } from "./inventory.js";
import { loadHistoryPage } from "./history.js";

let cachedProducts = [];
let pendingImageDataUrl = "";

function getUser() {
  try {
    return JSON.parse(localStorage.getItem("authUser") || "{}");
  } catch {
    return {};
  }
}

function canEdit() {
  const user = getUser();
  return user.role === "admin" || user.role === "manager";
}
function canDelete() {
  const user = getUser();
  return user.role === "admin";
}
function canViewPrice() {
  const user = getUser();
  return user.role === "admin" || user.role === "manager";
}

function openImageModal(product) {
  const modal = document.getElementById("imageModal");
  const title = document.getElementById("imageModalTitle");
  const img = document.getElementById("imageModalImg");

  title.textContent = `${product.code} - ${product.name}`;
  img.src = product.image || "";
  modal.classList.add("active");
}
function closeImageModal() {
  document.getElementById("imageModal").classList.remove("active");
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error("이미지 읽기 실패"));
    fr.readAsDataURL(file);
  });
}

function el(id) {
  return document.getElementById(id);
}

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
  const rows = Array.from(el("bomTableBody").querySelectorAll("tr"));
  const items = [];
  for (const tr of rows) {
    const code = (tr.querySelector(".bom-code")?.value || "").trim();
    const qty = Number(tr.querySelector(".bom-qty")?.value || 0);
    if (!code) continue;
    if (!Number.isFinite(qty) || qty <= 0) continue;
    items.push({ code, qty });
  }
  return items;
}

async function fetchProducts() {
  const data = await apiGet("/products");
  cachedProducts = data.products || [];
}

function applySearch(term) {
  const t = (term || "").toLowerCase();
  const filtered = cachedProducts.filter((p) => {
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
  el("addBomRowBtn").onclick = () => addBomRow();

  if (mode === "create") {
    el("productModalTitle").textContent = "상품 추가";
    el("productCode").value = "";
    el("productCode").disabled = false;

    el("productName").value = "";
    el("productCategory").value = "";
    el("productUnit").value = "ea";

    el("productBarcode").value = "";
    el("productLocation").value = "";
    el("productSpec").value = "";
    el("productDescription").value = "";
    el("productCondition").value = "new";
    el("productType").value = "standard";
    setBomVisible(false);

    el("productPrice").value = 0;
    el("productSafetyStock").value = 10;
    el("productQty").value = 0;
  } else {
    el("productModalTitle").textContent = "상품 수정";
    el("productCode").value = product.code;
    el("productCode").disabled = true;

    el("productName").value = product.name || "";
    el("productCategory").value = product.category || "";
    el("productUnit").value = product.unit || "ea";

    el("productBarcode").value = product.barcode || "";
    el("productLocation").value = product.location || "";
    el("productSpec").value = product.spec || "";
    el("productDescription").value = product.description || "";
    el("productCondition").value = product.condition === "used" ? "used" : "new";
    el("productType").value = product.type === "bom" ? "bom" : "standard";

    setBomVisible(el("productType").value === "bom");
    if (el("productType").value === "bom") {
      el("bomTableBody").innerHTML = "";
      const items = Array.isArray(product.bomItems) ? product.bomItems : [];
      if (items.length === 0) addBomRow();
      else items.forEach((it) => addBomRow({ code: it.code, qty: it.qty }));
    }

    el("productPrice").value = canViewPrice() ? (product.price || 0) : 0;
    el("productSafetyStock").value = product.safetyStock ?? 10;
    el("productQty").value = product.qty ?? 0;
  }

  el("productPrice").disabled = !canViewPrice();
}

function closeModal() {
  el("productModal").classList.remove("active");
}

function badgeTextCondition(p) {
  return p.condition === "used" ? "중고" : "신품";
}
function badgeTextType(p) {
  return p.type === "bom" ? "BOM" : "기성품";
}

async function renderTable(products) {
  const tbody = el("productTableBody");
  tbody.innerHTML = "";

  products.forEach((p) => {
    const status = badgeStatus(Number(p.qty || 0), Number(p.safetyStock || 0));

    const hasImg = !!(p.image && p.image.length > 20);
    const imgHtml = hasImg
      ? `<img class="thumb" data-action="img" data-code="${p.code}" src="${p.image}" alt="img"/>`
      : `<img class="thumb empty" src="" alt="noimg"/>`;

    const priceText = canViewPrice() ? fmtMoney(Number(p.price || 0)) : "-";
    const unitText = ((p.unit || "ea") + "").toUpperCase();

    const locationText = (p.location || "-");
    const barcodeText = (p.barcode || "-");

    const condBadge = `<span class="badge">${badgeTextCondition(p)}</span>`;
    const typeBadge = `<span class="badge">${badgeTextType(p)}</span>`;

     const categoryClass = `category-${(p.category || "기타").replace(/\s/g, "")}`;
    const categoryBadge = p.category 
      ? `<span class="category-badge ${categoryClass}">${p.category}</span>`
      : `<span class="category-badge">-</span>`;

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${imgHtml}</td>
      <td>${p.code}</td>
      <td>${p.name}</td>
      <td>${categoryBadge}</td>
      <td>${unitText}</td>
      <td>${locationText}</td>
      <td>${barcodeText}</td>
      <td>${condBadge}</td>
      <td>${typeBadge}</td>
      <td>${priceText}</td>
      <td>${Number(p.qty || 0)}</td>
      <td><span class="badge ${status.cls}">${status.text}</span></td>
      <td class="action-btns">
        <button class="btn-edit" data-action="edit" data-code="${p.code}">수정</button>
        <button class="btn-delete" data-action="del" data-code="${p.code}">삭제</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("[data-action]").forEach((node) => {
    const act = node.getAttribute("data-action");
    const code = node.getAttribute("data-code");
    const product = cachedProducts.find((x) => x.code === code);
    if (!product) return;

    if (act === "img") {
      node.addEventListener("click", () => openImageModal(product));
    }

    if (act === "edit") {
      node.addEventListener("click", () => {
        if (!canEdit()) {
          showToast("수정 권한이 없습니다(admin/manager만 가능).", true);
          return;
        }
        openModal("update", product);
      });
    }

    if (act === "del") {
      node.addEventListener("click", async () => {
        if (!canDelete()) {
          showToast("삭제 권한이 없습니다(admin만 가능).", true);
          return;
        }
        if (!confirm(`${product.code} 삭제하시겠습니까?`)) return;

        try {
          await apiDelete(`/products/${product.code}`);
          showToast("삭제 완료");
          await loadProductsPage(true);
          await loadInventoryPage(true);
          await loadHistoryPage(true);
          await loadDashboard();
        } catch (err) {
          showToast(err.message, true);
        }
      });
    }
  });

  if (!canDelete()) {
    tbody.querySelectorAll(".btn-del").forEach((b) => (b.style.display = "none"));
  }
}

async function handleSubmit(e) {
  e.preventDefault();

  if (!canEdit()) {
    showToast("상품 저장 권한이 없습니다(admin/manager만 가능).", true);
    return;
  }

  const mode = el("productMode").value;

  const code = el("productCode").value.trim();
  const name = el("productName").value.trim();
  const category = el("productCategory").value.trim();
  const unit = el("productUnit").value;

  const barcode = el("productBarcode").value.trim();
  const location = el("productLocation").value.trim();
  const spec = el("productSpec").value.trim();
  const description = el("productDescription").value.trim();
  const condition = el("productCondition").value;
  const type = el("productType").value;
  const bomItems = type === "bom" ? collectBomItems() : [];

  const price = Number(el("productPrice").value || 0);
  const safetyStock = Number(el("productSafetyStock").value || 0);
  const qty = Number(el("productQty").value || 0);

  if (!code || !name) {
    showToast("상품코드/상품명은 필수입니다.", true);
    return;
  }

  const imgFile = el("productImageFile").files[0];
  if (imgFile) {
    try {
      pendingImageDataUrl = await readFileAsDataURL(imgFile);
    } catch (err) {
      showToast(err.message, true);
      return;
    }
  }

  try {
    if (mode === "create") {
      const body = {
        code, name, category, unit, price, safetyStock, qty,
        image: pendingImageDataUrl,
        barcode, location, spec, description, condition, type, bomItems
      };

      await apiPost("/products", body);
      showToast("상품 추가 완료");
    } else {
      const body = {
        name, category, unit, safetyStock,
        barcode, location, spec, description, condition, type, bomItems,
        qty
      };

      if (canViewPrice()) body.price = price;
      if (pendingImageDataUrl) body.image = pendingImageDataUrl;

      await apiPut(`/products/${code}`, body);
      showToast("상품 수정 완료");
    }

    closeModal();
    await loadProductsPage(true);
    await loadInventoryPage(true);
    await loadHistoryPage(true);
    await loadDashboard();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function handleExportExcel() {
  try {
    const user = getUser();
    if (!user.username) {
      showToast("로그인이 필요합니다.", true);
      return;
    }

    const res = await fetch(`${API_BASE_URL}/products/export.xlsx`, {
      method: "GET",
      headers: { "x-user": user.username, "x-role": user.role }
    });

    if (!res.ok) {
      const t = await res.text();
      showToast(t || "엑셀 내보내기 실패", true);
      return;
    }

    const blob = await res.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "products.xlsx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  } catch {
    showToast("엑셀 내보내기 실패", true);
  }
}

async function handleImportExcel(file, mode) {
  try {
    const user = getUser();
    if (!user.username) {
      showToast("로그인이 필요합니다.", true);
      return;
    }

    const base64 = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => {
        const dataUrl = String(fr.result || "");
        const commaIdx = dataUrl.indexOf(",");
        if (commaIdx === -1) return reject(new Error("파일 읽기 실패"));
        resolve(dataUrl.slice(commaIdx + 1));
      };
      fr.onerror = () => reject(new Error("파일 읽기 실패"));
      fr.readAsDataURL(file);
    });

    const res = await fetch(`${API_BASE_URL}/products/import?mode=${encodeURIComponent(mode)}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-user": user.username,
        "x-role": user.role
      },
      body: JSON.stringify({ base64 })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      showToast(data.message || "엑셀 가져오기 실패", true);
      return;
    }

    showToast(`엑셀 가져오기 완료 (inserted:${data.inserted}, updated:${data.updated})`);
    await loadProductsPage(true);
    await loadInventoryPage(true);
    await loadHistoryPage(true);
    await loadDashboard();
  } catch (err) {
    showToast(err.message || "엑셀 가져오기 실패", true);
  }
}

export async function loadProductsPage(force = false) {
  try {
    if (force || cachedProducts.length === 0) {
      await fetchProducts();
    }
    renderTable(cachedProducts);

    el("productSearch").oninput = () => applySearch(el("productSearch").value);

    el("openAddProductBtn").onclick = () => {
      if (!canEdit()) {
        showToast("추가 권한이 없습니다(admin/manager만 가능).", true);
        return;
      }
      openModal("create", null);
    };

    el("closeProductModal").onclick = closeModal;
    el("cancelProductModal").onclick = closeModal;
    el("productForm").onsubmit = handleSubmit;

    el("closeImageModal").onclick = closeImageModal;
    el("imageModal").addEventListener("click", (e) => {
      if (e.target && e.target.id === "imageModal") closeImageModal();
    });

    el("exportExcelBtn").onclick = handleExportExcel;

    const input = el("excelFileInput");
    el("importExcelBtn").onclick = () => {
      if (!canEdit()) {
        showToast("엑셀 가져오기는 admin/manager만 가능합니다.", true);
        return;
      }
      input.value = "";
      input.click();
    };

    input.onchange = async () => {
      const file = input.files && input.files[0];
      if (!file) return;

      const mode = confirm("가져오기 모드 선택\n확인=merge(업데이트/추가)\n취소=replace(상품 전체 교체)")
        ? "merge"
        : "replace";

      await handleImportExcel(file, mode);
    };
  } catch (err) {
    showToast(err.message, true);
  }
}
