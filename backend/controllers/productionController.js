/**
 * productionController.js
 * BOM 관리 / 제품화(생산) / 판매(SALE) / COGS 리포트
 */
"use strict";

const { readDB, writeDB, nowISO, genId } = require("../config/database");
const { createLedgerEntry } = require("./ledgerController");

// ─────────────────── 공통 헬퍼 ──────────────────────
function requireAuth(req, res) {
  const username = req.headers["x-user"];
  const role     = req.headers["x-role"];
  if (!username || !role) {
    res.status(401).json({ success: false, message: "인증 헤더 누락 (x-user, x-role)" });
    return null;
  }
  return { username, role };
}
function roleAllowed(role, list) { return list.includes(role); }
function safeNum(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 가중평균 단가 계산
 * 입고(INBOUND) 로그로 가중평균, 없으면 unitCost fallback
 */
function calcWeightedAvgCost(db, sku) {
  const inbounds = (db.ledger || []).filter(e => e.sku === sku && e.type === "INBOUND" && e.meta?.unitCost > 0);
  if (inbounds.length === 0) {
    const p = (db.products || []).find(p => p.code === sku);
    return p ? safeNum(p.unitCost || p.price, 0) : 0;
  }
  let totalQty = 0, totalCost = 0;
  inbounds.forEach(e => {
    const qty  = Math.abs(e.qtyChange);
    const cost = safeNum(e.meta?.unitCost, 0);
    totalQty  += qty;
    totalCost += qty * cost;
  });
  return totalQty > 0 ? totalCost / totalQty : 0;
}

// ═══════════════════════════════════════
// BOM CRUD
// ═══════════════════════════════════════

// GET /production/bom/:productCode
function getBom(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const db = readDB();
  const p  = (db.products || []).find(p => p.code === req.params.productCode);
  if (!p) return res.status(404).json({ success: false, message: "상품을 찾을 수 없습니다" });

  return res.json({ success: true, data: { productCode: p.code, bomItems: p.bomItems || [] } });
}

// PUT /production/bom/:productCode  { bomItems:[{componentCode, qtyPerUnit}] }
function saveBom(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!roleAllowed(auth.role, ["admin","manager"]))
    return res.status(403).json({ success: false, message: "권한 없음" });

  const { bomItems } = req.body || {};
  if (!Array.isArray(bomItems))
    return res.status(400).json({ success: false, message: "bomItems 배열이 필요합니다" });

  const db  = readDB();
  const idx = (db.products || []).findIndex(p => p.code === req.params.productCode);
  if (idx === -1) return res.status(404).json({ success: false, message: "상품을 찾을 수 없습니다" });
  if (db.products[idx].productType !== "bom")
    return res.status(400).json({ success: false, message: "BOM 유형 상품만 BOM을 설정할 수 있습니다" });

  // Validate items
  for (const item of bomItems) {
    if (!item.componentCode) return res.status(400).json({ success: false, message: "구성품 코드 누락" });
    if (safeNum(item.qtyPerUnit, 0) <= 0) return res.status(400).json({ success: false, message: "구성품 수량은 0 초과여야 합니다" });
    if (!db.products.find(p => p.code === item.componentCode))
      return res.status(400).json({ success: false, message: `구성품 코드 없음: ${item.componentCode}` });
  }

  db.products[idx].bomItems = bomItems.map(item => ({
    componentCode: String(item.componentCode).trim(),
    qtyPerUnit:    safeNum(item.qtyPerUnit, 1),
  }));
  db.products[idx].updatedAt = nowISO();
  writeDB(db);

  return res.json({ success: true, message: "BOM 저장 완료", data: db.products[idx].bomItems });
}

// ═══════════════════════════════════════
// PRODUCE (제품화/생산)
// ═══════════════════════════════════════

// POST /production/produce
// body: { productCode, qty, memo }
function produce(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!roleAllowed(auth.role, ["admin","manager"]))
    return res.status(403).json({ success: false, message: "권한 없음" });

  const { productCode, qty, memo = "" } = req.body || {};
  if (!productCode) return res.status(400).json({ success: false, message: "productCode 필수" });

  const produceQty = safeNum(qty, 0);
  if (produceQty <= 0) return res.status(400).json({ success: false, message: "생산 수량은 0 초과여야 합니다" });

  const db = readDB();
  const finishedIdx = (db.products || []).findIndex(p => p.code === productCode);
  if (finishedIdx === -1) return res.status(404).json({ success: false, message: "완제품을 찾을 수 없습니다" });

  const finished = db.products[finishedIdx];
  if (finished.productType !== "bom")
    return res.status(400).json({ success: false, message: "BOM 유형 상품만 생산할 수 있습니다" });

  const bomItems = finished.bomItems || [];
  if (bomItems.length === 0)
    return res.status(400).json({ success: false, message: "BOM이 비어 있습니다. 먼저 BOM을 설정하세요." });

  // ① 재고 부족 사전 체크
  const materialChecks = [];
  for (const item of bomItems) {
    const comp = (db.products || []).find(p => p.code === item.componentCode);
    if (!comp) return res.status(400).json({ success: false, message: `구성품 없음: ${item.componentCode}` });
    const needed = item.qtyPerUnit * produceQty;
    if (comp.qty < needed)
      return res.status(400).json({
        success: false,
        message: `재고 부족: ${comp.name}(${comp.code}) 필요=${needed} 현재=${comp.qty}`,
        data: { componentCode: comp.code, needed, available: comp.qty }
      });
    materialChecks.push({ comp, compIdx: db.products.indexOf(comp), needed });
  }

  // ② BOM 스냅샷 + 원가 계산
  const lotId      = genId("LOT");
  let   totalMaterialCost = 0;
  const bomSnapshot = [];

  for (const item of bomItems) {
    const unitCost = calcWeightedAvgCost(db, item.componentCode);
    const needed   = item.qtyPerUnit * produceQty;
    totalMaterialCost += unitCost * needed;
    bomSnapshot.push({
      componentCode: item.componentCode,
      qtyPerUnit:    item.qtyPerUnit,
      neededQty:     needed,
      unitCost,
      lineCost:      unitCost * needed,
    });
  }
  const unitCostOfFinished = produceQty > 0 ? totalMaterialCost / produceQty : 0;

  // ③ 원자재 차감 + 로그
  for (const { comp, compIdx, needed } of materialChecks) {
    const before = comp.qty;
    const after  = before - needed;
    db.products[compIdx] = { ...comp, qty: after, updatedAt: nowISO() };
    createLedgerEntry(db, {
      type:      "MATERIAL_OUT",
      sku:       comp.code,
      qtyChange: -needed,
      qtyBefore: before,
      qtyAfter:  after,
      reason:    `생산(${productCode}) 원자재 소모`,
      refId:     lotId,
      userId:    auth.username,
      meta:      { lotId, finishedProductCode: productCode, produceQty },
    });
  }

  // ④ 완제품 증가 + 로그
  const finBefore = finished.qty;
  const finAfter  = finBefore + produceQty;
  db.products[finishedIdx] = { ...finished, qty: finAfter, updatedAt: nowISO() };
  createLedgerEntry(db, {
    type:      "PRODUCE",
    sku:       productCode,
    qtyChange: +produceQty,
    qtyBefore: finBefore,
    qtyAfter:  finAfter,
    reason:    memo || `생산 완료`,
    refId:     lotId,
    userId:    auth.username,
    meta:      { lotId, bomSnapshot, totalMaterialCost, unitCostOfFinished },
  });

  // ⑤ 생산 로트 기록
  if (!Array.isArray(db.productionLots)) db.productionLots = [];
  const lot = {
    id:                lotId,
    productCode,
    producedQty:       produceQty,
    unitCost:          unitCostOfFinished,
    totalCost:         totalMaterialCost,
    bomSnapshot,
    memo:              String(memo || ""),
    timestamp:         nowISO(),
    userId:            auth.username,
  };
  db.productionLots.unshift(lot);

  // ⑥ history 호환 기록
  if (!Array.isArray(db.history)) db.history = [];
  db.history.unshift({
    id: genId("H"), productCode, type: "PRODUCE",
    delta: produceQty, memo: memo || `생산 로트: ${lotId}`,
    user: auth.username, at: nowISO(), refId: lotId,
  });

  writeDB(db);

  // ⑦ Socket 브로드캐스트
  if (req.io) {
    req.io.emit("inventory:update", {
      message: `생산 완료: ${finished.name} x${produceQty}`,
      productCode, kind: "PRODUCE", delta: produceQty, at: nowISO(),
    });
  }

  return res.status(201).json({
    success: true,
    message: `생산 완료: ${finished.name} x${produceQty}`,
    data: { lot, finishedQty: finAfter },
  });
}

// GET /production/lots  — 생산 로트 목록
function listLots(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const db = readDB();
  const { productCode, from, to } = req.query;
  let items = Array.isArray(db.productionLots) ? [...db.productionLots] : [];

  if (productCode) items = items.filter(l => l.productCode === productCode);
  if (from)        items = items.filter(l => l.timestamp >= from);
  if (to)          items = items.filter(l => l.timestamp <= to + "T23:59:59.999Z");

  return res.json({ success: true, data: items });
}

// ═══════════════════════════════════════
// SALE (판매 출고)
// ═══════════════════════════════════════

// POST /production/sale
// body: { productCode, qty, salePrice, memo }
function sale(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;
  if (!roleAllowed(auth.role, ["admin","manager","staff"]))
    return res.status(403).json({ success: false, message: "권한 없음" });

  const { productCode, qty, salePrice = 0, memo = "" } = req.body || {};
  if (!productCode) return res.status(400).json({ success: false, message: "productCode 필수" });

  const saleQty = safeNum(qty, 0);
  if (saleQty <= 0) return res.status(400).json({ success: false, message: "판매 수량은 0 초과여야 합니다" });

  const db = readDB();
  const pIdx = (db.products || []).findIndex(p => p.code === productCode);
  if (pIdx === -1) return res.status(404).json({ success: false, message: "상품을 찾을 수 없습니다" });

  const product = db.products[pIdx];
  if (product.qty < saleQty)
    return res.status(400).json({
      success: false,
      message: `재고 부족: 필요=${saleQty} 현재=${product.qty}`,
      data: { available: product.qty }
    });

  // 평균 원가 기반 COGS
  const avgCost  = calcWeightedAvgCost(db, productCode);
  const cogs     = avgCost * saleQty;
  const revenue  = safeNum(salePrice, 0) * saleQty;
  const saleId   = genId("SALE");

  // 재고 차감
  const before = product.qty;
  const after  = before - saleQty;
  db.products[pIdx] = { ...product, qty: after, updatedAt: nowISO() };

  // 레저 로그
  createLedgerEntry(db, {
    type:      "SALE",
    sku:       productCode,
    qtyChange: -saleQty,
    qtyBefore: before,
    qtyAfter:  after,
    reason:    memo || "판매 출고",
    refId:     saleId,
    userId:    auth.username,
    meta:      { saleId, saleQty, salePrice: safeNum(salePrice, 0), revenue, cogs, avgCost },
  });

  // 판매 기록
  if (!Array.isArray(db.sales)) db.sales = [];
  const saleRecord = {
    id:          saleId,
    productCode,
    qty:         saleQty,
    salePrice:   safeNum(salePrice, 0),
    revenue,
    cogs,
    avgCost,
    grossProfit: revenue - cogs,
    memo:        String(memo || ""),
    timestamp:   nowISO(),
    userId:      auth.username,
  };
  db.sales.unshift(saleRecord);

  // history 호환
  if (!Array.isArray(db.history)) db.history = [];
  db.history.unshift({
    id: genId("H"), productCode, type: "SALE",
    delta: -saleQty, memo: memo || `판매: ${saleId}`,
    user: auth.username, at: nowISO(), refId: saleId,
  });

  writeDB(db);

  if (req.io) {
    req.io.emit("inventory:update", {
      message: `판매 출고: ${product.name} x${saleQty}`,
      productCode, kind: "SALE", delta: -saleQty, at: nowISO(),
    });
  }

  return res.status(201).json({
    success: true,
    message: `판매 완료: ${product.name} x${saleQty}`,
    data: { sale: saleRecord, remainingQty: after },
  });
}

// GET /production/sales — 판매 목록
function listSales(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const db = readDB();
  const { productCode, from, to } = req.query;
  let items = Array.isArray(db.sales) ? [...db.sales] : [];

  if (productCode) items = items.filter(s => s.productCode === productCode);
  if (from)        items = items.filter(s => s.timestamp >= from);
  if (to)          items = items.filter(s => s.timestamp <= to + "T23:59:59.999Z");

  return res.json({ success: true, data: items });
}

// ═══════════════════════════════════════
// COGS REPORT
// ═══════════════════════════════════════

// GET /production/cogs-report?from=&to=
function cogsReport(req, res) {
  const auth = requireAuth(req, res);
  if (!auth) return;

  const db = readDB();
  const { from, to } = req.query;
  let sales = Array.isArray(db.sales) ? [...db.sales] : [];
  let lots  = Array.isArray(db.productionLots) ? [...db.productionLots] : [];

  if (from) {
    sales = sales.filter(s => s.timestamp >= from);
    lots  = lots.filter(l => l.timestamp >= from);
  }
  if (to) {
    sales = sales.filter(s => s.timestamp <= to + "T23:59:59.999Z");
    lots  = lots.filter(l => l.timestamp <= to + "T23:59:59.999Z");
  }

  // 판매 집계
  const totalRevenue    = sales.reduce((a, s) => a + safeNum(s.revenue, 0),      0);
  const totalCogs       = sales.reduce((a, s) => a + safeNum(s.cogs, 0),         0);
  const totalGrossProfit= sales.reduce((a, s) => a + safeNum(s.grossProfit, 0),   0);
  const totalSaleQty    = sales.reduce((a, s) => a + safeNum(s.qty, 0),           0);

  // 생산 집계
  const totalProductionCost = lots.reduce((a, l) => a + safeNum(l.totalCost, 0), 0);
  const totalProducedQty    = lots.reduce((a, l) => a + safeNum(l.producedQty, 0),0);

  // 상품별 판매 집계
  const byProduct = {};
  sales.forEach(s => {
    if (!byProduct[s.productCode]) {
      const p = (db.products||[]).find(p=>p.code===s.productCode);
      byProduct[s.productCode] = {
        productCode: s.productCode,
        productName: p ? p.name : s.productCode,
        qty: 0, revenue: 0, cogs: 0, grossProfit: 0,
      };
    }
    byProduct[s.productCode].qty         += safeNum(s.qty, 0);
    byProduct[s.productCode].revenue     += safeNum(s.revenue, 0);
    byProduct[s.productCode].cogs        += safeNum(s.cogs, 0);
    byProduct[s.productCode].grossProfit += safeNum(s.grossProfit, 0);
  });

  return res.json({
    success: true,
    data: {
      period:      { from: from || null, to: to || null },
      summary: {
        totalSaleQty, totalRevenue, totalCogs, totalGrossProfit,
        grossMarginPct: totalRevenue > 0 ? (totalGrossProfit / totalRevenue * 100).toFixed(1) : "0.0",
        totalProductionCost, totalProducedQty,
      },
      byProduct: Object.values(byProduct),
      sales,
      lots,
    },
  });
}

module.exports = {
  getBom, saveBom,
  produce, listLots,
  sale, listSales,
  cogsReport,
};
