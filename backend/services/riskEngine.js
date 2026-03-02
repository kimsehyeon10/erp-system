"use strict";

/**
 * riskEngine.js — Inventory AI Risk Engine (Rule-based + Statistical)
 *
 * 순수 함수 모듈. DB 접근 없음. 입력된 집계 수치를 받아 리스크 판단·점수화 후 반환.
 *
 * 리스크 레벨: HIGH(80+) / MED(40~79) / OK(0~39)
 * 총점은 4가지 리스크 점수의 합 (max 320)
 */

const TINY = 0.001; // 0-나누기 방지용 epsilon

/**
 * analyzeItem(row, opts) → 단일 품목의 리스크 분석 결과 반환
 *
 * @param {object} row      - SQL 집계 결과 (숫자 파싱 완료된 상태)
 * @param {object} opts     - 쿼리 파라미터 옵션
 * @returns {object}        - { product_id, warehouse_id, name, code, metrics, risk, recommendation }
 */
function analyzeItem(row, opts) {
  const { stockoutDays, deadDays, spikeX, pricePct, days } = opts;

  const {
    product_id,
    warehouse_id,
    name,
    code,
    current_qty,
    safety_stock,
    total_out,          // 분석 기간(days) 동안의 OUT 합계
    out_1d,             // 최근 1일 OUT 수량
    avg_prev7_per_day,  // 직전 7일(오늘 제외) 일평균 OUT
    last_out_at,        // 가장 최근 OUT 타임스탬프 (null 가능)
    last_cost,          // 가장 최근 unit_cost (null 가능)
    avg_cost_30,        // 최근 30일 unit_cost 평균 (null 가능)
    out_90d,            // 최근 90일 OUT 합계 (재고회전율 계산용)
  } = row;

  // ── 파생 지표 계산 ───────────────────────────────────────────
  const avg_daily_out   = total_out / Math.max(days, 1);
  const stockout_in_days = current_qty / Math.max(avg_daily_out, TINY);

  let pct_change = null;
  if (last_cost != null && avg_cost_30 != null && avg_cost_30 > 0) {
    pct_change = ((last_cost - avg_cost_30) / avg_cost_30) * 100;
  }

  // 마지막 출고 경과 일수
  const last_out_days_ago =
    last_out_at ? (Date.now() - new Date(last_out_at).getTime()) / 86_400_000 : null;

  const metrics = {
    current_qty,
    avg_daily_out_30d:  round2(avg_daily_out),
    stockout_in_days:   round2(stockout_in_days),
    last_out_at:        last_out_at || null,
    out_1d,
    avg_prev7_per_day:  round2(avg_prev7_per_day),
    last_cost:          last_cost  !== null ? Number(last_cost)   : null,
    avg_cost_30:        avg_cost_30 !== null ? round2(Number(avg_cost_30)) : null,
    pct_change:         pct_change !== null  ? round2(pct_change)          : null,
  };

  // ── 1) 품절 위험 (Stockout Risk) ──────────────────────────────
  let stockoutScore = 0;
  let stockoutLevel = "OK";
  let stockoutReason = "";

  if (current_qty <= 0) {
    stockoutScore  = 100;
    stockoutLevel  = "HIGH";
    stockoutReason = "현재 재고 0 — 이미 품절";
  } else if (stockout_in_days <= stockoutDays) {
    stockoutScore  = 80;
    stockoutLevel  = "HIGH";
    stockoutReason = `약 ${round2(stockout_in_days)}일 후 품절 예상 (기준 ${stockoutDays}일)`;
  } else if (stockout_in_days <= stockoutDays * 2) {
    stockoutScore  = 40;
    stockoutLevel  = "MED";
    stockoutReason = `약 ${round2(stockout_in_days)}일 후 품절 예상 (기준 ${stockoutDays * 2}일)`;
  }

  // ── 2) 과잉/사장 재고 위험 (Overstock / Dead-stock Risk) ──────
  let overstockScore = 0;
  let overstockLevel = "OK";
  let overstockReason = "";

  if (current_qty > 0) {
    const noOutHistory = last_out_at === null;
    const deadstockHit =
      last_out_days_ago !== null && last_out_days_ago >= deadDays;

    if (noOutHistory) {
      overstockScore  = 80;
      overstockLevel  = "HIGH";
      overstockReason = `출고 이력 전무, 재고 ${current_qty}개 보유`;
    } else if (deadstockHit) {
      overstockScore  = 80;
      overstockLevel  = "HIGH";
      overstockReason = `${Math.floor(last_out_days_ago)}일 미출고 (기준 ${deadDays}일)`;
    } else {
      // 재고회전율: 90일 출고 / 현재재고
      const turnover = out_90d / Math.max(current_qty, TINY);
      if (turnover < 0.1) {
        overstockScore  = 40;
        overstockLevel  = "MED";
        overstockReason =
          `재고회전율 낮음 — 90일 출고 ${out_90d}개 / 재고 ${current_qty}개 = ${round2(turnover)}`;
      }
    }
  }

  // ── 3) 비정상 출고 감지 (Outbound Anomaly) ────────────────────
  let anomalyScore = 0;
  let anomalyLevel = "OK";
  let anomalyReason = "";

  const baseline = Math.max(avg_prev7_per_day, TINY);

  if (out_1d > baseline * spikeX) {
    anomalyScore  = 80;
    anomalyLevel  = "HIGH";
    anomalyReason =
      `당일 출고 ${out_1d}개 > 직전7일 평균×${spikeX} (${round2(baseline * spikeX)}개)`;
  } else if (out_1d > baseline * 1.5) {
    anomalyScore  = 30;
    anomalyLevel  = "MED";
    anomalyReason =
      `당일 출고 ${out_1d}개 > 직전7일 평균×1.5 (${round2(baseline * 1.5)}개)`;
  }

  // ── 4) 단가 급변 감지 (Price Spike) ──────────────────────────
  let priceScore = 0;
  let priceLevel = "OK";
  let priceReason = "";

  if (last_cost !== null && last_cost <= 0) {
    priceScore  = 80;
    priceLevel  = "HIGH";
    priceReason = `비정상 단가 감지: ${last_cost}`;
  } else if (pct_change !== null && Math.abs(pct_change) >= pricePct) {
    priceScore  = 80;
    priceLevel  = "HIGH";
    priceReason = `단가 급변 ${round2(pct_change)}% (기준 ±${pricePct}%)`;
  }

  // ── 종합 점수 / 레벨 ─────────────────────────────────────────
  const total_score = stockoutScore + overstockScore + anomalyScore + priceScore;
  const total_level = total_score >= 80 ? "HIGH" : total_score >= 40 ? "MED" : "OK";

  // ── 발주 추천 (Reorder Recommendation) ───────────────────────
  const needsReorder =
    stockoutLevel === "HIGH" || current_qty <= (safety_stock || 0);

  let should_order       = false;
  let reorderQty         = 0;
  let reorderReason      = "";
  let expected_cover_days = 0;

  if (needsReorder) {
    should_order = true;
    // 목표: 30일치 수요 + 안전재고
    const target = Math.ceil(avg_daily_out * 30 + (safety_stock || 0));
    reorderQty   = Math.max(target - current_qty, 1);
    expected_cover_days = Math.ceil(reorderQty / Math.max(avg_daily_out, TINY));

    reorderReason =
      stockoutLevel === "HIGH"
        ? `품절 위험 — 30일분 수요+안전재고 충족을 위해 ${reorderQty}개 발주 필요`
        : `안전재고(${safety_stock}) 미달 — ${reorderQty}개 발주 권장`;
  }

  return {
    product_id,
    warehouse_id: warehouse_id || 1,
    name,
    code,
    metrics,
    risk: {
      stockout:         { level: stockoutLevel,  score: stockoutScore,  reason: stockoutReason  },
      overstock:        { level: overstockLevel, score: overstockScore, reason: overstockReason },
      outbound_anomaly: { level: anomalyLevel,   score: anomalyScore,   reason: anomalyReason   },
      price_spike:      { level: priceLevel,     score: priceScore,     reason: priceReason     },
      total_score,
      total_level,
    },
    recommendation: {
      reorder: {
        should_order,
        qty:                should_order ? reorderQty          : 0,
        reason:             reorderReason,
        expected_cover_days: should_order ? expected_cover_days : 0,
      },
    },
  };
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

module.exports = { analyzeItem };
