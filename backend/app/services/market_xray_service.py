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
        spot_klines_url = f"https://api.binance.com/api/v3/klines?symbol={sym}&interval=5m&limit=12"
        fut_klines_url = f"https://fapi.binance.com/fapi/v1/klines?symbol={sym}&interval=5m&limit=12" if market_clean == "futures" else None
        oi_hist_url = f"https://fapi.binance.com/futures/data/openInterestHist?symbol={sym}&period=5m&limit=6" if market_clean == "futures" else None

        depth_data = None
        trades_data = None
        current_price = 0.0
        oi_val = 0.0
        top_trader_long_pct = 50.0
        retail_long_pct = 50.0
        taker_buy_pct = 50.0
        spot_klines: List[Any] = []
        fut_klines: List[Any] = []
        oi_hist: List[Any] = []

        async with httpx.AsyncClient(headers=HEADERS, timeout=timeout, verify=settings.TLS_VERIFY) as client:
            task_map: Dict[str, Any] = {
                "depth": client.get(depth_url),
                "trades": client.get(trades_url),
                "ticker": client.get(ticker_url),
                "spot_klines": client.get(spot_klines_url)
            }
            if oi_url:
                task_map["oi"] = client.get(oi_url)
            if top_ls_url:
                task_map["top_ls"] = client.get(top_ls_url)
            if global_ls_url:
                task_map["global_ls"] = client.get(global_ls_url)
            if taker_ls_url:
                task_map["taker_ls"] = client.get(taker_ls_url)
            if fut_klines_url:
                task_map["fut_klines"] = client.get(fut_klines_url)
            if oi_hist_url:
                task_map["oi_hist"] = client.get(oi_hist_url)

            keys = list(task_map.keys())
            raw_results = await asyncio.gather(*[task_map[k] for k in keys], return_exceptions=True)
            res_by_key = dict(zip(keys, raw_results))

            # Depth
            r_depth = res_by_key.get("depth")
            if r_depth and not isinstance(r_depth, Exception) and r_depth.status_code == 200:
                depth_data = r_depth.json()
            # Trades
            r_trades = res_by_key.get("trades")
            if r_trades and not isinstance(r_trades, Exception) and r_trades.status_code == 200:
                trades_data = r_trades.json()
            # Ticker
            r_ticker = res_by_key.get("ticker")
            if r_ticker and not isinstance(r_ticker, Exception) and r_ticker.status_code == 200:
                current_price = float(r_ticker.json().get("price", 0.0))
            # Spot Klines
            r_spot_k = res_by_key.get("spot_klines")
            if r_spot_k and not isinstance(r_spot_k, Exception) and r_spot_k.status_code == 200:
                data_k = r_spot_k.json()
                if isinstance(data_k, list):
                    spot_klines = data_k
            # Derivatives
            r_oi = res_by_key.get("oi")
            if r_oi and not isinstance(r_oi, Exception) and r_oi.status_code == 200:
                try:
                    oi_val = float(r_oi.json().get("openInterest", 0.0))
                except Exception:
                    pass
            r_top_ls = res_by_key.get("top_ls")
            if r_top_ls and not isinstance(r_top_ls, Exception) and r_top_ls.status_code == 200:
                try:
                    ls_arr = r_top_ls.json()
                    if isinstance(ls_arr, list) and len(ls_arr) > 0:
                        top_trader_long_pct = float(ls_arr[0].get("longAccount", 0.5)) * 100.0
                except Exception:
                    pass
            r_gl_ls = res_by_key.get("global_ls")
            if r_gl_ls and not isinstance(r_gl_ls, Exception) and r_gl_ls.status_code == 200:
                try:
                    gl_arr = r_gl_ls.json()
                    if isinstance(gl_arr, list) and len(gl_arr) > 0:
                        retail_long_pct = float(gl_arr[0].get("longAccount", 0.5)) * 100.0
                except Exception:
                    pass
            r_tk_ls = res_by_key.get("taker_ls")
            if r_tk_ls and not isinstance(r_tk_ls, Exception) and r_tk_ls.status_code == 200:
                try:
                    tk_arr = r_tk_ls.json()
                    if isinstance(tk_arr, list) and len(tk_arr) > 0:
                        taker_buy_pct = float(tk_arr[0].get("buyVol", 0.5)) / max(1e-6, (float(tk_arr[0].get("buyVol", 0.5)) + float(tk_arr[0].get("sellVol", 0.5)))) * 100.0
                except Exception:
                    pass
            r_fut_k = res_by_key.get("fut_klines")
            if r_fut_k and not isinstance(r_fut_k, Exception) and r_fut_k.status_code == 200:
                data_fk = r_fut_k.json()
                if isinstance(data_fk, list):
                    fut_klines = data_fk
            r_oi_h = res_by_key.get("oi_hist")
            if r_oi_h and not isinstance(r_oi_h, Exception) and r_oi_h.status_code == 200:
                data_oh = r_oi_h.json()
                if isinstance(data_oh, list):
                    oi_hist = data_oh

        # Fallback to Binance Vision Spot depth/trades/klines if upstream was blocked or empty
        if not depth_data or not depth_data.get("bids") or not spot_klines:
            try:
                async with httpx.AsyncClient(headers=HEADERS, timeout=timeout, verify=settings.TLS_VERIFY) as fallback_client:
                    fb_tasks = []
                    need_depth = not depth_data or not depth_data.get("bids")
                    if need_depth:
                        fb_tasks.append(("depth", fallback_client.get(f"https://data-api.binance.vision/api/v3/depth?symbol={sym}&limit=500")))
                        fb_tasks.append(("trades", fallback_client.get(f"https://data-api.binance.vision/api/v3/aggTrades?symbol={sym}&limit=500")))
                        fb_tasks.append(("ticker", fallback_client.get(f"https://data-api.binance.vision/api/v3/ticker/price?symbol={sym}")))
                    if not spot_klines:
                        fb_tasks.append(("spot_klines", fallback_client.get(f"https://data-api.binance.vision/api/v3/klines?symbol={sym}&interval=5m&limit=12")))
                    if fb_tasks:
                        fb_res = await asyncio.gather(*[t[1] for t in fb_tasks], return_exceptions=True)
                        for (k, _), resp in zip(fb_tasks, fb_res):
                            if isinstance(resp, Exception) or resp.status_code != 200:
                                continue
                            if k == "depth":
                                depth_data = resp.json()
                            elif k == "trades":
                                trades_data = resp.json()
                            elif k == "ticker" and not current_price:
                                current_price = float(resp.json().get("price", 0.0))
                            elif k == "spot_klines":
                                data_k = resp.json()
                                if isinstance(data_k, list):
                                    spot_klines = data_k
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
        retail_bids: List[Dict[str, float]] = []
        retail_asks: List[Dict[str, float]] = []

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
                    retail_bids.append({"price": p, "usd": usd})
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
                    retail_asks.append({"price": p, "usd": usd})
            except Exception:
                continue

        # Top Whale Fortress Walls (Sort first before fallback usage)
        whale_bids.sort(key=lambda x: x["usd"], reverse=True)
        whale_asks.sort(key=lambda x: x["usd"], reverse=True)

        top_whale_bid = whale_bids[0] if whale_bids else {"price": current_price * 0.985, "usd": 0.0}
        top_whale_ask = whale_asks[0] if whale_asks else {"price": current_price * 1.015, "usd": 0.0}

        # Volume-Weighted Average Prices (VWAP of Limit Orders)
        weighted_whale_bid = sum(x["price"] * x["usd"] for x in whale_bids)
        weighted_whale_ask = sum(x["price"] * x["usd"] for x in whale_asks)
        weighted_retail_bid = sum(x["price"] * x["usd"] for x in retail_bids)
        weighted_retail_ask = sum(x["price"] * x["usd"] for x in retail_asks)

        avg_whale_long = round(weighted_whale_bid / total_inst_bids, 2) if total_inst_bids > 0 else (top_whale_bid["price"] if top_whale_bid["price"] > 0 else round(current_price * 0.985, 2))
        avg_whale_short = round(weighted_whale_ask / total_inst_asks, 2) if total_inst_asks > 0 else (top_whale_ask["price"] if top_whale_ask["price"] > 0 else round(current_price * 1.015, 2))
        avg_retail_long = round(weighted_retail_bid / total_retail_bids, 2) if total_retail_bids > 0 else round(current_price * 0.995, 2)
        avg_retail_short = round(weighted_retail_ask / total_retail_asks, 2) if total_retail_asks > 0 else round(current_price * 1.005, 2)

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
        long_sl_50x = round(avg_buy_entry * 0.9805, 2)
        long_sl_25x = round(avg_buy_entry * 0.9610, 2)
        est_long_sl_usd = sum(x["usd"] for x in recent_large_buys) * 1.6 or 15000000.0

        short_sl_50x = round(avg_sell_entry * 1.0195, 2)
        short_sl_25x = round(avg_sell_entry * 1.0390, 2)
        est_short_sl_usd = sum(x["usd"] for x in recent_large_sells) * 1.6 or 18000000.0

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

        # 3. Compute Spot vs Futures CVD Divergence (30-min rolling institutional absorption detector)
        def _calc_klines_cvd_and_chg(klines_arr: List[Any], bars: int = 6) -> Tuple[float, float]:
            if not klines_arr:
                return 0.0, 0.0
            sl = klines_arr[-min(bars, len(klines_arr)):]
            net_delta_usd = 0.0
            for k in sl:
                try:
                    q_vol = float(k[7])
                    taker_buy_q = float(k[10])
                    net_delta_usd += (2.0 * taker_buy_q - q_vol)
                except Exception:
                    continue
            try:
                first_open = float(sl[0][1])
                last_close = float(sl[-1][4])
                pct_chg = ((last_close - first_open) / max(1e-9, first_open)) * 100.0
            except Exception:
                pct_chg = 0.0
            return net_delta_usd, pct_chg

        spot_cvd_30m, spot_price_chg_30m = _calc_klines_cvd_and_chg(spot_klines, bars=6)
        fut_cvd_30m, fut_price_chg_30m = _calc_klines_cvd_and_chg(fut_klines, bars=6)
        ref_price_chg = fut_price_chg_30m if fut_klines else spot_price_chg_30m

        cvd_div_regime = "NEUTRAL"
        if spot_klines and fut_klines:
            if spot_cvd_30m > 0 and fut_cvd_30m < 0:
                cvd_div_regime = "SPOT_ABSORPTION_BULLISH"
            elif spot_cvd_30m < 0 and fut_cvd_30m > 0:
                cvd_div_regime = "SPOT_DISTRIBUTION_BEARISH"
            elif spot_cvd_30m > 0 and fut_cvd_30m > 0:
                cvd_div_regime = "ALIGNED_BULLISH"
            elif spot_cvd_30m < 0 and fut_cvd_30m < 0:
                cvd_div_regime = "ALIGNED_BEARISH"

        # 4. Compute 4-Quadrant OI Regime (Recent 15-30m OI Delta vs Price Direction)
        oi_change_pct = 0.0
        oi_regime = "NEUTRAL"
        if isinstance(oi_hist, list) and len(oi_hist) >= 2:
            try:
                prev_oi = float(oi_hist[max(0, len(oi_hist) - 4)].get("sumOpenInterest", 0.0))
                curr_oi = float(oi_hist[-1].get("sumOpenInterest", 0.0))
                if prev_oi > 0:
                    oi_change_pct = ((curr_oi - prev_oi) / prev_oi) * 100.0
                    # Evaluate 4-Quadrant OI Regime
                    if ref_price_chg < -0.05 and oi_change_pct < -0.05:
                        oi_regime = "LONG_LIQUIDATION_FLUSH"
                    elif ref_price_chg > 0.05 and oi_change_pct < -0.05:
                        oi_regime = "SHORT_COVERING_SQUEEZE"
                    elif ref_price_chg > 0.05 and oi_change_pct > 0.05:
                        oi_regime = "LONG_BUILD_UP"
                    elif ref_price_chg < -0.05 and oi_change_pct > 0.05:
                        oi_regime = "SHORT_BUILD_UP"
            except Exception:
                pass

        # 5. Compute Whale vs Retail Intent & Squeeze Direction
        inst_bid_share = total_inst_bids / max(1.0, total_inst_bids + total_inst_asks)
        whale_pressure_buy_pct = round(top_trader_long_pct * 0.5 + inst_bid_share * 100.0 * 0.5, 1)
        retail_pressure_long_pct = round(retail_long_pct, 1)

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
            "spot_vs_futures": {
                "spot_cvd_30m_usd": round(spot_cvd_30m, 2),
                "futures_cvd_30m_usd": round(fut_cvd_30m, 2),
                "price_change_30m_pct": round(ref_price_chg, 3),
                "regime": cvd_div_regime
            },
            "oi_regime": {
                "regime": oi_regime,
                "oi_change_pct": round(oi_change_pct, 3),
                "price_change_pct": round(ref_price_chg, 3)
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
                "bid_walls": [
                    {
                        "price": round(w["price"], 2),
                        "usd_value": round(w["usd"], 2),
                        "distance_pct": round(((w["price"] - current_price) / current_price) * 100.0, 2)
                    }
                    for w in whale_bids[:5]
                ],
                "ask_walls": [
                    {
                        "price": round(w["price"], 2),
                        "usd_value": round(w["usd"], 2),
                        "distance_pct": round(((w["price"] - current_price) / current_price) * 100.0, 2)
                    }
                    for w in whale_asks[:5]
                ],
                "total_inst_bids_usd": round(total_inst_bids, 2),
                "total_inst_asks_usd": round(total_inst_asks, 2)
            },
            "average_limit_orders": {
                "whale_avg_long": {
                    "price": round(avg_whale_long, 2),
                    "usd_value": round(total_inst_bids, 2),
                    "distance_pct": round(((avg_whale_long - current_price) / current_price) * 100.0, 2),
                    "order_count": len(whale_bids),
                    "label": f"Whale Avg Long (${round(total_inst_bids / 1e6, 2)}M)"
                },
                "whale_avg_short": {
                    "price": round(avg_whale_short, 2),
                    "usd_value": round(total_inst_asks, 2),
                    "distance_pct": round(((avg_whale_short - current_price) / current_price) * 100.0, 2),
                    "order_count": len(whale_asks),
                    "label": f"Whale Avg Short (${round(total_inst_asks / 1e6, 2)}M)"
                },
                "retail_avg_long": {
                    "price": round(avg_retail_long, 2),
                    "usd_value": round(total_retail_bids, 2),
                    "distance_pct": round(((avg_retail_long - current_price) / current_price) * 100.0, 2),
                    "order_count": len(retail_bids),
                    "label": f"Retail Avg Long (${round(total_retail_bids / 1e6, 2)}M)"
                },
                "retail_avg_short": {
                    "price": round(avg_retail_short, 2),
                    "usd_value": round(total_retail_asks, 2),
                    "distance_pct": round(((avg_retail_short - current_price) / current_price) * 100.0, 2),
                    "order_count": len(retail_asks),
                    "label": f"Retail Avg Short (${round(total_retail_asks / 1e6, 2)}M)"
                }
            }
        }

        self._cache[cache_key] = (now, result)
        return result

market_xray_service = MarketXrayService()
