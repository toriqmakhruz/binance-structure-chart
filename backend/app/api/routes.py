import logging
from typing import Optional, Dict, Any
from fastapi import APIRouter, Query, HTTPException
from ..models.schemas import FullAnalysisResponse, Candle
from ..services.binance_service import binance_service
from ..analysis.smc_engine import SmcEngine
from ..analysis.pattern_engine import PatternEngine
from ..analysis.movement_engine import MovementEngine
from ..analysis.forecast_engine import ForecastEngine

logger = logging.getLogger("api_routes")
router = APIRouter(prefix="/api")

@router.get("/symbols")
async def get_symbols(market: str = Query("futures", pattern="^(spot|futures)$")):
    """
    Get top traded symbols on Binance with 24h volume and price stats.
    """
    try:
        symbols = await binance_service.get_symbols(market=market)
        return {"market": market, "symbols": symbols}
    except Exception as e:
        logger.error(f"Error fetching symbols: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/analysis", response_model=FullAnalysisResponse)
async def get_full_analysis(
    symbol: str = Query("BTCUSDT"),
    timeframe: str = Query("15m"),
    market: str = Query("futures", pattern="^(spot|futures)$"),
    htf: Optional[str] = Query(None), # Higher timeframe for MTF overlay (e.g., 4h, 1d)
    swing_length: int = Query(5, ge=2, le=20),
    fvg_min_pct: float = Query(0.05, ge=0.01, le=1.0),
    forecast_horizon: int = Query(20, ge=5, le=50)
):
    """
    Execute full analysis: SMC + Classic Patterns + Movement Dynamics + Hybrid Forecasting.
    """
    try:
        # 1. Fetch current timeframe candles (up to 1200 candles for extensive backward history)
        candles = await binance_service.get_klines(
            symbol=symbol,
            interval=timeframe,
            limit=1200,
            market=market
        )

        if not candles:
            raise HTTPException(status_code=404, detail="Candle data not found")

        # 2. Run analysis engines
        smc_engine = SmcEngine(swing_length=swing_length, fvg_min_pct=fvg_min_pct)
        smc_res = smc_engine.analyze(candles)

        pattern_engine = PatternEngine()
        pattern_res = pattern_engine.analyze(candles, smc_res.swings)

        movement_engine = MovementEngine()
        movement_res = movement_engine.analyze(candles, smc=smc_res, patterns=pattern_res)

        forecast_engine = ForecastEngine(default_horizon=forecast_horizon)
        forecast_res = forecast_engine.analyze(
            candles=candles,
            smc=smc_res,
            patterns=pattern_res,
            movement=movement_res,
            horizon=forecast_horizon
        )

        # 3. Optional Multi-Timeframe (HTF) Analysis
        htf_data = None
        if htf and htf != timeframe:
            try:
                htf_candles = await binance_service.get_klines(
                    symbol=symbol,
                    interval=htf,
                    limit=200,
                    market=market
                )
                if htf_candles:
                    htf_smc = smc_engine.analyze(htf_candles)
                    htf_data = {
                        "timeframe": htf,
                        "current_trend": htf_smc.current_trend,
                        "order_blocks": [ob.model_dump() for ob in htf_smc.order_blocks if not ob.mitigated][-5:],
                        "events": [ev.model_dump() for ev in htf_smc.events][-4:]
                    }
            except Exception as htf_err:
                logger.warning(f"Failed to fetch HTF data: {htf_err}")

        return FullAnalysisResponse(
            symbol=symbol.upper(),
            market=market,
            timeframe=timeframe,
            candles=candles,
            smc=smc_res,
            patterns=pattern_res,
            movement=movement_res,
            forecast=forecast_res,
            htf_overlay=htf_data
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Analysis failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
