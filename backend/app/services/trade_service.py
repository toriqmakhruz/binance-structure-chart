import os
import re
import json
import asyncio
import hmac
import hashlib
import time
import math
import logging
from pathlib import Path
from typing import Dict, Any, Optional, Tuple, List
from urllib.parse import urlencode
import httpx
from ..config import settings

logger = logging.getLogger("trade_service")

HEADERS_BASE = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36",
    "Accept": "application/json"
}

class TradeService:
    def __init__(self):
        # Base URLs for Demo (Testnet) and Live (Production)
        self.futures_live_url = "https://fapi.binance.com"
        self.futures_demo_url = "https://testnet.binancefuture.com"
        self.spot_live_url = "https://api.binance.com"
        self.spot_demo_url = "https://testnet.binance.vision"

        # Symbol rule cache: {f"{market}_{mode}_{symbol}": (expires_at, rules_dict)}
        self._symbol_rules_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}
        self._rules_ttl = 300.0  # 5 minutes

        # Persistent virtual paper trading balances and positions (fallback demo)
        self._storage_dir = Path("data")
        self._storage_path = self._storage_dir / "paper_trading.json"
        self._paper_wallet: Dict[str, float] = {
            "USDT": 10000.0
        }
        self._paper_positions: List[Dict[str, Any]] = []
        self._paper_history: List[Dict[str, Any]] = []
        self._load_paper_data()

        # Persistent server-side credentials and mode for cross-device sync (Desktop & Tablet)
        self._creds_path = self._storage_dir / "trade_credentials.json"
        self._server_credentials: Dict[str, Any] = {
            "demoApiKey": "",
            "demoApiSecret": "",
            "liveApiKey": "",
            "liveApiSecret": "",
            "mode": "demo",
            "useSimulatedDemo": True
        }
        self._load_credentials()

        # Rate-limiting protection caches & circuit breaker
        self._positions_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}
        self._positions_ttl = 3.0  # 3s cache for snappy OCO updates
        self._orders_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}
        self._orders_ttl = 3.0  # 3s cache for snappy OCO updates
        self._conn_test_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}
        self._conn_test_ttl = 15.0  # 15s cache
        self._history_cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}
        self._history_ttl = 15.0  # 15s cache
        self._rate_limit_ban_until: float = 0.0
        self._last_live_clean_time: float = 0.0
        self._last_known_positions: Dict[str, List[Dict[str, Any]]] = {}

        # 24/7 Background OCO and TP/SL Monitor Task
        self._monitor_task: Optional[asyncio.Task] = None
        self._monitor_running: bool = False

    def _handle_rate_limit(self, msg: str):
        ban_match = re.search(r"banned until (\d+)", str(msg))
        if ban_match:
            ban_ms = int(ban_match.group(1))
            self._rate_limit_ban_until = (ban_ms / 1000.0) + 2.0
        else:
            self._rate_limit_ban_until = time.time() + 60.0
        logger.warning(f"Binance rate limit cooldown active until {self._rate_limit_ban_until}: {msg}")

    def _load_paper_data(self) -> None:
        try:
            if self._storage_path.exists():
                with open(self._storage_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data.get("wallet"), dict):
                        self._paper_wallet = data["wallet"]
                    if isinstance(data.get("positions"), list):
                        self._paper_positions = data["positions"]
                    if isinstance(data.get("history"), list):
                        self._paper_history = data["history"]
        except Exception as exc:
            logger.warning(f"Failed loading paper trading data: {exc}")

    def _save_paper_data(self) -> None:
        try:
            self._storage_dir.mkdir(parents=True, exist_ok=True)
            with open(self._storage_path, "w", encoding="utf-8") as f:
                json.dump({
                    "wallet": self._paper_wallet,
                    "positions": self._paper_positions,
                    "history": self._paper_history
                }, f, indent=2)
        except Exception as exc:
            logger.warning(f"Failed saving paper trading data: {exc}")

    def _close_single_paper_position(
        self,
        p: Dict[str, Any],
        close_price: float,
        reason: str = "Market Close",
        timestamp_ms: Optional[int] = None
    ) -> float:
        """
        Helper to close a single paper position, calculate realized PnL,
        update wallet balance, and record trade history.
        """
        p["status"] = "CLOSED"
        margin = float(p.get("margin", 0))
        entry_p = float(p.get("price", 0))
        qty = float(p.get("quantity", 0))
        is_long = (p.get("side") == "BUY")

        diff = (close_price - entry_p) if is_long else (entry_p - close_price)
        gross_pnl = round(diff * qty, 2)
        # Realistic Binance Futures taker fee (0.05% of notional)
        fee = round(close_price * qty * 0.0005, 4)
        net_pnl = round(gross_pnl - fee, 2)
        roe = round((net_pnl / margin) * 100, 2) if margin > 0 else 0.0

        ts = timestamp_ms or int(time.time() * 1000)
        history_item = {
            "id": p.get("id") or f"paper_{int(time.time()*1000)}",
            "symbol": p.get("symbol"),
            "side": "LONG" if is_long else "SHORT",
            "entryPrice": entry_p,
            "closePrice": close_price,
            "quantity": qty,
            "margin": margin,
            "leverage": p.get("leverage", 1),
            "grossPnl": gross_pnl,
            "fee": fee,
            "commission": fee,
            "realizedPnl": net_pnl,
            "netPnl": net_pnl,
            "roePct": roe,
            "time": ts,
            "reason": reason,
            "is_simulated": True
        }
        self._paper_history.insert(0, history_item)
        self._paper_wallet["USDT"] = round(self._paper_wallet.get("USDT", 10000.0) + margin + net_pnl, 2)
        return net_pnl

    async def _check_paper_positions_tp_sl(self) -> int:
        """
        Check all active paper trading positions against live market prices.
        Automatically closes positions and executes Take Profit or Stop Loss
        when price triggers are hit, updating virtual wallet balance and history.
        Returns the number of positions closed.
        """
        active_pos = [p for p in self._paper_positions if p.get("status") == "FILLED"]
        if not active_pos:
            return 0

        # Fetch live prices for active symbols
        try:
            from .binance_service import BinanceService
            bs = BinanceService()
            tickers = await bs.get_live_ticker_batch(market="futures")
            price_map = {t["s"]: float(t["c"]) for t in tickers if "s" in t and "c" in t}
        except Exception as e:
            logger.debug(f"Failed fetching live prices for paper position TP/SL check: {e}")
            return 0

        closed_count = 0
        now_ms = int(time.time() * 1000)

        for p in list(active_pos):
            sym = p.get("symbol")
            cur_p = price_map.get(sym)
            if not cur_p or cur_p <= 0:
                continue

            entry_p = float(p.get("price", 0))
            is_long = (p.get("side") == "BUY")
            sl = float(p.get("stop_loss")) if p.get("stop_loss") else None
            tp = float(p.get("take_profit")) if p.get("take_profit") else None

            hit_tp = False
            hit_sl = False
            close_price = cur_p
            reason = "Market Close"

            if is_long:
                if tp is not None and cur_p >= tp:
                    hit_tp = True
                    close_price = tp
                    reason = "Take Profit Hit"
                elif sl is not None and cur_p <= sl:
                    hit_sl = True
                    close_price = sl
                    reason = "Stop Loss Hit"
            else:  # Short
                if tp is not None and cur_p <= tp:
                    hit_tp = True
                    close_price = tp
                    reason = "Take Profit Hit"
                elif sl is not None and cur_p >= sl:
                    hit_sl = True
                    close_price = sl
                    reason = "Stop Loss Hit"

            if hit_tp or hit_sl:
                self._close_single_paper_position(p, close_price=close_price, reason=reason, timestamp_ms=now_ms)
                closed_count += 1
                logger.info(f"[Paper Trading] Position {sym} auto-closed: {reason} at {close_price}")

        if closed_count > 0:
            self._save_paper_data()
            self._positions_cache.clear()
            self._orders_cache.clear()
            self._history_cache.clear()

        return closed_count

    def _load_credentials(self) -> None:
        try:
            if self._creds_path.exists():
                with open(self._creds_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, dict):
                        self._server_credentials.update(data)
                        logger.info("Loaded server-side trade credentials successfully.")
        except Exception as exc:
            logger.warning(f"Failed loading trade credentials: {exc}")

    def _save_credentials(self) -> None:
        try:
            self._storage_dir.mkdir(parents=True, exist_ok=True)
            with open(self._creds_path, "w", encoding="utf-8") as f:
                json.dump(self._server_credentials, f, indent=2)
                logger.info("Saved server-side trade credentials successfully.")
        except Exception as exc:
            logger.warning(f"Failed saving trade credentials: {exc}")

    def get_stored_credentials(self) -> Dict[str, Any]:
        return dict(self._server_credentials)

    def save_stored_credentials(self, creds: Dict[str, Any]) -> Dict[str, Any]:
        for k in ["demoApiKey", "demoApiSecret", "liveApiKey", "liveApiSecret", "mode", "useSimulatedDemo"]:
            if k in creds and creds[k] is not None:
                self._server_credentials[k] = creds[k]
        self._save_credentials()
        return {"success": True, "credentials": self.get_stored_credentials()}

    def _resolve_credentials(self, mode: str, api_key: Optional[str], api_secret: Optional[str]) -> Tuple[str, str, str]:
        mode_clean = (mode or "").lower().strip()
        server_mode = self._server_credentials.get("mode", "demo")
        if not mode_clean:
            mode_clean = server_mode

        key_clean = (api_key or "").strip()
        secret_clean = (api_secret or "").strip()

        # If keys not provided in request, fallback to server credentials
        if not key_clean or not secret_clean:
            if mode_clean == "live":
                key_clean = self._server_credentials.get("liveApiKey", "").strip()
                secret_clean = self._server_credentials.get("liveApiSecret", "").strip()
            elif not self._server_credentials.get("useSimulatedDemo", True):
                key_clean = self._server_credentials.get("demoApiKey", "").strip()
                secret_clean = self._server_credentials.get("demoApiSecret", "").strip()

        return mode_clean, key_clean, secret_clean

    def _is_simulated_demo(self, mode: str, api_key: str, api_secret: str) -> bool:
        mode_clean = (mode or "").lower().strip()
        if mode_clean != "demo":
            return False
        use_sim = self._server_credentials.get("useSimulatedDemo", True)
        return bool(use_sim or not api_key or not api_secret)

    def _get_base_url(self, market: str, mode: str) -> str:
        market_clean = market.lower().strip()
        mode_clean = mode.lower().strip()

        if market_clean == "futures":
            return self.futures_demo_url if mode_clean == "demo" else self.futures_live_url
        elif market_clean == "spot":
            return self.spot_demo_url if mode_clean == "demo" else self.spot_live_url
        else:
            raise ValueError(f"Invalid market: {market}. Must be 'spot' or 'futures'.")

    def _sign_payload(self, params: Dict[str, Any], secret_key: str) -> str:
        """
        Sign query parameters with HMAC-SHA256 according to Binance API specification.
        Adds timestamp in milliseconds and recvWindow.
        """
        params_with_time = dict(params)
        params_with_time["timestamp"] = int(time.time() * 1000)
        params_with_time.setdefault("recvWindow", 5000)

        query_string = urlencode(params_with_time)
        signature = hmac.new(
            secret_key.encode("utf-8"),
            query_string.encode("utf-8"),
            hashlib.sha256
        ).hexdigest()

        return f"{query_string}&signature={signature}"

    async def test_connection(
        self,
        market: str = "futures",
        mode: str = "demo",
        api_key: str = "",
        api_secret: str = ""
    ) -> Dict[str, Any]:
        """
        Test if the provided API key & secret are valid and can reach Binance account endpoint.
        """
        mode, api_key, api_secret = self._resolve_credentials(mode, api_key, api_secret)
        api_key = (api_key or "").strip()
        api_secret = (api_secret or "").strip()

        if self._is_simulated_demo(mode, api_key, api_secret):
            return {
                "success": True,
                "mode": "demo",
                "market": market,
                "is_simulated": True,
                "message": "Mode Paper Trading (Virtual) siap digunakan tanpa API Key!"
            }

        if not api_key or not api_secret:
            if mode == "demo":
                return {
                    "success": True,
                    "mode": "demo",
                    "market": market,
                    "is_simulated": True,
                    "message": "Mode Paper Trading (Virtual) siap digunakan tanpa API Key!"
                }
            return {
                "success": False,
                "mode": mode,
                "market": market,
                "message": "API Key dan Secret Key tidak boleh kosong untuk Live Account."
            }

        now = time.time()
        conn_key = f"{market.lower()}_{mode.lower()}_{api_key[-8:] if api_key else 'anon'}"
        if conn_key in self._conn_test_cache:
            exp, val = self._conn_test_cache[conn_key]
            if now < exp:
                return val

        if now < self._rate_limit_ban_until:
            wait_sec = int(self._rate_limit_ban_until - now)
            return {
                "success": False,
                "mode": mode,
                "market": market,
                "message": f"Binance rate limit cooldown aktif. Menunggu pendinginan {wait_sec} detik sebelum tes ulang."
            }

        base_url = self._get_base_url(market, mode)
        path = "/fapi/v2/account" if market.lower() == "futures" else "/api/v3/account"
        signed_query = self._sign_payload({}, api_secret)
        url = f"{base_url}{path}?{signed_query}"
        headers = {**HEADERS_BASE, "X-MBX-APIKEY": api_key}

        timeout = httpx.Timeout(10.0, connect=5.0)
        async with httpx.AsyncClient(headers=headers, timeout=timeout) as client:
            try:
                resp = await client.get(url)
                if resp.status_code == 200:
                    data = resp.json()
                    can_trade = data.get("canTrade", True)
                    ret = {
                        "success": True,
                        "mode": mode,
                        "market": market,
                        "is_simulated": False,
                        "canTrade": can_trade,
                        "message": "Koneksi Binance API berhasil terverifikasi!"
                    }
                    self._conn_test_cache[conn_key] = (time.time() + self._conn_test_ttl, ret)
                    return ret
                else:
                    err_json = {}
                    try:
                        err_json = resp.json()
                    except Exception:
                        pass
                    msg = err_json.get("msg") or f"HTTP {resp.status_code}: {resp.text[:120]}"
                    return {
                        "success": False,
                        "mode": mode,
                        "market": market,
                        "code": err_json.get("code"),
                        "message": f"Koneksi gagal: {msg}"
                    }
            except Exception as exc:
                return {
                    "success": False,
                    "mode": mode,
                    "market": market,
                    "message": f"Gagal menghubungi server Binance ({mode.upper()}): {str(exc)}"
                }

    async def get_balance(
        self,
        market: str = "futures",
        mode: str = "demo",
        api_key: str = "",
        api_secret: str = ""
    ) -> Dict[str, Any]:
        """
        Fetch available USDT balance, wallet balance, and unrealized PnL from Binance.
        Falls back to in-memory virtual paper wallet if demo mode without keys.
        """
        mode, api_key, api_secret = self._resolve_credentials(mode, api_key, api_secret)
        api_key = (api_key or "").strip()
        api_secret = (api_secret or "").strip()

        # Simulated Paper Trading fallback for Demo
        if self._is_simulated_demo(mode, api_key, api_secret):
            return {
                "success": True,
                "mode": "demo",
                "market": market,
                "is_simulated": True,
                "asset": "USDT",
                "availableBalance": round(self._paper_wallet.get("USDT", 10000.0), 2),
                "walletBalance": round(self._paper_wallet.get("USDT", 10000.0), 2),
                "unrealizedPnl": 0.0,
                "message": "Saldo Paper Trading Virtual"
            }

        if not api_key or not api_secret:
            return {
                "success": False,
                "mode": mode,
                "market": market,
                "message": "API Key dan Secret Key diperlukan untuk mengambil saldo riil."
            }

        base_url = self._get_base_url(market, mode)
        headers = {**HEADERS_BASE, "X-MBX-APIKEY": api_key}
        timeout = httpx.Timeout(10.0, connect=5.0)

        async with httpx.AsyncClient(headers=headers, timeout=timeout) as client:
            try:
                if market.lower() == "futures":
                    # /fapi/v2/balance
                    signed_query = self._sign_payload({}, api_secret)
                    url = f"{base_url}/fapi/v2/balance?{signed_query}"
                    resp = await client.get(url)

                    if resp.status_code == 200:
                        balances = resp.json()
                        usdt_item = next((b for b in balances if b.get("asset") == "USDT"), None)
                        if usdt_item:
                            avail = float(usdt_item.get("availableBalance", usdt_item.get("withdrawAvailable", 0)))
                            wallet = float(usdt_item.get("balance", 0))
                            unpnl = float(usdt_item.get("crossUnPnl", 0))
                            return {
                                "success": True,
                                "mode": mode,
                                "market": market,
                                "is_simulated": False,
                                "asset": "USDT",
                                "availableBalance": round(avail, 2),
                                "walletBalance": round(wallet, 2),
                                "unrealizedPnl": round(unpnl, 2),
                                "message": "Saldo Binance Futures live"
                            }
                        return {
                            "success": True,
                            "mode": mode,
                            "market": market,
                            "is_simulated": False,
                            "asset": "USDT",
                            "availableBalance": 0.0,
                            "walletBalance": 0.0,
                            "unrealizedPnl": 0.0,
                            "message": "Aset USDT tidak ditemukan di akun Futures"
                        }
                    else:
                        err_json = resp.json() if resp.text else {}
                        return {
                            "success": False,
                            "mode": mode,
                            "market": market,
                            "message": err_json.get("msg") or f"HTTP {resp.status_code}"
                        }
                else:
                    # /api/v3/account for Spot
                    signed_query = self._sign_payload({}, api_secret)
                    url = f"{base_url}/api/v3/account?{signed_query}"
                    resp = await client.get(url)

                    if resp.status_code == 200:
                        account_data = resp.json()
                        balances = account_data.get("balances", [])
                        usdt_item = next((b for b in balances if b.get("asset") == "USDT"), None)
                        if usdt_item:
                            free = float(usdt_item.get("free", 0))
                            locked = float(usdt_item.get("locked", 0))
                            return {
                                "success": True,
                                "mode": mode,
                                "market": market,
                                "is_simulated": False,
                                "asset": "USDT",
                                "availableBalance": round(free, 2),
                                "walletBalance": round(free + locked, 2),
                                "unrealizedPnl": 0.0,
                                "message": "Saldo Binance Spot live"
                            }
                        return {
                            "success": True,
                            "mode": mode,
                            "market": market,
                            "is_simulated": False,
                            "asset": "USDT",
                            "availableBalance": 0.0,
                            "walletBalance": 0.0,
                            "unrealizedPnl": 0.0
                        }
                    else:
                        err_json = resp.json() if resp.text else {}
                        return {
                            "success": False,
                            "mode": mode,
                            "market": market,
                            "message": err_json.get("msg") or f"HTTP {resp.status_code}"
                        }
            except Exception as exc:
                return {
                    "success": False,
                    "mode": mode,
                    "market": market,
                    "message": f"Gagal mengambil saldo: {str(exc)}"
                }

    async def get_symbol_rules(
        self,
        symbol: str,
        market: str = "futures",
        mode: str = "demo"
    ) -> Dict[str, Any]:
        """
        Fetch stepSize, tickSize, minQty, and minNotional filters for accurate order sizing.
        """
        sym_clean = symbol.upper().strip()
        cache_key = f"{market}_{mode}_{sym_clean}"
        now = time.time()
        cached = self._symbol_rules_cache.get(cache_key)
        if cached and now < cached[0]:
            return cached[1]

        base_url = self._get_base_url(market, mode)
        path = "/fapi/v1/exchangeInfo" if market.lower() == "futures" else "/api/v3/exchangeInfo"
        url = f"{base_url}{path}"

        defaults = {
            "symbol": sym_clean,
            "tickSize": 0.01,
            "stepSize": 0.001,
            "minQty": 0.001,
            "minNotional": 5.0,
            "pricePrecision": 2,
            "quantityPrecision": 3
        }

        timeout = httpx.Timeout(10.0, connect=5.0)
        async with httpx.AsyncClient(headers=HEADERS_BASE, timeout=timeout) as client:
            try:
                resp = await client.get(url, params={"symbol": sym_clean})
                if resp.status_code == 200:
                    data = resp.json()
                    symbols = data.get("symbols", [])
                    sym_info = next((s for s in symbols if s.get("symbol") == sym_clean), None)
                    if sym_info:
                        filters = {f.get("filterType"): f for f in sym_info.get("filters", [])}

                        # Price Filter
                        pf = filters.get("PRICE_FILTER", {})
                        tick_size = float(pf.get("tickSize", 0.01))
                        price_precision = sym_info.get("pricePrecision", max(0, -int(math.log10(tick_size)))) if tick_size > 0 else 2

                        # Lot Size Filter
                        lf = filters.get("LOT_SIZE", {})
                        step_size = float(lf.get("stepSize", 0.001))
                        min_qty = float(lf.get("minQty", step_size))
                        qty_precision = sym_info.get("quantityPrecision", max(0, -int(math.log10(step_size)))) if step_size > 0 else 3

                        # Min Notional
                        nf = filters.get("MIN_NOTIONAL") or filters.get("NOTIONAL") or {}
                        min_notional = float(nf.get("notional") or nf.get("minNotional") or 5.0)

                        rules = {
                            "symbol": sym_clean,
                            "tickSize": tick_size,
                            "stepSize": step_size,
                            "minQty": min_qty,
                            "minNotional": min_notional,
                            "pricePrecision": int(price_precision),
                            "quantityPrecision": int(qty_precision)
                        }
                        self._symbol_rules_cache[cache_key] = (now + self._rules_ttl, rules)
                        return rules
            except Exception as exc:
                logger.warning(f"Failed fetching rules for {sym_clean}: {exc}")

        return defaults

    def format_quantity(self, qty: float, step_size: float, qty_precision: int) -> float:
        """Round down quantity strictly to symbol stepSize to avoid exceeding account balance."""
        if qty <= 0:
            return 0.0
        if step_size > 0:
            steps = math.floor(qty / step_size)
            rounded = steps * step_size
            return round(rounded, qty_precision)
        return round(qty, qty_precision)

    def format_price(self, price: float, tick_size: float, price_precision: int) -> float:
        """Round price strictly to tickSize."""
        if price <= 0:
            return 0.0
        if tick_size > 0:
            ticks = round(price / tick_size)
            rounded = ticks * tick_size
            return round(rounded, price_precision)
        return round(price, price_precision)

    async def _place_futures_brackets(
        self,
        client: httpx.AsyncClient,
        base_url: str,
        api_secret: str,
        symbol: str,
        side: str,  # "BUY" (Long) or "SELL" (Short)
        quantity: float,
        stop_loss: Optional[float],
        take_profit: Optional[float],
        tick_size: float,
        price_prec: int,
        qty_prec: int,
        step_size: float,
        is_market_order: bool = True,
        is_hedge: Optional[bool] = None,
        is_filled: bool = True  # False for LIMIT orders not yet filled
    ) -> Dict[str, Any]:
        """
        Rock-solid, guaranteed bracket order placement for Binance Futures:
        1. Auto-detects Hedge Mode (dualSidePosition) vs One-Way Mode.
        2. Validates stop prices against live Mark Price to prevent code -2021 (immediate trigger).
        3. Formats prices and lot sizes strictly to exchange tickSize & stepSize.
        4. Auto-cleans older pending bracket orders for this symbol.
        5. Attempts Strategy 1: closePosition="true" (native close-all for filled positions).
        6. Falls back to Strategy 2: quantity + reduceOnly="true" (for pending/limit/partial fills).
        7. Falls back to Strategy 3: CONTRACT_PRICE workingType if MARK_PRICE is rejected.
        """
        bracket_results: Dict[str, Any] = {}
        if not stop_loss and not take_profit:
            return bracket_results

        close_side = "SELL" if side.upper() == "BUY" else "BUY"

        # 1. Detect Position Mode (Hedge vs One-Way) if not provided
        if is_hedge is None:
            try:
                signed_dual = self._sign_payload({}, api_secret)
                dual_resp = await client.get(f"{base_url}/fapi/v1/positionSide/dual?{signed_dual}")
                if dual_resp.status_code == 200:
                    is_hedge = dual_resp.json().get("dualSidePosition", False)
            except Exception as e:
                logger.warning(f"Failed querying dualSidePosition: {e}")
                is_hedge = False

        # In Hedge mode, closing a BUY requires positionSide='LONG', closing SELL requires positionSide='SHORT'
        hedge_pos_side = "LONG" if side.upper() == "BUY" else "SHORT"

        # 2. Get current Mark Price to validate against -2021 (Order would immediately trigger)
        current_mark_price = 0.0
        try:
            p_resp = await client.get(f"{base_url}/fapi/v1/premiumIndex?symbol={symbol}")
            if p_resp.status_code == 200:
                current_mark_price = float(p_resp.json().get("markPrice", 0))
        except Exception as p_err:
            logger.warning(f"Failed fetching markPrice for bracket validation: {p_err}")

        # 3. Wait slightly if MARKET order so fill registers in exchange position ledger
        if is_market_order:
            await asyncio.sleep(1.2)  # 1.2s — give Binance matching engine time to register position

        formatted_qty = self.format_quantity(quantity, step_size, qty_prec)

        # Helper to cancel prior open brackets of the same type to avoid conflicts
        async def cancel_prior_brackets(order_type_str: str):
            # 1. Clean prior open algo orders (modern Binance Futures endpoint)
            try:
                signed_ao = self._sign_payload({"symbol": symbol}, api_secret)
                resp_ao = await client.get(f"{base_url}/fapi/v1/openAlgoOrders?{signed_ao}")
                if resp_ao.status_code == 200:
                    for ao in resp_ao.json():
                        ao_type = str(ao.get("algoType") or ao.get("type") or "")
                        is_match = (ao_type == order_type_str) or \
                                   (order_type_str.startswith("STOP") and "STOP" in ao_type) or \
                                   (order_type_str.startswith("TAKE_PROFIT") and "PROFIT" in ao_type)
                        if is_match:
                            aid = ao.get("algoId")
                            d_sign = self._sign_payload({"symbol": symbol, "algoId": aid}, api_secret)
                            await client.delete(f"{base_url}/fapi/v1/algoOrder?{d_sign}")
                            logger.info(f"Cleaned prior algo {order_type_str} order {aid} for {symbol}")
            except Exception as ao_err:
                logger.warning(f"Note: error cleaning prior algo {order_type_str}: {ao_err}")

            # 2. Clean prior standard open orders (legacy fallback)
            try:
                signed_o = self._sign_payload({"symbol": symbol}, api_secret)
                resp_o = await client.get(f"{base_url}/fapi/v1/openOrders?{signed_o}")
                if resp_o.status_code == 200:
                    for o in resp_o.json():
                        if o.get("type") == order_type_str:
                            oid = o.get("orderId")
                            d_sign = self._sign_payload({"symbol": symbol, "orderId": oid}, api_secret)
                            await client.delete(f"{base_url}/fapi/v1/order?{d_sign}")
                            logger.info(f"Cleaned prior standard {order_type_str} order {oid} for {symbol}")
            except Exception as c_err:
                logger.warning(f"Note: error cleaning prior standard {order_type_str}: {c_err}")

        # Helper to execute multi-strategy order placement
        async def place_single_bracket(order_type: str, raw_target_price: float, is_stop_loss: bool) -> Tuple[bool, Any]:
            target_p = float(raw_target_price)

            # Prevent -2021 error: triggerPrice cannot be past markPrice
            if current_mark_price > 0:
                if side.upper() == "BUY":  # Long position
                    if is_stop_loss and target_p >= current_mark_price:
                        target_p = current_mark_price * 0.998  # clamp 0.2% below mark
                    elif not is_stop_loss and target_p <= current_mark_price:
                        target_p = current_mark_price * 1.002  # clamp 0.2% above mark
                else:  # Short position
                    if is_stop_loss and target_p <= current_mark_price:
                        target_p = current_mark_price * 1.002  # clamp 0.2% above mark
                    elif not is_stop_loss and target_p >= current_mark_price:
                        target_p = current_mark_price * 0.998  # clamp 0.2% below mark

            formatted_price = self.format_price(target_p, tick_size, price_prec)

            # Cancel prior order of this type first
            await cancel_prior_brackets(order_type)

            # --- STRATEGY 1: Modern Binance USDS-M Algo Order API (/fapi/v1/algoOrder) ---
            # Required by Binance for conditional types (code -4120 on legacy /fapi/v1/order)

            # 1A. Try closePosition="true" if position is already filled
            resp_1a = None
            if is_filled:
                algo_params_1a: Dict[str, Any] = {
                    "symbol": symbol,
                    "side": close_side,
                    "type": order_type,
                    "algoType": "CONDITIONAL",
                    "triggerPrice": formatted_price,
                    "closePosition": "true",
                    "workingType": "MARK_PRICE"
                }
                if is_hedge:
                    algo_params_1a["positionSide"] = hedge_pos_side

                signed_1a = self._sign_payload(algo_params_1a, api_secret)
                resp_1a = await client.post(f"{base_url}/fapi/v1/algoOrder?{signed_1a}")
                if resp_1a.status_code == 200:
                    logger.info(f"{order_type} (algoOrder closePosition=true) SUCCESS: {resp_1a.text}")
                    return True, resp_1a.json()

                # Handle potential -4061 positionSide mismatch
                if "-4061" in resp_1a.text:
                    if is_hedge:
                        algo_params_1a.pop("positionSide", None)
                    else:
                        algo_params_1a["positionSide"] = hedge_pos_side
                    signed_retry_1a = self._sign_payload(algo_params_1a, api_secret)
                    resp_retry_1a = await client.post(f"{base_url}/fapi/v1/algoOrder?{signed_retry_1a}")
                    if resp_retry_1a.status_code == 200:
                        logger.info(f"{order_type} (algoOrder -4061 retry) SUCCESS: {resp_retry_1a.text}")
                        return True, resp_retry_1a.json()

                logger.warning(f"{order_type} algoOrder Strategy 1A ({resp_1a.status_code}: {resp_1a.text}), trying Strategy 1B...")

            # 1B. Try quantity + reduceOnly="true"
            algo_params_1b: Dict[str, Any] = {
                "symbol": symbol,
                "side": close_side,
                "type": order_type,
                "algoType": "CONDITIONAL",
                "triggerPrice": formatted_price,
                "quantity": formatted_qty,
                "reduceOnly": "true",
                "workingType": "MARK_PRICE"
            }
            if is_hedge:
                algo_params_1b["positionSide"] = hedge_pos_side

            signed_1b = self._sign_payload(algo_params_1b, api_secret)
            resp_1b = await client.post(f"{base_url}/fapi/v1/algoOrder?{signed_1b}")
            if resp_1b.status_code == 200:
                logger.info(f"{order_type} (algoOrder quantity) SUCCESS: {resp_1b.text}")
                return True, resp_1b.json()

            if "-4061" in resp_1b.text:
                if is_hedge:
                    algo_params_1b.pop("positionSide", None)
                else:
                    algo_params_1b["positionSide"] = hedge_pos_side
                signed_retry_1b = self._sign_payload(algo_params_1b, api_secret)
                resp_retry_1b = await client.post(f"{base_url}/fapi/v1/algoOrder?{signed_retry_1b}")
                if resp_retry_1b.status_code == 200:
                    logger.info(f"{order_type} (algoOrder quantity -4061 retry) SUCCESS: {resp_retry_1b.text}")
                    return True, resp_retry_1b.json()

            logger.warning(f"{order_type} algoOrder Strategy 1B ({resp_1b.status_code}: {resp_1b.text}), trying Strategy 1C (CONTRACT_PRICE)...")

            # 1C. Try CONTRACT_PRICE workingType
            algo_params_1c = dict(algo_params_1b)
            algo_params_1c["workingType"] = "CONTRACT_PRICE"
            signed_1c = self._sign_payload(algo_params_1c, api_secret)
            resp_1c = await client.post(f"{base_url}/fapi/v1/algoOrder?{signed_1c}")
            if resp_1c.status_code == 200:
                logger.info(f"{order_type} (algoOrder CONTRACT_PRICE) SUCCESS: {resp_1c.text}")
                return True, resp_1c.json()

            # --- STRATEGY 2: Legacy fallback to /fapi/v1/order ---
            logger.warning(f"{order_type} algoOrder failed, attempting legacy /fapi/v1/order fallback...")
            legacy_params: Dict[str, Any] = {
                "symbol": symbol,
                "side": close_side,
                "type": order_type,
                "stopPrice": formatted_price,
                "quantity": formatted_qty,
                "reduceOnly": "true",
                "workingType": "MARK_PRICE"
            }
            if is_hedge:
                legacy_params["positionSide"] = hedge_pos_side

            signed_leg = self._sign_payload(legacy_params, api_secret)
            resp_leg = await client.post(f"{base_url}/fapi/v1/order?{signed_leg}")
            if resp_leg.status_code == 200:
                logger.info(f"{order_type} (legacy fapi/v1/order) SUCCESS: {resp_leg.text}")
                return True, resp_leg.json()

            err_text = resp_1b.text or (resp_1a.text if resp_1a else "") or resp_leg.text
            logger.error(f"{order_type} ALL STRATEGIES FAILED: {err_text}")
            return False, err_text

        # 4. Place Stop Loss if provided
        if stop_loss and float(stop_loss) > 0:
            ok_sl, res_sl = await place_single_bracket("STOP_MARKET", float(stop_loss), is_stop_loss=True)
            if ok_sl:
                bracket_results["stop_loss"] = res_sl
            else:
                bracket_results["stop_loss_error"] = str(res_sl)

        # 5. Place Take Profit if provided
        if take_profit and float(take_profit) > 0:
            ok_tp, res_tp = await place_single_bracket("TAKE_PROFIT_MARKET", float(take_profit), is_stop_loss=False)
            if ok_tp:
                bracket_results["take_profit"] = res_tp
            else:
                bracket_results["take_profit_error"] = str(res_tp)

        return bracket_results

    async def execute_order(
        self,
        symbol: str,
        market: str = "futures",
        mode: str = "demo",
        api_key: str = "",
        api_secret: str = "",
        side: str = "BUY",
        order_type: str = "MARKET",
        quantity: float = 0.0,
        price: Optional[float] = None,
        leverage: int = 10,
        stop_loss: Optional[float] = None,
        take_profit: Optional[float] = None,
        reduce_only: bool = False
    ) -> Dict[str, Any]:
        """
        Execute an order on Binance (Demo Testnet or Live Production),
        including optional leverage adjustment and bracket SL/TP orders.
        """
        mode, api_key, api_secret = self._resolve_credentials(mode, api_key, api_secret)
        sym_clean = symbol.upper().strip()
        market_clean = market.lower().strip()
        mode_clean = mode.lower().strip()
        side_clean = side.upper().strip()
        order_type_clean = order_type.upper().strip()

        api_key = (api_key or "").strip()
        api_secret = (api_secret or "").strip()

        # 1. Fetch exact precision & lot size rules
        rules = await self.get_symbol_rules(sym_clean, market_clean, mode_clean)
        step_size = rules["stepSize"]
        tick_size = rules["tickSize"]
        qty_prec = rules["quantityPrecision"]
        price_prec = rules["pricePrecision"]
        min_notional = rules["minNotional"]

        final_qty = self.format_quantity(quantity, step_size, qty_prec)
        if final_qty <= 0 or final_qty < rules["minQty"]:
            return {
                "success": False,
                "message": f"Kuantitas order ({final_qty}) kurang dari batas minimum Binance ({rules['minQty']} {sym_clean})."
            }

        final_price = self.format_price(price, tick_size, price_prec) if (price and price > 0) else None

        # 2. Simulated Execution (Paper Trading fallback when demo has no keys)
        if self._is_simulated_demo(mode_clean, api_key, api_secret):
            order_id = int(time.time() * 1000)
            exec_price = final_price if (order_type_clean == "LIMIT" and final_price) else (price or 1.0)
            notional = final_qty * exec_price
            req_margin = notional / max(1, leverage) if market_clean == "futures" else notional

            # Deduct virtual margin
            current_usdt = self._paper_wallet.get("USDT", 10000.0)
            if req_margin > current_usdt:
                return {
                    "success": False,
                    "message": f"Saldo virtual tidak mencukupi (Perlu: ${req_margin:.2f}, Tersedia: ${current_usdt:.2f})"
                }

            self._paper_wallet["USDT"] = max(0.0, current_usdt - req_margin)

            paper_pos = {
                "id": str(order_id),
                "symbol": sym_clean,
                "side": side_clean,
                "type": order_type_clean,
                "quantity": final_qty,
                "price": exec_price,
                "leverage": leverage if market_clean == "futures" else 1,
                "margin": req_margin,
                "stop_loss": stop_loss,
                "take_profit": take_profit,
                "time": int(time.time()),
                "status": "FILLED"
            }
            self._paper_positions.append(paper_pos)
            self._save_paper_data()

            return {
                "success": True,
                "mode": "demo",
                "market": market_clean,
                "is_simulated": True,
                "order_id": order_id,
                "symbol": sym_clean,
                "side": side_clean,
                "type": order_type_clean,
                "executed_qty": final_qty,
                "avg_price": exec_price,
                "status": "FILLED",
                "leverage": leverage if market_clean == "futures" else 1,
                "stop_loss": stop_loss,
                "take_profit": take_profit,
                "bracket_orders": {
                    "stop_loss": stop_loss,
                    "take_profit": take_profit
                },
                "message": f"Order Paper Trading {side_clean} {final_qty} {sym_clean} berhasil dibuka (Simulasi)."
            }

        # 3. Real Binance API Execution (Demo Testnet or Live Production)
        if not api_key or not api_secret:
            return {
                "success": False,
                "message": f"API Key dan Secret Key diperlukan untuk membuka posisi di {mode_clean.upper()}."
            }

        base_url = self._get_base_url(market_clean, mode_clean)
        headers = {**HEADERS_BASE, "X-MBX-APIKEY": api_key}
        timeout = httpx.Timeout(15.0, connect=5.0)

        async with httpx.AsyncClient(headers=headers, timeout=timeout) as client:
            try:
                # A. Set Leverage on Futures
                if market_clean == "futures" and leverage >= 1:
                    try:
                        lev_payload = {"symbol": sym_clean, "leverage": int(leverage)}
                        signed_lev = self._sign_payload(lev_payload, api_secret)
                        lev_resp = await client.post(f"{base_url}/fapi/v1/leverage?{signed_lev}")
                        if lev_resp.status_code != 200:
                            logger.warning(f"Leverage set response: {lev_resp.text}")
                    except Exception as lev_err:
                        logger.warning(f"Failed setting leverage: {lev_err}")

                # Check position mode (Hedge vs One-Way)
                is_hedge = False
                if market_clean == "futures":
                    try:
                        signed_dual = self._sign_payload({}, api_secret)
                        dual_resp = await client.get(f"{base_url}/fapi/v1/positionSide/dual?{signed_dual}")
                        if dual_resp.status_code == 200:
                            is_hedge = dual_resp.json().get("dualSidePosition", False)
                    except Exception as dual_err:
                        logger.warning(f"Failed getting dualSidePosition: {dual_err}")

                # B. Place Primary Entry Order
                order_params: Dict[str, Any] = {
                    "symbol": sym_clean,
                    "side": side_clean,
                    "type": order_type_clean,
                    "quantity": final_qty
                }

                if market_clean == "futures" and is_hedge:
                    order_params["positionSide"] = "LONG" if side_clean == "BUY" else "SHORT"

                if order_type_clean == "LIMIT":
                    if not final_price or final_price <= 0:
                        return {"success": False, "message": "Harga Entry limit harus ditentukan untuk order LIMIT."}
                    order_params["price"] = final_price
                    order_params["timeInForce"] = "GTC"

                if reduce_only:
                    order_params["reduceOnly"] = "true"

                path = "/fapi/v1/order" if market_clean == "futures" else "/api/v3/order"
                signed_order = self._sign_payload(order_params, api_secret)
                order_url = f"{base_url}{path}?{signed_order}"

                resp = await client.post(order_url)
                if resp.status_code != 200:
                    err_payload = resp.json() if resp.text else {}
                    err_msg = err_payload.get("msg") or f"HTTP {resp.status_code}: {resp.text[:120]}"
                    return {
                        "success": False,
                        "code": err_payload.get("code"),
                        "message": f"Binance rejected order: {err_msg}"
                    }

                order_res = resp.json()
                main_order_id = order_res.get("orderId")
                avg_price = float(order_res.get("avgPrice") or order_res.get("price") or (final_price or 0))

                # Fix exec_qty bug: "0" string is truthy in Python, must check numeric value
                raw_exec_qty_str = order_res.get("executedQty", "0")
                raw_exec_qty = float(raw_exec_qty_str) if raw_exec_qty_str else 0.0
                exec_qty = raw_exec_qty if raw_exec_qty > 0 else final_qty

                status_res = order_res.get("status", "NEW")

                # C. Guaranteed Automatic Attached Bracket Orders (Stop Loss & Take Profit) for Futures
                bracket_results = {}
                if market_clean == "futures" and (stop_loss or take_profit):
                    # Determine if position is actually filled (FILLED) or still pending (NEW/LIMIT)
                    order_is_filled = status_res in ("FILLED", "PARTIALLY_FILLED")
                    logger.info(f"Bracket placement: status={status_res}, is_filled={order_is_filled}, exec_qty={exec_qty}, final_qty={final_qty}")
                    bracket_results = await self._place_futures_brackets(
                        client=client,
                        base_url=base_url,
                        api_secret=api_secret,
                        symbol=sym_clean,
                        side=side_clean,
                        quantity=exec_qty if exec_qty > 0 else final_qty,
                        stop_loss=stop_loss,
                        take_profit=take_profit,
                        tick_size=tick_size,
                        price_prec=price_prec,
                        qty_prec=qty_prec,
                        step_size=step_size,
                        is_market_order=(order_type_clean == "MARKET"),
                        is_hedge=is_hedge,
                        is_filled=order_is_filled
                    )

                status_msg = f"Order {side_clean} {exec_qty} {sym_clean} ({status_res}) berhasil dibuka di Binance {mode_clean.upper()}!"
                if bracket_results.get("stop_loss"):
                    status_msg += " ✓ Stop Loss aktif"
                elif bracket_results.get("stop_loss_error"):
                    status_msg += f" [SL gagal: {bracket_results['stop_loss_error']}]"

                if bracket_results.get("take_profit"):
                    status_msg += " ✓ Take Profit aktif"
                elif bracket_results.get("take_profit_error"):
                    status_msg += f" [TP gagal: {bracket_results['take_profit_error']}]"

                return {
                    "success": True,
                    "mode": mode_clean,
                    "market": market_clean,
                    "is_simulated": False,
                    "order_id": main_order_id,
                    "client_order_id": order_res.get("clientOrderId"),
                    "symbol": sym_clean,
                    "side": side_clean,
                    "type": order_type_clean,
                    "executed_qty": exec_qty,
                    "avg_price": avg_price,
                    "status": status_res,
                    "leverage": leverage if market_clean == "futures" else 1,
                    "stop_loss": stop_loss,
                    "take_profit": take_profit,
                    "bracket_orders": bracket_results,
                    "raw": order_res,
                    "message": status_msg
                }

            except Exception as exc:
                return {
                    "success": False,
                    "message": f"Gagal mengeksekusi order di Binance: {str(exc)}"
                }

    async def get_positions(
        self,
        market: str = "futures",
        mode: str = "demo",
        api_key: str = "",
        api_secret: str = "",
        symbol: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Fetch active open positions.
        - Simulated paper trading: returns in-memory positions with live mark price & unrealized PnL.
        - Binance Testnet / Live: queries /fapi/v2/positionRisk.
        """
        mode, api_key, api_secret = self._resolve_credentials(mode, api_key, api_secret)
        sym_clean = symbol.upper().strip() if symbol else None
        market_clean = market.lower().strip()
        mode_clean = mode.lower().strip()

        api_key = (api_key or "").strip()
        api_secret = (api_secret or "").strip()

        # Simulated Paper Trading
        if self._is_simulated_demo(mode_clean, api_key, api_secret):
            # 1. Trigger automated TP/SL check before returning positions
            await self._check_paper_positions_tp_sl()

            open_pos = [p for p in self._paper_positions if p.get("status") == "FILLED"]
            if sym_clean:
                open_pos = [p for p in open_pos if p.get("symbol") == sym_clean]

            # Try to enrich with live price ONLY if there are active positions
            price_map = {}
            if open_pos:
                try:
                    from .binance_service import BinanceService
                    bs = BinanceService()
                    tickers = await bs.get_live_ticker_batch(market=market_clean)
                    price_map = {t["s"]: t["c"] for t in tickers}
                except Exception:
                    pass

            formatted_positions = []
            total_unpnl = 0.0

            for p in open_pos:
                pos_sym = p.get("symbol", "")
                entry_p = float(p.get("price", 0))
                mark_p = price_map.get(pos_sym, entry_p)
                qty = float(p.get("quantity", 0))
                is_long = p.get("side") == "BUY"
                margin = float(p.get("margin", 0))

                price_diff = (mark_p - entry_p) if is_long else (entry_p - mark_p)
                unrealized_pnl = round(price_diff * qty, 2)
                roe_pct = round((unrealized_pnl / margin) * 100, 2) if margin > 0 else 0.0
                total_unpnl += unrealized_pnl

                formatted_positions.append({
                    "id": p.get("id"),
                    "symbol": pos_sym,
                    "side": "LONG" if is_long else "SHORT",
                    "positionAmt": qty if is_long else -qty,
                    "entryPrice": entry_p,
                    "markPrice": mark_p,
                    "unrealizedProfit": unrealized_pnl,
                    "roePct": roe_pct,
                    "margin": round(margin, 2),
                    "leverage": p.get("leverage", 1),
                    "stopLoss": p.get("stop_loss"),
                    "takeProfit": p.get("take_profit"),
                    "time": p.get("time", int(time.time())),
                    "is_simulated": True
                })

            return {
                "success": True,
                "mode": "demo",
                "market": market_clean,
                "is_simulated": True,
                "total_unrealized_pnl": round(total_unpnl, 2),
                "positions": formatted_positions
            }

        if not api_key or not api_secret:
            return {
                "success": False,
                "message": "API Key dan Secret Key diperlukan untuk melihat posisi Live."
            }

        now = time.time()
        cache_key = f"{market_clean}_{mode_clean}_{api_key[-8:] if api_key else 'anon'}_{sym_clean or 'all'}"
        if cache_key in self._positions_cache:
            exp, val = self._positions_cache[cache_key]
            if now < exp:
                return val

        if now < self._rate_limit_ban_until:
            wait_sec = int(self._rate_limit_ban_until - now)
            cached_pos = self._last_known_positions.get(cache_key, [])
            return {
                "success": True,
                "mode": mode_clean,
                "market": market_clean,
                "is_simulated": False,
                "total_unrealized_pnl": 0.0,
                "positions": cached_pos,
                "warning": f"Cooldown rate limit Binance aktif ({wait_sec}s tersisa)"
            }

        base_url = self._get_base_url(market_clean, mode_clean)
        headers = {**HEADERS_BASE, "X-MBX-APIKEY": api_key}
        timeout = httpx.Timeout(12.0, connect=5.0)

        async with httpx.AsyncClient(headers=headers, timeout=timeout) as client:
            try:
                if market_clean == "futures":
                    query_params = {}
                    if sym_clean:
                        query_params["symbol"] = sym_clean
                    signed_query = self._sign_payload(query_params, api_secret)
                    url = f"{base_url}/fapi/v2/positionRisk?{signed_query}"

                    resp = await client.get(url)
                    if resp.status_code == 200:
                        raw_positions = resp.json()
                        formatted_positions = []
                        total_unpnl = 0.0

                        active_raw = [p for p in raw_positions if float(p.get("positionAmt", 0)) != 0]

                        # Correlate active open trigger orders (STOP_MARKET / TAKE_PROFIT_MARKET)
                        bracket_map: Dict[str, Dict[str, Optional[float]]] = {}
                        if active_raw:
                            # 1. Check modern Binance USDS-M openAlgoOrders
                            try:
                                algo_query = self._sign_payload({"symbol": sym_clean} if sym_clean else {}, api_secret)
                                algo_resp = await client.get(f"{base_url}/fapi/v1/openAlgoOrders?{algo_query}")
                                if algo_resp.status_code == 200:
                                    for ao in algo_resp.json():
                                        aosym = ao.get("symbol")
                                        aotype = str(ao.get("algoType") or ao.get("type") or "")
                                        trig_p = float(ao.get("triggerPrice") or ao.get("stopPrice") or ao.get("price") or 0)
                                        if aosym not in bracket_map:
                                            bracket_map[aosym] = {"stopLoss": None, "takeProfit": None}
                                        if "STOP" in aotype:
                                            bracket_map[aosym]["stopLoss"] = trig_p
                                        elif "PROFIT" in aotype:
                                            bracket_map[aosym]["takeProfit"] = trig_p
                            except Exception as a_err:
                                logger.warning(f"Failed correlating open algo orders for positions: {a_err}")

                            # 2. Check legacy openOrders (fallback)
                            try:
                                ord_query = self._sign_payload({"symbol": sym_clean} if sym_clean else {}, api_secret)
                                ord_resp = await client.get(f"{base_url}/fapi/v1/openOrders?{ord_query}")
                                if ord_resp.status_code == 200:
                                    for o in ord_resp.json():
                                        osym = o.get("symbol")
                                        otype = str(o.get("type") or "")
                                        trigger_price = float(o.get("stopPrice") or o.get("price") or 0)
                                        if osym not in bracket_map:
                                            bracket_map[osym] = {"stopLoss": None, "takeProfit": None}
                                        if "STOP" in otype and not bracket_map[osym].get("stopLoss"):
                                            bracket_map[osym]["stopLoss"] = trigger_price
                                        elif "PROFIT" in otype and not bracket_map[osym].get("takeProfit"):
                                            bracket_map[osym]["takeProfit"] = trigger_price
                            except Exception as ord_err:
                                logger.warning(f"Failed correlating legacy open orders for positions: {ord_err}")

                        for p in active_raw:
                            amt = float(p.get("positionAmt", 0))
                            entry_p = float(p.get("entryPrice", 0))
                            mark_p = float(p.get("markPrice", 0))
                            unpnl = float(p.get("unRealizedProfit", 0))
                            notional = abs(float(p.get("notional", 0)))
                            lev = int(p.get("leverage", 1))
                            isolated_margin = float(p.get("isolatedMargin", 0))
                            margin = isolated_margin if isolated_margin > 0 else (notional / lev if lev > 0 else notional)
                            roe_pct = round((unpnl / margin) * 100, 2) if margin > 0 else 0.0
                            total_unpnl += unpnl

                            pos_sym = p.get("symbol")
                            bm = bracket_map.get(pos_sym, {})

                            formatted_positions.append({
                                "symbol": pos_sym,
                                "side": "LONG" if amt > 0 else "SHORT",
                                "positionAmt": amt,
                                "entryPrice": entry_p,
                                "markPrice": mark_p,
                                "unrealizedProfit": round(unpnl, 2),
                                "roePct": roe_pct,
                                "liquidationPrice": float(p.get("liquidationPrice", 0)),
                                "leverage": lev,
                                "marginType": p.get("marginType", "cross"),
                                "margin": round(margin, 2),
                                "notional": round(notional, 2),
                                "stopLoss": bm.get("stopLoss"),
                                "takeProfit": bm.get("takeProfit"),
                                "is_simulated": False
                            })

                        ret = {
                            "success": True,
                            "mode": mode_clean,
                            "market": market_clean,
                            "is_simulated": False,
                            "total_unrealized_pnl": round(total_unpnl, 2),
                            "positions": formatted_positions
                        }

                        # Auto-OCO check: detect if any symbol's position just closed and cancel hanging brackets
                        prev_positions = self._last_known_positions.get(cache_key, [])
                        prev_active_symbols = {p.get("symbol") for p in prev_positions if float(p.get("positionAmt", 0)) != 0}
                        current_active_symbols = {p.get("symbol") for p in formatted_positions if float(p.get("positionAmt", 0)) != 0}
                        closed_symbols = prev_active_symbols - current_active_symbols

                        for closed_sym in closed_symbols:
                            logger.info(f"[Auto-OCO] Position {closed_sym} closed. Auto-cancelling remaining hanging bracket orders...")
                            asyncio.create_task(
                                self.cancel_all_symbol_open_orders(
                                    symbol=closed_sym,
                                    market=market_clean,
                                    mode=mode_clean,
                                    api_key=api_key,
                                    api_secret=api_secret
                                )
                            )

                        self._positions_cache[cache_key] = (time.time() + self._positions_ttl, ret)
                        self._last_known_positions[cache_key] = formatted_positions
                        return ret
                    else:
                        err_payload = resp.json() if resp.text else {}
                        msg = err_payload.get("msg") or f"HTTP {resp.status_code}"
                        if resp.status_code in (418, 429):
                            self._handle_rate_limit(msg)
                        return {
                            "success": False,
                            "message": msg
                        }
                else:
                    return {
                        "success": True,
                        "mode": mode_clean,
                        "market": "spot",
                        "positions": [],
                        "total_unrealized_pnl": 0.0,
                        "message": "Spot tidak memiliki posisi margin/leverage terbuka."
                    }
            except Exception as exc:
                return {"success": False, "message": f"Gagal mengambil posisi: {str(exc)}"}

    async def get_open_orders(
        self,
        market: str = "futures",
        mode: str = "demo",
        api_key: str = "",
        api_secret: str = "",
        symbol: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Fetch active open orders (Limits, Stop Loss, Take Profit bracket orders).
        """
        mode, api_key, api_secret = self._resolve_credentials(mode, api_key, api_secret)
        sym_clean = symbol.upper().strip() if symbol else None
        market_clean = market.lower().strip()
        mode_clean = mode.lower().strip()

        api_key = (api_key or "").strip()
        api_secret = (api_secret or "").strip()

        # Simulated Paper Orders
        if self._is_simulated_demo(mode_clean, api_key, api_secret):
            paper_orders = []
            for p in self._paper_positions:
                if p.get("status") == "FILLED":
                    pos_sym = p.get("symbol")
                    if sym_clean and pos_sym != sym_clean:
                        continue
                    sl = p.get("stop_loss")
                    tp = p.get("take_profit")
                    if sl:
                        paper_orders.append({
                            "orderId": int(f"{p['id']}1"),
                            "symbol": pos_sym,
                            "status": "NEW",
                            "type": "STOP_MARKET",
                            "side": "SELL" if p.get("side") == "BUY" else "BUY",
                            "price": 0.0,
                            "stopPrice": float(sl),
                            "origQty": float(p.get("quantity", 0)),
                            "time": p.get("time", int(time.time())),
                            "is_simulated": True
                        })
                    if tp:
                        paper_orders.append({
                            "orderId": int(f"{p['id']}2"),
                            "symbol": pos_sym,
                            "status": "NEW",
                            "type": "TAKE_PROFIT_MARKET",
                            "side": "SELL" if p.get("side") == "BUY" else "BUY",
                            "price": 0.0,
                            "stopPrice": float(tp),
                            "origQty": float(p.get("quantity", 0)),
                            "time": p.get("time", int(time.time())),
                            "is_simulated": True
                        })

            return {
                "success": True,
                "mode": "demo",
                "market": market_clean,
                "is_simulated": True,
                "orders": paper_orders
            }

        if not api_key or not api_secret:
            return {"success": False, "message": "API Key dan Secret Key diperlukan."}

        now = time.time()
        if now < self._rate_limit_ban_until:
            wait_sec = int(self._rate_limit_ban_until - now)
            return {
                "success": True,
                "mode": mode_clean,
                "market": market_clean,
                "is_simulated": False,
                "orders": [],
                "warning": f"Cooldown rate limit Binance aktif ({wait_sec}s tersisa)"
            }

        base_url = self._get_base_url(market_clean, mode_clean)
        headers = {**HEADERS_BASE, "X-MBX-APIKEY": api_key}
        timeout = httpx.Timeout(12.0, connect=5.0)

        async with httpx.AsyncClient(headers=headers, timeout=timeout) as client:
            try:
                query_params = {}
                if sym_clean:
                    query_params["symbol"] = sym_clean

                path = "/fapi/v1/openOrders" if market_clean == "futures" else "/api/v3/openOrders"
                signed_query = self._sign_payload(query_params, api_secret)
                url = f"{base_url}{path}?{signed_query}"

                resp = await client.get(url)
                formatted_orders = []
                if resp.status_code == 200:
                    raw_orders = resp.json()
                    for o in raw_orders:
                        raw_t = o.get("time", 0)
                        formatted_orders.append({
                            "orderId": o.get("orderId"),
                            "symbol": o.get("symbol"),
                            "status": o.get("status"),
                            "clientOrderId": o.get("clientOrderId"),
                            "type": o.get("type"),
                            "side": o.get("side"),
                            "price": float(o.get("price", 0)),
                            "stopPrice": float(o.get("stopPrice", 0)),
                            "origQty": float(o.get("origQty", 0)),
                            "executedQty": float(o.get("executedQty", 0)),
                            "time": int(raw_t // 1000) if raw_t > 10000000000 else int(raw_t),
                            "is_simulated": False
                        })

                # Also fetch modern algo orders (STOP / TAKE_PROFIT) on Futures
                if market_clean == "futures":
                    try:
                        signed_algo_q = self._sign_payload(query_params, api_secret)
                        resp_algo = await client.get(f"{base_url}/fapi/v1/openAlgoOrders?{signed_algo_q}")
                        if resp_algo.status_code == 200:
                            for ao in resp_algo.json():
                                raw_at = ao.get("time", 0)
                                formatted_orders.append({
                                    "orderId": ao.get("algoId"),
                                    "symbol": ao.get("symbol"),
                                    "status": "NEW",
                                    "clientOrderId": ao.get("clientAlgoId"),
                                    "type": ao.get("algoType") or ao.get("type"),
                                    "side": ao.get("side"),
                                    "price": float(ao.get("price", 0)),
                                    "stopPrice": float(ao.get("triggerPrice") or ao.get("stopPrice", 0)),
                                    "origQty": float(ao.get("quantity", 0)),
                                    "executedQty": 0.0,
                                    "time": int(raw_at // 1000) if raw_at > 10000000000 else int(raw_at),
                                    "is_simulated": False,
                                    "is_algo": True
                                })
                    except Exception as a_err:
                        logger.warning(f"Error fetching openAlgoOrders in get_open_orders: {a_err}")

                # In get_open_orders: simply return all open orders cleanly without side-effect deletions.
                # True orphan order cleanup is safely handled by auto_clean_orphaned_brackets.

                if resp.status_code == 200 or formatted_orders:
                    return {
                        "success": True,
                        "mode": mode_clean,
                        "market": market_clean,
                        "is_simulated": False,
                        "orders": formatted_orders
                    }
                else:
                    err_payload = resp.json() if resp.text else {}
                    return {"success": False, "message": err_payload.get("msg") or f"HTTP {resp.status_code}"}
            except Exception as exc:
                return {"success": False, "message": f"Gagal mengambil order: {str(exc)}"}

    async def cancel_all_symbol_open_orders(
        self,
        symbol: str,
        market: str = "futures",
        mode: str = "demo",
        api_key: str = "",
        api_secret: str = ""
    ) -> Dict[str, Any]:
        """
        Cancel all open orders and algo orders for a given symbol.
        Used when a position is closed (either manually or via TP/SL execution)
        to prevent orphaned bracket orders from hanging open.
        """
        mode, api_key, api_secret = self._resolve_credentials(mode, api_key, api_secret)
        sym_clean = symbol.upper().strip()
        market_clean = market.lower().strip()
        mode_clean = mode.lower().strip()

        if self._is_simulated_demo(mode_clean, api_key, api_secret):
            for p in self._paper_positions:
                if p.get("symbol") == sym_clean:
                    p["stop_loss"] = None
                    p["take_profit"] = None
            self._save_paper_data()
            self._orders_cache.clear()
            return {"success": True, "message": f"Semua order paper untuk {sym_clean} dibersihkan."}

        if not api_key or not api_secret:
            return {"success": False, "message": "API Key dan Secret Key diperlukan."}

        now = time.time()
        if now < self._rate_limit_ban_until:
            wait_sec = int(self._rate_limit_ban_until - now)
            return {
                "success": True,
                "mode": mode_clean,
                "market": market_clean,
                "is_simulated": False,
                "orders": [],
                "warning": f"Cooldown rate limit Binance aktif ({wait_sec}s tersisa)"
            }

        base_url = self._get_base_url(market_clean, mode_clean)
        headers = {**HEADERS_BASE, "X-MBX-APIKEY": api_key}
        timeout = httpx.Timeout(12.0, connect=5.0)

        async with httpx.AsyncClient(headers=headers, timeout=timeout) as client:
            cancelled_count = 0
            # 1. Cancel standard open orders
            try:
                signed_del = self._sign_payload({"symbol": sym_clean}, api_secret)
                path = "/fapi/v1/allOpenOrders" if market_clean == "futures" else "/api/v3/openOrders"
                resp = await client.delete(f"{base_url}{path}?{signed_del}")
                if resp.status_code == 200:
                    cancelled_count += 1
            except Exception as e:
                logger.warning(f"Error cancelling allOpenOrders for {sym_clean}: {e}")

            # 2. Cancel open algo orders on Futures (bulk endpoint)
            if market_clean == "futures":
                try:
                    signed_del_algo = self._sign_payload({"symbol": sym_clean}, api_secret)
                    resp_algo = await client.delete(f"{base_url}/fapi/v1/algoOpenOrders?{signed_del_algo}")
                    if resp_algo.status_code == 200:
                        cancelled_count += 1
                except Exception as e:
                    logger.debug(f"algoOpenOrders bulk delete note for {sym_clean}: {e}")

                # 3. Individual algo order cleanup fallback
                try:
                    signed_ao = self._sign_payload({"symbol": sym_clean}, api_secret)
                    resp_ao = await client.get(f"{base_url}/fapi/v1/openAlgoOrders?{signed_ao}")
                    if resp_ao.status_code == 200:
                        for ao in resp_ao.json():
                            aid = ao.get("algoId")
                            if aid:
                                d_sign = self._sign_payload({"symbol": sym_clean, "algoId": aid}, api_secret)
                                await client.delete(f"{base_url}/fapi/v1/algoOrder?{d_sign}")
                                cancelled_count += 1
                                logger.info(f"[Auto-OCO] Cleaned lingering individual algo order {aid} for {sym_clean}")
                except Exception as e:
                    logger.warning(f"Error cleaning individual algo orders for {sym_clean}: {e}")

            self._orders_cache.clear()
            return {"success": True, "cancelled_count": cancelled_count}

    async def auto_clean_orphaned_brackets(
        self,
        market: str = "futures",
        mode: str = "demo",
        api_key: str = "",
        api_secret: str = "",
        symbol: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Detect and cancel any orphaned conditional/bracket orders (SL/TP)
        on Binance where the corresponding position is already closed (positionAmt == 0).
        """
        mode, api_key, api_secret = self._resolve_credentials(mode, api_key, api_secret)
        market_clean = market.lower().strip()
        mode_clean = mode.lower().strip()

        if self._is_simulated_demo(mode_clean, api_key, api_secret):
            return {"success": True, "cancelled": 0}

        if not api_key or not api_secret or market_clean != "futures":
            return {"success": False, "message": "API credentials required for futures auto-clean."}

        if time.time() < self._rate_limit_ban_until:
            return {"success": True, "cancelled": 0, "rate_limited": True}

        base_url = self._get_base_url(market_clean, mode_clean)
        headers = {**HEADERS_BASE, "X-MBX-APIKEY": api_key}
        timeout = httpx.Timeout(12.0, connect=5.0)

        async with httpx.AsyncClient(headers=headers, timeout=timeout) as client:
            try:
                # 1. Fetch current positions to identify active symbols
                q_pos = {}
                if symbol:
                    q_pos["symbol"] = symbol.upper().strip()
                signed_pos = self._sign_payload(q_pos, api_secret)
                resp_pos = await client.get(f"{base_url}/fapi/v2/positionRisk?{signed_pos}")
                if resp_pos.status_code != 200:
                    return {"success": False, "message": "Failed querying positions."}

                raw_pos = resp_pos.json()
                active_symbols = set()
                active_position_sides = set()  # (symbol, positionSide)
                for p in raw_pos:
                    amt = float(p.get("positionAmt", 0))
                    sym = p.get("symbol")
                    pside = p.get("positionSide", "BOTH")
                    if amt != 0:
                        active_symbols.add(sym)
                        active_position_sides.add((sym, pside))

                # 2. Query open standard orders to identify pending entry orders (e.g. LIMIT orders)
                # CRITICAL: Pending LIMIT entry orders with pre-attached SL/TP brackets must NOT have
                # their brackets deleted while waiting to be filled!
                q_ord = {}
                if symbol:
                    q_ord["symbol"] = symbol.upper().strip()
                signed_ord = self._sign_payload(q_ord, api_secret)
                resp_ord = await client.get(f"{base_url}/fapi/v1/openOrders?{signed_ord}")
                pending_entry_symbols = set()
                pending_entry_sides = set()
                raw_standard_orders = resp_ord.json() if resp_ord.status_code == 200 else []

                for o in raw_standard_orders:
                    is_reduce = bool(o.get("reduceOnly", False))
                    is_close = bool(o.get("closePosition", False))
                    # Any order that is NOT reduceOnly and NOT closePosition is an entry order!
                    if not is_reduce and not is_close:
                        osym = o.get("symbol")
                        opside = o.get("positionSide", "BOTH")
                        pending_entry_symbols.add(osym)
                        pending_entry_sides.add((osym, opside))

                # Combined protected set: symbols with active open positions OR pending entry orders
                protected_symbols = active_symbols | pending_entry_symbols
                protected_sides = active_position_sides | pending_entry_sides

                cancelled = 0

                # 3. Query open algo orders
                q_algo = {}
                if symbol:
                    q_algo["symbol"] = symbol.upper().strip()
                signed_algo = self._sign_payload(q_algo, api_secret)
                resp_algo = await client.get(f"{base_url}/fapi/v1/openAlgoOrders?{signed_algo}")
                if resp_algo.status_code == 200:
                    for ao in resp_algo.json():
                        ao_sym = ao.get("symbol")
                        ao_id = ao.get("algoId")
                        ao_pside = ao.get("positionSide", "BOTH")
                        ao_type = str(ao.get("algoType") or ao.get("type") or "").upper()

                        is_orphaned = False
                        if ao_pside == "BOTH":
                            is_orphaned = (ao_sym not in protected_symbols)
                        else:
                            is_orphaned = ((ao_sym, ao_pside) not in protected_sides)

                        if is_orphaned and ao_id:
                            d_sign = self._sign_payload({"symbol": ao_sym, "algoId": ao_id}, api_secret)
                            del_resp = await client.delete(f"{base_url}/fapi/v1/algoOrder?{d_sign}")
                            if del_resp.status_code == 200:
                                cancelled += 1
                                logger.info(f"[Auto-OCO] Successfully cancelled orphaned algo order #{ao_id} ({ao_type}) for {ao_sym} (position & pending entry both closed).")

                # 4. Clean orphaned standard orders
                for o in raw_standard_orders:
                    o_sym = o.get("symbol")
                    o_id = o.get("orderId")
                    o_pside = o.get("positionSide", "BOTH")
                    o_type = str(o.get("type", "")).upper()
                    is_reduce = bool(o.get("reduceOnly", False))
                    is_close = bool(o.get("closePosition", False))
                    is_cond = any(t in o_type for t in ("STOP", "PROFIT", "TRAILING"))

                    if is_reduce or is_close or is_cond:
                        is_orphaned = False
                        if o_pside == "BOTH":
                            is_orphaned = (o_sym not in protected_symbols)
                        else:
                            is_orphaned = ((o_sym, o_pside) not in protected_sides)

                        if is_orphaned and o_id:
                            d_sign = self._sign_payload({"symbol": o_sym, "orderId": o_id}, api_secret)
                            del_resp = await client.delete(f"{base_url}/fapi/v1/order?{d_sign}")
                            if del_resp.status_code == 200:
                                cancelled += 1
                                logger.info(f"[Auto-OCO] Successfully cancelled orphaned standard order #{o_id} ({o_type}) for {o_sym} (position & pending entry both closed).")

                if cancelled > 0:
                    self._orders_cache.clear()

                return {"success": True, "cancelled": cancelled}
            except Exception as exc:
                logger.warning(f"auto_clean_orphaned_brackets error: {exc}")
                return {"success": False, "message": str(exc)}

    async def start_background_monitor(self):
        """
        24/7 background task to monitor positions and enforce OCO bracket hygiene:
        1. Auto-triggers TP and SL execution for simulated paper trading positions.
        2. Auto-detects closed positions on live/testnet Binance and cancels any
           lingering/orphaned SL or TP orders.
        """
        self._monitor_running = True
        logger.info("24/7 Trade Bracket & OCO Auto-Cleanup Monitor started.")
        while self._monitor_running:
            try:
                # 1. Process simulated paper positions (TP/SL hit check)
                await self._check_paper_positions_tp_sl()

                # 2. Process live / testnet orphaned bracket cleanup (throttled to 45s to protect rate limits)
                now_ts = time.time()
                server_mode = self._server_credentials.get("mode", "demo")
                use_sim = self._server_credentials.get("useSimulatedDemo", True)
                if (server_mode == "live" or (server_mode == "demo" and not use_sim)) and (now_ts > self._rate_limit_ban_until):
                    if now_ts - self._last_live_clean_time >= 45.0:
                        api_key = self._server_credentials.get("liveApiKey" if server_mode == "live" else "demoApiKey", "")
                        api_secret = self._server_credentials.get("liveApiSecret" if server_mode == "live" else "demoApiSecret", "")
                        if api_key and api_secret:
                            self._last_live_clean_time = now_ts
                            await self.auto_clean_orphaned_brackets(
                                market="futures",
                                mode=server_mode,
                                api_key=api_key,
                                api_secret=api_secret
                            )
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.debug(f"Trade monitor tick error: {e}")

            await asyncio.sleep(4.0)

    def stop_background_monitor(self):
        self._monitor_running = False
        if self._monitor_task and not self._monitor_task.done():
            self._monitor_task.cancel()

    async def close_position(
        self,
        symbol: str,
        market: str = "futures",
        mode: str = "demo",
        api_key: str = "",
        api_secret: str = ""
    ) -> Dict[str, Any]:
        """
        Instantly close an open position at MARKET and cancel its remaining SL/TP bracket orders.
        """
        mode, api_key, api_secret = self._resolve_credentials(mode, api_key, api_secret)
        sym_clean = symbol.upper().strip()
        market_clean = market.lower().strip()
        mode_clean = mode.lower().strip()

        api_key = (api_key or "").strip()
        api_secret = (api_secret or "").strip()

        # Paper Trading Close
        if self._is_simulated_demo(mode_clean, api_key, api_secret):
            matched = [p for p in self._paper_positions if p.get("symbol") == sym_clean and p.get("status") == "FILLED"]
            if not matched:
                return {"success": False, "message": f"Tidak ada posisi paper aktif untuk {sym_clean}."}

            from .binance_service import BinanceService
            bs = BinanceService()
            price_map = {}
            try:
                tickers = await bs.get_live_ticker_batch(market=market_clean)
                price_map = {t["s"]: t["c"] for t in tickers}
            except Exception:
                pass

            total_closed_pnl = 0.0
            for p in matched:
                mark_p = float(price_map.get(sym_clean, float(p.get("price", 0))))
                pnl = self._close_single_paper_position(p, close_price=mark_p, reason="Market Close")
                total_closed_pnl += pnl

            self._save_paper_data()
            self._positions_cache.clear()
            self._orders_cache.clear()
            self._history_cache.clear()

            pnl_sign = "+" if total_closed_pnl >= 0 else ""
            return {
                "success": True,
                "message": f"Posisi {sym_clean} berhasil ditutup! PnL: {pnl_sign}${total_closed_pnl:.2f} USDT."
            }

        if not api_key or not api_secret:
            return {"success": False, "message": "API Key dan Secret Key diperlukan."}

        now = time.time()
        if now < self._rate_limit_ban_until:
            wait_sec = int(self._rate_limit_ban_until - now)
            return {
                "success": True,
                "mode": mode_clean,
                "market": market_clean,
                "is_simulated": False,
                "orders": [],
                "warning": f"Cooldown rate limit Binance aktif ({wait_sec}s tersisa)"
            }

        base_url = self._get_base_url(market_clean, mode_clean)
        headers = {**HEADERS_BASE, "X-MBX-APIKEY": api_key}
        timeout = httpx.Timeout(15.0, connect=5.0)

        async with httpx.AsyncClient(headers=headers, timeout=timeout) as client:
            try:
                # 1. Fetch current open amount
                signed_pos = self._sign_payload({"symbol": sym_clean}, api_secret)
                pos_resp = await client.get(f"{base_url}/fapi/v2/positionRisk?{signed_pos}")
                if pos_resp.status_code != 200:
                    return {"success": False, "message": "Gagal membaca posisi saat ini dari Binance."}

                positions = pos_resp.json()
                active_p = next((p for p in positions if p.get("symbol") == sym_clean and float(p.get("positionAmt", 0)) != 0), None)
                if not active_p:
                    return {"success": False, "message": f"Tidak ditemukan posisi terbuka untuk {sym_clean}."}

                pos_amt = float(active_p.get("positionAmt", 0))
                close_side = "SELL" if pos_amt > 0 else "BUY"
                close_qty = abs(pos_amt)

                # 2. Market Close with reduceOnly=true
                close_params = {
                    "symbol": sym_clean,
                    "side": close_side,
                    "type": "MARKET",
                    "quantity": close_qty,
                    "reduceOnly": "true"
                }
                signed_close = self._sign_payload(close_params, api_secret)
                close_resp = await client.post(f"{base_url}/fapi/v1/order?{signed_close}")

                if close_resp.status_code != 200:
                    err_json = close_resp.json() if close_resp.text else {}
                    return {"success": False, "message": err_json.get("msg") or f"Gagal close: HTTP {close_resp.status_code}"}

                # 3. Clean all remaining open orders & algo orders (SL/TP) for this symbol
                await self.cancel_all_symbol_open_orders(
                    symbol=sym_clean,
                    market=market_clean,
                    mode=mode_clean,
                    api_key=api_key,
                    api_secret=api_secret
                )

                return {
                    "success": True,
                    "message": f"Posisi {sym_clean} ({close_side} {close_qty}) berhasil ditutup di Binance {mode_clean.upper()}!"
                }
            except Exception as exc:
                return {"success": False, "message": f"Gagal menutup posisi: {str(exc)}"}

    async def cancel_order(
        self,
        symbol: str,
        order_id: int,
        market: str = "futures",
        mode: str = "demo",
        api_key: str = "",
        api_secret: str = ""
    ) -> Dict[str, Any]:
        """
        Cancel a pending order.
        """
        mode, api_key, api_secret = self._resolve_credentials(mode, api_key, api_secret)
        sym_clean = symbol.upper().strip()
        market_clean = market.lower().strip()
        mode_clean = mode.lower().strip()

        api_key = (api_key or "").strip()
        api_secret = (api_secret or "").strip()

        if self._is_simulated_demo(mode_clean, api_key, api_secret):
            oid_str = str(order_id)
            cancelled_type = "Order"
            for p in self._paper_positions:
                if p.get("status") == "FILLED":
                    if oid_str == f"{p.get('id')}1" or (sym_clean and p.get("symbol") == sym_clean and oid_str.endswith("1")):
                        p["stop_loss"] = None
                        cancelled_type = "Stop Loss"
                        break
                    elif oid_str == f"{p.get('id')}2" or (sym_clean and p.get("symbol") == sym_clean and oid_str.endswith("2")):
                        p["take_profit"] = None
                        cancelled_type = "Take Profit"
                        break
            self._save_paper_data()
            self._orders_cache.clear()
            return {
                "success": True,
                "message": f"{cancelled_type} #{order_id} berhasil dibatalkan (Simulasi)."
            }

        if not api_key or not api_secret:
            return {"success": False, "message": "API Key dan Secret Key diperlukan."}

        now = time.time()
        if now < self._rate_limit_ban_until:
            wait_sec = int(self._rate_limit_ban_until - now)
            return {
                "success": True,
                "mode": mode_clean,
                "market": market_clean,
                "is_simulated": False,
                "orders": [],
                "warning": f"Cooldown rate limit Binance aktif ({wait_sec}s tersisa)"
            }

        base_url = self._get_base_url(market_clean, mode_clean)
        headers = {**HEADERS_BASE, "X-MBX-APIKEY": api_key}
        timeout = httpx.Timeout(12.0, connect=5.0)

        async with httpx.AsyncClient(headers=headers, timeout=timeout) as client:
            try:
                path = "/fapi/v1/order" if market_clean == "futures" else "/api/v3/order"
                signed_cancel = self._sign_payload({"symbol": sym_clean, "orderId": order_id}, api_secret)
                url = f"{base_url}{path}?{signed_cancel}"
                resp = await client.delete(url)
                if resp.status_code == 200:
                    return {"success": True, "message": f"Order #{order_id} ({sym_clean}) berhasil dibatalkan di Binance."}

                # If standard delete failed on Futures, attempt cancelling as an Algo Order
                if market_clean == "futures":
                    try:
                        signed_algo_cancel = self._sign_payload({"symbol": sym_clean, "algoId": order_id}, api_secret)
                        resp_algo_del = await client.delete(f"{base_url}/fapi/v1/algoOrder?{signed_algo_cancel}")
                        if resp_algo_del.status_code == 200:
                            return {"success": True, "message": f"Algo Order #{order_id} ({sym_clean}) berhasil dibatalkan di Binance."}
                    except Exception as a_del_err:
                        logger.warning(f"Failed cancelling as algo order: {a_del_err}")

                err_json = resp.json() if resp.text else {}
                return {"success": False, "message": err_json.get("msg") or f"HTTP {resp.status_code}"}
            except Exception as exc:
                return {"success": False, "message": f"Gagal membatalkan order: {str(exc)}"}

    async def set_position_brackets(
        self,
        symbol: str,
        market: str = "futures",
        mode: str = "demo",
        api_key: str = "",
        api_secret: str = "",
        stop_loss: Optional[float] = None,
        take_profit: Optional[float] = None
    ) -> Dict[str, Any]:
        """
        Add or update Stop Loss and/or Take Profit orders on an active open position.
        Automatically cancels old STOP_MARKET / TAKE_PROFIT_MARKET orders for this symbol.
        """
        mode, api_key, api_secret = self._resolve_credentials(mode, api_key, api_secret)
        sym_clean = symbol.upper().strip()
        market_clean = market.lower().strip()
        mode_clean = mode.lower().strip()

        api_key = (api_key or "").strip()
        api_secret = (api_secret or "").strip()

        # Simulated Paper Trading
        if self._is_simulated_demo(mode_clean, api_key, api_secret):
            matched = [p for p in self._paper_positions if p.get("symbol") == sym_clean and p.get("status") == "FILLED"]
            if not matched:
                return {"success": False, "message": f"Tidak ditemukan posisi paper terbuka untuk {sym_clean}."}

            for p in matched:
                if stop_loss is not None:
                    p["stop_loss"] = float(stop_loss) if float(stop_loss) > 0 else None
                if take_profit is not None:
                    p["take_profit"] = float(take_profit) if float(take_profit) > 0 else None

            self._save_paper_data()
            return {
                "success": True,
                "mode": "demo",
                "is_simulated": True,
                "symbol": sym_clean,
                "stop_loss": stop_loss,
                "take_profit": take_profit,
                "message": f"SL/TP berhasil diperbarui untuk posisi {sym_clean} (Simulasi)."
            }

        if not api_key or not api_secret:
            return {"success": False, "message": "API Key dan Secret Key diperlukan."}

        if market_clean != "futures":
            return {"success": False, "message": "Fitur SL/TP bracket hanya berlaku untuk Futures."}

        base_url = self._get_base_url(market_clean, mode_clean)
        headers = {**HEADERS_BASE, "X-MBX-APIKEY": api_key}
        timeout = httpx.Timeout(15.0, connect=5.0)

        async with httpx.AsyncClient(headers=headers, timeout=timeout) as client:
            try:
                # 1. Verify active position and get positionAmt
                signed_pos = self._sign_payload({"symbol": sym_clean}, api_secret)
                pos_resp = await client.get(f"{base_url}/fapi/v2/positionRisk?{signed_pos}")
                if pos_resp.status_code != 200:
                    return {"success": False, "message": "Gagal membaca posisi dari Binance."}

                raw_positions = pos_resp.json()
                active_p = next((p for p in raw_positions if p.get("symbol") == sym_clean and float(p.get("positionAmt", 0)) != 0), None)
                is_filled_pos = True
                if not active_p:
                    # Check if there is an active pending entry order (e.g. LIMIT order waiting to be filled)
                    signed_ord_q = self._sign_payload({"symbol": sym_clean}, api_secret)
                    ord_resp = await client.get(f"{base_url}/fapi/v1/openOrders?{signed_ord_q}")
                    pending_entry = None
                    if ord_resp.status_code == 200:
                        raw_ords = ord_resp.json()
                        pending_entry = next((o for o in raw_ords if not o.get("reduceOnly") and not o.get("closePosition")), None)

                    if not pending_entry:
                        return {"success": False, "message": f"Tidak ditemukan posisi terbuka atau order pending untuk {sym_clean} di Binance."}

                    entry_side = pending_entry.get("side", "BUY")
                    final_qty = float(pending_entry.get("origQty", 0))
                    is_filled_pos = False
                else:
                    pos_amt = float(active_p.get("positionAmt", 0))
                    entry_side = "BUY" if pos_amt > 0 else "SELL"
                    final_qty = abs(pos_amt)

                # 2. Get symbol rules for precision
                rules = await self.get_symbol_rules(symbol=sym_clean, market="futures", mode=mode_clean)
                price_prec = rules.get("pricePrecision", 2)
                tick_size = rules.get("tickSize", 0.01)
                qty_prec = rules.get("quantityPrecision", 3)
                step_size = rules.get("stepSize", 0.001)

                # 3. Call guaranteed multi-strategy bracket placement
                bracket_results = await self._place_futures_brackets(
                    client=client,
                    base_url=base_url,
                    api_secret=api_secret,
                    symbol=sym_clean,
                    side=entry_side,
                    quantity=final_qty,
                    stop_loss=stop_loss,
                    take_profit=take_profit,
                    tick_size=tick_size,
                    price_prec=price_prec,
                    qty_prec=qty_prec,
                    step_size=step_size,
                    is_market_order=False,
                    is_filled=is_filled_pos
                )

                has_sl = "stop_loss" in bracket_results
                has_tp = "take_profit" in bracket_results
                if has_sl or has_tp:
                    msg = f"Berhasil memasang {'SL dan TP' if (has_sl and has_tp) else ('SL' if has_sl else 'TP')} untuk {sym_clean} di Binance!"
                    return {
                        "success": True,
                        "symbol": sym_clean,
                        "bracket_orders": bracket_results,
                        "message": msg
                    }
                else:
                    return {
                        "success": False,
                        "symbol": sym_clean,
                        "bracket_orders": bracket_results,
                        "message": f"Gagal memasang SL/TP di Binance: {bracket_results}"
                    }

            except Exception as exc:
                return {"success": False, "message": f"Gagal update SL/TP: {str(exc)}"}

    async def get_trade_history(
        self,
        market: str = "futures",
        mode: str = "demo",
        api_key: str = "",
        api_secret: str = "",
        symbol: Optional[str] = None,
        limit: int = 50
    ) -> Dict[str, Any]:
        """
        Fetch trade history and realized PnL.
        - Demo (Paper Trading): returns simulated closed trades from local persistence.
        - Live (Binance Futures): queries /fapi/v1/income?incomeType=REALIZED_PNL.
        """
        mode, api_key, api_secret = self._resolve_credentials(mode, api_key, api_secret)
        sym_clean = symbol.upper().strip() if symbol else None
        market_clean = market.lower().strip()
        mode_clean = mode.lower().strip()
        api_key = (api_key or "").strip()
        api_secret = (api_secret or "").strip()

        # Paper Trading History
        if self._is_simulated_demo(mode_clean, api_key, api_secret):
            trades = list(self._paper_history)
            if sym_clean:
                trades = [t for t in trades if t.get("symbol") == sym_clean]
            
            selected = trades[:limit]
            formatted_selected = []
            total_net_pnl = 0.0
            total_fee = 0.0
            winning = 0
            losing = 0

            for t in selected:
                raw_pnl = float(t.get("realizedPnl", 0))
                qty = float(t.get("quantity", 0))
                close_p = float(t.get("closePrice", t.get("price", 0)))
                fee = float(t.get("fee", t.get("commission", 0)))
                if fee == 0 and qty > 0 and close_p > 0:
                    fee = round(qty * close_p * 0.0005, 4)

                net_pnl = float(t.get("netPnl", raw_pnl - (fee if "netPnl" not in t else 0)))
                net_pnl = round(net_pnl, 2)

                if net_pnl > 0:
                    winning += 1
                elif net_pnl < 0:
                    losing += 1

                total_net_pnl += net_pnl
                total_fee += fee

                formatted_selected.append({
                    **t,
                    "realizedPnl": net_pnl,
                    "netPnl": net_pnl,
                    "fee": round(fee, 4),
                    "commission": round(fee, 4),
                    "grossPnl": round(float(t.get("grossPnl", raw_pnl)), 2)
                })

            win_rate = round((winning / len(formatted_selected) * 100), 1) if formatted_selected else 0.0

            return {
                "success": True,
                "mode": "demo",
                "market": market_clean,
                "is_simulated": True,
                "total_realized_pnl": round(total_net_pnl, 2),
                "total_fee": round(total_fee, 4),
                "win_rate_pct": win_rate,
                "total_trades": len(formatted_selected),
                "winning_trades": winning,
                "losing_trades": losing,
                "trades": formatted_selected
            }

        if not api_key or not api_secret:
            return {
                "success": False,
                "message": "API Key dan Secret Key diperlukan untuk melihat riwayat Live."
            }

        now = time.time()
        cache_key = f"{market_clean}_{mode_clean}_{api_key[-8:]}_{sym_clean or 'all'}_{limit}"
        if cache_key in self._history_cache:
            exp, val = self._history_cache[cache_key]
            if now < exp:
                return val

        if now < self._rate_limit_ban_until:
            wait_sec = int(self._rate_limit_ban_until - now)
            return {
                "success": True,
                "mode": mode_clean,
                "market": market_clean,
                "is_simulated": False,
                "total_realized_pnl": 0.0,
                "win_rate_pct": 0.0,
                "total_trades": 0,
                "winning_trades": 0,
                "losing_trades": 0,
                "trades": [],
                "warning": f"Cooldown rate limit Binance aktif ({wait_sec}s tersisa)"
            }

        base_url = self._get_base_url(market_clean, mode_clean)
        headers = {**HEADERS_BASE, "X-MBX-APIKEY": api_key}
        timeout = httpx.Timeout(12.0, connect=5.0)

        async with httpx.AsyncClient(headers=headers, timeout=timeout) as client:
            try:
                if market_clean == "futures":
                    # Cutoff timestamp: keep only the ETHUSDT trade at 1795267097824 (21 Nov, 20:18) and newer trades
                    min_history_epoch_ms = 1795267097000
                    # Query both REALIZED_PNL and COMMISSION to calculate accurate Net PnL and Fees
                    query_params: Dict[str, Any] = {
                        "limit": min(limit * 4, 200),
                        "startTime": min_history_epoch_ms
                    }
                    if sym_clean:
                        query_params["symbol"] = sym_clean

                    signed_query = self._sign_payload(query_params, api_secret)
                    url = f"{base_url}/fapi/v1/income?{signed_query}"

                    resp = await client.get(url)
                    if resp.status_code == 200:
                        raw_income = resp.json()

                        # Deduplicate by tranId and filter out any records older than min_history_epoch_ms
                        seen_tran_ids = set()
                        valid_items = []
                        for item in raw_income:
                            inc_type = item.get("incomeType")
                            if inc_type not in ("REALIZED_PNL", "COMMISSION"):
                                continue
                            time_stamp = int(item.get("time", 0))
                            if time_stamp < min_history_epoch_ms:
                                continue
                            tran_id = str(item.get("tranId") or "")
                            if tran_id and tran_id in seen_tran_ids:
                                continue
                            if tran_id:
                                seen_tran_ids.add(tran_id)
                            valid_items.append(item)

                        # Sort chronologically so partial fills of the same position close cluster together
                        valid_items.sort(key=lambda x: int(x.get("time", 0)))

                        # Consolidate all partial fills of the same symbol within a 60s execution window into ONE single trade row (Binance Position History style)
                        clusters_by_symbol: Dict[str, List[Dict[str, Any]]] = {}
                        for item in valid_items:
                            sym = item.get("symbol", "")
                            inc_type = item.get("incomeType")
                            time_stamp = int(item.get("time", 0))
                            val = float(item.get("income", 0))

                            sym_clusters = clusters_by_symbol.setdefault(sym, [])
                            if sym_clusters and abs(time_stamp - sym_clusters[-1]["last_time"]) <= 60000:
                                grp = sym_clusters[-1]
                                grp["last_time"] = time_stamp
                            else:
                                grp = {
                                    "id": f"pos_{sym}_{time_stamp}",
                                    "symbol": sym,
                                    "grossPnl": 0.0,
                                    "fee": 0.0,
                                    "time": time_stamp,
                                    "last_time": time_stamp,
                                    "has_realized_pnl": False
                                }
                                sym_clusters.append(grp)

                            if inc_type == "REALIZED_PNL":
                                grp["grossPnl"] += val
                                grp["has_realized_pnl"] = True
                            elif inc_type == "COMMISSION":
                                grp["fee"] += abs(val)

                        all_clusters = [
                            grp
                            for sym_list in clusters_by_symbol.values()
                            for grp in sym_list
                        ]

                        formatted_trades = []
                        total_net_pnl = 0.0
                        total_fee = 0.0
                        winning = 0
                        losing = 0

                        # Filter and format only actual consolidated position realizations
                        for grp in all_clusters:
                            if not grp["has_realized_pnl"]:
                                continue

                            gross = round(grp["grossPnl"], 2)
                            fee = round(grp["fee"], 4)
                            net = round(gross - fee, 2)

                            if net > 0:
                                winning += 1
                            elif net < 0:
                                losing += 1

                            total_net_pnl += net
                            total_fee += fee

                            formatted_trades.append({
                                "id": grp["id"],
                                "symbol": grp["symbol"],
                                "side": "WIN" if net >= 0 else "LOSS",
                                "entryPrice": None,
                                "closePrice": None,
                                "quantity": 0,
                                "grossPnl": gross,
                                "fee": fee,
                                "commission": fee,
                                "realizedPnl": net,
                                "netPnl": net,
                                "roePct": None,
                                "time": grp["time"],
                                "reason": "Realized PnL",
                                "is_simulated": False
                            })

                        # Sort newest first
                        formatted_trades.sort(key=lambda x: x["time"], reverse=True)
                        formatted_trades = formatted_trades[:limit]

                        win_rate = round((winning / len(formatted_trades) * 100), 1) if formatted_trades else 0.0
                        result = {
                            "success": True,
                            "mode": mode_clean,
                            "market": market_clean,
                            "is_simulated": False,
                            "total_realized_pnl": round(total_net_pnl, 2),
                            "total_fee": round(total_fee, 4),
                            "win_rate_pct": win_rate,
                            "total_trades": len(formatted_trades),
                            "winning_trades": winning,
                            "losing_trades": losing,
                            "trades": formatted_trades
                        }
                        self._history_cache[cache_key] = (now + self._history_ttl, result)
                        return result
                    else:
                        err_payload = resp.json() if resp.text else {}
                        msg = err_payload.get("msg") or f"HTTP {resp.status_code}"
                        if resp.status_code in (418, 429):
                            self._handle_rate_limit(msg)
                        return {"success": False, "message": msg}
                else:
                    return {
                        "success": True,
                        "mode": mode_clean,
                        "market": "spot",
                        "total_realized_pnl": 0.0,
                        "win_rate_pct": 0.0,
                        "total_trades": 0,
                        "winning_trades": 0,
                        "losing_trades": 0,
                        "trades": []
                    }
            except Exception as exc:
                return {"success": False, "message": f"Gagal mengambil riwayat trade: {str(exc)}"}

    def clear_paper_history(self) -> Dict[str, Any]:
        """Clear all stored paper trading history."""
        self._paper_history = []
        self._save_paper_data()
        self._history_cache.clear()
        return {"success": True, "message": "Riwayat paper trading berhasil dibersihkan."}

trade_service = TradeService()
