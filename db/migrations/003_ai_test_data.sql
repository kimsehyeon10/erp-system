-- ════════════════════════════════════════════════════════════════════
-- Migration 003: AI 리스크 엔진 테스트 데이터
-- ════════════════════════════════════════════════════════════════════
--
-- 실행 방법:
--   psql $DATABASE_URL -f db/migrations/003_ai_test_data.sql
--   또는
--   psql -h localhost -U erp -d erp -f db/migrations/003_ai_test_data.sql
--
-- ✅ 5가지 리스크 시나리오:
--   P004 (노트북 PRO)   → 품절 위험 HIGH (3일 후 품절)
--   P005 (무선 마우스)  → 과잉 재고 HIGH (120일 미출고)
--   P006 (기계식 키보드)→ 비정상 출고 HIGH (오늘 급증 x10)
--   P007 (4K 모니터)    → 단가 급변 HIGH (+45% 급등)
--   P008 (HDMI 케이블)  → 정상 OK (기준선)
-- ════════════════════════════════════════════════════════════════════

BEGIN;

-- ── unit_cost 컬럼 보장 ──────────────────────────────────────────────
ALTER TABLE inventory_transactions
  ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(15,4);

-- ── 상품 삽입 (이미 존재하면 건너뜀) ────────────────────────────────
INSERT INTO products (code, name, category, safety_stock, qty_on_hand)
VALUES
  ('P004', '노트북 PRO',    '전자기기', 20, 12),
  ('P005', '무선 마우스',   '주변기기', 15, 80),
  ('P006', '기계식 키보드', '주변기기', 10, 60),
  ('P007', '4K 모니터',     '전자기기',  5, 25),
  ('P008', 'HDMI 케이블',   '소모품',    5, 100)
ON CONFLICT (code) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════
-- 1) P004 (노트북 PRO) — 품절 위험 HIGH
--    qty=12, 매일 4개 출고 → 3일 후 품절, safety_stock=20 미달
-- ════════════════════════════════════════════════════════════════════
INSERT INTO inventory_transactions (product_id, tx_type, qty_delta, unit_cost, happened_at)
SELECT
  p.id, 'OUT', -4, 1150000,
  NOW() - (n || ' days')::INTERVAL
FROM products p,
     generate_series(1, 30) AS gs(n)
WHERE p.code = 'P004';

-- ════════════════════════════════════════════════════════════════════
-- 2) P005 (무선 마우스) — 과잉 재고 HIGH
--    마지막 OUT이 120일 전, 현재 재고 80개
-- ════════════════════════════════════════════════════════════════════
-- 120일 전 마지막 출고 (이후 완전 정체)
INSERT INTO inventory_transactions (product_id, tx_type, qty_delta, unit_cost, happened_at)
SELECT id, 'OUT', -5, 33000, NOW() - INTERVAL '120 days'
FROM products WHERE code = 'P005';

-- 입고만 있음 (과잉재고 발생)
INSERT INTO inventory_transactions (product_id, tx_type, qty_delta, unit_cost, happened_at)
SELECT id, 'IN', 80, 33000, NOW() - INTERVAL '125 days'
FROM products WHERE code = 'P005';

-- ════════════════════════════════════════════════════════════════════
-- 3) P006 (기계식 키보드) — 비정상 출고 HIGH
--    직전 7일: 1개/day 정상, 오늘: 30개 급출고 (spike x30)
-- ════════════════════════════════════════════════════════════════════
-- 직전 8일 ~ 어제: 1개/day (정상 패턴)
INSERT INTO inventory_transactions (product_id, tx_type, qty_delta, unit_cost, happened_at)
SELECT
  p.id, 'OUT', -1, 85000,
  NOW() - (n || ' days')::INTERVAL
FROM products p,
     generate_series(2, 8) AS gs(n)
WHERE p.code = 'P006';

-- 오늘: 30개 급출고 (anomaly)
INSERT INTO inventory_transactions (product_id, tx_type, qty_delta, unit_cost, happened_at)
SELECT id, 'OUT', -30, 85000, NOW() - INTERVAL '2 hours'
FROM products WHERE code = 'P006';

-- ════════════════════════════════════════════════════════════════════
-- 4) P007 (4K 모니터) — 단가 급변 HIGH (+45%)
--    30일 평균 단가 340,000원 → 최근 단가 493,000원 (+45%)
-- ════════════════════════════════════════════════════════════════════
-- 30일간 평균 단가 입고
INSERT INTO inventory_transactions (product_id, tx_type, qty_delta, unit_cost, happened_at)
SELECT
  p.id, 'IN', 3, 340000,
  NOW() - (n || ' days')::INTERVAL
FROM products p,
     generate_series(5, 30, 5) AS gs(n)
WHERE p.code = 'P007';

-- 최근 입고: 단가 +45% 급등
INSERT INTO inventory_transactions (product_id, tx_type, qty_delta, unit_cost, happened_at)
SELECT id, 'IN', 5, 493000, NOW() - INTERVAL '3 hours'
FROM products WHERE code = 'P007';

-- 정기 출고 (재고회전 정상)
INSERT INTO inventory_transactions (product_id, tx_type, qty_delta, unit_cost, happened_at)
SELECT
  p.id, 'OUT', -1, 340000,
  NOW() - (n || ' days')::INTERVAL
FROM products p,
     generate_series(1, 20) AS gs(n)
WHERE p.code = 'P007';

-- ════════════════════════════════════════════════════════════════════
-- 5) P008 (HDMI 케이블) — 정상 OK (기준선)
--    매일 3개 출고, 재고 100개, 단가 안정 (25,000원)
-- ════════════════════════════════════════════════════════════════════
INSERT INTO inventory_transactions (product_id, tx_type, qty_delta, unit_cost, happened_at)
SELECT
  p.id, 'OUT', -3, 12000,
  NOW() - (n || ' days')::INTERVAL
FROM products p,
     generate_series(1, 30) AS gs(n)
WHERE p.code = 'P008';

INSERT INTO inventory_transactions (product_id, tx_type, qty_delta, unit_cost, happened_at)
SELECT
  p.id, 'IN', 30, 12000,
  NOW() - (n || ' days')::INTERVAL
FROM products p,
     generate_series(5, 30, 5) AS gs(n)
WHERE p.code = 'P008';

COMMIT;

-- ════════════════════════════════════════════════════════════════════
-- 데이터 검증 쿼리 (실행 후 확인용)
-- ════════════════════════════════════════════════════════════════════
-- SELECT code, name, qty_on_hand, safety_stock FROM products WHERE code IN ('P004','P005','P006','P007','P008');
-- SELECT p.code, t.tx_type, COUNT(*), SUM(ABS(t.qty_delta)) FROM inventory_transactions t JOIN products p ON t.product_id=p.id WHERE p.code IN ('P004','P005','P006','P007','P008') GROUP BY p.code, t.tx_type ORDER BY p.code, t.tx_type;
