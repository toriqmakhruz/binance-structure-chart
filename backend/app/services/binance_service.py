import asyncio
import math
import time
import httpx
import logging
from typing import List, Dict, Any, Optional, Tuple
from ..config import settings
from ..models.schemas import Candle, AnalysisMetadata

logger = logging.getLogger("binance_service")

STABLECOIN_AND_FIAT_BASES = {
    "USDC", "FDUSD", "TUSD", "USDP", "BUSD", "DAI", "USD1", "RLUSD",
    "USDE", "PYUSD", "BFUSD", "EURI", "EUR", "AEUR", "GBP", "AUD",
    "TRY", "BRL", "JPY", "ARS", "UAH", "PLN", "RON", "CZK", "VAI"
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "application/json"
}

class DataUnavailableException(Exception):
    """Raised when upstream Binance market data cannot be fetched from any valid endpoint."""
    pass

class DataMalformedException(Exception):
    """Raised when data returned by upstream fails structural integrity validation."""
    pass

class BinanceService:
    def __init__(self):
        self.spot_endpoints = settings.BINANCE_SPOT_REST_ENDPOINTS
        self.futures_endpoints = settings.BINANCE_FUTURES_REST_ENDPOINTS
        self._exchange_meta_cache: Dict[str, Tuple[float, Dict[str, str]]] = {}
        self._exchange_meta_ttl = 600.0
        self._tickers_cache: Dict[str, Tuple[float, List[Dict[str, Any]]]] = {}
        self._tickers_locks: Dict[str, asyncio.Lock] = {
            "spot": asyncio.Lock(),
            "futures": asyncio.Lock()
        }
        self._tickers_cache_ttl = 2.5

    def _get_candidate_urls(self, path: str, market: str) -> List[str]:
        """
        Build isolated candidate URLs according to market type.
        Futures requests NEVER fall back to Spot endpoints, and vice versa.
        """
        market_clean = market.lower().strip()
        if market_clean == "spot":
            # Path usually /api/v3/klines or /api/v3/ticker/24hr
            return [f"{base.rstrip('/')}{path}" for base in self.spot_endpoints]
        elif market_clean == "futures":
            # Path usually /fapi/v1/klines or /fapi/v1/ticker/24hr
            return [f"{base.rstrip('/')}{path}" for base in self.futures_endpoints]
        else:
            raise ValueError(f"Unsupported market type: {market}. Must be 'spot' or 'futures'.")

    async def _fetch_raw_batch(
        self,
        symbol: str,
        interval: str,
        limit: int,
        market: str,
        end_time: Optional[int] = None
    ) -> Tuple[List[Any], str]:
        """
        Fetch a batch of klines from isolated upstream endpoints.
        Returns: (raw_data, successful_source_name)
        """
        params: Dict[str, Any] = {
            "symbol": symbol.upper(),
            "interval": interval,
            "limit": min(limit, 1000)
        }
        if end_time:
            params["endTime"] = end_time

        market_clean = market.lower().strip()
        path = "/api/v3/klines" if market_clean == "spot" else "/fapi/v1/klines"
        urls = self._get_candidate_urls(path, market_clean)

        data = None
        successful_source = ""
        last_error = None

        timeout = httpx.Timeout(settings.HTTP_TIMEOUT_SECONDS, connect=5.0)
        async with httpx.AsyncClient(headers=HEADERS, timeout=timeout, verify=settings.TLS_VERIFY) as client:
            for url in urls:
                try:
                    resp = await client.get(url, params=params)
                    if resp.status_code == 200:
                        json_resp = resp.json()
                        if isinstance(json_resp, list):
                            data = json_resp
                            successful_source = f"BINANCE_{market_clean.upper()}"
                            break
                        else:
                            last_error = f"Unexpected response format from {url}: {type(json_resp)}"
                    else:
                        last_error = f"HTTP {resp.status_code} from {url}: {resp.text[:200]}"
                except Exception as exc:
                    last_error = f"Connection error contacting {url}: {exc}"
                    continue

        if data is None:
            err_msg = f"Failed to fetch klines for {symbol} ({market}) from all endpoints. Last error: {last_error}"
            logger.error(err_msg)
            raise DataUnavailableException(err_msg)

        return data, successful_source

    def validate_and_clean_candles(
        self,
        raw_items: List[Any],
        interval: str = "15m",
        server_time_ms: Optional[int] = None
    ) -> List[Candle]:
        """
        Validates OHLCV, timestamp sequence, finite values, and detects open/closed status.
        Rejects corrupt, incomplete, or impossible candle data.
        """
        if not raw_items:
            return []

        cleaned_candles: List[Candle] = []
        now_sec = int(time.time())

        for idx, item in enumerate(raw_items):
            if not isinstance(item, (list, tuple)) or len(item) < 6:
                logger.warning(f"Skipping malformed kline row at index {idx}: insufficient columns")
                continue

            try:
                open_time_ms = int(item[0])
                open_price = float(item[1])
                high_price = float(item[2])
                low_price = float(item[3])
                close_price = float(item[4])
                volume = float(item[5])
                close_time_ms = int(item[6]) if len(item) > 6 else (open_time_ms + 60000)
                taker_buy_vol = float(item[9]) if len(item) > 9 else (volume * 0.5)
            except (ValueError, TypeError) as parse_err:
                logger.warning(f"Skipping row {idx} due to parsing failure: {parse_err}")
                continue

            # 1. Non-finite check
            if not all(math.isfinite(x) for x in [open_price, high_price, low_price, close_price, volume, taker_buy_vol]):
                logger.warning(f"Skipping row {idx}: non-finite numeric values detected")
                continue

            # 2. Positive price check
            if open_price <= 0 or high_price <= 0 or low_price <= 0 or close_price <= 0:
                logger.warning(f"Skipping row {idx}: non-positive price detected")
                continue

            # 3. OHLC mathematical relation integrity
            # High must be >= max(open, close, low)
            # Low must be <= min(open, close, high)
            if high_price < open_price or high_price < close_price or high_price < low_price:
                logger.warning(f"Skipping row {idx}: High ({high_price}) violated OHLC bounds")
                continue
            if low_price > open_price or low_price > close_price:
                logger.warning(f"Skipping row {idx}: Low ({low_price}) violated OHLC bounds")
                continue

            # 4. Volume integrity
            if volume < 0:
                logger.warning(f"Skipping row {idx}: negative volume ({volume})")
                continue
            if taker_buy_vol < 0:
                taker_buy_vol = 0.0
            elif taker_buy_vol > volume:
                # Slight precision overflow guard
                taker_buy_vol = volume

            # 5. Open vs Closed determination
            # If server_time_ms is provided, use it; otherwise use local time in ms
            ref_time_ms = server_time_ms or (now_sec * 1000)
            is_closed = close_time_ms <= ref_time_ms

            candle_sec = int(open_time_ms // 1000)
            cleaned_candles.append(Candle(
                time=candle_sec,
                open=open_price,
                high=high_price,
                low=low_price,
                close=close_price,
                volume=volume,
                taker_buy_volume=taker_buy_vol,
                is_closed=is_closed
            ))

        if not cleaned_candles:
            raise DataMalformedException("No valid candles remained after strict integrity validation.")

        # 6. Deduplicate by timestamp and sort strictly ascending
        candle_map: Dict[int, Candle] = {}
        for c in cleaned_candles:
            candle_map[c.time] = c

        sorted_times = sorted(candle_map.keys())
        sorted_candles = [candle_map[t] for t in sorted_times]

        return sorted_candles

    async def get_klines(
        self,
        symbol: str = "BTCUSDT",
        interval: str = "15m",
        limit: int = 1500,
        market: str = "futures"
    ) -> Tuple[List[Candle], AnalysisMetadata]:
        """
        Fetch historical candlestick data with pagination support and strict data validation.
        Returns validated candles and associated source metadata.
        """
        symbol = symbol.upper().strip()
        market = market.lower().strip()
        received_at = int(time.time())

        raw_items: List[Any] = []
        source_name = f"BINANCE_{market.upper()}"

        if limit <= 1000:
            raw_items, source_name = await self._fetch_raw_batch(symbol, interval, limit, market)
        else:
            # Batch 1 (latest 1000)
            b1, source_name = await self._fetch_raw_batch(symbol, interval, 1000, market)
            if b1:
                first_open_time = b1[0][0]
                # Batch 2 (older candles before first_open_time)
                remaining = min(limit - 1000, 1000)
                try:
                    b2, _ = await self._fetch_raw_batch(symbol, interval, remaining, market, end_time=first_open_time - 1)
                    raw_items = b2 + b1
                except Exception as b2_err:
                    logger.warning(f"Batch 2 pagination failed ({b2_err}), using Batch 1 only.")
                    raw_items = b1
            else:
                raw_items = []

        if not raw_items:
            raise DataUnavailableException(f"DATA_UNAVAILABLE: No klines returned for {symbol} ({market}).")

        candles = self.validate_and_clean_candles(raw_items, interval=interval)

        metadata = AnalysisMetadata(
            symbol=symbol,
            market_type=market,
            interval=interval,
            source=source_name,
            server_time=raw_items[-1][6] // 1000 if len(raw_items[-1]) > 6 else None,
            received_at=received_at,
            total_candles=len(candles),
            is_stale=False
        )

        return candles, metadata

    async def _get_allowed_crypto_usdt_map(
        self,
        client: httpx.AsyncClient,
        market_clean: str
    ) -> Optional[Dict[str, str]]:
        """
        Return a cached mapping of {symbol: baseAsset} for active TRADING crypto USDT pairs.
        - Futures: only PERPETUAL + COIN contracts (excludes TRADIFI_PERPETUAL equities/commodities and delivery contracts).
        - Spot: only active TRADING spot pairs with quoteAsset=USDT, excluding stablecoin/fiat pairs.
        """
        now = time.time()
        cached = self._exchange_meta_cache.get(market_clean)
        if cached and now < cached[0]:
            return cached[1]

        path = "/api/v3/exchangeInfo" if market_clean == "spot" else "/fapi/v1/exchangeInfo"
        urls = self._get_candidate_urls(path, market_clean)

        for url in urls:
            try:
                resp = await client.get(url)
                if resp.status_code != 200:
                    continue
                payload = resp.json()
                raw_symbols = payload.get("symbols") if isinstance(payload, dict) else None
                if not isinstance(raw_symbols, list):
                    continue

                allowed: Dict[str, str] = {}
                for item in raw_symbols:
                    if not isinstance(item, dict):
                        continue
                    if item.get("status") != "TRADING" or item.get("quoteAsset") != "USDT":
                        continue

                    sym = item.get("symbol", "")
                    base = item.get("baseAsset", "")
                    if not sym or not base:
                        continue

                    if market_clean == "futures":
                        if item.get("contractType") != "PERPETUAL":
                            continue
                        if item.get("underlyingType") != "COIN":
                            continue
                    else:
                        if not item.get("isSpotTradingAllowed", True):
                            continue
                        if base.upper() in STABLECOIN_AND_FIAT_BASES:
                            continue

                    allowed[sym] = base

                if allowed:
                    self._exchange_meta_cache[market_clean] = (now + self._exchange_meta_ttl, allowed)
                    return allowed
            except Exception as exc:
                logger.warning(f"Failed fetching exchangeInfo from {url}: {exc}")
                continue

        return cached[1] if cached else None

    async def _fetch_raw_tickers_24hr(
        self,
        client: httpx.AsyncClient,
        market_clean: str
    ) -> Tuple[Optional[List[Dict[str, Any]]], Optional[str]]:
        """Fetch 24h tickers with a short shared lock+cache to prevent rate-limit spikes."""
        lock = self._tickers_locks.setdefault(market_clean, asyncio.Lock())
        async with lock:
            now = time.time()
            cached = self._tickers_cache.get(market_clean)
            if cached and now < cached[0]:
                return cached[1], None

            path = "/api/v3/ticker/24hr" if market_clean == "spot" else "/fapi/v1/ticker/24hr"
            urls = self._get_candidate_urls(path, market_clean)
            last_error = None

            for url in urls:
                try:
                    resp = await client.get(url)
                    if resp.status_code == 200:
                        json_resp = resp.json()
                        if isinstance(json_resp, list):
                            self._tickers_cache[market_clean] = (time.time() + self._tickers_cache_ttl, json_resp)
                            return json_resp, None
                        last_error = f"Expected list response from {url}, got {type(json_resp)}"
                    else:
                        last_error = f"HTTP {resp.status_code} from {url}"
                except Exception as exc:
                    last_error = str(exc)

            return (cached[1] if cached else None), last_error

    async def get_live_ticker_batch(self, market: str = "futures") -> List[Dict[str, Any]]:
        """Return compact live ticker updates {s, c, P, q} for active USDT pairs."""
        market_clean = market.lower().strip()
        timeout = httpx.Timeout(settings.HTTP_TIMEOUT_SECONDS, connect=5.0)
        async with httpx.AsyncClient(headers=HEADERS, timeout=timeout, verify=settings.TLS_VERIFY) as client:
            tickers, allowed_map = await asyncio.gather(
                self._fetch_raw_tickers_24hr(client, market_clean),
                self._get_allowed_crypto_usdt_map(client, market_clean)
            )

        raw_list, _ = tickers
        if not raw_list:
            return []

        updates: List[Dict[str, Any]] = []
        for t in raw_list:
            if not isinstance(t, dict):
                continue
            sym = t.get("symbol", "")
            if not sym.endswith("USDT"):
                continue
            if allowed_map is not None and sym not in allowed_map:
                continue
            try:
                price = float(t.get("lastPrice", 0))
                if price <= 0:
                    continue
                updates.append({
                    "s": sym,
                    "c": price,
                    "P": float(t.get("priceChangePercent", 0)),
                    "q": float(t.get("quoteVolume", 0)),
                })
            except (ValueError, TypeError):
                continue
        return updates

    async def get_symbols(self, market: str = "futures", demo_mode: bool = False) -> List[Dict[str, Any]]:
        """
        Fetch 24h ticker info strictly from the selected market, filtered to active crypto USDT pairs
        and sorted by 24h quoteVolume descending to match Binance's market ranking.
        NEVER injects synthetic or hardcoded prices in production.
        """
        market_clean = market.lower().strip()
        timeout = httpx.Timeout(settings.HTTP_TIMEOUT_SECONDS, connect=5.0)

        async with httpx.AsyncClient(headers=HEADERS, timeout=timeout, verify=settings.TLS_VERIFY) as client:
            (tickers, last_error), allowed_map = await asyncio.gather(
                self._fetch_raw_tickers_24hr(client, market_clean),
                self._get_allowed_crypto_usdt_map(client, market_clean)
            )

        if not tickers:
            if demo_mode:
                logger.warning("Upstream tickers unavailable. Demo mode active, returning tagged DEMO data.")
                return [
                    {"symbol": "BTCUSDT", "baseAsset": "BTC", "lastPrice": 88500.0, "priceChangePercent": 2.45, "quoteVolume": 2500000000, "market": market_clean, "is_demo": True},
                    {"symbol": "ETHUSDT", "baseAsset": "ETH", "lastPrice": 3200.0, "priceChangePercent": 1.82, "quoteVolume": 1200000000, "market": market_clean, "is_demo": True},
                    {"symbol": "SOLUSDT", "baseAsset": "SOL", "lastPrice": 215.0, "priceChangePercent": 5.14, "quoteVolume": 850000000, "market": market_clean, "is_demo": True},
                ]
            err_msg = f"DATA_UNAVAILABLE: Failed to retrieve 24hr tickers for market '{market_clean}'. Last error: {last_error}"
            logger.error(err_msg)
            raise DataUnavailableException(err_msg)

        symbols_list = []
        for t in tickers:
            if not isinstance(t, dict):
                continue
            sym = t.get("symbol", "")
            if not sym.endswith("USDT"):
                continue
            if allowed_map is not None and sym not in allowed_map:
                continue

            try:
                last_price = float(t.get("lastPrice", 0))
                if last_price <= 0:
                    continue
                base_asset = allowed_map[sym] if allowed_map and sym in allowed_map else sym[:-4]
                symbols_list.append({
                    "symbol": sym,
                    "baseAsset": base_asset,
                    "lastPrice": last_price,
                    "priceChangePercent": float(t.get("priceChangePercent", 0)),
                    "quoteVolume": float(t.get("quoteVolume", 0)),
                    "market": market_clean,
                    "source": f"BINANCE_{market_clean.upper()}",
                    "is_demo": False
                })
            except (ValueError, TypeError):
                continue

        symbols_list.sort(key=lambda x: x["quoteVolume"], reverse=True)
        return symbols_list

binance_service = BinanceService()
