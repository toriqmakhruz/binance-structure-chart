import os
import asyncio
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from .api.routes import router as api_router
from .api.websocket import ws_router
from .api.trade_routes import trade_router
from .api.autobot_routes import autobot_router
from .services.autobot_service import autobot_service

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger("main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Initialize background worker for AutoBot daemon
    logger.info("Starting AutoBot background worker (Initial state: OFF / DORMANT)...")
    stop_event = asyncio.Event()

    async def _worker_loop():
        # Short initial delay to let server boot fully
        await asyncio.sleep(5)
        while not stop_event.is_set():
            try:
                await autobot_service.run_cycle()
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.error(f"Error in autobot background worker: {exc}")
            
            # Run cycle every 15 seconds
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=15.0)
            except asyncio.TimeoutError:
                pass

    worker_task = asyncio.create_task(_worker_loop())
    yield
    # Shutdown: Cleanly cancel background worker
    logger.info("Shutting down AutoBot worker...")
    stop_event.set()
    worker_task.cancel()
    try:
        await worker_task
    except asyncio.CancelledError:
        pass


app = FastAPI(
    title="Binance Crypto Structure & Forecasting API",
    description="Backend API for Smart Money Concepts (SMC), Pattern Recognition, Movement Dynamics, and Hybrid Forecasting.",
    version="1.0.0",
    lifespan=lifespan
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
app.include_router(autobot_router)

@app.get("/health")
def health_check():
    return {"status": "ok", "service": "binance-structure-analysis"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
