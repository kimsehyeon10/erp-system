import { apiPost } from "./api.js";
import { showToast, setActivePage } from "./utils.js";
import { loadDashboard } from "./dashboard.js";
import { loadProductsPage } from "./products.js";
import { loadInventoryPage } from "./inventory.js";
import { loadHistoryPage } from "./history.js";

function setUserUI() {
  const userStr = localStorage.getItem("authUser");
  if (!userStr) return;

  const user = JSON.parse(userStr);
  document.getElementById("currentUserName").textContent = user.username;
  document.getElementById("currentUserRole").textContent = user.role;
}

function goMain() {
  document.getElementById("loginPage").style.display = "none";
  document.getElementById("mainPage").classList.add("active");

  setUserUI();
  setActivePage("dashboard");
  loadDashboard();
}

async function handleLogin(e) {
  e.preventDefault();

  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value.trim();

  try {
    const data = await apiPost("/auth/login", { username, password });

    localStorage.setItem("authToken", data.token);
    localStorage.setItem("authUser", JSON.stringify(data.user));

    showToast("로그인 성공!");
    goMain();
  } catch (err) {
    showToast(err.message, true);
  }
}

function handleLogout() {
  localStorage.removeItem("authToken");
  localStorage.removeItem("authUser");

  document.getElementById("mainPage").classList.remove("active");
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
      }
    });
  });
}

window.addEventListener("DOMContentLoaded", () => {
  document.getElementById("loginForm").addEventListener("submit", handleLogin);
  document.getElementById("logoutBtn").addEventListener("click", handleLogout);

  initMenu();

  // 이미 로그인 상태면 바로 진입
  const userStr = localStorage.getItem("authUser");
  if (userStr) {
    goMain();
  }
});
