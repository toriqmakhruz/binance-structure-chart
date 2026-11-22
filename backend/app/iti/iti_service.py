import asyncio
import time
import logging
from typing import Optional, Dict, Any, Tuple
from ..services.binance_service import binance_service
from ..models.iti_schemas import (
    ITITelemetryResponse,
    ITIDataHealth
)
from .iti_session_manager import session_manager
from .iti_ingestion import ingestion_service
from .engines.iti_smc_engine import smc_engine
from .engines.iti_liquidity_engine import liquidity_engine
from .engines.iti_sl_hunter_engine import sl_hunter_engine
from .engines.iti_dom_engine import dom_engine
from .engines.iti_footprint_engine import footprint_engine
from .engines.iti_volume_profile_engine import volume_profile_engine
from .engines.iti_derivatives_engine import derivatives_engine
from .iti_decision_engine import decision_engine

logger = logging.getLogger("iti_service")

class ITIService:
    """
    Master Institutional Trading Intelligence (ITI) Service.
    Orchestrates:
      - Active pair session resolution (strict single active symbol)
      - Ingestion tasks
      - 7 Core Institutional Engines
      - Hard Gates & Trade Plan Builder
    """
    def __init__(self):
        self._cache: Dict[str, Tuple[float, ITITelemetryResponse]] = {}
        self._cache_ttl = 1.5  # 1.5s live response cache

    async def switch_pair(self, symbol: str, market: str = "futures") -> int:
        """Explicit pair switch trigger from user."""
        gen_id = await session_manager.set_active_symbol(symbol, market)
        ingestion_service.reset_for_new_symbol()
        # Trigger immediate initial ingestion
        asyncio.create_task(self._initial_sync(symbol, market, gen_id))
        return gen_id

    async def _initial_sync(self, symbol: str, market: str, gen_id: int):
        try:
            await asyncio.gather(
                ingestion_service.sync_depth_snapshot(symbol, market, gen_id),
                ingestion_service.ingest_agg_trades(symbol, market, gen_id),
                ingestion_service.ingest_derivatives(symbol, gen_id),
                return_exceptions=True
            )
        except Exception as e:
            logger.warning(f"[ITI] Initial sync exception for {symbol}: {e}")

    async def get_telemetry(self, symbol: Optional[str] = None, market: Optional[str] = None) -> ITITelemetryResponse:
        active_sym = (symbol or session_manager.active_symbol).upper().strip()
        active_mkt = (market or session_manager.active_market).lower().strip()

        # If symbol differs, switch pair session
        if active_sym != session_manager.active_symbol or active_mkt != session_manager.active_market:
            await self.switch_pair(active_sym, active_mkt)

        gen_id = session_manager.generation_id
        cache_key = f"{active_sym}_{active_mkt}_{gen_id}"
        now = time.time()

        if cache_key in self._cache:
            ts, cached_resp = self._cache[cache_key]
            if now - ts < self._cache_ttl:
                return cached_resp

        # Ensure market data is fresh
        health = ingestion_service.get_data_health()
        if not health["local_book_synced"] or health["last_update_age_s"] > 3.0:
            await self._initial_sync(active_sym, active_mkt, gen_id)

        # 1. Fetch Candles
        candles, _ = await binance_service.get_klines(
            symbol=active_sym,
            interval="15m",
            limit=120,
            market=active_mkt
        )
        current_price = candles[-1].close if candles else 58000.0

        # 2. Run 7 Engines
        bids, asks = ingestion_service.get_local_depth(50)
        trades = ingestion_service.get_trades_buffer()
        raw_deriv = ingestion_service.get_derivatives()

        smc = smc_engine.analyze(candles)
        liq = liquidity_engine.analyze(candles)
        bsl_p = liq.nearest_bsl.get("price", 0.0) if liq.nearest_bsl else 0.0
        ssl_p = liq.nearest_ssl.get("price", 0.0) if liq.nearest_ssl else 0.0
        sl = sl_hunter_engine.analyze(candles, bsl_p, ssl_p)
        dom = dom_engine.analyze(bids, asks, current_price)
        footprint = footprint_engine.analyze(trades, current_price)
        vp = volume_profile_engine.analyze(candles)
        deriv = derivatives_engine.analyze(raw_deriv, current_price)
        data_health = ITIDataHealth(**ingestion_service.get_data_health())

        # 3. Decision Engine & Trade Plan
        lifecycle, direction, confidence, long_score, short_score, hard_gates, trade_plan = decision_engine.evaluate_decision(
            current_price=current_price,
            smc=smc,
            liq=liq,
            sl=sl,
            dom=dom,
            footprint=footprint,
            vp=vp,
            deriv=deriv,
            data_health=data_health
        )

        response = ITITelemetryResponse(
            symbol=active_sym,
            generation_id=gen_id,
            market=active_mkt,
            current_price=round(current_price, 2),
            timestamp=int(now),
            lifecycle_state=lifecycle,
            direction=direction,
            confidence_score=confidence,
            long_score=long_score,
            short_score=short_score,
            hard_gates=hard_gates,
            trade_plan=trade_plan,
            smc=smc,
            liquidity=liq,
            sl_hunter=sl,
            dom=dom,
            footprint=footprint,
            volume_profile=vp,
            derivatives=deriv,
            data_health=data_health
        )

        self._cache[cache_key] = (now, response)
        return response

iti_service = ITIService()
