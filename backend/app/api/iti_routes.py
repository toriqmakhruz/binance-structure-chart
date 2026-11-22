from fastapi import APIRouter, Query, HTTPException, status
from pydantic import BaseModel
from typing import Optional
from ..iti.iti_service import iti_service
from ..iti.iti_session_manager import session_manager
from ..iti.iti_ingestion import ingestion_service
from ..models.iti_schemas import ITITelemetryResponse

iti_router = APIRouter(prefix="/api/iti", tags=["Institutional Trading Intelligence (ITI)"])

class SelectPairRequest(BaseModel):
    symbol: str
    market: str = "futures"

@iti_router.get("/telemetry", response_model=ITITelemetryResponse)
async def get_iti_telemetry(
    symbol: Optional[str] = Query(None, description="Trading pair symbol (defaults to active_symbol)"),
    market: Optional[str] = Query("futures", description="Market type ('futures' or 'spot')")
):
    """
    Get real-time Institutional Trading Intelligence (ITI) telemetry for the single active symbol.
    Runs SMC, Liquidity BSL/SSL, SL Hunter, DOM Microstructure, Footprint/CVD, Volume Profile, and Derivatives.
    """
    try:
        return await iti_service.get_telemetry(symbol=symbol, market=market)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Gagal mengambil telemetry ITI: {str(e)}"
        )

@iti_router.post("/select-pair")
async def select_iti_pair(req: SelectPairRequest):
    """
    Explicitly switches the active symbol for the ITI session.
    Stops old pair streams, increments generation_id, and initializes new snapshot.
    """
    try:
        gen_id = await iti_service.switch_pair(symbol=req.symbol, market=req.market)
        return {
            "status": "ok",
            "active_symbol": session_manager.active_symbol,
            "market": session_manager.active_market,
            "generation_id": gen_id
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Gagal mengganti pasangan aktif ITI: {str(e)}"
        )

@iti_router.get("/data-health")
async def get_iti_data_health():
    """Returns data feed status, sequence health, and update age for the active symbol."""
    health = ingestion_service.get_data_health()
    health["active_symbol"] = session_manager.active_symbol
    health["market"] = session_manager.active_market
    return health
