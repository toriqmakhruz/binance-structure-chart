import asyncio
import math
import time
import httpx
import logging
from typing import Dict, Any, List, Optional, Tuple
from ..config import settings
from .binance_service import HEADERS

logger = logging.getLogger("market_xray_service")

class MarketXrayService:
    def __init__(self):
        self._cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}
        self._cache_ttl = 3.5  # 3.5 seconds live cache

    async def get_market_xray(
        self,
        symbol: str = "BTCUSDT",
        market: str = "futures"
    ) -> Dict[str, Any]:
        """
        Market X-Ray Engine: Dissects the inner anatomy of Binance Futures.
        Aggregates:
          1. Order Book Depth L2 (Whale vs Retail ticket decomposition)
          2. Recent Aggregated Trades (Large Whale execution anchors)
          3. Real-time Open Interest (OI) & OI Delta
          4. Top Trader Long/Short Ratio
          5. Global Long/Short Account Ratio
          6. Taker Buy/Sell Volume Ratio
        Outputs:
          - Real Stop Loss Pools (Short SL Magnet above, Long SL Cascade below)
          - Whale Fortress Walls (Support & Resistance by real capital)
          - Telemetry & Intent Score (Hunting direction, confidence, whale vs retail bias)
        """
        sym = symbol.upper().strip()
        market_clean = market.lower().strip()
        cache_key = f"{sym}_{market_clean}"
        now = time.time()

        if cache_key in self._cache:
            ts, cached_data = self._cache[cache_key]
            if now - ts < self._cache_ttl:
                return cached_data

        timeout = httpx.Timeout(6.5, connect=3.0)

        # Endpoints
        depth_url = f"https://fapi.binance.com/fapi/v1/depth?symbol={sym}&limit=500" if market_clean == "futures" else f"https://api.binance.com/api/v3/depth?symbol={sym}&limit=500"
        trades_url = f"https://fapi.binance.com/fapi/v1/aggTrades?symbol={sym}&limit=500" if market_clean == "futures" else f"https://api.binance.com/api/v3/aggTrades?symbol={sym}&limit=500"
        ticker_url = f"https://fapi.binance.com/fapi/v1/ticker/price?symbol={sym}" if market_clean == "futures" else f"https://api.binance.com/api/v3/ticker/price?symbol={sym}"
        oi_url = f"https://fapi.binance.com/fapi/v1/openInterest?symbol={sym}" if market_clean == "futures" else None
        top_ls_url = f"https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol={sym}&period=15m&limit=1" if market_clean == "futures" else None
        global_ls_url = f"https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol={sym}&period=15m&limit=1" if market_clean == "futures" else None
        taker_ls_url = f"https://fapi.binance.com/futures/data/takerlongshortRatio?symbol={sym}&period=15m&limit=1" if market_clean == "futures" else None

        depth_data = None
        trades_data = None
        current_price = 0.0
        oi_val = 0.0
        top_trader_long_pct = 50.0
        retail_long_pct = 50.0
        taker_buy_pct = 50.0

        async with httpx.AsyncClient(headers=HEADERS, timeout=timeout, verify=settings.TLS_VERIFY) as client:
            tasks = [
                client.get(depth_url),
                client.get(trades_url),
                client.get(ticker_url)
            ]
            if oi_url:
                tasks.append(client.get(oi_url))
            if top_ls_url:
                tasks.append(client.get(top_ls_url))
            if global_ls_url:
                tasks.append(client.get(global_ls_url))
            if taker_ls_url:
                tasks.append(client.get(taker_ls_url))

            results = await asyncio.gather(*tasks, return_exceptions=True)

            # Depth
            if not isinstance(results[0], Exception) and results[0].status_code == 200:
                depth_data = results[0].json()
            # Trades
            if not isinstance(results[1], Exception) and results[1].status_code == 200:
                trades_data = results[1].json()
            # Ticker
            if not isinstance(results[2], Exception) and results[2].status_code == 200:
                current_price = float(results[2].json().get("price", 0.0))

            # Derivatives
            if len(results) > 3 and not isinstance(results[3], Exception) and results[3].status_code == 200:
                try:
                    oi_val = float(results[3].json().get("openInterest", 0.0))
                except Exception:
                    pass

            if len(results) > 4 and not isinstance(results[4], Exception) and results[4].status_code == 200:
                try:
                    ls_arr = results[4].json()
                    if isinstance(ls_arr, list) and len(ls_arr) > 0:
                        top_trader_long_pct = float(ls_arr[0].get("longAccount", 0.5)) * 100.0
                except Exception:
                    pass

            if len(results) > 5 and not isinstance(results[5], Exception) and results[5].status_code == 200:
                try:
                    gl_arr = results[5].json()
                    if isinstance(gl_arr, list) and len(gl_arr) > 0:
                        retail_long_pct = float(gl_arr[0].get("longAccount", 0.5)) * 100.0
                except Exception:
                    pass

            if len(results) > 6 and not isinstance(results[6], Exception) and results[6].status_code == 200:
                try:
                    tk_arr = results[6].json()
                    if isinstance(tk_arr, list) and len(tk_arr) > 0:
                        taker_buy_pct = float(tk_arr[0].get("buyVol", 0.5)) / max(1e-6, (float(tk_arr[0].get("buyVol", 0.5)) + float(tk_arr[0].get("sellVol", 0.5)))) * 100.0
                except Exception:
                    pass

        # Fallback to Binance Vision Spot depth/trades if upstream futures was blocked or empty
        if not depth_data or not depth_data.get("bids"):
            try:
                async with httpx.AsyncClient(headers=HEADERS, timeout=timeout, verify=settings.TLS_VERIFY) as fallback_client:
                    fb_tasks = [
                        fallback_client.get(f"https://data-api.binance.vision/api/v3/depth?symbol={sym}&limit=500"),
                        fallback_client.get(f"https://data-api.binance.vision/api/v3/aggTrades?symbol={sym}&limit=500"),
                        fallback_client.get(f"https://data-api.binance.vision/api/v3/ticker/price?symbol={sym}")
                    ]
                    fb_res = await asyncio.gather(*fb_tasks, return_exceptions=True)
                    if not isinstance(fb_res[0], Exception) and fb_res[0].status_code == 200:
                        depth_data = fb_res[0].json()
                    if not isinstance(fb_res[1], Exception) and fb_res[1].status_code == 200:
                        trades_data = fb_res[1].json()
                    if not current_price and not isinstance(fb_res[2], Exception) and fb_res[2].status_code == 200:
                        current_price = float(fb_res[2].json().get("price", 0.0))
            except Exception as e:
                logger.warning(f"Fallback to binance vision failed: {e}")


        raw_bids = depth_data.get("bids", []) if depth_data else []
        raw_asks = depth_data.get("asks", []) if depth_data else []

        if not current_price and raw_bids and raw_asks:
            current_price = (float(raw_bids[0][0]) + float(raw_asks[0][0])) / 2.0

        if not current_price:
            current_price = 58000.0

        # 1. Parse Orderbook Depth for Institutional Walls vs Retail
        total_inst_bids = 0.0
        total_inst_asks = 0.0
        total_retail_bids = 0.0
        total_retail_asks = 0.0

        whale_bids: List[Dict[str, float]] = []
        whale_asks: List[Dict[str, float]] = []

        WHALE_THRESHOLD_USD = 50000.0
        RETAIL_THRESHOLD_USD = 10000.0

        for b in raw_bids:
            try:
                p = float(b[0])
                q = float(b[1])
                usd = p * q
                if usd >= WHALE_THRESHOLD_USD:
                    total_inst_bids += usd
                    whale_bids.append({"price": p, "usd": usd})
                elif usd <= RETAIL_THRESHOLD_USD:
                    total_retail_bids += usd
            except Exception:
                continue

        for a in raw_asks:
            try:
                p = float(a[0])
                q = float(a[1])
                usd = p * q
                if usd >= WHALE_THRESHOLD_USD:
                    total_inst_asks += usd
                    whale_asks.append({"price": p, "usd": usd})
                elif usd <= RETAIL_THRESHOLD_USD:
                    total_retail_asks += usd
            except Exception:
                continue

        # Top Whale Fortress Walls
        whale_bids.sort(key=lambda x: x["usd"], reverse=True)
        whale_asks.sort(key=lambda x: x["usd"], reverse=True)

        top_whale_bid = whale_bids[0] if whale_bids else {"price": current_price * 0.985, "usd": 0.0}
        top_whale_ask = whale_asks[0] if whale_asks else {"price": current_price * 1.015, "usd": 0.0}

        # 2. Extract Big Trade Anchors for Real Forced Stop-Loss Liquidation Models
        recent_large_buys = []
        recent_large_sells = []

        if isinstance(trades_data, list):
            for t in trades_data:
                try:
                    p = float(t.get("p", 0.0))
                    q = float(t.get("q", 0.0))
                    val = p * q
                    is_buyer_maker = bool(t.get("m", False))
                    if val >= 40000.0:
                        if not is_buyer_maker:
                            recent_large_buys.append({"price": p, "usd": val})
                        else:
                            recent_large_sells.append({"price": p, "usd": val})
                except Exception:
                    continue

        avg_buy_entry = sum(x["price"] * x["usd"] for x in recent_large_buys) / max(1e-6, sum(x["usd"] for x in recent_large_buys)) if recent_large_buys else current_price
        avg_sell_entry = sum(x["price"] * x["usd"] for x in recent_large_sells) / max(1e-6, sum(x["usd"] for x in recent_large_sells)) if recent_large_sells else current_price

        # Standard Binance MMR Liquidation Calculation
        # Long Stop-Loss Liquidation level (Below current price)
        # Using 50x (2% dist) and 25x (4% dist) as the primary clusters
        long_sl_50x = round(avg_buy_entry * 0.9805, 2)
        long_sl_25x = round(avg_buy_entry * 0.9610, 2)
        est_long_sl_usd = sum(x["usd"] for x in recent_large_buys) * 1.6 or 15000000.0

        # Short Stop-Loss Liquidation level (Above current price)
        short_sl_50x = round(avg_sell_entry * 1.0195, 2)
        short_sl_25x = round(avg_sell_entry * 1.0390, 2)
        est_short_sl_usd = sum(x["usd"] for x in recent_large_sells) * 1.6 or 18000000.0

        # Primary Squeeze Targets
        primary_short_sl = {
            "price": short_sl_50x if short_sl_50x > current_price else round(current_price * 1.018, 2),
            "side": "SHORT_LIQ",
            "tier": "50x Squeeze",
            "est_usd": round(est_short_sl_usd, 2),
            "distance_pct": round(((short_sl_50x - current_price) / current_price) * 100.0, 2),
            "label": f"Short SL Magnet (${round(est_short_sl_usd / 1e6, 1)}M)"
        }

        primary_long_sl = {
            "price": long_sl_50x if long_sl_50x < current_price else round(current_price * 0.982, 2),
            "side": "LONG_LIQ",
            "tier": "50x Cascade",
            "est_usd": round(est_long_sl_usd, 2),
            "distance_pct": round(((long_sl_50x - current_price) / current_price) * 100.0, 2),
            "label": f"Long SL Cascade (${round(est_long_sl_usd / 1e6, 1)}M)"
        }

        # 3. Compute Whale vs Retail Intent & Squeeze Direction
        # Whale Pressure = Top Trader Long % + (Whale Bids / Total Whale Orders)
        inst_bid_share = total_inst_bids / max(1.0, total_inst_bids + total_inst_asks)
        whale_pressure_buy_pct = round(top_trader_long_pct * 0.5 + inst_bid_share * 100.0 * 0.5, 1)
        retail_pressure_long_pct = round(retail_long_pct, 1)

        # Market Intent Deduction:
        # If Whales are Buying (Whale Buy Wall) while Ritel is Shorting -> High probability Short Squeeze upward!
        # If Whales are Selling while Ritel is Longing -> High probability Long Cascade downward!
        intent = "NEUTRAL_ACCUMULATION"
        intent_description = "Buku order seimbang. Menunggu dorongan volume institusi."
        confidence = 50

        if whale_pressure_buy_pct >= 58.0 and retail_pressure_long_pct <= 48.0:
            intent = "HUNTING_SHORT_SL"
            confidence = min(92, int(50 + (whale_pressure_buy_pct - 50) * 2.2 + (50 - retail_pressure_long_pct) * 1.5))
            intent_description = f"Smart Money mengakumulasi beli. Algoritma cenderung menyapu Short SL di ${primary_short_sl['price']}."
        elif whale_pressure_buy_pct <= 42.0 and retail_pressure_long_pct >= 52.0:
            intent = "HUNTING_LONG_SL"
            confidence = min(92, int(50 + (50 - whale_pressure_buy_pct) * 2.2 + (retail_pressure_long_pct - 50) * 1.5))
            intent_description = f"Smart Money mendistribusi jual. Rawan pembantaian Long SL ritel di ${primary_long_sl['price']}."
        elif total_inst_bids > total_inst_asks * 1.3:
            intent = "WHALE_BUY_WALL_DEFENSE"
            confidence = 75
            intent_description = f"Dinding beli paus masif di ${top_whale_bid['price']} menahan penurunan harga."
        elif total_inst_asks > total_inst_bids * 1.3:
            intent = "WHALE_SELL_WALL_PRESSURE"
            confidence = 75
            intent_description = f"Dinding jual paus tebal di ${top_whale_ask['price']} menekan kenaikan harga."

        result = {
            "symbol": sym,
            "market": market_clean,
            "current_price": current_price,
            "timestamp": int(now),
            "telemetry": {
                "intent": intent,
                "confidence": confidence,
                "intent_description": intent_description,
                "whale_bias_pct": whale_pressure_buy_pct,
                "retail_long_pct": retail_pressure_long_pct,
                "top_trader_long_pct": round(top_trader_long_pct, 1),
                "taker_buy_pct": round(taker_buy_pct, 1),
                "open_interest_coins": oi_val,
                "open_interest_usd": round(oi_val * current_price, 2)
            },
            "stop_loss_pools": {
                "short_sl_magnet": primary_short_sl,
                "long_sl_cascade": primary_long_sl
            },
            "whale_fortress": {
                "top_bid_wall": {
                    "price": round(top_whale_bid["price"], 2),
                    "usd_value": round(top_whale_bid["usd"], 2),
                    "distance_pct": round(((top_whale_bid["price"] - current_price) / current_price) * 100.0, 2)
                },
                "top_ask_wall": {
                    "price": round(top_whale_ask["price"], 2),
                    "usd_value": round(top_whale_ask["usd"], 2),
                    "distance_pct": round(((top_whale_ask["price"] - current_price) / current_price) * 100.0, 2)
                },
                "total_inst_bids_usd": round(total_inst_bids, 2),
                "total_inst_asks_usd": round(total_inst_asks, 2)
            }
        }

        self._cache[cache_key] = (now, result)
        return result

market_xray_service = MarketXrayService()
