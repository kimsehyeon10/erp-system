import { apiGet } from "./api.js";
import { showToast } from "./utils.js";

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
  } catch (err) {
    showToast(err.message, true);
  }
}
