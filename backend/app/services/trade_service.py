import hmac
import hashlib
import time
import math
import logging
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

        # In-memory virtual paper trading balances and positions (fallback demo)
        self._paper_wallet: Dict[str, float] = {
            "USDT": 10000.0
        }
        self._paper_positions: List[Dict[str, Any]] = []

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

                # B. Place Primary Entry Order
                order_params: Dict[str, Any] = {
                    "symbol": sym_clean,
                    "side": side_clean,
                    "type": order_type_clean,
                    "quantity": final_qty
                }

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
                exec_qty = float(order_res.get("executedQty") or final_qty)
                status_res = order_res.get("status", "NEW")

                # C. Optional Attached Bracket Orders (Stop Loss & Take Profit) for Futures
                bracket_results = {}
                close_side = "SELL" if side_clean == "BUY" else "BUY"

                if market_clean == "futures":
                    # Place Stop Loss
                    if stop_loss and stop_loss > 0:
                        try:
                            sl_formatted = self.format_price(stop_loss, tick_size, price_prec)
                            sl_params = {
                                "symbol": sym_clean,
                                "side": close_side,
                                "type": "STOP_MARKET",
                                "stopPrice": sl_formatted,
                                "closePosition": "true",
                                "timeInForce": "GTC"
                            }
                            signed_sl = self._sign_payload(sl_params, api_secret)
                            sl_resp = await client.post(f"{base_url}/fapi/v1/order?{signed_sl}")
                            if sl_resp.status_code == 200:
                                bracket_results["stop_loss"] = sl_resp.json()
                            else:
                                bracket_results["stop_loss_error"] = sl_resp.text
                        except Exception as sl_exc:
                            bracket_results["stop_loss_error"] = str(sl_exc)

                    # Place Take Profit
                    if take_profit and take_profit > 0:
                        try:
                            tp_formatted = self.format_price(take_profit, tick_size, price_prec)
                            tp_params = {
                                "symbol": sym_clean,
                                "side": close_side,
                                "type": "TAKE_PROFIT_MARKET",
                                "stopPrice": tp_formatted,
                                "closePosition": "true",
                                "timeInForce": "GTC"
                            }
                            signed_tp = self._sign_payload(tp_params, api_secret)
                            tp_resp = await client.post(f"{base_url}/fapi/v1/order?{signed_tp}")
                            if tp_resp.status_code == 200:
                                bracket_results["take_profit"] = tp_resp.json()
                            else:
                                bracket_results["take_profit_error"] = tp_resp.text
                        except Exception as tp_exc:
                            bracket_results["take_profit_error"] = str(tp_exc)

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
                    "bracket_orders": bracket_results,
                    "raw": order_res,
                    "message": f"Order {side_clean} {exec_qty} {sym_clean} ({status_res}) berhasil dikirim ke Binance {mode_clean.upper()}!"
                }

            except Exception as exc:
                return {
                    "success": False,
                    "message": f"Gagal mengeksekusi order di Binance: {str(exc)}"
                }

trade_service = TradeService()
