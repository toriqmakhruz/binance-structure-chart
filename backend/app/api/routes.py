import asyncio
import time
import logging
from typing import Optional, Dict, Any, List, Tuple
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


def _run_analysis_engines(
    candles: List[Candle],
    swing_length: int,
    fvg_min_pct: float,
    forecast_horizon: int
):
    """Run SMC, pattern, movement, and forecast engines uniformly."""
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
    return smc_engine, smc_res, pattern_res, movement_res, forecast_res


_SETUPS_SCAN_CACHE: Dict[Tuple[str, str, int, float, int, int], Tuple[float, List[Dict[str, Any]]]] = {}
_SETUPS_SCAN_LOCKS: Dict[Tuple[str, str, int, float, int, int], asyncio.Lock] = {}
_SETUPS_CACHE_TTL_SECONDS = 60.0
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
        smc_engine, smc_res, pattern_res, movement_res, forecast_res = _run_analysis_engines(
            candles=candles,
            swing_length=swing_length,
            fvg_min_pct=fvg_min_pct,
            forecast_horizon=forecast_horizon
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


async def _scan_symbol_valid_setup(
    sem: asyncio.Semaphore,
    sym_info: Dict[str, Any],
    market: str,
    timeframe: str,
    swing_length: int,
    fvg_min_pct: float,
    forecast_horizon: int
) -> Optional[Dict[str, Any]]:
    """Scan one symbol and return only if a genuinely VALID_ENTRY setup is active."""
    sym = sym_info["symbol"]
    async with sem:
        try:
            candles, _ = await binance_service.get_klines(
                symbol=sym,
                interval=timeframe,
                limit=500,
                market=market
            )
            if not candles or len(candles) < 60:
                return None

            _, _, _, movement_res, forecast_res = _run_analysis_engines(
                candles=candles,
                swing_length=swing_length,
                fvg_min_pct=fvg_min_pct,
                forecast_horizon=forecast_horizon
            )

            valid_sc = next(
                (
                    sc for sc in forecast_res.scenarios
                    if sc.is_valid is True
                    and sc.status == "VALID_ENTRY"
                    and (sc.risk_reward_ratio or 0) >= 1.5
                    and sc.entry_price is not None
                    and sc.direction in ("LONG", "SHORT")
                ),
                None
            )
            if not valid_sc:
                return None

            live_price = float(sym_info.get("lastPrice") or candles[-1].close)
            sl = float(valid_sc.invalidation_price)
            tp = float(valid_sc.target_price)

            # Discard immediately if live price already breached SL or reached TP
            if valid_sc.direction == "LONG":
                if live_price <= sl or live_price >= tp:
                    return None
            else:
                if live_price >= sl or live_price <= tp:
                    return None

            return {
                "symbol": sym,
                "baseAsset": sym_info.get("baseAsset") or sym[:-4],
                "market": market,
                "timeframe": timeframe,
                "direction": valid_sc.direction,
                "name": valid_sc.name,
                "entry_price": float(valid_sc.entry_price),
                "entry_time": int(valid_sc.entry_time or candles[-1].time),
                "entry_zone_high": float(valid_sc.entry_zone_high or valid_sc.entry_price),
                "entry_zone_low": float(valid_sc.entry_zone_low or valid_sc.entry_price),
                "invalidation_price": sl,
                "target_price": tp,
                "risk_reward_ratio": float(valid_sc.risk_reward_ratio),
                "confluence_weight": float(valid_sc.confluence_weight),
                "confluence_score": float(movement_res.confluence_score),
                "current_price": live_price,
                "price_change_pct": float(sym_info.get("priceChangePercent", 0.0)),
                "quote_volume": float(sym_info.get("quoteVolume", 0.0)),
            }
        except Exception as exc:
            logger.debug(f"Setup scan skipped {sym} ({market}/{timeframe}): {exc}")
            return None


@router.get("/setups")
async def get_valid_setups(
    market: str = Query("futures", pattern="^(spot|futures)$"),
    timeframe: str = Query("15m"),
    swing_length: int = Query(5, ge=2, le=20),
    fvg_min_pct: float = Query(0.05, ge=0.01, le=1.0),
    forecast_horizon: int = Query(20, ge=5, le=50),
    scan_limit: int = Query(24, ge=5, le=40),
    force_refresh: bool = Query(False)
):
    """
    Scan top traded Binance crypto pairs and return ONLY currently VALID A+ setups,
    sorted newest first by entry_time. Invalidated/triggered-SL/TP setups are discarded.
    """
    tf_clean = timeframe.lower().strip()
    if tf_clean not in settings.TIMEFRAMES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "INVALID_TIMEFRAME",
                "message": f"Timeframe '{timeframe}' is not supported. Allowed: {settings.TIMEFRAMES}"
            }
        )

    cache_key = (market, tf_clean, swing_length, round(fvg_min_pct, 4), forecast_horizon, scan_limit)
    lock = _SETUPS_SCAN_LOCKS.setdefault(cache_key, asyncio.Lock())

    async with lock:
        now = time.time()
        cached = _SETUPS_SCAN_CACHE.get(cache_key)
        if not force_refresh and cached and now < cached[0]:
            return {
                "market": market,
                "timeframe": tf_clean,
                "scanned_count": scan_limit,
                "valid_count": len(cached[1]),
                "updated_at": int(cached[0] - _SETUPS_CACHE_TTL_SECONDS),
                "setups": cached[1],
            }

        try:
            top_symbols = await binance_service.get_symbols(market=market, demo_mode=False)
            candidates = top_symbols[:scan_limit]
            sem = asyncio.Semaphore(8)
            results = await asyncio.gather(*[
                _scan_symbol_valid_setup(
                    sem=sem,
                    sym_info=sym_info,
                    market=market,
                    timeframe=tf_clean,
                    swing_length=swing_length,
                    fvg_min_pct=fvg_min_pct,
                    forecast_horizon=forecast_horizon
                )
                for sym_info in candidates
            ])
            valid_setups = [r for r in results if r is not None]
            valid_setups.sort(
                key=lambda x: (x["entry_time"], x["confluence_weight"]),
                reverse=True
            )
            _SETUPS_SCAN_CACHE[cache_key] = (time.time() + _SETUPS_CACHE_TTL_SECONDS, valid_setups)
            return {
                "market": market,
                "timeframe": tf_clean,
                "scanned_count": len(candidates),
                "valid_count": len(valid_setups),
                "updated_at": int(time.time()),
                "setups": valid_setups,
            }
        except DataUnavailableException as e:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={"code": "DATA_UNAVAILABLE", "message": str(e)}
            )
        except Exception as e:
            logger.error(f"Error scanning setups: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail={"code": "SETUPS_SCAN_FAILED", "message": str(e)}
            )
