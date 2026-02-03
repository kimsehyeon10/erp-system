import { apiGet, apiPost, apiPut, apiDelete, API_BASE_URL } from "./api.js";
import { showToast, badgeStatus, fmtMoney } from "./utils.js";
import { loadDashboard } from "./dashboard.js";
import { loadInventoryPage } from "./inventory.js";
import { loadHistoryPage } from "./history.js";

let cachedProducts = [];
let pendingImageDataUrl = ""; // 모달에서 선택한 이미지(base64 dataURL)

function canEdit() {
  const userStr = localStorage.getItem("authUser");
  if (!userStr) return false;
  const user = JSON.parse(userStr);
  return user.role === "admin" || user.role === "manager";
}

function canDelete() {
  const userStr = localStorage.getItem("authUser");
  if (!userStr) return false;
  const user = JSON.parse(userStr);
  return user.role === "admin";
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

function openModal(mode, product = null) {
  const modal = document.getElementById("productModal");
  modal.classList.add("active");

  document.getElementById("productMode").value = mode;

  // 이미지 초기화
  pendingImageDataUrl = "";
  const imageInput = document.getElementById("productImageFile");
  imageInput.value = "";

  if (mode === "create") {
    document.getElementById("productModalTitle").textContent = "상품 추가";
    document.getElementById("productCode").value = "";
    document.getElementById("productCode").disabled = false;
    document.getElementById("productName").value = "";
    document.getElementById("productCategory").value = "";
    document.getElementById("productUnit").value = "ea";
    document.getElementById("productPrice").value = 0;
    document.getElementById("productSafetyStock").value = 10;
    document.getElementById("productQty").value = 0;
  } else {
    document.getElementById("productModalTitle").textContent = "상품 수정";
    document.getElementById("productCode").value = product.code;
    document.getElementById("productCode").disabled = true;
    document.getElementById("productName").value = product.name;
    document.getElementById("productCategory").value = product.category || "";
    document.getElementById("productUnit").value = product.unit || "ea";
    document.getElementById("productPrice").value = product.price || 0;
    document.getElementById("productSafetyStock").value = product.safetyStock ?? 10;
    document.getElementById("productQty").value = product.qty ?? 0;

    // 수정 시에는 "선택한 경우에만" 이미지 변경되도록 pending은 비워둠
  }
}

function closeModal() {
  document.getElementById("productModal").classList.remove("active");
}

async function renderTable(products) {
  const tbody = document.getElementById("productTableBody");
  tbody.innerHTML = "";

  products.forEach((p) => {
    const status = badgeStatus(Number(p.qty || 0), Number(p.safetyStock || 0));
    const tr = document.createElement("tr");

    const hasImg = !!(p.image && p.image.length > 20);
    const imgHtml = hasImg
      ? `<img class="thumb" data-action="img" data-code="${p.code}" src="${p.image}" alt="img"/>`
      : `<img class="thumb empty" src="" alt="noimg"/>`;

    tr.innerHTML = `
      <td>${imgHtml}</td>
      <td>${p.code}</td>
      <td>${p.name}</td>
      <td>${p.category || "-"}</td>
      <td>${p.unit || "ea"}</td>
      <td>${fmtMoney(p.price || 0)}</td>
      <td>${Number(p.qty || 0)}</td>
      <td><span class="badge ${status.cls}">${status.text}</span></td>
      <td class="action-btns">
        <button class="btn-edit" data-action="edit" data-code="${p.code}">수정</button>
        <button class="btn-delete" data-action="delete" data-code="${p.code}">삭제</button>
      </td>
    `;

    tbody.appendChild(tr);
  });

  // 이미지 클릭(확대)
  tbody.querySelectorAll('img.thumb[data-action="img"]').forEach((img) => {
    img.addEventListener("click", () => {
      const code = img.getAttribute("data-code");
      const product = cachedProducts.find((x) => x.code === code);
      if (!product || !product.image) return;
      openImageModal(product);
    });
  });

  // 수정/삭제
  tbody.querySelectorAll("button").forEach((btn) => {
    const action = btn.getAttribute("data-action");
    const code = btn.getAttribute("data-code");

    if (action === "edit") {
      btn.disabled = !canEdit();
      btn.addEventListener("click", () => {
        const product = cachedProducts.find((x) => x.code === code);
        if (!product) return;
        openModal("update", product);
      });
    }

    if (action === "delete") {
      btn.disabled = !canDelete();
      btn.addEventListener("click", async () => {
        if (!canDelete()) {
          showToast("삭제 권한이 없습니다(admin만 가능).", true);
          return;
        }
        if (!confirm("정말 삭제하시겠습니까?")) return;

        try {
          await apiDelete(`/products/${code}`);
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
}

async function fetchProducts() {
  const data = await apiGet("/products");
  cachedProducts = data.products || [];
  return cachedProducts;
}

function applySearch(term) {
  const t = (term || "").toLowerCase();
  const filtered = cachedProducts.filter((p) => {
    const s = `${p.code} ${p.name}`.toLowerCase();
    return s.includes(t);
  });
  renderTable(filtered);
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ""));
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

async function handleSubmit(e) {
  e.preventDefault();

  if (!canEdit()) {
    showToast("상품 저장 권한이 없습니다(admin/manager만 가능).", true);
    return;
  }

  const mode = document.getElementById("productMode").value;

  const code = document.getElementById("productCode").value.trim();
  const name = document.getElementById("productName").value.trim();
  const category = document.getElementById("productCategory").value.trim();
  const unit = document.getElementById("productUnit").value;
  const price = Number(document.getElementById("productPrice").value || 0);
  const safetyStock = Number(document.getElementById("productSafetyStock").value || 0);
  const qty = Number(document.getElementById("productQty").value || 0);

  if (!code || !name) {
    showToast("상품코드/상품명은 필수입니다.", true);
    return;
  }

  // 이미지 파일 선택 시 -> dataURL(base64)로 저장
  const imgFile = document.getElementById("productImageFile").files[0];
  if (imgFile) {
    try {
      pendingImageDataUrl = await readFileAsDataURL(imgFile); // "data:image/...;base64,...."
    } catch (err) {
      showToast(err.message, true);
      return;
    }
  }

  try {
    if (mode === "create") {
      await apiPost("/products", { code, name, category, unit, price, safetyStock, qty, image: pendingImageDataUrl });
      showToast("상품 추가 완료");
    } else {
      // 수정: 이미지 파일을 선택한 경우에만 image를 덮어씀
      const body = { name, category, unit, price, safetyStock };
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
    // auth 헤더를 직접 붙여서 다운로드
    const user = JSON.parse(localStorage.getItem("authUser") || "{}");
    if (!user.username) {
      showToast("로그인이 필요합니다.", true);
      return;
    }

    const res = await fetch(`${API_BASE_URL}/products/export.xlsx`, {
      method: "GET",
      headers: {
        "x-user": user.username,
        "x-role": user.role
      }
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.message || "Export failed");
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "products.xlsx";
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
    showToast("엑셀 내보내기 완료");
  } catch (err) {
    showToast(err.message, true);
  }
}

async function handleImportExcel(file, mode = "merge") {
  try {
    if (!canEdit()) {
      showToast("엑셀 가져오기는 admin/manager만 가능합니다.", true);
      return;
    }

    const ab = await readFileAsArrayBuffer(file);
    const base64 = arrayBufferToBase64(ab);

    const data = await apiPost(`/products/import?mode=${encodeURIComponent(mode)}`, { base64 });

    showToast(`엑셀 가져오기 완료 (created:${data.created}, updated:${data.updated}, adjusted:${data.adjusted})`);
    await loadProductsPage(true);
    await loadInventoryPage(true);
    await loadHistoryPage(true);
    await loadDashboard();
  } catch (err) {
    showToast(err.message, true);
  }
}

export async function loadProductsPage(force = false) {
  try {
    if (force || cachedProducts.length === 0) {
      await fetchProducts();
    }
    renderTable(cachedProducts);

    const search = document.getElementById("productSearch");
    search.oninput = () => applySearch(search.value);

    document.getElementById("openAddProductBtn").onclick = () => {
      if (!canEdit()) {
        showToast("추가 권한이 없습니다(admin/manager만 가능).", true);
        return;
      }
      openModal("create", null);
    };

    document.getElementById("closeProductModal").onclick = closeModal;
    document.getElementById("cancelProductModal").onclick = closeModal;
    document.getElementById("productForm").onsubmit = handleSubmit;

    // 이미지 모달 닫기
    document.getElementById("closeImageModal").onclick = closeImageModal;
    document.getElementById("imageModal").addEventListener("click", (e) => {
      if (e.target && e.target.id === "imageModal") closeImageModal();
    });

    // 이미지 파일 선택 시 바로 pending에 올려두지는 않고, 저장 시 읽습니다.
    document.getElementById("productImageFile").onchange = () => {};

    // 엑셀 내보내기
    document.getElementById("exportExcelBtn").onclick = handleExportExcel;

    // 엑셀 가져오기
    const input = document.getElementById("excelFileInput");
    document.getElementById("importExcelBtn").onclick = () => {
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

      // merge/replace 선택
      const mode = confirm("가져오기 모드 선택\n확인=merge(업데이트/추가)\n취소=replace(상품 전체 교체)")
        ? "merge"
        : "replace";

      await handleImportExcel(file, mode);
    };
  } catch (err) {
    showToast(err.message, true);
  }
}
