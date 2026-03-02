/**
 * migrate.js - DB 스키마 마이그레이션
 * 실행: node backend/scripts/migrate.js
 * server.js에서 자동 require 시에도 안전하게 동작
 */
"use strict";
const fs   = require("fs");
const path = require("path");

const DB_PATH = path.join(__dirname, "..", "models", "database.json");

function migrate() {
  const raw = fs.readFileSync(DB_PATH, "utf-8");
  const db  = JSON.parse(raw);
  let changed = false;

  // 기존 컬렉션 초기화
  if (!Array.isArray(db.ledger))         { db.ledger = [];         changed = true; }
  if (!Array.isArray(db.productionLots)) { db.productionLots = []; changed = true; }
  if (!Array.isArray(db.sales))          { db.sales = [];           changed = true; }

  // [신규] 현대 자재 컬렉션 (일반 products와 완전 분리)
  if (!Array.isArray(db.hyundaiProducts)) { db.hyundaiProducts = []; changed = true; }

  // [신규] 원가 계산 결과 저장 컬렉션
  if (!Array.isArray(db.costRecords)) { db.costRecords = []; changed = true; }

  // products 필드 보강
  if (Array.isArray(db.products)) {
    db.products = db.products.map(p => {
      const upd = { ...p };
      let prodChanged = false;
      if (upd.unitCost  === undefined) { upd.unitCost  = Number(upd.price || 0); prodChanged = true; }
      if (upd.bomItems  === undefined) { upd.bomItems  = [];                     prodChanged = true; }
      // stock_type 보장: 일반 상품은 반드시 'normal'
      if (upd.stock_type === undefined) { upd.stock_type = "normal"; prodChanged = true; }
      if (prodChanged) changed = true;
      return upd;
    });
  }

  if (changed) {
    fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf-8");
    console.log("✅ DB 마이그레이션 완료 →", DB_PATH);
  }
  // 변경 없을 때 로그 없음 (서버 시작 노이즈 방지)
}

migrate();
