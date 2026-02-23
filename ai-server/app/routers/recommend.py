from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services.recommend_service import RecommendService

router = APIRouter()
service = RecommendService()


class RecommendOrderRequest(BaseModel):
    productCodes: list[str] = Field(default_factory=list)
    reviewPeriodDays: int = Field(default=7, ge=1, le=365)


@router.post("/recommend-order")
def recommend_order(payload: RecommendOrderRequest) -> dict:
    try:
        data = service.recommend_order(
            product_codes=payload.productCodes,
            review_period_days=payload.reviewPeriodDays,
        )
        return {"ok": True, "data": data}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=500,
            detail=f"AI 추천 계산 중 오류가 발생했습니다: {exc}",
        ) from exc
