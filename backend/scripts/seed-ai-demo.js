#!/usr/bin/env node
"use strict";

/**
 * seed-ai-demo.js — AI 리스크 엔진 데모 데이터 삽입
 *
 * 실행: node backend/scripts/seed-ai-demo.js
 *
 * ✅ 5가지 리스크 시나리오 데이터 삽입:
 *   P001 (노트북 A)  → 품절 위험 HIGH + 발주 필요
 *   P002 (마우스 B)  → 과잉 재고 HIGH (90일 미출고)
 *   P003 (키보드 C)  → 비정상 출고 HIGH (오늘 급증)
 *   +P004 (모니터 D) → 단가 급변 HIGH (신규 상품 추가)
 *   +P005 (USB Hub)  → 정상 (OK 기준선)
 *
 * ⚠️  주의: 기존 demo 데이터가 있으면 덮어쓰지 않음 (idempotent)
 */

const fs   = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "../models/database.json");

// ── 날짜 헬퍼 ─────────────────────────────────────────────────────────
const now = new Date();
function daysAgo(n) {
  const d = new Date(now);
  d.setDate(d.getDate() - n);
  return d.toISOString();
}
function hoursAgo(h) {
  return new Date(now.getTime() - h * 3_600_000).toISOString();
}
function genId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// ── 읽기 ─────────────────────────────────────────────────────────────
const raw = fs.readFileSync(DB_PATH, "utf-8");
const db  = JSON.parse(raw);

if (!Array.isArray(db.products)) db.products = [];
if (!Array.isArray(db.history))  db.history  = [];

// ── 이미 시드된 경우 스킵 ─────────────────────────────────────────────
const alreadySeeded = db.products.some(p => p.code === "P004");
if (alreadySeeded) {
  console.log("ℹ️  이미 데모 데이터가 존재합니다. 시드를 건너뜁니다.");
  console.log("   (재삽입이 필요하면 P004·P005 상품과 관련 이력을 먼저 삭제하세요)");
  process.exit(0);
}

// ════════════════════════════════════════════════════════════════════
// 상품 추가 (P004, P005)
// ════════════════════════════════════════════════════════════════════
const newProducts = [
  {
    id: "P004", code: "P004",
    name: "모니터 D",  category: "전자기기", unit: "ea",
    qty: 20,   price: 350000, safetyStock: 5,
    unitCost: 490000,   // ← 최근 단가 급등 (30일 평균 350000 대비 +40%)
    barcode: "P004", location: "D열 1층",
    spec: "27인치 4K", note: "단가 급변 시나리오",
    condition: "new", productType: "finished", bomItems: [],
    updatedAt: now.toISOString(),
  },
  {
    id: "P005", code: "P005",
    name: "USB Hub E", category: "주변기기", unit: "ea",
    qty: 50,   price: 25000, safetyStock: 10,
    unitCost: 25000,
    barcode: "P005", location: "E열 2층",
    spec: "7포트 / USB3.0", note: "정상 기준선",
    condition: "new", productType: "finished", bomItems: [],
    updatedAt: now.toISOString(),
  },
];
db.products.push(...newProducts);

// ════════════════════════════════════════════════════════════════════
// 출고 이력 추가
// ════════════════════════════════════════════════════════════════════
const newHistory = [];

// ─── P001 (노트북 A) — 품절 위험 HIGH ─────────────────────────────
// 매일 5개씩 출고 → 30일 총 150개, 현재재고 15개, 3일 후 품절
for (let i = 1; i <= 30; i++) {
  newHistory.push({
    id:          genId("H_P001_OUT"),
    productCode: "P001",
    type:        "OUT",
    delta:       -5,
    memo:        `일일 출고 (D-${i})`,
    user:        "manager",
    at:          daysAgo(i),
  });
}

// ─── P002 (마우스 B) — 과잉 재고 HIGH ────────────────────────────
// 100일 이상 아무 출고 없음 → deadstock
// (아무 OUT 이력도 추가하지 않음 — 이미 기존 OUT은 모두 취소됨)
// 입고 이력만 추가 (재고는 있지만 출고 없음)
newHistory.push({
  id:          genId("H_P002_IN"),
  productCode: "P002",
  type:        "IN",
  delta:       90,
  memo:        "대량 입고 (과잉재고 시나리오)",
  user:        "admin",
  at:          daysAgo(100),
  unitCost:    35000,
});

// ─── P003 (키보드 C) — 비정상 출고 HIGH ──────────────────────────
// 직전 7일: 평균 1개/day 출고 (정상)
for (let i = 2; i <= 8; i++) {
  newHistory.push({
    id:          genId("H_P003_PREV"),
    productCode: "P003",
    type:        "OUT",
    delta:       -1,
    memo:        `정상 일일 출고 (D-${i})`,
    user:        "staff",
    at:          daysAgo(i),
  });
}
// 오늘: 갑자기 25개 출고 → spikeX=3 기준 (1 × 3 = 3개) 초과 → HIGH
newHistory.push({
  id:          genId("H_P003_SPIKE"),
  productCode: "P003",
  type:        "OUT",
  delta:       -25,
  memo:        "긴급 대량 출고 (비정상 급증!)",
  user:        "staff",
  at:          hoursAgo(2),
});

// ─── P004 (모니터 D) — 단가 급변 HIGH ────────────────────────────
// 30일간 입고 단가 350,000원 (avg_cost_30)
for (let i = 5; i <= 30; i += 5) {
  newHistory.push({
    id:          genId("H_P004_IN"),
    productCode: "P004",
    type:        "IN",
    delta:       5,
    memo:        `정기 입고 (단가 350,000원)`,
    user:        "admin",
    at:          daysAgo(i),
    unitCost:    350000,  // 평균 단가
  });
}
// 최근 입고: 단가 490,000원 (+40% 급등)
newHistory.push({
  id:          genId("H_P004_SPIKE"),
  productCode: "P004",
  type:        "IN",
  delta:       5,
  memo:        "최근 입고 — 단가 급등 (490,000원)",
  user:        "admin",
  at:          hoursAgo(6),
  unitCost:    490000,
});
// 정기 출고 (재고회전 정상)
for (let i = 1; i <= 20; i++) {
  newHistory.push({
    id:          genId("H_P004_OUT"),
    productCode: "P004",
    type:        "OUT",
    delta:       -1,
    memo:        `정기 출고 (D-${i})`,
    user:        "manager",
    at:          daysAgo(i),
  });
}

// ─── P005 (USB Hub E) — 정상 OK ──────────────────────────────────
// 매일 2개씩 출고, 재고 충분, 단가 안정
for (let i = 1; i <= 30; i++) {
  newHistory.push({
    id:          genId("H_P005_OUT"),
    productCode: "P005",
    type:        "OUT",
    delta:       -2,
    memo:        `정상 일일 출고 (D-${i})`,
    user:        "staff",
    at:          daysAgo(i),
  });
}

// ── P001 단가 이력 추가 (단가는 안정적) ──────────────────────────
for (let i = 5; i <= 30; i += 5) {
  newHistory.push({
    id:          genId("H_P001_IN"),
    productCode: "P001",
    type:        "IN",
    delta:       10,
    memo:        `정기 입고 (단가 1,200,000원)`,
    user:        "admin",
    at:          daysAgo(i + 30), // 30일 분석 기간 밖 (오래된 입고)
    unitCost:    1200000,
  });
}

// ── 저장 ─────────────────────────────────────────────────────────────
db.history.push(...newHistory);
fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");

console.log("\n✅ AI 데모 데이터 삽입 완료!\n");
console.log("📊 삽입된 데이터 요약:");
console.log("   P001 (노트북 A)  — 30일간 5개/day 출고 → 품절 위험 HIGH");
console.log("   P002 (마우스 B)  — 100일 미출고         → 과잉 재고 HIGH");
console.log("   P003 (키보드 C)  — 오늘 25개 급출고     → 비정상 출고 HIGH");
console.log("   P004 (모니터 D)  — 단가 +40% 급등       → 단가 급변 HIGH");
console.log("   P005 (USB Hub E) — 정상 출고 패턴        → OK (기준선)");
console.log(`\n   추가 이력: ${newHistory.length}건`);
console.log("\n🚀 이제 서버를 실행하고 아래 명령으로 확인하세요:");
console.log("   node backend/server.js");
console.log("   curl http://localhost:5000/api/ai/risk/run\n");
