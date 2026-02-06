import { apiGet, apiPost, apiPut, apiDelete, API_BASE_URL } from "./api.js";
import { showToast, badgeStatus, fmtMoney } from "./utils.js";
import { loadDashboard } from "./dashboard.js";
import { loadInventoryPage } from "./inventory.js";
import { loadHistoryPage } from "./history.js";

let cachedProducts = [];
let pendingImageDataUrl = "";

function getRole() {
  const user = JSON.parse(localStorage.getItem("authUser") || "{}");
  return user.role || "";
}

function canEdit() {
  return ["admin", "manager"].includes(getRole());
}

function canDelete() {
  return getRole() === "admin";
}

function canViewPrice() {
  return ["admin", "manager"].includes(getRole());
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

function openModal(mode, product = null) {
  document.getElementById("productModal").classList.add("active");
  document.getElementById("productMode").value = mode;
  pendingImageDataUrl = "";
  document.getElementById("productImageFile").value = "";

  if (mode === "create") {
    document.getElementById("productModalTitle").textContent = "상품 추가";
    document.getElementById("productCode").value = "";
    document.getElementById("productCode").disabled = false;
    document.getElementById("productBarcode").value = "";
    document.getElementById("productName").value = "";
    document.getElementById("productCategory").value = "";
    document.getElementById("productUnit").value = "ea";
    document.getElementById("productLocation").value = "";
    document.getElementById("productCondition").value = "new";
    document.getElementById("productType").value = "finished";
    document.getElementById("productSpec").value = "";
    document.getElementById("productNote").value = "";
    document.getElementById("productPrice").value = 0;
    document.getElementById("productSafetyStock").value = 10;
    document.getElementById("productQty").value = 0;
  } else {
    document.getElementById("productModalTitle").textContent = "상품 수정";
    document.getElementById("productCode").value = product.code;
    document.getElementById("productCode").disabled = true;
    document.getElementById("productBarcode").value = product.barcode || product.code;
    document.getElementById("productName").value = product.name;
    document.getElementById("productCategory").value = product.category || "";
    document.getElementById("productUnit").value = product.unit || "ea";
    document.getElementById("productLocation").value = product.location || "";
    document.getElementById("productCondition").value = product.condition || "new";
    document.getElementById("productType").value = product.productType || "finished";
    document.getElementById("productSpec").value = product.spec || "";
    document.getElementById("productNote").value = product.note || "";
    document.getElementById("productPrice").value = product.price || 0;
    document.getElementById("productSafetyStock").value = product.safetyStock ?? 10;
    document.getElementById("productQty").value = product.qty ?? 0;
  }
}

function closeModal() {
  document.getElementById("productModal").classList.remove("active");
}

function renderTable(products) {
  const tbody = document.getElementById("productTableBody");
  tbody.innerHTML = "";

  products.forEach((p) => {
    const status = badgeStatus(Number(p.qty || 0), Number(p.safetyStock || 0));
    const tr = document.createElement("tr");
    const imgHtml = p.image && p.image.length > 20
      ? `<img class="thumb" data-action="img" data-code="${p.code}" src="${p.image}" alt="img"/>`
      : `<img class="thumb empty" src="" alt="noimg"/>`;

    tr.innerHTML = `
      <td>${imgHtml}</td>
      <td>${p.code}<div class="hint small">${p.barcode || "-"}</div></td>
      <td>${p.name}<div class="hint small">${p.spec || ""}</div></td>
      <td>${p.category || "-"}</td>
      <td>${p.unit || "ea"}</td>
      <td>${p.location || "-"}</td>
      <td>${p.condition === "used" ? "중고" : "신품"}</td>
      <td>${p.productType === "bom" ? "BOM" : "기성품"}</td>
      <td>${canViewPrice() ? fmtMoney(p.price || 0) : "권한 필요"}</td>
      <td>${Number(p.qty || 0)} ${p.unit || "ea"}</td>
      <td><span class="badge ${status.cls}">${status.text}</span></td>
      <td class="action-btns">
        <button class="btn-edit" data-action="edit" data-code="${p.code}">수정</button>
        <button class="btn-delete" data-action="delete" data-code="${p.code}">삭제</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('img.thumb[data-action="img"]').forEach((img) => {
    img.addEventListener("click", () => {
      const product = cachedProducts.find((x) => x.code === img.getAttribute("data-code"));
      if (product?.image) openImageModal(product);
    });
  });

  tbody.querySelectorAll("button").forEach((btn) => {
    const action = btn.getAttribute("data-action");
    const code = btn.getAttribute("data-code");
    if (action === "edit") {
      btn.disabled = !canEdit();
      btn.addEventListener("click", () => openModal("update", cachedProducts.find((x) => x.code === code)));
    }
    if (action === "delete") {
      btn.disabled = !canDelete();
      btn.addEventListener("click", async () => {
        if (!confirm("정말 삭제하시겠습니까?")) return;
        try {
          await apiDelete(`/products/${code}`);
          showToast("삭제 완료");
          await refreshAll();
        } catch (err) {
          showToast(err.message, true);
        }
      });
    }
  });
}

async function fetchProducts() {
  const data = await apiGet("/products");
  cachedProducts = data.products || [];
}

function applySearch(term) {
  const t = (term || "").toLowerCase();
  const filtered = cachedProducts.filter((p) => `${p.code} ${p.barcode || ""} ${p.name}`.toLowerCase().includes(t));
  renderTable(filtered);
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error("파일 읽기 실패"));
    fr.readAsDataURL(file);
  });
}

function readFileAsArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result);
    fr.onerror = () => reject(new Error("파일 읽기 실패"));
    fr.readAsArrayBuffer(file);
  });
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

async function refreshAll() {
  await loadProductsPage(true);
  await loadInventoryPage(true);
  await loadHistoryPage(true);
  await loadDashboard();
}

async function handleSubmit(e) {
  e.preventDefault();
  if (!canEdit()) return showToast("상품 저장 권한이 없습니다.", true);

  const mode = document.getElementById("productMode").value;
  const code = document.getElementById("productCode").value.trim();
  const payload = {
    barcode: document.getElementById("productBarcode").value.trim() || code,
    name: document.getElementById("productName").value.trim(),
    category: document.getElementById("productCategory").value.trim(),
    unit: document.getElementById("productUnit").value,
    location: document.getElementById("productLocation").value.trim(),
    condition: document.getElementById("productCondition").value,
    productType: document.getElementById("productType").value,
    spec: document.getElementById("productSpec").value.trim(),
    note: document.getElementById("productNote").value.trim(),
    price: Number(document.getElementById("productPrice").value || 0),
    safetyStock: Number(document.getElementById("productSafetyStock").value || 0),
    qty: Number(document.getElementById("productQty").value || 0),
  };

  const imgFile = document.getElementById("productImageFile").files[0];
  if (imgFile) pendingImageDataUrl = await readFileAsDataURL(imgFile);

  try {
    if (mode === "create") {
      await apiPost("/products", { code, ...payload, image: pendingImageDataUrl });
      showToast("상품 추가 완료");
    } else {
      if (pendingImageDataUrl) payload.image = pendingImageDataUrl;
      await apiPut(`/products/${code}`, payload);
      showToast("상품 수정 완료");
    }
    closeModal();
    await refreshAll();
  } catch (err) {
    showToast(err.message, true);
  }
}

async function handleExportExcel() {
  try {
    const user = JSON.parse(localStorage.getItem("authUser") || "{}");
    const res = await fetch(`${API_BASE_URL}/products/export.xlsx`, { headers: { "x-user": user.username, "x-role": user.role } });
    if (!res.ok) throw new Error("Export failed");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "products.xlsx";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    showToast(err.message, true);
  }
}

async function handleImportExcel(file, mode = "merge") {
  try {
    if (!canEdit()) return showToast("엑셀 가져오기는 admin/manager만 가능합니다.", true);
    const ab = await readFileAsArrayBuffer(file);
    const base64 = arrayBufferToBase64(ab);
    const data = await apiPost(`/products/import?mode=${encodeURIComponent(mode)}`, { base64 });
    showToast(`엑셀 가져오기 완료 (created:${data.created}, updated:${data.updated}, adjusted:${data.adjusted})`);
    await refreshAll();
  } catch (err) {
    showToast(err.message, true);
  }
}

export async function loadProductsPage(force = false) {
  try {
    if (force || cachedProducts.length === 0) await fetchProducts();
    renderTable(cachedProducts);

    document.getElementById("productSearch").oninput = (e) => applySearch(e.target.value);
    document.getElementById("openAddProductBtn").onclick = () => (canEdit() ? openModal("create") : showToast("권한 없음", true));
    document.getElementById("closeProductModal").onclick = closeModal;
    document.getElementById("cancelProductModal").onclick = closeModal;
    document.getElementById("productForm").onsubmit = handleSubmit;

    document.getElementById("closeImageModal").onclick = closeImageModal;
    document.getElementById("imageModal").onclick = (e) => e.target?.id === "imageModal" && closeImageModal();

    document.getElementById("exportExcelBtn").onclick = handleExportExcel;
    const input = document.getElementById("excelFileInput");
    document.getElementById("importExcelBtn").onclick = () => {
      if (!canEdit()) return showToast("엑셀 가져오기 권한 없음", true);
      input.value = "";
      input.click();
    };
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const mode = confirm("확인=merge / 취소=replace") ? "merge" : "replace";
      await handleImportExcel(file, mode);
    };
  } catch (err) {
    showToast(err.message, true);
  }
}
