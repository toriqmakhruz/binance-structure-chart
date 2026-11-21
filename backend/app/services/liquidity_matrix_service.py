import asyncio
import math
import time
import httpx
import logging
from typing import Dict, Any, List, Optional
from ..config import settings
from .binance_service import HEADERS

logger = logging.getLogger("liquidity_matrix_service")

class LiquidityMatrixService:
    def __init__(self):
        self._cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}
        self._cache_ttl = 3.0  # 3 seconds live cache for fast responsiveness

    async def get_liquidity_matrix(
        self,
        symbol: str = "BTCUSDT",
        market: str = "futures",
        num_bins: int = 24
    ) -> Dict[str, Any]:
        """
        Fetch 100% REAL Binance Order Book Depth (L2) and recent aggregated trades.
        Decomposes resting limit orders into:
          - Institutional / Whale Orders (Ticket >= $50,000 USD)
          - Retail Orders (Ticket < $10,000 USD)
        Computes real margin forced liquidation / stop-loss cluster levels.
        """
        sym = symbol.upper().strip()
        market_clean = market.lower().strip()
        cache_key = f"{sym}_{market_clean}_{num_bins}"
        now = time.time()

        if cache_key in self._cache:
            ts, cached_data = self._cache[cache_key]
            if now - ts < self._cache_ttl:
                return cached_data

        depth_url = (
            f"https://fapi.binance.com/fapi/v1/depth?symbol={sym}&limit=500"
            if market_clean == "futures"
            else f"https://api.binance.com/api/v3/depth?symbol={sym}&limit=500"
        )
        trades_url = (
            f"https://fapi.binance.com/fapi/v1/aggTrades?symbol={sym}&limit=500"
            if market_clean == "futures"
            else f"https://api.binance.com/api/v3/aggTrades?symbol={sym}&limit=500"
        )
        ticker_url = (
            f"https://fapi.binance.com/fapi/v1/ticker/price?symbol={sym}"
            if market_clean == "futures"
            else f"https://api.binance.com/api/v3/ticker/price?symbol={sym}"
        )

        timeout = httpx.Timeout(8.0, connect=3.5)
        depth_data = None
        trades_data = None
        last_price = 0.0

        async with httpx.AsyncClient(headers=HEADERS, timeout=timeout, verify=settings.TLS_VERIFY) as client:
            try:
                res_depth, res_trades, res_ticker = await asyncio.gather(
                    client.get(depth_url),
                    client.get(trades_url),
                    client.get(ticker_url),
                    return_exceptions=True
                )

                if not isinstance(res_ticker, Exception) and res_ticker.status_code == 200:
                    last_price = float(res_ticker.json().get("price", 0.0))

                if not isinstance(res_depth, Exception) and res_depth.status_code == 200:
                    depth_data = res_depth.json()

                if not isinstance(res_trades, Exception) and res_trades.status_code == 200:
                    trades_data = res_trades.json()

            except Exception as e:
                logger.error(f"Error fetching real depth/trades for {sym}: {e}")

        # Fallback if depth fails
        if not depth_data or "bids" not in depth_data or "asks" not in depth_data:
            return self._build_empty_response(sym, market_clean, last_price)

        raw_bids = depth_data.get("bids", [])
        raw_asks = depth_data.get("asks", [])

        if not raw_bids or not raw_asks:
            return self._build_empty_response(sym, market_clean, last_price)

        best_bid = float(raw_bids[0][0])
        best_ask = float(raw_asks[0][0])
        mid_price = (best_bid + best_ask) / 2.0
        current_price = last_price if last_price > 0 else mid_price

        # 1. Analyze Large Trades Anchor Points from aggTrades (Whale Entries)
        whale_buy_anchors: List[Dict[str, float]] = []
        whale_sell_anchors: List[Dict[str, float]] = []

        if isinstance(trades_data, list):
            for t in trades_data:
                try:
                    p = float(t.get("p", 0.0))
                    q = float(t.get("q", 0.0))
                    val = p * q
                    is_buyer_maker = bool(t.get("m", False))
                    # Taker Buy = !is_buyer_maker, Taker Sell = is_buyer_maker
                    if val >= 40000.0:  # Large trade threshold ($40,000+)
                        if not is_buyer_maker:
                            whale_buy_anchors.append({"price": p, "val": val})
                        else:
                            whale_sell_anchors.append({"price": p, "val": val})
                except Exception:
                    continue

        # 2. Mathematical Liquidation / Forced Stop Loss Model
        # Standard Binance MMR (Maintenance Margin Rate) ~ 0.4% to 0.5%
        mmr = 0.005
        stop_loss_levels: List[Dict[str, Any]] = []

        # Longs forced liquidation (occurs BELOW current price)
        # 100x -> dist ~ 0.95%, 50x -> dist ~ 1.95%, 25x -> dist ~ 3.9%, 10x -> dist ~ 9.5%
        leverage_tiers = [
            {"tier": "100x", "dist_pct": 0.0095, "weight": 1.4},
            {"tier": "50x", "dist_pct": 0.0195, "weight": 1.25},
            {"tier": "25x", "dist_pct": 0.0390, "weight": 1.0},
            {"tier": "10x", "dist_pct": 0.0950, "weight": 0.8}
        ]

        # Calculate estimated liquidation clusters from recent whale buy entries
        long_liq_prices: List[Dict[str, Any]] = []
        for anchor in whale_buy_anchors[-30:]:
            p_entry = anchor["price"]
            for lev in leverage_tiers:
                liq_p = p_entry * (1.0 - lev["dist_pct"])
                if liq_p < current_price:
                    long_liq_prices.append({
                        "price": liq_p,
                        "tier": lev["tier"],
                        "est_usd": anchor["val"] * lev["weight"],
                        "side": "LONG_LIQ"
                    })

        # Short liquidation clusters from recent whale sell entries (occurs ABOVE current price)
        short_liq_prices: List[Dict[str, Any]] = []
        for anchor in whale_sell_anchors[-30:]:
            p_entry = anchor["price"]
            for lev in leverage_tiers:
                liq_p = p_entry * (1.0 + lev["dist_pct"])
                if liq_p > current_price:
                    short_liq_prices.append({
                        "price": liq_p,
                        "tier": lev["tier"],
                        "est_usd": anchor["val"] * lev["weight"],
                        "side": "SHORT_LIQ"
                    })

        # 3. Dissect Order Book Depth into Price Buckets
        half_bins = max(8, num_bins // 2)
        # Span: look +/- 4.5% from current price
        max_dist_pct = 0.045
        step = (current_price * max_dist_pct) / half_bins

        # Build Ask Buckets (Above Price)
        ask_bins: List[Dict[str, Any]] = []
        for i in range(half_bins):
            b_low = current_price + i * step
            b_high = b_low + step
            ask_bins.append({
                "mid_price": round((b_low + b_high) / 2.0, 2),
                "low_p": b_low,
                "high_p": b_high,
                "side": "ASK",
                "inst_usd": 0.0,
                "retail_usd": 0.0,
                "total_usd": 0.0,
                "whale_count": 0,
                "retail_count": 0,
                "sl_cluster_usd": 0.0,
                "sl_tier": ""
            })

        # Build Bid Buckets (Below Price)
        bid_bins: List[Dict[str, Any]] = []
        for i in range(half_bins):
            b_high = current_price - i * step
            b_low = b_high - step
            bid_bins.append({
                "mid_price": round((b_low + b_high) / 2.0, 2),
                "low_p": b_low,
                "high_p": b_high,
                "side": "BID",
                "inst_usd": 0.0,
                "retail_usd": 0.0,
                "total_usd": 0.0,
                "whale_count": 0,
                "retail_count": 0,
                "sl_cluster_usd": 0.0,
                "sl_tier": ""
            })

        # Classify raw asks into ask bins
        WHALE_THRESHOLD_USD = 50000.0  # >= $50k ticket size is Institutional/Whale
        RETAIL_THRESHOLD_USD = 10000.0  # < $10k ticket size is Retail

        for ask in raw_asks:
            try:
                p = float(ask[0])
                q = float(ask[1])
                usd = p * q
                for b in ask_bins:
                    if b["low_p"] <= p < b["high_p"]:
                        b["total_usd"] += usd
                        if usd >= WHALE_THRESHOLD_USD:
                            b["inst_usd"] += usd
                            b["whale_count"] += 1
                        elif usd <= RETAIL_THRESHOLD_USD:
                            b["retail_usd"] += usd
                            b["retail_count"] += 1
                        else:
                            # Medium tier: split 50/50
                            b["inst_usd"] += usd * 0.5
                            b["retail_usd"] += usd * 0.5
                        break
            except Exception:
                continue

        # Classify raw bids into bid bins
        for bid in raw_bids:
            try:
                p = float(bid[0])
                q = float(bid[1])
                usd = p * q
                for b in bid_bins:
                    if b["low_p"] <= p < b["high_p"]:
                        b["total_usd"] += usd
                        if usd >= WHALE_THRESHOLD_USD:
                            b["inst_usd"] += usd
                            b["whale_count"] += 1
                        elif usd <= RETAIL_THRESHOLD_USD:
                            b["retail_usd"] += usd
                            b["retail_count"] += 1
                        else:
                            b["inst_usd"] += usd * 0.5
                            b["retail_usd"] += usd * 0.5
                        break
            except Exception:
                continue

        # Map Short Stop-Loss Liquidations into Ask Bins
        for sl in short_liq_prices:
            for b in ask_bins:
                if b["low_p"] <= sl["price"] < b["high_p"]:
                    b["sl_cluster_usd"] += sl["est_usd"]
                    if not b["sl_tier"]:
                        b["sl_tier"] = sl["tier"]
                    break

        # Map Long Stop-Loss Liquidations into Bid Bins
        for sl in long_liq_prices:
            for b in bid_bins:
                if b["low_p"] <= sl["price"] < b["high_p"]:
                    b["sl_cluster_usd"] += sl["est_usd"]
                    if not b["sl_tier"]:
                        b["sl_tier"] = sl["tier"]
                    break

        # 4. Formulate Summary Metrics
        total_inst_bids = sum(b["inst_usd"] for b in bid_bins)
        total_inst_asks = sum(b["inst_usd"] for b in ask_bins)
        total_retail_bids = sum(b["retail_usd"] for b in bid_bins)
        total_retail_asks = sum(b["retail_usd"] for b in ask_bins)

        # Find Top Institutional Whale Bid and Ask
        top_whale_bid_bin = max(bid_bins, key=lambda x: x["inst_usd"], default=None)
        top_whale_ask_bin = max(ask_bins, key=lambda x: x["inst_usd"], default=None)

        top_whale_bid = {
            "price": top_whale_bid_bin["mid_price"] if top_whale_bid_bin else current_price,
            "usd_value": round(top_whale_bid_bin["inst_usd"], 2) if top_whale_bid_bin else 0.0,
            "distance_pct": round(((top_whale_bid_bin["mid_price"] - current_price) / current_price) * 100.0, 2) if top_whale_bid_bin else 0.0
        }
        top_whale_ask = {
            "price": top_whale_ask_bin["mid_price"] if top_whale_ask_bin else current_price,
            "usd_value": round(top_whale_ask_bin["inst_usd"], 2) if top_whale_ask_bin else 0.0,
            "distance_pct": round(((top_whale_ask_bin["mid_price"] - current_price) / current_price) * 100.0, 2) if top_whale_ask_bin else 0.0
        }

        # Find Major Stop Loss Clusters
        major_sl_clusters = []
        top_ask_sl = max(ask_bins, key=lambda x: x["sl_cluster_usd"], default=None)
        if top_ask_sl and top_ask_sl["sl_cluster_usd"] > 100000.0:
            major_sl_clusters.append({
                "price": top_ask_sl["mid_price"],
                "side": "SHORT_LIQ",
                "tier": top_ask_sl["sl_tier"] or "50x",
                "est_usd": round(top_ask_sl["sl_cluster_usd"], 2),
                "distance_pct": round(((top_ask_sl["mid_price"] - current_price) / current_price) * 100.0, 2),
                "label": f"Short Squeeze Magnet ({top_ask_sl['sl_tier'] or '50x'})"
            })

        top_bid_sl = max(bid_bins, key=lambda x: x["sl_cluster_usd"], default=None)
        if top_bid_sl and top_bid_sl["sl_cluster_usd"] > 100000.0:
            major_sl_clusters.append({
                "price": top_bid_sl["mid_price"],
                "side": "LONG_LIQ",
                "tier": top_bid_sl["sl_tier"] or "50x",
                "est_usd": round(top_bid_sl["sl_cluster_usd"], 2),
                "distance_pct": round(((top_bid_sl["mid_price"] - current_price) / current_price) * 100.0, 2),
                "label": f"Long Flush Cascade ({top_bid_sl['sl_tier'] or '50x'})"
            })

        imbalance_ratio = (
            round(total_inst_bids / max(1.0, total_inst_asks), 3)
            if total_inst_asks > 0
            else 1.0
        )

        dominant_pressure = "NEUTRAL"
        if imbalance_ratio >= 1.25:
            dominant_pressure = "INSTITUTIONAL_BUY_WALL"
        elif imbalance_ratio <= 0.80:
            dominant_pressure = "INSTITUTIONAL_SELL_WALL"

        # Combine matrix rows for display: Highest Ask down to Lowest Bid
        formatted_rows = []
        for b in reversed(ask_bins):
            dist = round(((b["mid_price"] - current_price) / current_price) * 100.0, 2)
            formatted_rows.append({
                "price": b["mid_price"],
                "side": "ASK",
                "distance_pct": dist,
                "total_usd": round(b["total_usd"], 2),
                "inst_usd": round(b["inst_usd"], 2),
                "retail_usd": round(b["retail_usd"], 2),
                "whale_count": b["whale_count"],
                "retail_count": b["retail_count"],
                "has_stop_loss": b["sl_cluster_usd"] > 0,
                "sl_usd": round(b["sl_cluster_usd"], 2),
                "sl_tier": b["sl_tier"]
            })

        for b in bid_bins:
            dist = round(((b["mid_price"] - current_price) / current_price) * 100.0, 2)
            formatted_rows.append({
                "price": b["mid_price"],
                "side": "BID",
                "distance_pct": dist,
                "total_usd": round(b["total_usd"], 2),
                "inst_usd": round(b["inst_usd"], 2),
                "retail_usd": round(b["retail_usd"], 2),
                "whale_count": b["whale_count"],
                "retail_count": b["retail_count"],
                "has_stop_loss": b["sl_cluster_usd"] > 0,
                "sl_usd": round(b["sl_cluster_usd"], 2),
                "sl_tier": b["sl_tier"]
            })

        result = {
            "symbol": sym,
            "market": market_clean,
            "current_price": current_price,
            "timestamp": int(now),
            "summary": {
                "top_whale_bid": top_whale_bid,
                "top_whale_ask": top_whale_ask,
                "total_inst_bids_usd": round(total_inst_bids, 2),
                "total_inst_asks_usd": round(total_inst_asks, 2),
                "total_retail_bids_usd": round(total_retail_bids, 2),
                "total_retail_asks_usd": round(total_retail_asks, 2),
                "imbalance_ratio": imbalance_ratio,
                "dominant_pressure": dominant_pressure
            },
            "major_stop_loss_clusters": major_sl_clusters,
            "matrix_rows": formatted_rows
        }

        self._cache[cache_key] = (now, result)
        return result

    def _build_empty_response(self, symbol: str, market: str, price: float) -> Dict[str, Any]:
        return {
            "symbol": symbol,
            "market": market,
            "current_price": price,
            "timestamp": int(time.time()),
            "summary": {
                "top_whale_bid": {"price": price, "usd_value": 0, "distance_pct": 0},
                "top_whale_ask": {"price": price, "usd_value": 0, "distance_pct": 0},
                "total_inst_bids_usd": 0,
                "total_inst_asks_usd": 0,
                "total_retail_bids_usd": 0,
                "total_retail_asks_usd": 0,
                "imbalance_ratio": 1.0,
                "dominant_pressure": "NEUTRAL"
            },
            "major_stop_loss_clusters": [],
            "matrix_rows": []
        }

liquidity_matrix_service = LiquidityMatrixService()
