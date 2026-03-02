import { apiPost } from "./api.js";
import { showToast, setActivePage } from "./utils.js";
import { loadDashboard } from "./dashboard.js";
import { loadProductsPage } from "./products.js";
import { loadInventoryPage } from "./inventory.js";
import { loadHistoryPage } from "./history.js";
import { initHyundai } from "./hyundai.js";
import { initCost } from "./cost.js";

function setUserUI() {
  const userStr = localStorage.getItem("authUser");
  if (!userStr) return;

  const user = JSON.parse(userStr);
  document.getElementById("currentUserName").textContent = user.username;
  document.getElementById("currentUserRole").textContent = user.role;

  document.getElementById("loginPage").style.display = "none";
  document.getElementById("mainPage").style.display = "flex";
}

function logout() {
  localStorage.removeItem("authUser");
  document.getElementById("mainPage").style.display = "none";
  document.getElementById("loginPage").style.display = "flex";
  document.getElementById("loginForm").reset();
  showToast("로그아웃되었습니다.");
}

function initMenu() {
  document.querySelectorAll(".menu-item").forEach((item) => {
    item.addEventListener("click", async () => {
      const page = item.getAttribute("data-page");

      if (page === "dashboard") {
        setActivePage("dashboard");
        loadDashboard();
      } else if (page === "products") {
        setActivePage("products");
        loadProductsPage();
      } else if (page === "inventory") {
        setActivePage("inventory");
        loadInventoryPage();
      } else if (page === "history") {
        setActivePage("history");
        loadHistoryPage();
      } else if (page === "barcode") {
        setActivePage("barcode");
      } else if (page === "production") {
        // ✅ production.js가 window.loadProductionPage를 등록함
        setActivePage("production");
        if (typeof window.loadProductionPage === "function") {
          window.loadProductionPage();
        } else {
          // fallback: dynamic import
          import("./production.js").then(m => m.loadProductionPage());
        }
      } else if (page === "hyundai") {
        setActivePage("hyundai");
        initHyundai();
      } else if (page === "cost") {
        setActivePage("cost");
        initCost();
      }
    });
  });
}

window.addEventListener("DOMContentLoaded", () => {
  const userStr = localStorage.getItem("authUser");
  if (userStr) {
    setUserUI();
    initMenu();
    setActivePage("dashboard");
    loadDashboard();
  } else {
    document.getElementById("mainPage").style.display = "none";
    document.getElementById("loginPage").style.display = "flex";
  }

  document.getElementById("logoutBtn").addEventListener("click", logout);

  document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();

    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value.trim();

    try {
      const data = await apiPost("/auth/login", { username, password });
      if (!data.ok) {
        showToast(data.message || "로그인 실패", true);
        return;
      }

      localStorage.setItem("authUser", JSON.stringify(data.user));
      setUserUI();
      initMenu();
      setActivePage("dashboard");
      loadDashboard();
      showToast("로그인 성공");
    } catch (err) {
      showToast("서버 연결 실패", true);
    }
  });
});
