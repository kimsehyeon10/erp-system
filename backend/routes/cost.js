/**
 * routes/cost.js - 원가 계산 API
 *
 * 설계 원칙:
 *  - 음수/NaN 입력 방지
 *  - 필수 값 누락 시 400 에러 반환
 *  - 저장 후 재시작해도 유지 (JSON DB 영속화)
 *
 * 엔드포인트:
 *  GET  /cost/:productCode   - 해당 상품의 저장된 원가 기록 조회
 *  POST /cost/calculate      - 원가 계산 (저장 없음, 결과만 반환)
 *  POST /cost/save           - 원가 계산 후 저장
 */
"use strict";

const express = require("express");
const router  = express.Router();
const { readDB, writeDB, nowISO, genId } = require("../config/database");

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

// ─────────────────────── 유효성 검사 ─────────────────────────

/**
 * 숫자가 유효한지 확인 (음수/NaN/Infinity 방지)
 * @param {*} val
 * @param {number} min  최솟값 (기본 0)
 * @returns {number|null}  유효하면 숫자, 아니면 null
 */
function safePositive(val, min = 0) {
  const n = Number(val);
  if (!Number.isFinite(n) || n < min) return null;
  return n;
}

/**
 * 원가 계산 핵심 로직
 *
 * cost = (unitPrice × qty) + sum(additionalCosts)
 * sellingPrice = cost × (1 + marginRate)
 *
 * @param {object} params
 * @returns {{ ok, error, result }}
 */
function calcCost(params) {
  const { unitPrice, qty, additionalCosts = [], marginRate = 0 } = params;

  // ── 필수 값 검증 ─────────────────────────────────────────
  const validUnitPrice = safePositive(unitPrice);
  if (validUnitPrice === null)
    return { ok: false, error: "unitPrice는 0 이상의 숫자여야 합니다." };

  const validQty = safePositive(qty, 1);
  if (validQty === null)
    return { ok: false, error: "qty는 1 이상의 정수여야 합니다." };

  const validMargin = safePositive(marginRate, 0);
  if (validMargin === null)
    return { ok: false, error: "marginRate는 0 이상의 숫자여야 합니다 (예: 0.3 = 30%)." };

  // ── 부가 비용 검증 ────────────────────────────────────────
  if (!Array.isArray(additionalCosts))
    return { ok: false, error: "additionalCosts는 배열이어야 합니다." };

  const validatedAdditional = [];
  for (let i = 0; i < additionalCosts.length; i++) {
    const item = additionalCosts[i];
    if (!item || typeof item !== "object")
      return { ok: false, error: `additionalCosts[${i}]가 올바른 객체가 아닙니다.` };

    const label  = String(item.label || "").trim();
    if (!label)
      return { ok: false, error: `additionalCosts[${i}].label이 비어있습니다.` };

    const amount = safePositive(item.amount, 0);
    if (amount === null)
      return { ok: false, error: `additionalCosts[${i}].amount는 0 이상의 숫자여야 합니다.` };

    validatedAdditional.push({ label, amount });
  }

  // ── 계산 ─────────────────────────────────────────────────
  const materialCost       = validUnitPrice * validQty;
  const totalAdditionalCost = validatedAdditional.reduce((s, c) => s + c.amount, 0);
  const totalCost          = materialCost + totalAdditionalCost;
  const unitCostCalculated = totalCost / validQty;
  const sellingPrice       = totalCost * (1 + validMargin);

  return {
    ok: true,
    result: {
      unitPrice:            validUnitPrice,
      qty:                  validQty,
      marginRate:           validMargin,
      additionalCosts:      validatedAdditional,
      materialCost,
      totalAdditionalCost,
      totalCost,
      unitCostCalculated:   Math.round(unitCostCalculated * 100) / 100,
      sellingPrice:         Math.round(sellingPrice * 100) / 100,
    },
  };
}

// ─────────────────────── GET /cost/:productCode ───────────────

/**
 * 특정 상품 코드의 저장된 원가 기록 조회
 * query: ?limit=20 (기본 20, 최대 100)
 */
router.get("/:productCode", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const productCode = String(req.params.productCode || "").trim();
  if (!productCode)
    return res.status(400).json({ ok: false, message: "productCode가 필요합니다." });

  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));

  const db      = readDB();
  const records = (db.costRecords || [])
    .filter(r => r.productCode === productCode)
    .sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt))
    .slice(0, limit);

  return res.json({ ok: true, productCode, records });
});

// ─────────────────────── POST /cost/calculate ────────────────

/**
 * 원가 계산 (저장하지 않음, 결과만 반환)
 *
 * Body:
 * {
 *   "productCode": "P001",          // 선택 (참조용)
 *   "unitPrice": 100000,            // 매입 단가
 *   "qty": 10,                      // 수량
 *   "additionalCosts": [            // 부가 비용 배열 (선택)
 *     { "label": "운송비", "amount": 50000 },
 *     { "label": "인건비", "amount": 30000 }
 *   ],
 *   "marginRate": 0.3               // 마진율 (0.3 = 30%), 선택
 * }
 */
router.post("/calculate", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const { productCode, unitPrice, qty, additionalCosts, marginRate } = req.body || {};

  const calc = calcCost({ unitPrice, qty, additionalCosts, marginRate });
  if (!calc.ok)
    return res.status(400).json({ ok: false, message: calc.error });

  // productCode가 있으면 상품명도 같이 반환
  let productName = null;
  if (productCode) {
    const db = readDB();
    const product = (db.products || []).find(p => p.code === productCode);
    if (product) productName = product.name;
  }

  return res.json({
    ok: true,
    productCode: productCode || null,
    productName,
    ...calc.result,
  });
});

// ─────────────────────── POST /cost/save ─────────────────────

/**
 * 원가 계산 후 결과를 DB에 저장
 *
 * Body: 위 calculate와 동일 + productCode 필수
 */
router.post("/save", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const { productCode, unitPrice, qty, additionalCosts, marginRate, memo } = req.body || {};

  if (!productCode || !String(productCode).trim())
    return res.status(400).json({ ok: false, message: "productCode는 필수입니다." });

  const code = String(productCode).trim();

  const calc = calcCost({ unitPrice, qty, additionalCosts, marginRate });
  if (!calc.ok)
    return res.status(400).json({ ok: false, message: calc.error });

  const db = readDB();

  // 상품 존재 여부 확인 (일반 상품 또는 현대 자재)
  const product    = (db.products        || []).find(p => p.code === code);
  const hyProduct  = (db.hyundaiProducts || []).find(p => p.code === code);
  const targetName = product?.name || hyProduct?.name || code;

  if (!product && !hyProduct)
    return res.status(404).json({ ok: false, message: `상품 코드 '${code}'을(를) 찾을 수 없습니다.` });

  const record = {
    id:          genId("COST"),
    productCode: code,
    productName: targetName,
    memo:        String(memo || "").trim(),
    savedAt:     nowISO(),
    savedBy:     auth.username,
    ...calc.result,
  };

  if (!Array.isArray(db.costRecords)) db.costRecords = [];
  db.costRecords.unshift(record);

  writeDB(db);

  return res.status(201).json({ ok: true, record });
});

// ─────────────────────── DELETE /cost/:id ────────────────────

/**
 * 저장된 원가 기록 삭제 (admin 전용)
 */
router.delete("/:id", (req, res) => {
  const auth = requireAuth(req, res);
  if (!auth) return;

  if (auth.role !== "admin")
    return res.status(403).json({ ok: false, message: "admin만 삭제할 수 있습니다." });

  const id = String(req.params.id || "").trim();
  if (!id)
    return res.status(400).json({ ok: false, message: "id가 필요합니다." });

  const db  = readDB();
  const idx = (db.costRecords || []).findIndex(r => r.id === id);

  if (idx === -1)
    return res.status(404).json({ ok: false, message: "해당 원가 기록을 찾을 수 없습니다." });

  const [deleted] = db.costRecords.splice(idx, 1);
  writeDB(db);

  return res.json({ ok: true, deleted });
});

module.exports = router;
