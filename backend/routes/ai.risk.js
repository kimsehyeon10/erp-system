"use strict";

/**
 * routes/ai.risk.js — Inventory AI Risk Engine API
 *
 * GET /ai/risk/run
 *   Query params:
 *     days        (default 30)  — 분석 기간(일)
 *     stockoutDays(default 7)   — N일 이내 품절이면 HIGH
 *     deadDays    (default 90)  — N일 이상 미출고면 Overstock HIGH
 *     spikeX      (default 3)   — 출고 폭증 배수 기준
 *     pricePct    (default 30)  — 단가 급변 % 기준
 *
 * 의존:
 *   ../config/postgres  — getPool(), dbErrorMessage()
 *   ../services/riskEngine — analyzeItem()
 */

const express      = require("express");
const router       = express.Router();
const { getPool, dbErrorMessage } = require("../config/postgres");
const { analyzeItem }             = require("../services/riskEngine");

// ── Schema 자동 적용 (서버 최초 1회) ─────────────────────────────
// unit_cost 컬럼이 없으면 추가 (ADD COLUMN IF NOT EXISTS — 멱등)
let _schemaReady = false;

async function ensureSchema(pool) {
  if (_schemaReady) return;
  await pool.query(`
    ALTER TABLE inventory_transactions
      ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(15, 4)
  `);
  _schemaReady = true;
}

// ── GET /ai/risk/run ─────────────────────────────────────────────
router.get("/risk/run", async (req, res) => {
  const pool = getPool();

  // 파라미터 파싱 & 범위 제한
  const days         = clampInt  (req.query.days,         1, 365,  30);
  const stockoutDays = clampInt  (req.query.stockoutDays, 1, 365,   7);
  const deadDays     = clampInt  (req.query.deadDays,     1, 3650, 90);
  const spikeX       = clampFloat(req.query.spikeX,       1, 100,   3);
  const pricePct     = clampFloat(req.query.pricePct,     0, 100,  30);

  try {
    await ensureSchema(pool);

    // ── 단일 CTE 집계 쿼리 ──────────────────────────────────────
    // $1 = days (분석 기간)
    // 모든 interval 계산은 INTERVAL '1 day' * $1 방식으로 파라미터 바인딩
    const { rows } = await pool.query(
      `
      WITH
        /* 전체 품목 기준 */
        prods AS (
          SELECT
            id            AS product_id,
            code,
            name,
            qty_on_hand   AS current_qty,
            safety_stock
          FROM products
        ),

        /* 분석 기간(days) 내 OUT 합계 */
        out_window AS (
          SELECT
            product_id,
            SUM(ABS(qty_delta)) AS total_out
          FROM inventory_transactions
          WHERE tx_type = 'OUT'
            AND happened_at >= NOW() - INTERVAL '1 day' * $1
          GROUP BY product_id
        ),

        /* 최근 1일 OUT 수량 */
        out_1d AS (
          SELECT
            product_id,
            SUM(ABS(qty_delta)) AS out_1d
          FROM inventory_transactions
          WHERE tx_type = 'OUT'
            AND happened_at >= NOW() - INTERVAL '1 day'
          GROUP BY product_id
        ),

        /* 직전 7일(오늘 제외) 일평균 OUT — 기준선 */
        out_prev7 AS (
          SELECT
            product_id,
            SUM(ABS(qty_delta)) / 7.0 AS avg_prev7_per_day
          FROM inventory_transactions
          WHERE tx_type = 'OUT'
            AND happened_at >= NOW() - INTERVAL '8 days'
            AND happened_at <  NOW() - INTERVAL '1 day'
          GROUP BY product_id
        ),

        /* 최근 90일 OUT 합계 — 재고회전율 계산용 */
        out_90d AS (
          SELECT
            product_id,
            SUM(ABS(qty_delta)) AS out_90d
          FROM inventory_transactions
          WHERE tx_type = 'OUT'
            AND happened_at >= NOW() - INTERVAL '90 days'
          GROUP BY product_id
        ),

        /* 마지막 출고 시각 (전체 기간) */
        last_out AS (
          SELECT
            product_id,
            MAX(happened_at) AS last_out_at
          FROM inventory_transactions
          WHERE tx_type = 'OUT'
          GROUP BY product_id
        ),

        /* 가장 최근 unit_cost */
        last_cost AS (
          SELECT DISTINCT ON (product_id)
            product_id,
            unit_cost AS last_cost
          FROM inventory_transactions
          WHERE unit_cost IS NOT NULL
            AND unit_cost > 0
          ORDER BY product_id, happened_at DESC
        ),

        /* 최근 30일 unit_cost 평균 */
        avg_cost AS (
          SELECT
            product_id,
            AVG(unit_cost) AS avg_cost_30
          FROM inventory_transactions
          WHERE unit_cost IS NOT NULL
            AND unit_cost > 0
            AND happened_at >= NOW() - INTERVAL '30 days'
          GROUP BY product_id
        )

      SELECT
        p.product_id,
        1                                     AS warehouse_id,
        p.name,
        p.code,
        p.current_qty,
        p.safety_stock,
        COALESCE(ow.total_out,          0)    AS total_out,
        COALESCE(o1.out_1d,             0)    AS out_1d,
        COALESCE(op7.avg_prev7_per_day, 0)    AS avg_prev7_per_day,
        lo.last_out_at,
        lc.last_cost,
        ac.avg_cost_30,
        COALESCE(o90.out_90d,           0)    AS out_90d
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

    // ── 리스크 엔진 실행 ─────────────────────────────────────────
    const opts = { days, stockoutDays, deadDays, spikeX, pricePct };

    const items = rows.map(row =>
      analyzeItem(
        {
          product_id:        Number(row.product_id),
          warehouse_id:      1,
          name:              row.name,
          code:              row.code,
          current_qty:       Number(row.current_qty),
          safety_stock:      Number(row.safety_stock || 0),
          total_out:         Number(row.total_out),
          out_1d:            Number(row.out_1d),
          avg_prev7_per_day: Number(row.avg_prev7_per_day),
          last_out_at:       row.last_out_at || null,
          last_cost:         row.last_cost   != null ? Number(row.last_cost)  : null,
          avg_cost_30:       row.avg_cost_30 != null ? Number(row.avg_cost_30) : null,
          out_90d:           Number(row.out_90d),
        },
        opts
      )
    );

    // ── 정렬: HIGH → MED → OK, 동일 레벨 내 total_score 내림차순 ──
    const LEVEL_ORDER = { HIGH: 0, MED: 1, OK: 2 };
    items.sort((a, b) => {
      const la = LEVEL_ORDER[a.risk.total_level] ?? 3;
      const lb = LEVEL_ORDER[b.risk.total_level] ?? 3;
      if (la !== lb) return la - lb;
      return b.risk.total_score - a.risk.total_score;
    });

    // ── 요약 집계 ────────────────────────────────────────────────
    const highItems   = items.filter(i => i.risk.total_level === "HIGH");
    const medItems    = items.filter(i => i.risk.total_level === "MED");
    const reorderItems = items.filter(i => i.recommendation.reorder.should_order);

    const summary = {
      total_items:     items.length,
      high_risk_count: highItems.length,
      med_risk_count:  medItems.length,
      ok_count:        items.length - highItems.length - medItems.length,
      reorder_count:   reorderItems.length,
      params:          { days, stockoutDays, deadDays, spikeX, pricePct },
    };

    // ── 콘솔 요약 로그 ────────────────────────────────────────────
    console.log("\n🔍 [AI Risk Engine] ════════════════════════════════════");
    console.log(
      `   분석 기간: ${days}일 | 총 품목: ${summary.total_items}개 | ` +
      `HIGH: ${summary.high_risk_count} | MED: ${summary.med_risk_count} | ` +
      `OK: ${summary.ok_count} | 발주필요: ${summary.reorder_count}`
    );
    console.log("   ── High Risk Top 10 ─────────────────────────────────");
    if (highItems.length === 0) {
      console.log("   (없음)");
    } else {
      highItems.slice(0, 10).forEach((it, i) => {
        const r = it.risk;
        const reasons = [
          r.stockout.reason,
          r.overstock.reason,
          r.outbound_anomaly.reason,
          r.price_spike.reason,
        ].filter(Boolean).join(" | ");
        console.log(
          `   ${String(i + 1).padStart(2)}. [${it.code}] ${it.name} ` +
          `score=${r.total_score} → ${reasons || "복합 위험"}`
        );
      });
    }
    console.log("═══════════════════════════════════════════════════════\n");

    return res.json({ ok: true, summary, items });
  } catch (err) {
    console.error("[GET /ai/risk/run]", err);
    return res.status(500).json({ ok: false, message: dbErrorMessage(err) });
  }
});

// ── 헬퍼: 정수 범위 제한 ────────────────────────────────────────
function clampInt(val, min, max, def) {
  const n = parseInt(val, 10);
  if (!Number.isFinite(n) || n < min || n > max) return def;
  return n;
}

// ── 헬퍼: 실수 범위 제한 ────────────────────────────────────────
function clampFloat(val, min, max, def) {
  const n = parseFloat(val);
  if (!Number.isFinite(n) || n < min || n > max) return def;
  return n;
}

module.exports = router;
