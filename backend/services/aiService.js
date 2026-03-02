"use strict";

/**
 * aiService.js — 재고 리스크 예측 서비스
 *
 * ✅ 기능 5가지:
 *   1) 품절 위험 감지     (days_to_stockout)
 *   2) 과잉 재고 감지     (overstock_score)
 *   3) 비정상 출고 감지   (anomaly_score)
 *   4) 단가 급변 감지     (price_change_rate)
 *   5) 자동 발주 추천     (reorder_point, recommended_qty)
 *
 * ✅ DB 연결 전략:
 *   - PostgreSQL 연결 성공 → postgres 모드
 *   - PostgreSQL 연결 실패 → JSON fallback 모드 (database.json)
 */

const path = require("path");
const fs   = require("fs");

const { analyzeItem } = require("./riskEngine");

// ── 연결 오류 판별 ────────────────────────────────────────────────────
function isConnectionError(err) {
  return (
    ["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "EHOSTUNREACH"].includes(err.code) ||
    err.code === "3D000"  || // DB not found
    err.code === "28P01"  || // auth failure
    /connect|ECONNREFUSED/i.test(err.message || "")
  );
}

// ── PostgreSQL 스키마 보강 (멱등) ─────────────────────────────────────
let _pgSchemaReady = false;
async function ensurePgSchema(pool) {
  if (_pgSchemaReady) return;
  await pool.query(`
    ALTER TABLE inventory_transactions
      ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(15,4)
  `);
  _pgSchemaReady = true;
}

// ── PostgreSQL 집계 쿼리 ──────────────────────────────────────────────
async function fetchRowsFromPg(pool, days) {
  await ensurePgSchema(pool);

  const { rows } = await pool.query(
    `
    WITH
      prods AS (
        SELECT id AS product_id, code, name,
               qty_on_hand AS current_qty,
               safety_stock
        FROM products
      ),
      out_window AS (
        SELECT product_id, SUM(ABS(qty_delta)) AS total_out
        FROM inventory_transactions
        WHERE tx_type = 'OUT'
          AND happened_at >= NOW() - INTERVAL '1 day' * $1
        GROUP BY product_id
      ),
      out_1d AS (
        SELECT product_id, SUM(ABS(qty_delta)) AS out_1d
        FROM inventory_transactions
        WHERE tx_type = 'OUT'
          AND happened_at >= NOW() - INTERVAL '1 day'
        GROUP BY product_id
      ),
      out_prev7 AS (
        SELECT product_id,
               SUM(ABS(qty_delta)) / 7.0 AS avg_prev7_per_day
        FROM inventory_transactions
        WHERE tx_type = 'OUT'
          AND happened_at >= NOW() - INTERVAL '8 days'
          AND happened_at <  NOW() - INTERVAL '1 day'
        GROUP BY product_id
      ),
      out_90d AS (
        SELECT product_id, SUM(ABS(qty_delta)) AS out_90d
        FROM inventory_transactions
        WHERE tx_type = 'OUT'
          AND happened_at >= NOW() - INTERVAL '90 days'
        GROUP BY product_id
      ),
      last_out AS (
        SELECT product_id, MAX(happened_at) AS last_out_at
        FROM inventory_transactions
        WHERE tx_type = 'OUT'
        GROUP BY product_id
      ),
      last_cost AS (
        SELECT DISTINCT ON (product_id)
          product_id, unit_cost AS last_cost
        FROM inventory_transactions
        WHERE unit_cost IS NOT NULL AND unit_cost > 0
        ORDER BY product_id, happened_at DESC
      ),
      avg_cost AS (
        SELECT product_id, AVG(unit_cost) AS avg_cost_30
        FROM inventory_transactions
        WHERE unit_cost IS NOT NULL AND unit_cost > 0
          AND happened_at >= NOW() - INTERVAL '30 days'
        GROUP BY product_id
      )
    SELECT
      p.product_id, 1 AS warehouse_id,
      p.name, p.code,
      p.current_qty, p.safety_stock,
      COALESCE(ow.total_out,          0) AS total_out,
      COALESCE(o1.out_1d,             0) AS out_1d,
      COALESCE(op7.avg_prev7_per_day, 0) AS avg_prev7_per_day,
      lo.last_out_at,
      lc.last_cost,
      ac.avg_cost_30,
      COALESCE(o90.out_90d,           0) AS out_90d
    FROM prods p
    LEFT JOIN out_window ow  ON p.product_id = ow.product_id
    LEFT JOIN out_1d     o1  ON p.product_id = o1.product_id
    LEFT JOIN out_prev7  op7 ON p.product_id = op7.product_id
    LEFT JOIN out_90d    o90 ON p.product_id = o90.product_id
    LEFT JOIN last_out   lo  ON p.product_id = lo.product_id
    LEFT JOIN last_cost  lc  ON p.product_id = lc.product_id
    LEFT JOIN avg_cost   ac  ON p.product_id = ac.product_id
    ORDER BY p.product_id
    `,
    [days]
  );

  return rows.map(r => ({
    product_id:        Number(r.product_id),
    warehouse_id:      1,
    name:              r.name,
    code:              r.code,
    current_qty:       Number(r.current_qty),
    safety_stock:      Number(r.safety_stock || 0),
    total_out:         Number(r.total_out),
    out_1d:            Number(r.out_1d),
    avg_prev7_per_day: Number(r.avg_prev7_per_day),
    last_out_at:       r.last_out_at || null,
    last_cost:         r.last_cost  != null ? Number(r.last_cost)   : null,
    avg_cost_30:       r.avg_cost_30 != null ? Number(r.avg_cost_30) : null,
    out_90d:           Number(r.out_90d),
  }));
}

// ── JSON fallback: database.json 기반 집계 ───────────────────────────
function fetchRowsFromJSON(days) {
  const DB_PATH = path.join(__dirname, "../models/database.json");
  const raw = fs.readFileSync(DB_PATH, "utf-8");
  const db  = JSON.parse(raw);

  const products = db.products || [];
  const history  = db.history  || [];

  const now      = Date.now();
  const MS       = 86_400_000; // 1day ms
  const winStart = now - days * MS;
  const d90Start = now - 90   * MS;
  const d1Start  = now -  1   * MS;
  const d8Start  = now -  8   * MS; // 오늘 제외 7일 전
  const d30Start = now - 30   * MS;

  return products.map((p, idx) => {
    // 취소되지 않은 OUT 이력만
    const outTx = history.filter(
      h => h.productCode === p.code && h.type === "OUT" && !h.canceledAt
    );
    // 취소되지 않은 IN 이력 (단가용)
    const inTx = history.filter(
      h => h.productCode === p.code && h.type === "IN" && !h.canceledAt
    );

    const totalOut = outTx
      .filter(h => new Date(h.at).getTime() >= winStart)
      .reduce((s, h) => s + Math.abs(h.delta), 0);

    const out1d = outTx
      .filter(h => new Date(h.at).getTime() >= d1Start)
      .reduce((s, h) => s + Math.abs(h.delta), 0);

    // 직전 7일 (오늘 미포함)
    const prev7total = outTx
      .filter(h => {
        const t = new Date(h.at).getTime();
        return t >= d8Start && t < d1Start;
      })
      .reduce((s, h) => s + Math.abs(h.delta), 0);

    const out90d = outTx
      .filter(h => new Date(h.at).getTime() >= d90Start)
      .reduce((s, h) => s + Math.abs(h.delta), 0);

    const outTimes = outTx.map(h => new Date(h.at).getTime());
    const lastOutAt =
      outTimes.length > 0
        ? new Date(Math.max(...outTimes)).toISOString()
        : null;

    // 단가: 최근 단가 vs 30일 평균
    const lastCost   = p.unitCost != null ? p.unitCost : (p.price || null);
    const in30d      = inTx.filter(h => new Date(h.at).getTime() >= d30Start);
    const avgCost30  =
      in30d.length > 0
        ? in30d.reduce((s, h) => s + (h.unitCost || p.unitCost || p.price || 0), 0) /
          in30d.length
        : lastCost; // 30일 이력 없으면 현재가와 동일 → pct_change = 0

    return {
      product_id:        idx + 1,
      warehouse_id:      1,
      name:              p.name,
      code:              p.code,
      current_qty:       Number(p.qty || 0),
      safety_stock:      Number(p.safetyStock || 0),
      total_out:         totalOut,
      out_1d:            out1d,
      avg_prev7_per_day: prev7total / 7,
      last_out_at:       lastOutAt,
      last_cost:         lastCost,
      avg_cost_30:       avgCost30,
      out_90d:           out90d,
    };
  });
}

// ── 요약 집계 ─────────────────────────────────────────────────────────
function buildSummary(items, params) {
  const high    = items.filter(i => i.risk.total_level === "HIGH");
  const med     = items.filter(i => i.risk.total_level === "MED");
  const reorder = items.filter(i => i.recommendation.reorder.should_order);
  return {
    total_items:     items.length,
    high_risk_count: high.length,
    med_risk_count:  med.length,
    ok_count:        items.length - high.length - med.length,
    reorder_count:   reorder.length,
    params,
  };
}

// ── 정렬: HIGH → MED → OK ─────────────────────────────────────────────
const LEVEL_ORDER = { HIGH: 0, MED: 1, OK: 2 };
function sortItems(items) {
  return [...items].sort((a, b) => {
    const la = LEVEL_ORDER[a.risk.total_level] ?? 3;
    const lb = LEVEL_ORDER[b.risk.total_level] ?? 3;
    if (la !== lb) return la - lb;
    return b.risk.total_score - a.risk.total_score;
  });
}

// ── 메인 분석 함수 ────────────────────────────────────────────────────
/**
 * fetchAndAnalyze(opts)
 *
 * @param {object} opts
 *   days         - 분석 기간 (기본 30)
 *   stockoutDays - 품절 위험 기준 (기본 7)
 *   deadDays     - 미출고 기준일 (기본 90)
 *   spikeX       - 출고 폭증 배수 (기본 3)
 *   pricePct     - 단가 급변 % (기본 30)
 *   filter       - null | 'stockout' | 'overstock' | 'anomaly' | 'price' | 'reorder'
 *   pool         - pg Pool 인스턴스 (없으면 JSON fallback)
 * @returns {object} { ok, mode, summary, items }
 */
async function fetchAndAnalyze(opts = {}) {
  const {
    days         = 30,
    stockoutDays = 7,
    deadDays     = 90,
    spikeX       = 3,
    pricePct     = 30,
    filter       = null,
    pool         = null,
  } = opts;

  let rawRows;
  let mode = "postgres";

  if (pool) {
    try {
      rawRows = await fetchRowsFromPg(pool, days);
    } catch (err) {
      if (isConnectionError(err)) {
        console.warn("⚠️  [aiService] PostgreSQL 연결 실패 → JSON fallback 모드 전환");
        rawRows = fetchRowsFromJSON(days);
        mode = "json";
      } else {
        throw err;
      }
    }
  } else {
    rawRows = fetchRowsFromJSON(days);
    mode = "json";
  }

  const analysisOpts = { days, stockoutDays, deadDays, spikeX, pricePct };
  let items = rawRows.map(row => analyzeItem(row, analysisOpts));

  // 필터 적용
  if (filter === "stockout") {
    items = items.filter(i => i.risk.stockout.level !== "OK");
  } else if (filter === "overstock") {
    items = items.filter(i => i.risk.overstock.level !== "OK");
  } else if (filter === "anomaly") {
    items = items.filter(i => i.risk.outbound_anomaly.level !== "OK");
  } else if (filter === "price") {
    items = items.filter(i => i.risk.price_spike.level !== "OK");
  } else if (filter === "reorder") {
    items = items.filter(i => i.recommendation.reorder.should_order);
  }

  items = sortItems(items);

  const params  = { days, stockoutDays, deadDays, spikeX, pricePct };
  const summary = buildSummary(items, params);

  // 콘솔 요약
  const highItems = items.filter(i => i.risk.total_level === "HIGH");
  console.log(`\n🔍 [AI Risk] mode=${mode} | 총품목=${summary.total_items} | HIGH=${summary.high_risk_count} | MED=${summary.med_risk_count} | 발주=${summary.reorder_count} | filter=${filter || "all"}`);
  if (highItems.length > 0) {
    highItems.slice(0, 5).forEach((it, i) => {
      const r = it.risk;
      const reasons = [
        r.stockout.reason,
        r.overstock.reason,
        r.outbound_anomaly.reason,
        r.price_spike.reason,
      ].filter(Boolean).join(" | ");
      console.log(`   ${i + 1}. [${it.code}] ${it.name} score=${r.total_score} → ${reasons || "복합 위험"}`);
    });
  }

  return { ok: true, mode, summary, items };
}

module.exports = { fetchAndAnalyze };
