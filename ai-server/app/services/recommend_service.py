import os
from datetime import datetime, timedelta, timezone

import psycopg2
from psycopg2.extras import RealDictCursor


class RecommendService:
    def __init__(self) -> None:
        self.database_url = os.getenv("DATABASE_URL", "")
        self.lead_time_days = int(os.getenv("LEAD_TIME_DAYS", "7"))
        self.default_lookback_days = int(os.getenv("OUT_LOOKBACK_DAYS", "30"))

    def _connect(self):
        if not self.database_url:
            raise ValueError(
                "DATABASE_URL이 설정되지 않았습니다. ai-server 실행 전에 환경변수를 설정하세요."
            )
        try:
            return psycopg2.connect(self.database_url)
        except Exception as exc:
            raise RuntimeError(
                f"PostgreSQL 연결에 실패했습니다. DATABASE_URL 또는 DB 실행 상태를 확인하세요. ({exc})"
            ) from exc

    def recommend_order(self, product_codes: list[str], review_period_days: int = 7) -> list[dict]:
        if not product_codes:
            return []

        lookback_days = self.default_lookback_days
        since = datetime.now(timezone.utc) - timedelta(days=lookback_days)

        with self._connect() as conn:
            with conn.cursor(cursor_factory=RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT id, code, safety_stock, qty_on_hand
                    FROM products
                    WHERE code = ANY(%s)
                    ORDER BY code
                    """,
                    (product_codes,),
                )
                products = cur.fetchall()

                if not products:
                    return []

                product_ids = [p["id"] for p in products]

                cur.execute(
                    """
                    SELECT
                      product_id,
                      COUNT(DISTINCT DATE(happened_at)) AS out_days,
                      COALESCE(SUM(ABS(qty_delta)), 0) AS out_qty
                    FROM inventory_transactions
                    WHERE product_id = ANY(%s)
                      AND tx_type = 'OUT'
                      AND happened_at >= %s
                    GROUP BY product_id
                    """,
                    (product_ids, since),
                )
                out_stats_rows = cur.fetchall()

        out_stats = {row["product_id"]: row for row in out_stats_rows}
        result: list[dict] = []

        for p in products:
            stat = out_stats.get(p["id"], {})
            out_qty = float(stat.get("out_qty", 0) or 0)
            out_days = int(stat.get("out_days", 0) or 0)

            avg_daily_demand = out_qty / float(lookback_days)
            rop = float(p["safety_stock"] or 0) + (self.lead_time_days * avg_daily_demand)
            target = rop + (review_period_days * avg_daily_demand)
            current_qty = float(p["qty_on_hand"] or 0)

            recommended_qty = max(target - current_qty, 0.0) if current_qty <= rop else 0.0

            confidence = min(out_days / 30.0, 1.0)

            reason = "재고가 재주문점 이하" if current_qty <= rop else "재고가 재주문점 초과"

            result.append(
                {
                    "productCode": p["code"],
                    "recommendedQty": int(round(recommended_qty)),
                    "reason": reason,
                    "rop": int(round(rop)),
                    "target": int(round(target)),
                    "currentQty": int(round(current_qty)),
                    "confidence": round(confidence, 2),
                }
            )

        return result
