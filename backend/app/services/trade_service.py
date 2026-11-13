import os
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
        self._load_paper_data()

    def _load_paper_data(self) -> None:
        try:
            if self._storage_path.exists():
                with open(self._storage_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data.get("wallet"), dict):
                        self._paper_wallet = data["wallet"]
                    if isinstance(data.get("positions"), list):
                        self._paper_positions = data["positions"]
        except Exception as exc:
            logger.warning(f"Failed loading paper trading data: {exc}")

    def _save_paper_data(self) -> None:
        try:
            self._storage_dir.mkdir(parents=True, exist_ok=True)
            with open(self._storage_path, "w", encoding="utf-8") as f:
                json.dump({
                    "wallet": self._paper_wallet,
                    "positions": self._paper_positions
                }, f, indent=2)
        except Exception as exc:
            logger.warning(f"Failed saving paper trading data: {exc}")

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
        api_key = (api_key or "").strip()
        api_secret = (api_secret or "").strip()

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
                    return {
                        "success": True,
                        "mode": mode,
                        "market": market,
                        "is_simulated": False,
                        "canTrade": can_trade,
                        "message": "Koneksi Binance API berhasil terverifikasi!"
                    }
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
        api_key = (api_key or "").strip()
        api_secret = (api_secret or "").strip()

        # Simulated Paper Trading fallback for Demo
        if mode == "demo" and (not api_key or not api_secret):
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
            try:
                signed_o = self._sign_payload({"symbol": symbol}, api_secret)
                resp_o = await client.get(f"{base_url}/fapi/v1/openOrders?{signed_o}")
                if resp_o.status_code == 200:
                    for o in resp_o.json():
                        if o.get("type") == order_type_str:
                            oid = o.get("orderId")
                            d_sign = self._sign_payload({"symbol": symbol, "orderId": oid}, api_secret)
                            await client.delete(f"{base_url}/fapi/v1/order?{d_sign}")
                            logger.info(f"Cleaned prior {order_type_str} order {oid} for {symbol}")
            except Exception as c_err:
                logger.warning(f"Note: error cleaning prior {order_type_str}: {c_err}")

        # Helper to execute multi-strategy order placement
        async def place_single_bracket(order_type: str, raw_target_price: float, is_stop_loss: bool) -> Tuple[bool, Any]:
            target_p = float(raw_target_price)

            # Prevent -2021 error: stopPrice cannot be past markPrice
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

            # Strategy 1: closePosition="true" with MARK_PRICE
            # NOTE: Skip for LIMIT/unfilled orders — Binance rejects closePosition=true for open entry orders
            if is_filled:
                params1: Dict[str, Any] = {
                    "symbol": symbol,
                    "side": close_side,
                    "type": order_type,
                    "stopPrice": formatted_price,
                    "closePosition": "true",
                    "workingType": "MARK_PRICE"
                }
                if is_hedge:
                    params1["positionSide"] = hedge_pos_side

                signed1 = self._sign_payload(params1, api_secret)
                resp1 = await client.post(f"{base_url}/fapi/v1/order?{signed1}")
                if resp1.status_code == 200:
                    logger.info(f"{order_type} (closePosition=true) SUCCESS: {resp1.text}")
                    return True, resp1.json()

                logger.warning(f"{order_type} Strategy 1 ({resp1.status_code}: {resp1.text}), trying Strategy 2...")
            else:
                logger.info(f"{order_type} skipping closePosition=true for unfilled LIMIT order, using quantity fallback directly")

            # Strategy 2: quantity fallback (in Hedge mode, omit reduceOnly; in One-Way mode, set reduceOnly="true")
            params2: Dict[str, Any] = {
                "symbol": symbol,
                "side": close_side,
                "type": order_type,
                "stopPrice": formatted_price,
                "quantity": formatted_qty,
                "workingType": "MARK_PRICE"
            }
            if is_hedge:
                params2["positionSide"] = hedge_pos_side
            else:
                params2["reduceOnly"] = "true"

            signed2 = self._sign_payload(params2, api_secret)
            resp2 = await client.post(f"{base_url}/fapi/v1/order?{signed2}")
            if resp2.status_code == 200:
                logger.info(f"{order_type} (quantity fallback) SUCCESS: {resp2.text}")
                return True, resp2.json()

            logger.warning(f"{order_type} Strategy 2 ({resp2.status_code}: {resp2.text}), trying Strategy 3...")

            # Strategy 3: CONTRACT_PRICE fallback with closePosition (only if position is filled)
            if is_filled:
                params3 = dict(params1)
                params3["workingType"] = "CONTRACT_PRICE"
                signed3 = self._sign_payload(params3, api_secret)
                resp3 = await client.post(f"{base_url}/fapi/v1/order?{signed3}")
                if resp3.status_code == 200:
                    logger.info(f"{order_type} (CONTRACT_PRICE) SUCCESS: {resp3.text}")
                    return True, resp3.json()

            # Strategy 4: Quantity + CONTRACT_PRICE
            params4 = dict(params2)
            params4["workingType"] = "CONTRACT_PRICE"
            signed4 = self._sign_payload(params4, api_secret)
            resp4 = await client.post(f"{base_url}/fapi/v1/order?{signed4}")
            if resp4.status_code == 200:
                logger.info(f"{order_type} (Quantity + CONTRACT_PRICE) SUCCESS: {resp4.text}")
                return True, resp4.json()

            err_text = resp2.text
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
        if mode_clean == "demo" and (not api_key or not api_secret):
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
        sym_clean = symbol.upper().strip() if symbol else None
        market_clean = market.lower().strip()
        mode_clean = mode.lower().strip()

        api_key = (api_key or "").strip()
        api_secret = (api_secret or "").strip()

        # Simulated Paper Trading
        if mode_clean == "demo" and (not api_key or not api_secret):
            open_pos = [p for p in self._paper_positions if p.get("status") == "FILLED"]
            if sym_clean:
                open_pos = [p for p in open_pos if p.get("symbol") == sym_clean]

            # Try to enrich with live price
            price_map = {}
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
                            try:
                                ord_query = self._sign_payload({"symbol": sym_clean} if sym_clean else {}, api_secret)
                                ord_resp = await client.get(f"{base_url}/fapi/v1/openOrders?{ord_query}")
                                if ord_resp.status_code == 200:
                                    for o in ord_resp.json():
                                        osym = o.get("symbol")
                                        otype = o.get("type")
                                        trigger_price = float(o.get("stopPrice") or o.get("price") or 0)
                                        if osym not in bracket_map:
                                            bracket_map[osym] = {"stopLoss": None, "takeProfit": None}
                                        if otype in ("STOP_MARKET", "STOP"):
                                            bracket_map[osym]["stopLoss"] = trigger_price
                                        elif otype in ("TAKE_PROFIT_MARKET", "TAKE_PROFIT"):
                                            bracket_map[osym]["takeProfit"] = trigger_price
                            except Exception as ord_err:
                                logger.warning(f"Failed correlating open orders for positions: {ord_err}")

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

                        return {
                            "success": True,
                            "mode": mode_clean,
                            "market": market_clean,
                            "is_simulated": False,
                            "total_unrealized_pnl": round(total_unpnl, 2),
                            "positions": formatted_positions
                        }
                    else:
                        err_payload = resp.json() if resp.text else {}
                        return {
                            "success": False,
                            "message": err_payload.get("msg") or f"HTTP {resp.status_code}"
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
        sym_clean = symbol.upper().strip() if symbol else None
        market_clean = market.lower().strip()
        mode_clean = mode.lower().strip()

        api_key = (api_key or "").strip()
        api_secret = (api_secret or "").strip()

        # Simulated Paper Orders
        if mode_clean == "demo" and (not api_key or not api_secret):
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
                if resp.status_code == 200:
                    raw_orders = resp.json()
                    formatted_orders = []
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
        sym_clean = symbol.upper().strip()
        market_clean = market.lower().strip()
        mode_clean = mode.lower().strip()

        api_key = (api_key or "").strip()
        api_secret = (api_secret or "").strip()

        # Paper Trading Close
        if mode_clean == "demo" and (not api_key or not api_secret):
            matched = [p for p in self._paper_positions if p.get("symbol") == sym_clean and p.get("status") == "FILLED"]
            if not matched:
                return {"success": False, "message": f"Tidak ada posisi paper aktif untuk {sym_clean}."}

            for p in matched:
                p["status"] = "CLOSED"
                margin = float(p.get("margin", 0))
                self._paper_wallet["USDT"] = self._paper_wallet.get("USDT", 10000.0) + margin

            self._save_paper_data()

            return {
                "success": True,
                "message": f"Posisi {sym_clean} berhasil ditutup (Market Close Paper Trading)."
            }

        if not api_key or not api_secret:
            return {"success": False, "message": "API Key dan Secret Key diperlukan."}

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

                # 3. Cancel remaining open orders (SL/TP) for this symbol
                try:
                    signed_del = self._sign_payload({"symbol": sym_clean}, api_secret)
                    await client.delete(f"{base_url}/fapi/v1/allOpenOrders?{signed_del}")
                except Exception as del_err:
                    logger.warning(f"Failed to cancel remaining orders after close: {del_err}")

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
        sym_clean = symbol.upper().strip()
        market_clean = market.lower().strip()
        mode_clean = mode.lower().strip()

        api_key = (api_key or "").strip()
        api_secret = (api_secret or "").strip()

        if mode_clean == "demo" and (not api_key or not api_secret):
            return {
                "success": True,
                "message": f"Order #{order_id} berhasil dibatalkan (Simulasi)."
            }

        if not api_key or not api_secret:
            return {"success": False, "message": "API Key dan Secret Key diperlukan."}

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
                else:
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
        sym_clean = symbol.upper().strip()
        market_clean = market.lower().strip()
        mode_clean = mode.lower().strip()

        api_key = (api_key or "").strip()
        api_secret = (api_secret or "").strip()

        # Simulated Paper Trading
        if mode_clean == "demo" and (not api_key or not api_secret):
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
                if not active_p:
                    return {"success": False, "message": f"Tidak ditemukan posisi terbuka untuk {sym_clean} di Binance."}

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
                    is_market_order=False
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

trade_service = TradeService()
