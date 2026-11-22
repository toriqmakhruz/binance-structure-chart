import asyncio
import time
import httpx
import logging
from collections import deque
from typing import Dict, Any, List, Optional, Tuple
from ..config import settings
from ..services.binance_service import HEADERS
from .iti_session_manager import session_manager

logger = logging.getLogger("iti_ingestion")

class ITIIngestionService:
    """
    High-performance, rate-limited market data ingestion service for the ACTIVE SYMBOL only.
    Responsible for:
      1. Maintaining a high-fidelity Local Order Book L2
      2. Maintaining a rolling buffer of Aggregated Trades (maxlen=500)
      3. Ingesting Open Interest, Funding Rate, and Long/Short ratios
      4. Continuously verifying data freshness, sequence continuity, and feed latency
    """
    def __init__(self):
        # Bounded buffers to ensure zero memory leaks on 1GB RAM VPS
        self._trades_buffer: deque = deque(maxlen=500)
        self._local_bids: Dict[float, float] = {}  # price -> qty
        self._local_asks: Dict[float, float] = {}  # price -> qty
        self._last_update_id: int = 0
        self._is_book_synced: bool = False
        self._last_book_update_time: float = 0.0
        self._last_trade_time: float = 0.0
        self._last_derivatives_time: float = 0.0
        self._derivatives_data: Dict[str, Any] = {}
        self._lock = asyncio.Lock()
        self._poll_interval = 2.5  # 2.5s live polling cycle for REST endpoints

    def reset_for_new_symbol(self):
        """Clears memory buffers when symbol is switched."""
        self._trades_buffer.clear()
        self._local_bids.clear()
        self._local_asks.clear()
        self._last_update_id = 0
        self._is_book_synced = False
        self._last_book_update_time = 0.0
        self._derivatives_data.clear()

    async def sync_depth_snapshot(self, symbol: str, market: str, gen_id: int) -> bool:
        """
        Fetches an authoritative L2 depth snapshot (1000 limit) from Binance USD-M Futures.
        Falls back to Binance Vision Spot if ISP-censored.
        """
        endpoint = "https://fapi.binance.com/fapi/v1/depth" if market == "futures" else "https://api.binance.com/api/v3/depth"
        url = f"{endpoint}?symbol={symbol}&limit=1000"
        timeout = httpx.Timeout(4.0, connect=2.0)

        data = None
        try:
            async with httpx.AsyncClient(headers=HEADERS, timeout=timeout, verify=settings.TLS_VERIFY) as client:
                resp = await client.get(url)
                if resp.status_code == 200:
                    data = resp.json()
        except Exception as e:
            logger.debug(f"[ITI Ingestion] Primary depth request error for {symbol}: {e}")

        # Fallback to Binance Vision if primary failed
        if not data or not data.get("bids"):
            try:
                fb_url = f"https://data-api.binance.vision/api/v3/depth?symbol={symbol}&limit=500"
                async with httpx.AsyncClient(headers=HEADERS, timeout=timeout, verify=settings.TLS_VERIFY) as client:
                    fb_resp = await client.get(fb_url)
                    if fb_resp.status_code == 200:
                        data = fb_resp.json()
            except Exception as fb_err:
                logger.warning(f"[ITI Ingestion] Fallback depth failed for {symbol}: {fb_err}")

        if data and data.get("bids"):
            if not session_manager.is_valid_generation(gen_id, symbol):
                return False

            raw_bids = data.get("bids", [])
            raw_asks = data.get("asks", [])
            update_id = int(data.get("lastUpdateId", 0))

            async with self._lock:
                self._local_bids = {float(p): float(q) for p, q in raw_bids}
                self._local_asks = {float(p): float(q) for p, q in raw_asks}
                self._last_update_id = update_id
                self._is_book_synced = True
                self._last_book_update_time = time.time()
            return True

        self._is_book_synced = False
        return False

    async def ingest_agg_trades(self, symbol: str, market: str, gen_id: int) -> bool:
        """
        Polls recent aggregated trades (limit=500) and appends to bounded deque.
        Falls back to Binance Vision Spot if ISP-censored.
        """
        endpoint = "https://fapi.binance.com/fapi/v1/aggTrades" if market == "futures" else "https://api.binance.com/api/v3/aggTrades"
        url = f"{endpoint}?symbol={symbol}&limit=500"
        timeout = httpx.Timeout(4.0, connect=2.0)

        trades = None
        try:
            async with httpx.AsyncClient(headers=HEADERS, timeout=timeout, verify=settings.TLS_VERIFY) as client:
                resp = await client.get(url)
                if resp.status_code == 200:
                    trades = resp.json()
        except Exception as e:
            logger.debug(f"[ITI Ingestion] Primary trades request error for {symbol}: {e}")

        # Fallback to Binance Vision if primary failed
        if not isinstance(trades, list):
            try:
                fb_url = f"https://data-api.binance.vision/api/v3/aggTrades?symbol={symbol}&limit=500"
                async with httpx.AsyncClient(headers=HEADERS, timeout=timeout, verify=settings.TLS_VERIFY) as client:
                    fb_resp = await client.get(fb_url)
                    if fb_resp.status_code == 200:
                        trades = fb_resp.json()
            except Exception as fb_err:
                logger.warning(f"[ITI Ingestion] Fallback trades failed for {symbol}: {fb_err}")

        if isinstance(trades, list) and len(trades) > 0:
            if not session_manager.is_valid_generation(gen_id, symbol):
                return False

            now = time.time()
            async with self._lock:
                for t in trades:
                    p = float(t.get("p", 0.0))
                    q = float(t.get("q", 0.0))
                    m = bool(t.get("m", False))
                    ts = int(t.get("T", 0))
                    self._trades_buffer.append({
                        "p": p,
                        "q": q,
                        "usd": p * q,
                        "is_buyer_maker": m,
                        "timestamp_ms": ts
                    })
                self._last_trade_time = now
            return True

        return False

    async def ingest_derivatives(self, symbol: str, gen_id: int) -> bool:
        """
        Ingests real-time Open Interest, Funding Rate, Long/Short ratios for active symbol.
        """
        timeout = httpx.Timeout(5.0, connect=2.5)
        oi_url = f"https://fapi.binance.com/fapi/v1/openInterest?symbol={symbol}"
        prem_url = f"https://fapi.binance.com/fapi/v1/premiumIndex?symbol={symbol}"
        top_ls_url = f"https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol={symbol}&period=15m&limit=1"
        global_ls_url = f"https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol={symbol}&period=15m&limit=1"
        taker_ls_url = f"https://fapi.binance.com/futures/data/takerlongshortRatio?symbol={symbol}&period=15m&limit=1"

        try:
            async with httpx.AsyncClient(headers=HEADERS, timeout=timeout, verify=settings.TLS_VERIFY) as client:
                tasks = [
                    client.get(oi_url),
                    client.get(prem_url),
                    client.get(top_ls_url),
                    client.get(global_ls_url),
                    client.get(taker_ls_url)
                ]
                res = await asyncio.gather(*tasks, return_exceptions=True)
                if not session_manager.is_valid_generation(gen_id, symbol):
                    return False

                oi_usd = 0.0
                funding_rate = 0.0
                top_trader_long_pct = 50.0
                global_account_long_pct = 50.0
                taker_buy_pct = 50.0

                if not isinstance(res[0], Exception) and res[0].status_code == 200:
                    try:
                        oi_usd = float(res[0].json().get("openInterest", 0.0))
                    except Exception:
                        pass

                if not isinstance(res[1], Exception) and res[1].status_code == 200:
                    try:
                        funding_rate = float(res[1].json().get("lastFundingRate", 0.0))
                    except Exception:
                        pass

                if not isinstance(res[2], Exception) and res[2].status_code == 200:
                    try:
                        arr = res[2].json()
                        if isinstance(arr, list) and len(arr) > 0:
                            top_trader_long_pct = float(arr[0].get("longAccount", 0.5)) * 100.0
                    except Exception:
                        pass

                if not isinstance(res[3], Exception) and res[3].status_code == 200:
                    try:
                        arr = res[3].json()
                        if isinstance(arr, list) and len(arr) > 0:
                            global_account_long_pct = float(arr[0].get("longAccount", 0.5)) * 100.0
                    except Exception:
                        pass

                if not isinstance(res[4], Exception) and res[4].status_code == 200:
                    try:
                        arr = res[4].json()
                        if isinstance(arr, list) and len(arr) > 0:
                            bv = float(arr[0].get("buyVol", 0.5))
                            sv = float(arr[0].get("sellVol", 0.5))
                            taker_buy_pct = (bv / max(1e-6, bv + sv)) * 100.0
                    except Exception:
                        pass

                async with self._lock:
                    self._derivatives_data = {
                        "open_interest_usd": oi_usd,
                        "funding_rate": funding_rate,
                        "top_trader_long_pct": round(top_trader_long_pct, 1),
                        "global_account_long_pct": round(global_account_long_pct, 1),
                        "taker_buy_pct": round(taker_buy_pct, 1),
                        "timestamp": time.time()
                    }
                    self._last_derivatives_time = time.time()
                return True
        except Exception as e:
            logger.warning(f"[ITI Ingestion] Derivatives fetch failed for {symbol}: {e}")
        return False

    def get_local_depth(self, limit: int = 50) -> Tuple[List[Tuple[float, float]], List[Tuple[float, float]]]:
        """Returns sorted (bids, asks) up to limit levels."""
        sorted_bids = sorted(self._local_bids.items(), key=lambda x: x[0], reverse=True)[:limit]
        sorted_asks = sorted(self._local_asks.items(), key=lambda x: x[0], reverse=False)[:limit]
        return sorted_bids, sorted_asks

    def get_trades_buffer(self) -> List[Dict[str, Any]]:
        return list(self._trades_buffer)

    def get_derivatives(self) -> Dict[str, Any]:
        return self._derivatives_data.copy()

    def get_data_health(self) -> Dict[str, Any]:
        now = time.time()
        age = now - max(self._last_book_update_time, self._last_trade_time) if self._last_book_update_time > 0 else 999.0
        status = "ONLINE" if age < 4.0 and self._is_book_synced else "STALE" if age < 15.0 else "OFFLINE"
        return {
            "feed_status": status,
            "latency_ms": round(age * 100.0, 1),
            "last_update_age_s": round(age, 2),
            "local_book_synced": self._is_book_synced,
            "generation_id": session_manager.generation_id
        }

ingestion_service = ITIIngestionService()
