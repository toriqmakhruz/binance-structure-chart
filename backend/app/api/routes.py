import logging
from typing import Optional, Dict, Any
from fastapi import APIRouter, Query, HTTPException, status
from ..models.schemas import FullAnalysisResponse, Candle, AnalysisMetadata
from ..services.binance_service import (
    binance_service, DataUnavailableException, DataMalformedException
)
from ..config import settings
from ..analysis.smc_engine import SmcEngine
from ..analysis.pattern_engine import PatternEngine
from ..analysis.movement_engine import MovementEngine
from ..analysis.forecast_engine import ForecastEngine

logger = logging.getLogger("api_routes")
router = APIRouter(prefix="/api")

@router.get("/symbols")
async def get_symbols(
    market: str = Query("futures", pattern="^(spot|futures)$"),
    demo: bool = Query(False)
):
    """
    Get top traded symbols on Binance with 24h volume and price stats.
    Strictly isolated per market; no synthetic prices in production.
    """
    try:
        symbols = await binance_service.get_symbols(market=market, demo_mode=demo)
        return {
            "market": market,
            "source": f"BINANCE_{market.upper()}",
            "is_demo": demo,
            "symbols": symbols
        }
    except DataUnavailableException as e:
        logger.error(f"Symbols unavailable: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "DATA_UNAVAILABLE", "message": str(e)}
        )
    except Exception as e:
        logger.error(f"Error fetching symbols: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "INTERNAL_ERROR", "message": str(e)}
        )

@router.get("/analysis", response_model=FullAnalysisResponse)
async def get_full_analysis(
    symbol: str = Query("BTCUSDT", pattern=r"^[A-Za-z0-9]{3,16}$"),
    timeframe: str = Query("15m"),
    market: str = Query("futures", pattern="^(spot|futures)$"),
    htf: Optional[str] = Query(None),
    swing_length: int = Query(5, ge=2, le=20),
    fvg_min_pct: float = Query(0.05, ge=0.01, le=1.0),
    forecast_horizon: int = Query(20, ge=5, le=50)
):
    """
    Execute full analysis: SMC + Classic Patterns + Movement Dynamics + Hybrid Forecasting.
    """
    # Validate timeframe against allowlist
    tf_clean = timeframe.lower().strip()
    if tf_clean not in settings.TIMEFRAMES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "INVALID_TIMEFRAME",
                "message": f"Timeframe '{timeframe}' is not supported. Allowed: {settings.TIMEFRAMES}"
            }
        )

    if htf:
        htf_clean = htf.lower().strip()
        if htf_clean not in settings.TIMEFRAMES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "code": "INVALID_HTF",
                    "message": f"HTF timeframe '{htf}' is not supported. Allowed: {settings.TIMEFRAMES}"
                }
            )

    try:
        # 1. Fetch current timeframe candles (up to 1200 candles)
        candles, metadata = await binance_service.get_klines(
            symbol=symbol,
            interval=tf_clean,
            limit=1200,
            market=market
        )

        if not candles:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={"code": "NO_CANDLES", "message": "No candle data returned for the requested symbol/market."}
            )

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
        if htf and htf_clean != tf_clean:
            try:
                htf_candles, _ = await binance_service.get_klines(
                    symbol=symbol,
                    interval=htf_clean,
                    limit=200,
                    market=market
                )
                if htf_candles:
                    htf_smc = smc_engine.analyze(htf_candles)
                    htf_data = {
                        "timeframe": htf_clean,
                        "current_trend": htf_smc.current_trend,
                        "order_blocks": [ob.model_dump() for ob in htf_smc.order_blocks if not ob.mitigated][-5:],
                        "events": [ev.model_dump() for ev in htf_smc.events][-4:]
                    }
            except Exception as htf_err:
                logger.warning(f"Failed to fetch HTF data: {htf_err}")

        return FullAnalysisResponse(
            symbol=symbol.upper(),
            market=market,
            timeframe=tf_clean,
            candles=candles,
            smc=smc_res,
            patterns=pattern_res,
            movement=movement_res,
            forecast=forecast_res,
            htf_overlay=htf_data,
            metadata=metadata
        )

    except DataUnavailableException as e:
        logger.error(f"Analysis data unavailable: {e}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "DATA_UNAVAILABLE", "message": str(e)}
        )
    except DataMalformedException as e:
        logger.error(f"Analysis data malformed: {e}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={"code": "DATA_MALFORMED", "message": str(e)}
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Analysis failed unexpectedly: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "ANALYSIS_FAILED", "message": str(e)}
        )


from ..analysis.backtest_engine import BacktestEngine, BacktestMetrics

@router.get("/backtest", response_model=BacktestMetrics)
async def run_backtest_endpoint(
    symbol: str = Query("BTCUSDT", pattern=r"^[A-Za-z0-9]{3,16}$"),
    timeframe: str = Query("15m"),
    market: str = Query("futures", pattern="^(spot|futures)$"),
    train_ratio: float = Query(0.6, ge=0.4, le=0.8),
    fee_rate: float = Query(0.0005, ge=0.0, le=0.01),
    slippage_rate: float = Query(0.0002, ge=0.0, le=0.01)
):
    """
    Execute rigorous chronological walk-forward backtest accounting for fees, slippage, and funding.
    """
    tf_clean = timeframe.lower().strip()
    if tf_clean not in settings.TIMEFRAMES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"code": "INVALID_TIMEFRAME", "message": f"Timeframe '{timeframe}' is not supported."}
        )

    try:
        candles, _ = await binance_service.get_klines(
            symbol=symbol,
            interval=tf_clean,
            limit=1000,
            market=market
        )
        engine = BacktestEngine(fee_rate=fee_rate, slippage_rate=slippage_rate)
        return engine.run_walk_forward(candles, train_ratio=train_ratio)
    except DataUnavailableException as e:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(e))
    except Exception as e:
        logger.error(f"Backtest error: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
