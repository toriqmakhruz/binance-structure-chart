import asyncio
import time
import logging
from typing import Optional, Dict, Any, List, Tuple
from fastapi import APIRouter, Query, HTTPException, status, Body
from ..models.schemas import FullAnalysisResponse, Candle, AnalysisMetadata, OpenInterestData, FundingRateData
from ..services.binance_service import (
    binance_service, DataUnavailableException, DataMalformedException
)
from ..config import settings
from ..analysis.smc_engine import SmcEngine
from ..analysis.pattern_engine import PatternEngine
from ..analysis.movement_engine import MovementEngine
from ..analysis.forecast_engine import ForecastEngine
from ..analysis.trend_strength_engine import TrendStrengthEngine
from ..analysis.smart_risk_engine import SmartRiskEngine
from ..analysis.smart_divergence_engine import detect_smart_divergence

logger = logging.getLogger("api_routes")


def _run_analysis_engines(
    candles: List[Candle],
    swing_length: int,
    fvg_min_pct: float,
    forecast_horizon: int,
    setup_mode: str = "standard",
    htf_trend: Optional[str] = None
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
        horizon=forecast_horizon,
        setup_mode=setup_mode,
        htf_trend=htf_trend
    )
    return smc_engine, smc_res, pattern_res, movement_res, forecast_res


_SETUPS_SCAN_CACHE: Dict[Tuple[str, str, int, float, int, int, str], Tuple[float, List[Dict[str, Any]]]] = {}
_SETUPS_SCAN_LOCKS: Dict[Tuple[str, str, int, float, int, int, str], asyncio.Lock] = {}
_SETUPS_CACHE_TTL_SECONDS = 60.0

_DIVERGENCE_SCAN_CACHE: Dict[Tuple[str, str, int], Tuple[float, List[Dict[str, Any]]]] = {}
_DIVERGENCE_SCAN_LOCKS: Dict[Tuple[str, str, int], asyncio.Lock] = {}
_DIVERGENCE_CACHE_TTL_SECONDS = 30.0

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
    forecast_horizon: int = Query(20, ge=5, le=50),
    setup_mode: str = Query("standard", pattern="^(standard|pro_shield|craig_10x|apex_quant|smart_risk)$")
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

        # 2. Optional Multi-Timeframe (HTF) Analysis
        htf_data = None
        htf_trend_val = None
        if htf and htf_clean != tf_clean:
            try:
                htf_candles, _ = await binance_service.get_klines(
                    symbol=symbol,
                    interval=htf_clean,
                    limit=200,
                    market=market
                )
                if htf_candles:
                    temp_smc = SmcEngine(swing_length=swing_length, fvg_min_pct=fvg_min_pct)
                    htf_smc = temp_smc.analyze(htf_candles)
                    htf_trend_val = htf_smc.current_trend
                    htf_data = {
                        "timeframe": htf_clean,
                        "current_trend": htf_smc.current_trend,
                        "order_blocks": [ob.model_dump() for ob in htf_smc.order_blocks if not ob.mitigated][-5:],
                        "events": [ev.model_dump() for ev in htf_smc.events][-4:]
                    }
            except Exception as htf_err:
                logger.warning(f"Failed to fetch HTF data: {htf_err}")

        # 3. Run analysis engines (with setup_mode and optional htf_trend)
        smc_engine, smc_res, pattern_res, movement_res, forecast_res = _run_analysis_engines(
            candles=candles,
            swing_length=swing_length,
            fvg_min_pct=fvg_min_pct,
            forecast_horizon=forecast_horizon,
            setup_mode=setup_mode,
            htf_trend=htf_trend_val
        )

        # 4. Calculate Comprehensive Quantitative Trend Strength (TSI)
        trend_engine = TrendStrengthEngine()
        trend_res = trend_engine.analyze(
            candles=candles,
            htf_overlay=htf_data,
            timeframe=tf_clean
        )

        # 5. Smart Risk Institutional SMC Analysis
        smart_risk_data = None
        try:
            smart_risk_engine = SmartRiskEngine()
            smart_risk_res = smart_risk_engine.analyze(
                candles=candles,
                swings=smc_res.swings if smc_res else None,
                pools=smc_res.liquidity_pools if smc_res else None
            )
            smart_risk_data = smart_risk_res.model_dump()
        except Exception as _sr_err:
            logger.debug(f"Smart risk analysis calculation skipped: {_sr_err}")

        # Fetch Open Interest & Funding Rate if market is futures (purely informational indicators)
        oi_data = None
        funding_data = None
        if market.lower() == "futures":
            try:
                oi_data, funding_data = await asyncio.gather(
                    binance_service.get_open_interest(symbol=symbol, timeframe=tf_clean),
                    binance_service.get_funding_rate(symbol=symbol),
                    return_exceptions=True
                )
                if isinstance(oi_data, Exception):
                    logger.debug(f"OI fetch error: {oi_data}")
                    oi_data = None
                if isinstance(funding_data, Exception):
                    logger.debug(f"Funding rate fetch error: {funding_data}")
                    funding_data = None
            except Exception as feat_err:
                logger.debug(f"Futures features fetch error: {feat_err}")

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
            metadata=metadata,
            open_interest=oi_data,
            funding_rate=funding_data,
            setup_mode=setup_mode,
            trend_strength=trend_res,
            smart_risk=smart_risk_data
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
    forecast_horizon: int,
    setup_mode: str = "standard"
) -> Optional[Dict[str, Any]]:
    """Scan one symbol and return only if a genuinely VALID_ENTRY setup is active."""
    sym = sym_info["symbol"]
    async with sem:
        await asyncio.sleep(0.08)
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
                forecast_horizon=forecast_horizon,
                setup_mode=setup_mode
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
                "setup_mode": setup_mode,
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
    force_refresh: bool = Query(False),
    setup_mode: str = Query("standard", pattern="^(standard|pro_shield|craig_10x|apex_quant|smart_risk)$")
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

    cache_key = (market, tf_clean, swing_length, round(fvg_min_pct, 4), forecast_horizon, scan_limit, setup_mode)
    lock = _SETUPS_SCAN_LOCKS.setdefault(cache_key, asyncio.Lock())

    async with lock:
        now = time.time()
        cached = _SETUPS_SCAN_CACHE.get(cache_key)
        is_spammed = cached and force_refresh and (now - (cached[0] - _SETUPS_CACHE_TTL_SECONDS)) < 30.0
        if (not force_refresh or is_spammed) and cached and now < cached[0]:
            return {
                "market": market,
                "timeframe": tf_clean,
                "setup_mode": setup_mode,
                "scanned_count": scan_limit,
                "valid_count": len(cached[1]),
                "updated_at": int(cached[0] - _SETUPS_CACHE_TTL_SECONDS),
                "setups": cached[1],
            }

        try:
            top_symbols = await binance_service.get_symbols(market=market, demo_mode=False)
            candidates = top_symbols[:min(scan_limit, 16)]
            sem = asyncio.Semaphore(3)
            results = await asyncio.gather(*[
                _scan_symbol_valid_setup(
                    sem=sem,
                    sym_info=sym_info,
                    market=market,
                    timeframe=tf_clean,
                    swing_length=swing_length,
                    fvg_min_pct=fvg_min_pct,
                    forecast_horizon=forecast_horizon,
                    setup_mode=setup_mode
                )
                for sym_info in candidates
            ])
            valid_setups = [r for r in results if r is not None]
            valid_setups.sort(
                key=lambda x: (x["entry_time"], x["confluence_weight"]),
                reverse=True
            )
            _SETUPS_SCAN_CACHE[cache_key] = (time.time() + _SETUPS_CACHE_TTL_SECONDS, valid_setups)
            try:
                from ..services.telegram_service import telegram_service
                if valid_setups and telegram_service.settings.get("enabled"):
                    asyncio.create_task(telegram_service.notify_new_setups_from_radar(valid_setups))
            except Exception as _tg_err:
                logger.debug(f"Telegram dispatch from radar ignored: {_tg_err}")
            return {
                "market": market,
                "timeframe": tf_clean,
                "setup_mode": setup_mode,
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


async def _scan_symbol_divergence_task(
    sem: asyncio.Semaphore,
    sym_info: Dict[str, Any],
    market: str,
    timeframe: str
) -> Optional[Dict[str, Any]]:
    sym = sym_info["symbol"]
    async with sem:
        await asyncio.sleep(0.04)
        try:
            candles, _ = await binance_service.get_klines(
                symbol=sym,
                interval=timeframe,
                limit=140,
                market=market
            )
            if not candles or len(candles) < 40:
                return None
            return detect_smart_divergence(candles, sym_info, timeframe=timeframe)
        except Exception as exc:
            logger.debug(f"Divergence scan skipped {sym} ({market}/{timeframe}): {exc}")
            return None


@router.get("/scanner/smart-divergence")
async def get_smart_divergence_scan(
    market: str = Query("futures", pattern="^(spot|futures)$"),
    timeframe: str = Query("15m"),
    scan_limit: int = Query(24, ge=5, le=40),
    force_refresh: bool = Query(False)
):
    """
    Scan top traded Binance crypto pairs for active Smart Divergence signals
    (Multi-oscillator consensus: RSI + MACD + CVD/MFI, Rejection Wick, Sweeps).
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

    cache_key = (market, tf_clean, scan_limit)
    lock = _DIVERGENCE_SCAN_LOCKS.setdefault(cache_key, asyncio.Lock())

    async with lock:
        now = time.time()
        cached = _DIVERGENCE_SCAN_CACHE.get(cache_key)
        is_spammed = cached and force_refresh and (now - (cached[0] - _DIVERGENCE_CACHE_TTL_SECONDS)) < 15.0
        if (not force_refresh or is_spammed) and cached and now < cached[0]:
            return {
                "market": market,
                "timeframe": tf_clean,
                "scanned_count": scan_limit,
                "detected_count": len(cached[1]),
                "updated_at": int(cached[0] - _DIVERGENCE_CACHE_TTL_SECONDS),
                "signals": cached[1]
            }

        try:
            top_symbols = await binance_service.get_symbols(market=market, demo_mode=False)
            candidates = top_symbols[:min(scan_limit, 28)]
            sem = asyncio.Semaphore(4)
            results = await asyncio.gather(*[
                _scan_symbol_divergence_task(
                    sem=sem,
                    sym_info=sym_info,
                    market=market,
                    timeframe=tf_clean
                )
                for sym_info in candidates
            ])
            valid_signals = [r for r in results if r is not None]
            valid_signals.sort(
                key=lambda x: (x["grade"] == "A", x["confirm_time"]),
                reverse=True
            )
            _DIVERGENCE_SCAN_CACHE[cache_key] = (time.time() + _DIVERGENCE_CACHE_TTL_SECONDS, valid_signals)
            return {
                "market": market,
                "timeframe": tf_clean,
                "scanned_count": len(candidates),
                "detected_count": len(valid_signals),
                "updated_at": int(time.time()),
                "signals": valid_signals
            }
        except DataUnavailableException as e:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={"code": "DATA_UNAVAILABLE", "message": str(e)}
            )
        except Exception as e:
            logger.error(f"Error scanning smart divergences: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail={"code": "DIVERGENCE_SCAN_FAILED", "message": str(e)}
            )


@router.get("/scanner/squeeze-hunter")
async def get_squeeze_hunter_scan(
    min_funding_pct: float = Query(0.03, ge=0.01, le=2.0),
    limit: int = Query(30, ge=5, le=60)
):
    """
    Whale Liquidation & Short Squeeze Hunter Scanner:
    Scans for extreme negative funding rates (Short Squeeze / Pump Bias)
    and extreme positive funding rates (Long Squeeze / Dump Bias).
    """
    from ..analysis.squeeze_hunter_engine import scan_market_squeeze_candidates
    candidates = await scan_market_squeeze_candidates(
        min_funding_abs_pct=min_funding_pct,
        limit=limit
    )
    return {
        "market": "futures",
        "scanned_count": len(candidates),
        "updated_at": int(time.time()),
        "candidates": candidates
    }


@router.get("/open-interest", response_model=Optional[OpenInterestData])
async def get_open_interest(
    symbol: str = Query("BTCUSDT", pattern=r"^[A-Za-z0-9]{3,16}$"),
    timeframe: str = Query("15m")
):
    """
    Get real-time Open Interest statistics for Binance USD-M Futures.
    Purely informational indicator for traders - not used in automated entry scoring.
    """
    return await binance_service.get_open_interest(symbol=symbol, timeframe=timeframe)


@router.get("/funding-rate", response_model=Optional[FundingRateData])
async def get_funding_rate(
    symbol: str = Query("BTCUSDT", pattern=r"^[A-Za-z0-9]{3,16}$")
):
    """
    Get real-time Funding Rate & settlement countdown for Binance USD-M Futures.
    Purely an informational indicator for traders - not used in automated entry scoring.
    """
    return await binance_service.get_funding_rate(symbol=symbol)


@router.get("/user-preferences")
async def get_user_preferences():
    """
    Get server-stored user layout, indicator configurations, and chart preferences
    for cross-device synchronization (PC, mobile, tablet, different browsers).
    """
    from ..services.preferences_service import preferences_service
    return preferences_service.get_preferences()


@router.post("/user-preferences")
async def save_user_preferences(payload: Dict[str, Any] = Body(...)):
    """
    Persist user layout, indicator settings, and chart preferences on the server
    so any browser or mobile device will immediately load the user's custom layout.
    """
    from ..services.preferences_service import preferences_service
    res = preferences_service.save_preferences(payload)
    if not res.get("success"):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=res.get("message", "Gagal menyimpan konfigurasi ke server.")
        )
    return res


@router.get("/market/liquidity-matrix")
async def get_market_liquidity_matrix(
    symbol: str = Query("BTCUSDT", description="Trading pair symbol"),
    market: str = Query("futures", description="Market type ('futures' or 'spot')"),
    bins: int = Query(24, ge=10, le=40, description="Number of price brackets to return")
):
    """
    100% Real-time Order Book & Liquidity Matrix directly from Binance:
    - Segregates Institutional/Whale Orders (>= $50k ticket) vs Retail Orders (< $10k ticket)
    - Computes real margin liquidation / forced stop loss risk clusters
    - Non-chart Depth of Market profiling
    """
    from ..services.liquidity_matrix_service import liquidity_matrix_service
    try:
        return await liquidity_matrix_service.get_liquidity_matrix(
            symbol=symbol,
            market=market,
            num_bins=bins
        )
    except Exception as e:
        logger.error(f"Error generating liquidity matrix: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Gagal mengambil data buku order riil Binance: {str(e)}"
        )


@router.get("/market/xray")
async def get_market_xray(
    symbol: str = Query("BTCUSDT", description="Trading pair symbol"),
    market: str = Query("futures", description="Market type ('futures' or 'spot')")
):
    """
    Market X-Ray Engine (Big Data Stop Loss & Liquidity Radar):
    - Dissects order book L2 into Whale vs Retail ticket clusters
    - Computes real mathematical forced stop loss / liquidation pools
    - Analyzes Top Trader LS ratio, Global LS ratio, Open Interest & Taker aggression
    - Returns real-time Squeeze Hunting intent, confidence %, and Whale Fortress walls
    """
    from ..services.market_xray_service import market_xray_service
    try:
        return await market_xray_service.get_market_xray(
            symbol=symbol,
            market=market
        )
    except Exception as e:
        logger.error(f"Error generating market xray: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Gagal mengambil telemetry Market X-Ray: {str(e)}"
        )


@router.get("/market/sentiment-matrix")
async def get_whale_sentiment_matrix(
    symbol: str = Query("BTCUSDT", description="Trading pair symbol"),
    market: str = Query("futures", description="Market type ('futures' or 'spot')"),
    period: str = Query("5m", description="Period granularity ('5m', '15m', '1h')")
):
    """
    Whale vs Retail Sentiment Matrix (Smart Money Long/Short Divergence):
    - Top Trader Long/Short Position Ratio (Whale Contract Volume)
    - Top Trader Long/Short Account Ratio (Whale Trader Count)
    - Global Long/Short Account Ratio (Retail Public)
    - Taker Buy/Sell Aggression Ratio
    - Smart Money vs Retail Divergence Delta & Actionable Guidance
    """
    from ..services.whale_sentiment_service import whale_sentiment_service
    try:
        return await whale_sentiment_service.get_sentiment_matrix(
            symbol=symbol,
            market=market,
            period=period
        )
    except Exception as e:
        logger.error(f"Error generating sentiment matrix: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Gagal mengambil Whale Sentiment Matrix: {str(e)}"
        )


