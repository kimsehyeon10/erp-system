/**
 * routes/hyundai.js - 현대 스톡 자재 API
 *
 * 설계 원칙:
 *  - 현대 자재는 일반 products 컬렉션과 완전히 분리 저장
 *  - hyundaiProducts 컬렉션에만 저장, 일반 재고 합산 없음
 *  - 분실 시 패널티 단가 = unitPrice × penaltyRate (기본 3배)
 *  - 방어 코드: 현대 자재 코드가 일반 products에 등록 불가
 *
 * 엔드포인트:
 *  GET    /hyundai/products           - 현대 자재 전체 목록
 *  GET    /hyundai/products/:id       - 단일 현대 자재 조회
 *  POST   /hyundai/products           - 현대 자재 등록
 *  PUT    /hyundai/products/:id       - 현대 자재 수정
 *  DELETE /hyundai/products/:id       - 현대 자재 삭제 (admin 전용)
 *  POST   /hyundai/products/:id/adjust - 현대 자재 재고 조정 (입고/출고)
 */
"use strict";

const express = require("express");
const router  = express.Router();
const { readDB, writeDB, nowISO, genId } = require("../config/database");

// ─────────────────────── 상수 ────────────────────────────────

const DEFAULT_PENALTY_RATE = 3; // 분실 시 기본 패널티 배율

// ─────────────────────── 인증 헬퍼 ──────────────────────────

function requireAuth(req, res) {
  const username = req.headers["x-user"];
  const role     = req.headers["x-role"];
  if (!username || !role) {
    res.status(401).json({ ok: false, message: "인증 헤더(x-user, x-role)가 필요합니다." });
    return null;
  }
  return { username, role };
}

function requireRole(auth, roles, res) {
  if (!roles.includes(auth.role)) {
    res.status(403).json({ ok: false, message: `${roles.join("/")} 권한이 필요합니다.` });
    return false;
  }
  return true;
}

// ─────────────────────── 유효성 검사 ─────────────────────────

function safeNumber(val, fallback = 0) {
  const n = Number(val);
  return Number.isFinite(n) ? n : fallback;
}

function safePositive(val, min = 0) {
  const n = Number(val);
  if (!Number.isFinite(n) || n < min) return null;
  return n;
}

/**
 * 현대 자재 코드가 일반 products에 중복되는지 확인 (방어 코드)
 */
function isCodeConflictWithNormal(db, code, excludeId = null) {
  // 일반 products에 같은 코드가 있으면 충돌
  if ((db.products || []).some(p => p.code === code)) return true;
  // 현대 자재 내 중복 확인 (excludeId는 수정 시 자기 자신 제외)
  if ((db.hyundaiProducts || []).some(p => p.code === code && p.id !== excludeId)) return true;
  return false;
}

// ─────────────────────── 데이터 포맷 ─────────────────────────

function formatProduct(p) {
  return {
    id:           p.id,
    code:         p.code,
    name:         p.name,
    category:     p.category    || "원자재",
    unit:         p.unit        || "ea",
    qty:          safeNumber(p.qty,          0),
    unitPrice:    safeNumber(p.unitPrice,    0),
    penaltyRate:  safeNumber(p.penaltyRate,  DEFAULT_PENALTY_RATE),
    penaltyPrice: safeNumber(p.unitPrice, 0) * safeNumber(p.penaltyRate, DEFAULT_PENALTY_RATE),
    location:     p.location    || "",
    spec:         p.spec        || "",
    note:         p.note        || "",
    stock_type:   "hyundai",     // 항상 고정값으로 반환
    updatedAt:    p.updatedAt,
    createdAt:    p.createdAt,
  };
}

// ═══════════════════════════════════════════════════════════════
//  GET /hyundai/products
// ═══════════════════════════════════════════════════════════════

router.get("/", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const db       = readDB();
  const products = (db.hyundaiProducts || []).map(formatProduct);

  // 검색 필터 (선택)
  const q = String(req.query.q || "").trim().toLowerCase();
  const filtered = q
    ? products.filter(p =>
        p.code.toLowerCase().includes(q)     ||
        p.name.toLowerCase().includes(q)     ||
        p.location.toLowerCase().includes(q) ||
        p.category.toLowerCase().includes(q)
      )
    : products;

  return res.json({ ok: true, products: filtered, total: filtered.length });
});

// ═══════════════════════════════════════════════════════════════
//  GET /hyundai/products/:id
// ═══════════════════════════════════════════════════════════════

router.get("/:id", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const id = String(req.params.id || "").trim();
  const db = readDB();
  const p  = (db.hyundaiProducts || []).find(item => item.id === id || item.code === id);

  if (!p) return res.status(404).json({ ok: false, message: "현대 자재를 찾을 수 없습니다." });
  return res.json({ ok: true, product: formatProduct(p) });
});

// ═══════════════════════════════════════════════════════════════
//  POST /hyundai/products  (등록)
// ═══════════════════════════════════════════════════════════════

/**
 * Body:
 * {
 *   "code": "HY001",
 *   "name": "현대 강판 A",
 *   "category": "원자재",
 *   "unit": "ea",
 *   "qty": 50,
 *   "unitPrice": 150000,
 *   "penaltyRate": 3,        // 분실 패널티 배율 (기본 3)
 *   "location": "현대창고 A",
 *   "spec": "두께 2mm",
 *   "note": ""
 * }
 */
router.post("/", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!requireRole(auth, ["admin", "manager"], res)) return;

  const {
    code, name, category, unit, qty,
    unitPrice, penaltyRate, location, spec, note,
  } = req.body || {};

  if (!code || !String(code).trim())
    return res.status(400).json({ ok: false, message: "code는 필수입니다." });
  if (!name || !String(name).trim())
    return res.status(400).json({ ok: false, message: "name은 필수입니다." });

  const codeStr = String(code).trim();

  const db = readDB();
  if (!Array.isArray(db.hyundaiProducts)) db.hyundaiProducts = [];

  // 방어 코드: 일반 products 또는 현대 자재에 동일 코드 존재 여부 확인
  if (isCodeConflictWithNormal(db, codeStr))
    return res.status(409).json({
      ok: false,
      message: `코드 '${codeStr}'는 이미 일반 상품 또는 현대 자재에 등록되어 있습니다.`,
    });

  const validQty        = safePositive(qty, 0) ?? 0;
  const validUnitPrice  = safePositive(unitPrice, 0) ?? 0;
  const validPenalty    = safePositive(penaltyRate, 1) ?? DEFAULT_PENALTY_RATE;

  const product = {
    id:          genId("HY"),
    code:        codeStr,
    name:        String(name).trim(),
    category:    String(category || "원자재").trim(),
    unit:        String(unit     || "ea").trim(),
    qty:         validQty,
    unitPrice:   validUnitPrice,
    penaltyRate: validPenalty,
    location:    String(location || "").trim(),
    spec:        String(spec     || "").trim(),
    note:        String(note     || "").trim(),
    stock_type:  "hyundai",
    createdAt:   nowISO(),
    updatedAt:   nowISO(),
  };

  db.hyundaiProducts.push(product);

  // 이력 기록
  if (!Array.isArray(db.history)) db.history = [];
  db.history.unshift({
    id:          genId("H"),
    productCode: codeStr,
    type:        "CREATE",
    delta:       validQty,
    memo:        `[현대자재] 신규 등록: ${product.name}`,
    user:        auth.username,
    at:          nowISO(),
  });

  writeDB(db);

  // 소켓 브로드캐스트 (선택)
  try {
    if (req.io) req.io.emit("inventory:update", {
      message:     `[현대자재] 등록: ${codeStr} (${product.name})`,
      productCode: codeStr,
      kind:        "CREATE",
      stockType:   "hyundai",
      at:          nowISO(),
    });
  } catch {}

  return res.status(201).json({ ok: true, product: formatProduct(product) });
});

// ═══════════════════════════════════════════════════════════════
//  PUT /hyundai/products/:id  (수정)
// ═══════════════════════════════════════════════════════════════

router.put("/:id", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!requireRole(auth, ["admin", "manager"], res)) return;

  const id = String(req.params.id || "").trim();
  const db = readDB();
  if (!Array.isArray(db.hyundaiProducts)) db.hyundaiProducts = [];

  const idx = db.hyundaiProducts.findIndex(p => p.id === id);
  if (idx === -1)
    return res.status(404).json({ ok: false, message: "현대 자재를 찾을 수 없습니다." });

  const prev    = db.hyundaiProducts[idx];
  const payload = req.body || {};

  // code 변경 시 충돌 확인
  if (payload.code !== undefined) {
    const newCode = String(payload.code).trim();
    if (newCode !== prev.code && isCodeConflictWithNormal(db, newCode, id))
      return res.status(409).json({
        ok: false,
        message: `코드 '${newCode}'는 이미 다른 상품에 등록되어 있습니다.`,
      });
  }

  const next = {
    ...prev,
    name:        payload.name        !== undefined ? String(payload.name).trim()                            : prev.name,
    code:        payload.code        !== undefined ? String(payload.code).trim()                            : prev.code,
    category:    payload.category    !== undefined ? String(payload.category || "원자재").trim()             : prev.category,
    unit:        payload.unit        !== undefined ? String(payload.unit || "ea").trim()                    : prev.unit,
    unitPrice:   payload.unitPrice   !== undefined ? (safePositive(payload.unitPrice, 0) ?? prev.unitPrice) : prev.unitPrice,
    penaltyRate: payload.penaltyRate !== undefined ? (safePositive(payload.penaltyRate, 1) ?? prev.penaltyRate) : prev.penaltyRate,
    location:    payload.location    !== undefined ? String(payload.location || "").trim()                  : prev.location,
    spec:        payload.spec        !== undefined ? String(payload.spec     || "").trim()                  : prev.spec,
    note:        payload.note        !== undefined ? String(payload.note     || "").trim()                  : prev.note,
    stock_type:  "hyundai",
    updatedAt:   nowISO(),
  };

  db.hyundaiProducts[idx] = next;

  // 이력 기록
  if (!Array.isArray(db.history)) db.history = [];
  db.history.unshift({
    id:          genId("H"),
    productCode: next.code,
    type:        "UPDATE",
    delta:       0,
    memo:        `[현대자재] 정보 수정: ${next.name}`,
    user:        auth.username,
    at:          nowISO(),
  });

  writeDB(db);

  try {
    if (req.io) req.io.emit("inventory:update", {
      message:     `[현대자재] 수정: ${next.code} (${next.name})`,
      productCode: next.code,
      kind:        "UPDATE",
      stockType:   "hyundai",
      at:          nowISO(),
    });
  } catch {}

  return res.json({ ok: true, product: formatProduct(next) });
});

// ═══════════════════════════════════════════════════════════════
//  DELETE /hyundai/products/:id  (삭제, admin 전용)
// ═══════════════════════════════════════════════════════════════

router.delete("/:id", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!requireRole(auth, ["admin"], res)) return;

  const id = String(req.params.id || "").trim();
  const db = readDB();
  if (!Array.isArray(db.hyundaiProducts)) db.hyundaiProducts = [];

  const idx = db.hyundaiProducts.findIndex(p => p.id === id);
  if (idx === -1)
    return res.status(404).json({ ok: false, message: "현대 자재를 찾을 수 없습니다." });

  const [deleted] = db.hyundaiProducts.splice(idx, 1);

  if (!Array.isArray(db.history)) db.history = [];
  db.history.unshift({
    id:          genId("H"),
    productCode: deleted.code,
    type:        "DELETE",
    delta:       -deleted.qty,
    memo:        `[현대자재] 삭제: ${deleted.name}`,
    user:        auth.username,
    at:          nowISO(),
  });

  writeDB(db);

  try {
    if (req.io) req.io.emit("inventory:update", {
      message:     `[현대자재] 삭제: ${deleted.code} (${deleted.name})`,
      productCode: deleted.code,
      kind:        "DELETE",
      stockType:   "hyundai",
      at:          nowISO(),
    });
  } catch {}

  return res.json({ ok: true, deleted: formatProduct(deleted) });
});

// ═══════════════════════════════════════════════════════════════
//  POST /hyundai/products/:id/adjust  (재고 조정)
// ═══════════════════════════════════════════════════════════════

/**
 * Body:
 * {
 *   "type": "IN" | "OUT" | "ADJUST",
 *   "delta": 10,
 *   "memo": "선택사항",
 *   "isLost": false    // true이면 패널티 단가 적용 정보 기록
 * }
 */
router.post("/:id/adjust", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!requireRole(auth, ["admin", "manager", "staff"], res)) return;

  const id = String(req.params.id || "").trim();
  const db = readDB();
  if (!Array.isArray(db.hyundaiProducts)) db.hyundaiProducts = [];

  const idx = db.hyundaiProducts.findIndex(p => p.id === id || p.code === id);
  if (idx === -1)
    return res.status(404).json({ ok: false, message: "현대 자재를 찾을 수 없습니다." });

  const { type, delta, memo, isLost } = req.body || {};

  const ALLOWED_TYPES = ["IN", "OUT", "ADJUST"];
  if (!ALLOWED_TYPES.includes(String(type || "").toUpperCase()))
    return res.status(400).json({ ok: false, message: "type은 IN, OUT, ADJUST 중 하나여야 합니다." });

  const txType     = String(type).toUpperCase();
  const parsedDelta = Number(delta);
  if (!Number.isFinite(parsedDelta) || parsedDelta === 0)
    return res.status(400).json({ ok: false, message: "delta는 0이 아닌 숫자여야 합니다." });

  const prev = db.hyundaiProducts[idx];
  let nextQty = prev.qty;

  if      (txType === "IN")     nextQty = prev.qty + Math.abs(parsedDelta);
  else if (txType === "OUT")    nextQty = prev.qty - Math.abs(parsedDelta);
  else if (txType === "ADJUST") nextQty = prev.qty + parsedDelta;

  if (nextQty < 0)
    return res.status(400).json({
      ok: false,
      message: `재고가 부족합니다. 현재: ${prev.qty}, 요청: ${Math.abs(parsedDelta)}`,
    });

  const appliedDelta = txType === "IN"
    ? Math.abs(parsedDelta)
    : txType === "OUT" ? -Math.abs(parsedDelta)
    : parsedDelta;

  db.hyundaiProducts[idx] = { ...prev, qty: nextQty, updatedAt: nowISO() };

  // 패널티 계산 (분실 시)
  const penaltyApplied = isLost === true || isLost === "true";
  const penaltyAmount  = penaltyApplied
    ? Math.abs(appliedDelta) * prev.unitPrice * prev.penaltyRate
    : 0;

  if (!Array.isArray(db.history)) db.history = [];
  db.history.unshift({
    id:          genId("H"),
    productCode: prev.code,
    type:        txType,
    delta:       appliedDelta,
    memo:        [
      "[현대자재]",
      memo || "",
      penaltyApplied ? `(분실패널티: ${penaltyAmount.toLocaleString()}원)` : "",
    ].filter(Boolean).join(" ").trim(),
    user:        auth.username,
    at:          nowISO(),
  });

  writeDB(db);

  try {
    if (req.io) req.io.emit("inventory:update", {
      message:     `[현대자재] ${txType}: ${prev.code} (${prev.name}) ${appliedDelta > 0 ? "+" : ""}${appliedDelta}`,
      productCode: prev.code,
      kind:        txType,
      delta:       appliedDelta,
      stockType:   "hyundai",
      at:          nowISO(),
    });
  } catch {}

  return res.json({
    ok: true,
    product:       formatProduct(db.hyundaiProducts[idx]),
    appliedDelta,
    penaltyApplied,
    penaltyAmount,
  });
});

module.exports = router;
