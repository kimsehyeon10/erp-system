import { showToast } from "./utils.js";

// ✅ 기본은 "같은 오리진"(백엔드가 프론트를 서빙하는 방식)을 사용합니다.
// - http://[SERVER-IP]:5000 으로 접속하면 다른 PC에서도 그대로 동작
// - 필요 시 localStorage("ERP_API_BASE_URL")로 강제 지정 가능
const CONFIGURED = localStorage.getItem("ERP_API_BASE_URL");
const SAME_ORIGIN_OK = window.location && window.location.origin && window.location.port === "5000";

export const API_BASE_URL = CONFIGURED || (SAME_ORIGIN_OK ? "" : "http://localhost:5000");

function getAuthHeaders() {
  const userStr = localStorage.getItem("authUser");
  if (!userStr) return {};
  const user = JSON.parse(userStr);

  return {
    "x-user": user.username,
    "x-role": user.role
  };
}

export async function apiGet(path) {
  const res = await fetch(API_BASE_URL + path, {
    method: "GET",
    headers: {
      ...getAuthHeaders()
    }
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "GET failed");
  return data;
}

export async function apiPost(path, body) {
  const res = await fetch(API_BASE_URL + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders()
    },
    body: JSON.stringify(body || {})
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "POST failed");
  return data;
}

export async function apiPut(path, body) {
  const res = await fetch(API_BASE_URL + path, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...getAuthHeaders()
    },
    body: JSON.stringify(body || {})
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "PUT failed");
  return data;
}

export async function apiDelete(path) {
  const res = await fetch(API_BASE_URL + path, {
    method: "DELETE",
    headers: {
      ...getAuthHeaders()
    }
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || "DELETE failed");
  return data;
}

export function requireLoginOrRedirect() {
  const userStr = localStorage.getItem("authUser");
  if (!userStr) {
    showToast("로그인이 필요합니다.", true);
    document.getElementById("mainPage").classList.remove("active");
    document.getElementById("loginPage").style.display = "flex";
    return false;
  }
  return true;
}
