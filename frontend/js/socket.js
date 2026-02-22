/**
 * socket.js  ―  ERP v6 (UI 즉시 반영 수정판)
 *
 * 수정 사항:
 *  ① syncAllTabs(): 모든 탭 갱신 호출에 force=true 전달
 *    - window.loadProductsPage(true) : 상품 캐시 무효화
 *    - window.loadInventoryPage(true): 재고 캐시 무효화
 *    - window.loadHistoryPage()      : 이력은 force 파라미터 없음(항상 fetch)
 *    - window.loadDashboard()        : 대시보드는 항상 fetch
 *  ② 바코드 탭 갱신 추가
 *    - window.refreshBarcodeProduct(): barcode.js 에서 노출한 함수 호출
 *    - 현재 조회된 상품이 있을 때만 재조회 (내부에서 guard)
 */

import { showToast } from "./utils.js";

let socket = null;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

function getSocketUrl() {
  if (
    window.location.hostname === "localhost" ||
    window.location.hostname === "127.0.0.1"
  ) {
    return "http://localhost:5000";
  }
  return window.location.origin;
}

export function initSocket() {
  if (socket && socket.connected) {
    console.log("✅ Socket already connected");
    return socket;
  }

  const socketUrl = getSocketUrl();
  console.log(`🔌 Connecting to Socket.IO: ${socketUrl}`);

  socket = io(socketUrl, {
    transports:             ["websocket", "polling"],
    reconnection:           true,
    reconnectionDelay:      1000,
    reconnectionDelayMax:   5000,
    reconnectionAttempts:   MAX_RECONNECT_ATTEMPTS,
  });

  socket.on("connect", () => {
    console.log(`✅ Socket.IO connected: ${socket.id}`);
    reconnectAttempts = 0;
    showToast("🔄 실시간 동기화 연결됨", false);
    socket.emit("subscribe", { event: "inventory:update" });
  });

  socket.on("disconnect", (reason) => {
    console.warn(`🔌 Socket.IO disconnected: ${reason}`);
    if (reason === "io server disconnect") {
      socket.connect();
    }
  });

  socket.on("connect_error", (error) => {
    reconnectAttempts++;
    console.error(
      `❌ Socket.IO connection error (attempt ${reconnectAttempts}):`,
      error.message
    );
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      showToast("⚠️ 실시간 동기화 연결 실패. 새로고침해주세요.", true);
    }
  });

  socket.on("reconnect", (attemptNumber) => {
    console.log(`🔄 Socket.IO reconnected after ${attemptNumber} attempts`);
    showToast("🔄 실시간 동기화 재연결 성공", false);
    reconnectAttempts = 0;
  });

  // 재고 업데이트 이벤트 수신 → 모든 탭 강제 갱신
  socket.on("inventory:update", async (payload) => {
    console.log("📦 Inventory update received:", payload);

    const { message, kind } = payload;

    if (message && kind !== "UPDATE") {
      showToast(`🔔 ${message}`, false);
    }

    await syncAllTabs();
  });

  return socket;
}

// ─────────────────────────────────────────────────────────────
//  syncAllTabs  ―  모든 탭을 서버 최신 데이터로 강제 갱신
//
//  핵심 변경:
//   - loadProductsPage(true)  : force=true → cachedProducts 무시하고 fetch
//   - loadInventoryPage(true) : force=true → cachedProducts 무시하고 fetch
//   - loadHistoryPage()       : force 파라미터 없음, 항상 fetch
//   - loadDashboard()         : 항상 fetch
//   - refreshBarcodeProduct() : 바코드 탭에 상품 조회 중이면 재조회
// ─────────────────────────────────────────────────────────────
async function syncAllTabs() {
  try {
    // 대시보드
    if (typeof window.loadDashboard === "function") {
      await window.loadDashboard();
    }

    // 상품 관리 탭  ← force=true 추가
    if (typeof window.loadProductsPage === "function") {
      await window.loadProductsPage(true);
    }

    // 재고 관리 탭  ← force=true 추가
    if (typeof window.loadInventoryPage === "function") {
      await window.loadInventoryPage(true);
    }

    // 재고 이력 탭  (항상 fetch, force 파라미터 없음)
    if (typeof window.loadHistoryPage === "function") {
      await window.loadHistoryPage();
    }

    // 바코드 탭  ← 신규 추가
    if (typeof window.refreshBarcodeProduct === "function") {
      await window.refreshBarcodeProduct();
    }

    console.log("✅ All tabs synced (force)");
  } catch (error) {
    console.error("❌ Sync error:", error);
  }
}

export function getSocket() {
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
    console.log("🔌 Socket.IO disconnected manually");
  }
}

// 페이지 로드 시 자동 연결
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    initSocket();
  });
} else {
  initSocket();
}
