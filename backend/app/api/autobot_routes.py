from fastapi import APIRouter, HTTPException, status
from typing import Any, Dict
from pydantic import BaseModel

from ..services.autobot_service import autobot_service

autobot_router = APIRouter(prefix="/api/bot", tags=["AutoBot"])


class UpdateConfigRequest(BaseModel):
    enabled: bool = False
    mode: str = "demo"
    risk_per_trade_usd: float = 4.0
    max_daily_loss_usd: float = 16.0
    max_concurrent_positions: int = 4
    leverage: int = 10
    timeframe: str = "15m"
    market: str = "futures"
    api_key: str = ""
    api_secret: str = ""


@autobot_router.get("/status")
async def get_bot_status() -> Dict[str, Any]:
    """Retrieve live AutoBot configuration, state, active positions, and execution logs."""
    return autobot_service.get_status()


@autobot_router.post("/config")
async def update_bot_config(req: UpdateConfigRequest) -> Dict[str, Any]:
    """Update AutoBot risk parameters, leverage, timeframe, and account mode."""
    try:
        updated = autobot_service.update_config(req.model_dump())
        return {"success": True, "data": updated}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )


@autobot_router.post("/start")
async def start_bot() -> Dict[str, Any]:
    """Activate the AutoBot background trading loop."""
    result = await autobot_service.start()
    if not result.get("success"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=result.get("message")
        )
    return result


@autobot_router.post("/stop")
async def stop_bot() -> Dict[str, Any]:
    """Pause/Deactivate the AutoBot (enter safe hibernation state)."""
    return autobot_service.stop()


@autobot_router.post("/reset-circuit-breaker")
async def reset_circuit_breaker() -> Dict[str, Any]:
    """Manually reset the daily loss counter and unlock the AutoBot."""
    return autobot_service.reset_circuit_breaker()


@autobot_router.post("/panic-close-all")
async def panic_close_all() -> Dict[str, Any]:
    """Emergency button: immediately close all open positions and cancel pending limit orders."""
    return await autobot_service.panic_close_all()
