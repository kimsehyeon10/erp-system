import { apiGet } from "./api.js";
import { showToast } from "./utils.js";
import { showProductDetailModal } from "./inventory.js";

export async function loadDashboard() {
  try {
    const data = await apiGet("/products");
    const products = data.products || [];

    const totalProducts = products.length;
    const totalQty = products.reduce((sum, p) => sum + Number(p.qty || 0), 0);
    const lowStock = products.filter((p) => Number(p.qty || 0) < Number(p.safetyStock || 0)).length;

    document.getElementById("dashTotalProducts").textContent = totalProducts;
    document.getElementById("dashTotalQty").textContent = totalQty.toLocaleString();
    document.getElementById("dashLowStockCount").textContent = lowStock;
    
    // 차트 업데이트 (try 블록 안에서 호출)
    if (window.updateCharts) {
      window.updateCharts(products);
    }

    // 대시보드 테이블에 클릭 이벤트 추가
    addDashboardTableClickHandlers(products);
  } catch (err) {
    showToast(err.message, true);
  }
}

// 대시보드 재고 현황 테이블에 클릭 이벤트 추가
function addDashboardTableClickHandlers(products) {
  const tbody = document.getElementById("dashInventoryTableBody");
  if (!tbody) return;

  // 모든 행에 클릭 이벤트 추가
  const rows = tbody.querySelectorAll("tr");
  rows.forEach(row => {
    // 데이터가 없는 행은 제외
    const codeCell = row.cells[0];
    if (!codeCell || codeCell.colSpan > 1) return;

    const productCode = codeCell.textContent.trim();
    const product = products.find(p => p.code === productCode);
    
    if (product) {
      row.style.cursor = "pointer";
      row.classList.add("clickable-row");
      
      row.addEventListener("click", () => {
        showProductDetailModal(product);
      });

      // 호버 효과
      row.addEventListener("mouseenter", () => {
        row.style.backgroundColor = "#F8FAFC";
      });
      row.addEventListener("mouseleave", () => {
        row.style.backgroundColor = "";
      });
    }
  });
}
