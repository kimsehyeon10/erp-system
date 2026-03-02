-- Migration 002: unit_cost 컬럼 추가
-- inventory_transactions 테이블에 단가 컬럼 추가 (기존 데이터 호환 유지)
--
-- 실행 방법:
--   psql $DATABASE_URL -f db/migrations/002_add_unit_cost.sql
-- 또는 서버 기동 시 /ai/risk/run 첫 호출 때 자동 적용됨 (ADD COLUMN IF NOT EXISTS)

ALTER TABLE inventory_transactions
  ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(15, 4);

COMMENT ON COLUMN inventory_transactions.unit_cost IS
  '거래 당시 단가 (NULL = 미기록). AI 리스크 엔진 단가 급변 감지에 사용';
