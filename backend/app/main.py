import os
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .api.routes import router as api_router
from .api.websocket import ws_router
from .api.trade_routes import trade_router

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)

app = FastAPI(
    title="Binance Crypto Structure & Forecasting API",
    description="Backend API for Smart Money Concepts (SMC), Pattern Recognition, Movement Dynamics, and Hybrid Forecasting.",
    version="1.0.0"
)

# Secure explicit CORS origins (Audit Section 6.2: do not use wildcard with credentials)
allowed_origins = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://localhost:3050",
    "http://127.0.0.1:3050",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8000",
    "http://127.0.0.1:8000",
    "http://localhost:8050",
    "http://127.0.0.1:8050",
    "http://38.47.191.164:3050",
    "http://38.47.191.164:8050",
    "http://38.47.191.164:3000",
    "http://38.47.191.164:8000"
]

cors_env = os.getenv("CORS_ORIGINS")
if cors_env:
    for origin in cors_env.split(","):
        clean_origin = origin.strip()
        if clean_origin and clean_origin not in allowed_origins:
            allowed_origins.append(clean_origin)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1|38\.47\.191\.164)(:\d+)?",
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(api_router)
app.include_router(ws_router)
app.include_router(trade_router)

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "binance-structure-analysis"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
