/**
 * ledgerController.js
 * 재고 변동 통합 로그(Inventory Ledger) API
 *
 * type ENUM:
 *   INBOUND, OUTBOUND, ADJUST, PRODUCE, MATERIAL_OUT, SALE, RETURN
 */
"use strict";

const { readDB, writeDB, nowISO, genId } = require("../config/database");

function requireAuth(req, res) {
  const username = req.headers["x-user"];
  const role     = req.headers["x-role"];
  if (!username || !role) {
    res.status(401).json({ success: false, message: "인증 헤더 누락 (x-user, x-role)" });
    return null;
  }
  return { username, role };
}

const VALID_TYPES = ["INBOUND","OUTBOUND","ADJUST","PRODUCE","MATERIAL_OUT","SALE","RETURN"];

/**
 * 로그 엔트리 생성 헬퍼 (다른 컨트롤러에서도 공유 사용)
 * db 객체를 직접 받아 db.ledger에 push 후 반환
 * (writeDB는 호출부에서 한 번만 수행)
 */
function createLedgerEntry(db, {
  type, sku, qtyChange, qtyBefore, qtyAfter,
  reason = "", refId = "", userId, meta = {}
}) {
  const entry = {
    id:        genId("LED"),
    timestamp: nowISO(),
    userId,
    type,
    sku,
    qtyChange:  Number(qtyChange),
    qtyBefore:  Number(qtyBefore),
    qtyAfter:   Number(qtyAfter),
    reason:     String(reason || ""),
    refId:      String(refId  || ""),
    meta,
  };
  if (!Array.isArray(db.ledger)) db.ledger = [];
  db.ledger.unshift(entry);
  return entry;
}

// GET /ledger  — 필터: ?type=&sku=&from=&to=&page=&limit=
function listLedger(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const db = readDB();
  const { type, sku, from, to, page = 1, limit = 50 } = req.query;

  let items = Array.isArray(db.ledger) ? [...db.ledger] : [];

  if (type)  items = items.filter(e => e.type === type);
  if (sku)   items = items.filter(e => e.sku  === sku);
  if (from)  items = items.filter(e => e.timestamp >= from);
  if (to)    items = items.filter(e => e.timestamp <= to + "T23:59:59.999Z");

  const total   = items.length;
  const pageNum = Math.max(1, Number(page));
  const pageSize= Math.min(200, Math.max(1, Number(limit)));
  const paged   = items.slice((pageNum - 1) * pageSize, pageNum * pageSize);

  return res.json({ success: true, data: { items: paged, total, page: pageNum, limit: pageSize } });
}

// GET /ledger/:id — 상세
function getLedgerEntry(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const db    = readDB();
  const entry = (db.ledger || []).find(e => e.id === req.params.id);
  if (!entry) return res.status(404).json({ success: false, message: "로그 항목을 찾을 수 없습니다" });
  return res.json({ success: true, data: entry });
}

module.exports = { listLedger, getLedgerEntry, createLedgerEntry };
