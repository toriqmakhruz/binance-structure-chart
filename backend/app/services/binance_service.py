import asyncio
import math
import time
import httpx
import logging
import re
from typing import List, Dict, Any, Optional, Tuple
from ..config import settings
from ..models.schemas import Candle, AnalysisMetadata, OpenInterestData, OpenInterestPoint

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
        self._tickers_cache_ttl = 15.0
        self._klines_cache: Dict[Tuple[str, str, str], Tuple[float, List[Candle], AnalysisMetadata]] = {}
        self._klines_cache_ttl = 10.0
        self._oi_cache: Dict[str, Tuple[float, OpenInterestData]] = {}
        self._ban_until: float = 0.0

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
        Fetch a batch of klines from isolated upstream endpoints with automatic Spot fallback on rate limit ban.
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
        now = time.time()
        if market_clean == "futures" and now < self._ban_until:
            wait_s = int(self._ban_until - now)
            logger.warning(f"Binance Futures rate-limit cooldown ({wait_s}s). Fallback otomatis ke Spot klines untuk {symbol}...")
            try:
                spot_data, _ = await self._fetch_raw_batch(symbol, interval, limit, market="spot", end_time=end_time)
                return spot_data, "BINANCE_SPOT_FALLBACK"
            except Exception as e:
                logger.error(f"Spot fallback failed for {symbol}: {e}")
                raise DataUnavailableException(f"Binance Futures rate-limit aktif ({wait_s}s) & Spot fallback gagal: {e}")

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
                    elif resp.status_code in (418, 429):
                        match = re.search(r"banned until (\d+)", resp.text)
                        if match:
                            ban_ts_sec = float(match.group(1)) / 1000.0
                            self._ban_until = max(self._ban_until, ban_ts_sec + 2.0)
                            wait_s = int(self._ban_until - time.time())
                            logger.warning(f"Binance rate limit ban triggered until {ban_ts_sec} ({wait_s}s cooldown).")
                        else:
                            ra = resp.headers.get("retry-after")
                            sec = min(float(ra) if ra and ra.isdigit() else 60.0, 180.0)
                            self._ban_until = time.time() + sec
                            logger.warning(f"Binance rate limit ban triggered (HTTP {resp.status_code}). Backing off for {sec}s.")
                        last_error = f"HTTP {resp.status_code}: Rate limit ban ({resp.text[:120]})"
                        break
                    else:
                        last_error = f"HTTP {resp.status_code} from {url}: {resp.text[:200]}"
                except Exception as exc:
                    last_error = f"Connection error contacting {url}: {exc}"
                    continue

        if data is None:
            if market_clean == "futures":
                logger.warning(f"Futures candidate endpoints unavailable for {symbol}. Fallback ke Spot klines...")
                try:
                    spot_data, _ = await self._fetch_raw_batch(symbol, interval, limit, market="spot", end_time=end_time)
                    return spot_data, "BINANCE_SPOT_FALLBACK"
                except Exception as fallback_err:
                    logger.error(f"Spot fallback failed for {symbol}: {fallback_err}")
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

        cache_key = (symbol, interval, market)
        now = time.time()
        cached = self._klines_cache.get(cache_key)
        if cached and now < cached[0] and len(cached[1]) >= min(limit, 1000):
            return cached[1], cached[2]

        try:
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
        except DataUnavailableException as due:
            if cached and cached[1]:
                logger.info(f"Serving cached klines for {symbol} due to temporary upstream limit: {due}")
                return cached[1], cached[2]
            raise

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

        self._klines_cache[cache_key] = (time.time() + self._klines_cache_ttl, candles, metadata)
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
        if market_clean == "futures" and now < self._ban_until:
            if cached and cached[1]:
                return cached[1]
            return await self._get_allowed_crypto_usdt_map(client, "spot")

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
            if market_clean == "futures" and now < self._ban_until:
                if cached and cached[1]:
                    return cached[1], None
                return await self._fetch_raw_tickers_24hr(client, "spot")

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
                    elif resp.status_code in (418, 429):
                        match = re.search(r"banned until (\d+)", resp.text)
                        if match:
                            ban_ts_sec = float(match.group(1)) / 1000.0
                            self._ban_until = max(self._ban_until, ban_ts_sec + 2.0)
                        else:
                            self._ban_until = time.time() + 120.0
                        last_error = f"HTTP {resp.status_code} from {url}"
                        break
                    else:
                        last_error = f"HTTP {resp.status_code} from {url}"
                except Exception as exc:
                    last_error = str(exc)

            if cached and cached[1]:
                return cached[1], None
            if market_clean == "futures":
                logger.warning(f"Futures tickers failed ({last_error}). Falling back to Spot tickers...")
                try:
                    return await self._fetch_raw_tickers_24hr(client, "spot")
                except Exception:
                    pass

            return None, last_error

    async def get_live_ticker_batch(self, market: str = "futures") -> List[Dict[str, Any]]:
        """Return compact live ticker updates {s, c, P, q} for active USDT pairs."""
        market_clean = market.lower().strip()
        if market_clean == "futures" and time.time() < self._ban_until:
            return await self.get_live_ticker_batch(market="spot")
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
            if market_clean == "futures" and not demo_mode:
                logger.warning(f"Futures symbols unavailable ({last_error}). Falling back to Spot symbols...")
                try:
                    spot_symbols = await self.get_symbols(market="spot", demo_mode=False)
                    if spot_symbols:
                        return spot_symbols
                except Exception as fb_err:
                    logger.error(f"Spot symbols fallback failed: {fb_err}")
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

    async def get_open_interest(self, symbol: str, timeframe: str = "15m") -> Optional[OpenInterestData]:
        """
        Fetch real-time Open Interest and historical statistics from Binance Futures.
        Purely an informational indicator - never passed into forecasting or entry formulas.
        """
        sym_upper = symbol.upper().strip()
        tf_clean = timeframe.lower().strip()
        now = time.time()
        
        # Check cache (15s TTL)
        cache_key = f"{sym_upper}_{tf_clean}"
        if cache_key in self._oi_cache:
            cache_time, cached_data = self._oi_cache[cache_key]
            if now - cache_time < 15.0:
                return cached_data

        period_map = {
            "1m": "5m",
            "3m": "5m",
            "5m": "5m",
            "15m": "15m",
            "30m": "30m",
            "1h": "1h",
            "2h": "2h",
            "4h": "4h",
            "6h": "6h",
            "12h": "12h",
            "1d": "1d",
        }
        period = period_map.get(tf_clean, "15m")

        try:
            async with httpx.AsyncClient(timeout=6.0, headers=HEADERS, verify=settings.TLS_VERIFY) as client:
                oi_url = f"https://fapi.binance.com/fapi/v1/openInterest?symbol={sym_upper}"
                hist_url = f"https://fapi.binance.com/futures/data/openInterestHist?symbol={sym_upper}&period={period}&limit=100"

                res_oi, res_hist = await asyncio.gather(
                    client.get(oi_url),
                    client.get(hist_url),
                    return_exceptions=True
                )

                if isinstance(res_oi, Exception) or res_oi.status_code != 200:
                    logger.debug(f"Current OI unavailable for {sym_upper}: {res_oi}")
                    return None

                oi_json = res_oi.json()
                current_oi = float(oi_json.get("openInterest", 0))
                oi_time = int(oi_json.get("time", int(now * 1000)))

                history_points: List[OpenInterestPoint] = []
                current_oi_value = 0.0
                change_1h = 0.0
                change_24h = 0.0

                if not isinstance(res_hist, Exception) and res_hist.status_code == 200:
                    hist_data = res_hist.json()
                    if isinstance(hist_data, list) and len(hist_data) > 0:
                        for item in hist_data:
                            try:
                                history_points.append(OpenInterestPoint(
                                    timestamp=int(item.get("timestamp", 0)),
                                    open_interest=float(item.get("sumOpenInterest", 0)),
                                    open_interest_value=float(item.get("sumOpenInterestValue", 0))
                                ))
                            except (ValueError, TypeError):
                                continue

                        if history_points:
                            latest_hist = history_points[-1]
                            current_oi_value = latest_hist.open_interest_value
                            
                            # 1h delta based on timestamp (~3600s ago)
                            target_1h_ts = latest_hist.timestamp - 3600 * 1000
                            closest_1h = min(history_points, key=lambda p: abs(p.timestamp - target_1h_ts))
                            if closest_1h.open_interest > 0 and closest_1h != latest_hist:
                                change_1h = round(((current_oi - closest_1h.open_interest) / closest_1h.open_interest) * 100, 2)
                            elif len(history_points) >= 4:
                                base_1h = history_points[-4].open_interest
                                if base_1h > 0:
                                    change_1h = round(((current_oi - base_1h) / base_1h) * 100, 2)
                                    
                            # 24h delta based on timestamp (~86400s ago) or earliest point
                            target_24h_ts = latest_hist.timestamp - 86400 * 1000
                            closest_24h = min(history_points, key=lambda p: abs(p.timestamp - target_24h_ts))
                            base_24h = closest_24h.open_interest if closest_24h.open_interest > 0 else history_points[0].open_interest
                            if base_24h > 0 and closest_24h != latest_hist:
                                change_24h = round(((current_oi - base_24h) / base_24h) * 100, 2)

                if current_oi_value <= 0:
                    current_oi_value = current_oi

                oi_result = OpenInterestData(
                    symbol=sym_upper,
                    open_interest=current_oi,
                    open_interest_value=current_oi_value,
                    change_pct_1h=change_1h,
                    change_pct_24h=change_24h,
                    timestamp=oi_time,
                    history=history_points
                )

                self._oi_cache[cache_key] = (now, oi_result)
                return oi_result
        except Exception as e:
            logger.warning(f"Failed to fetch Open Interest for {sym_upper}: {e}")
            return None

binance_service = BinanceService()
