from fastapi import FastAPI

from app.routers.recommend import router as recommend_router

app = FastAPI(title="ERP AI Server", version="0.1.0")

app.include_router(recommend_router, prefix="/ai", tags=["ai"])


@app.get("/health")
def health() -> dict:
    return {"ok": True}
