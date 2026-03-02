"use strict";

/**
 * routes/ai.js — 재고 리스크 예측 & 자동 대응 API
 *
 * 마운트 위치: /api/ai  (server.js에서 app.use("/api/ai", aiRoutes))
 *
 * ┌──────────────────────────────────────────────┐
 * │  엔드포인트 목록                              │
 * ├──────────────────────────────────────────────┤
 * │  GET /api/ai/health          헬스체크         │
 * │  GET /api/ai/risk/run        전체 리스크 분석 │
 * │  GET /api/ai/risk/stockout   품절 위험 전용   │
 * │  GET /api/ai/risk/overstock  과잉재고 전용    │
 * │  GET /api/ai/risk/anomaly    비정상출고 전용  │
 * │  GET /api/ai/risk/price      단가급변 전용    │
 * │  GET /api/ai/reorder         발주 추천 전용   │
 * └──────────────────────────────────────────────┘
 *
 * 공통 Query Parameters (모든 /risk/* 엔드포인트 지원):
 *   days         (기본 30)   — 분석 기간(일)
 *   stockoutDays (기본  7)   — 품절 위험 기준일
 *   deadDays     (기본 90)   — 미출고 기준일 (과잉재고)
 *   spikeX       (기본  3)   — 출고 폭증 배수
 *   pricePct     (기본 30)   — 단가 급변 % 기준
 */

const express            = require("express");
const router             = express.Router();
const { fetchAndAnalyze } = require("../services/aiService");

// PostgreSQL Pool — 없으면 null (JSON fallback 자동 적용)
let _pool = null;
try {
  const { getPool } = require("../config/postgres");
  _pool = getPool();
} catch (_) {
  /* pg 미설치 또는 DB 설정 없음 → JSON 모드 */
}

// ── 파라미터 파싱 헬퍼 ────────────────────────────────────────────────
function clampInt(val, min, max, def) {
  const n = parseInt(val, 10);
  return Number.isFinite(n) && n >= min && n <= max ? n : def;
}
function clampFloat(val, min, max, def) {
  const n = parseFloat(val);
  return Number.isFinite(n) && n >= min && n <= max ? n : def;
}
function parseOpts(query) {
  return {
    days:         clampInt  (query.days,         1, 365, 30),
    stockoutDays: clampInt  (query.stockoutDays, 1, 365,  7),
    deadDays:     clampInt  (query.deadDays,     1, 3650,90),
    spikeX:       clampFloat(query.spikeX,       1, 100,  3),
    pricePct:     clampFloat(query.pricePct,     0, 100, 30),
    pool:         _pool,
  };
}

// ── 에러 핸들러 ───────────────────────────────────────────────────────
function handleErr(res, err, label) {
  console.error(`[${label}]`, err.message || err);
  const msg =
    err.code === "ECONNREFUSED"
      ? "PostgreSQL 연결 실패. DB 서버 상태와 .env 설정을 확인하세요."
      : err.message || "서버 내부 오류";
  return res.status(500).json({ ok: false, message: msg });
}

// ════════════════════════════════════════════════════════════════════
// GET /api/ai/health  — 헬스체크
// ════════════════════════════════════════════════════════════════════
router.get("/health", (req, res) => {
  res.json({
    ok:        true,
    service:   "AI Risk Engine",
    version:   "2.0.0",
    timestamp: new Date().toISOString(),
    db_mode:   _pool ? "postgres (연결 시도 가능)" : "json (fallback)",
    endpoints: [
      "GET /api/ai/health",
      "GET /api/ai/risk/run",
      "GET /api/ai/risk/stockout",
      "GET /api/ai/risk/overstock",
      "GET /api/ai/risk/anomaly",
      "GET /api/ai/risk/price",
      "GET /api/ai/reorder",
    ],
  });
});

// ════════════════════════════════════════════════════════════════════
// GET /api/ai/risk/run  — 전체 리스크 분석 (5가지 전부)
// ════════════════════════════════════════════════════════════════════
router.get("/risk/run", async (req, res) => {
  try {
    const opts   = parseOpts(req.query);
    const result = await fetchAndAnalyze({ ...opts, filter: null });
    return res.json(result);
  } catch (err) {
    return handleErr(res, err, "GET /api/ai/risk/run");
  }
});

// ════════════════════════════════════════════════════════════════════
// GET /api/ai/risk/stockout  — 1) 품절 위험 감지
//   days_to_stockout 기준 필터링
// ════════════════════════════════════════════════════════════════════
router.get("/risk/stockout", async (req, res) => {
  try {
    const opts   = parseOpts(req.query);
    const result = await fetchAndAnalyze({ ...opts, filter: "stockout" });

    // days_to_stockout 필드 추가 (alias)
    const items = result.items.map(it => ({
      ...it,
      days_to_stockout: it.metrics.stockout_in_days,
    }));

    return res.json({
      ...result,
      items,
      description: "품절 위험 품목 (재고 소진 임박)",
    });
  } catch (err) {
    return handleErr(res, err, "GET /api/ai/risk/stockout");
  }
});

// ════════════════════════════════════════════════════════════════════
// GET /api/ai/risk/overstock  — 2) 과잉 재고 감지
//   재고회전율(overstock_score) 기준 필터링
// ════════════════════════════════════════════════════════════════════
router.get("/risk/overstock", async (req, res) => {
  try {
    const opts   = parseOpts(req.query);
    const result = await fetchAndAnalyze({ ...opts, filter: "overstock" });

    // overstock_score 필드 추가 (alias: overstockScore)
    const items = result.items.map(it => ({
      ...it,
      overstock_score: it.risk.overstock.score,
    }));

    return res.json({
      ...result,
      items,
      description: "과잉/사장 재고 품목 (회전율 낮음 또는 장기 미출고)",
    });
  } catch (err) {
    return handleErr(res, err, "GET /api/ai/risk/overstock");
  }
});

// ════════════════════════════════════════════════════════════════════
// GET /api/ai/risk/anomaly  — 3) 비정상 출고 감지
//   평균 대비 급증 탐지 (anomaly_score)
// ════════════════════════════════════════════════════════════════════
router.get("/risk/anomaly", async (req, res) => {
  try {
    const opts   = parseOpts(req.query);
    const result = await fetchAndAnalyze({ ...opts, filter: "anomaly" });

    // anomaly_score 필드 추가
    const items = result.items.map(it => ({
      ...it,
      anomaly_score: it.risk.outbound_anomaly.score,
    }));

    return res.json({
      ...result,
      items,
      description: "비정상 출고 감지 (당일 급증 탐지)",
    });
  } catch (err) {
    return handleErr(res, err, "GET /api/ai/risk/anomaly");
  }
});

// ════════════════════════════════════════════════════════════════════
// GET /api/ai/risk/price  — 4) 단가 급변 감지
//   이전 대비 변화율 (price_change_rate)
// ════════════════════════════════════════════════════════════════════
router.get("/risk/price", async (req, res) => {
  try {
    const opts   = parseOpts(req.query);
    const result = await fetchAndAnalyze({ ...opts, filter: "price" });

    // price_change_rate 필드 추가
    const items = result.items.map(it => ({
      ...it,
      price_change_rate: it.metrics.pct_change,
    }));

    return res.json({
      ...result,
      items,
      description: "단가 급변 감지 (30일 평균 대비 최근 단가 변화율)",
    });
  } catch (err) {
    return handleErr(res, err, "GET /api/ai/risk/price");
  }
});

// ════════════════════════════════════════════════════════════════════
// GET /api/ai/reorder  — 5) 자동 발주 추천
//   리드타임 + 안전재고 기반 (reorder_point, recommended_qty)
// ════════════════════════════════════════════════════════════════════
router.get("/reorder", async (req, res) => {
  try {
    const opts        = parseOpts(req.query);
    const leadTimeDays = clampInt(req.query.leadTime, 1, 365, 7); // 리드타임 (기본 7일)

    const result = await fetchAndAnalyze({ ...opts, filter: "reorder" });

    // reorder_point 및 recommended_qty 필드 추가
    const items = result.items.map(it => {
      const avgDaily = it.metrics.avg_daily_out_30d;
      const safetyStock = it.metrics.current_qty >= 0
        ? (it.risk.stockout.level === "HIGH" ? it.metrics.current_qty : 0)
        : 0;

      // reorder_point = 안전재고 + (리드타임 × 일평균출고)
      const reorderPoint = Math.ceil(
        (it.metrics.current_qty <= 0 ? 0 : it.metrics.current_qty) +
        leadTimeDays * avgDaily
      );

      return {
        ...it,
        reorder_point:   reorderPoint,
        recommended_qty: it.recommendation.reorder.qty,
        lead_time_days:  leadTimeDays,
      };
    });

    return res.json({
      ...result,
      items,
      description: `발주 추천 품목 (리드타임 ${leadTimeDays}일 기준)`,
      lead_time_days: leadTimeDays,
    });
  } catch (err) {
    return handleErr(res, err, "GET /api/ai/reorder");
  }
});

module.exports = router;
