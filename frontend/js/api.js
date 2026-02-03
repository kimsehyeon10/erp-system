import { showToast } from "./utils.js";

export const API_BASE_URL = "http://localhost:5000";

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
