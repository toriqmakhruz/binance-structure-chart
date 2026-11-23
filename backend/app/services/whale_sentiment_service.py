import asyncio
import time
import logging
from typing import Dict, Any, List, Optional, Tuple
import httpx
from ..config import settings
from .binance_service import HEADERS

logger = logging.getLogger("whale_sentiment_service")

class WhaleSentimentService:
    def __init__(self):
        self._cache: Dict[str, Tuple[float, Dict[str, Any]]] = {}
        self._cache_ttl = 5.0  # 5 seconds live cache

    async def get_sentiment_matrix(
        self,
        symbol: str = "BTCUSDT",
        market: str = "futures",
        period: str = "5m"
    ) -> Dict[str, Any]:
        """
        Fetch real-time Binance Futures derivative sentiment:
        1. Top Trader Long/Short Position Ratio (Whale Contract Volume)
        2. Top Trader Long/Short Account Ratio (Whale Trader Count)
        3. Global Long/Short Account Ratio (Retail Trader Crowd)
        4. Taker Long/Short Ratio (Aggressive Market Order Volume)
        """
        sym = symbol.upper().strip()
        market_clean = market.lower().strip()
        cache_key = f"{sym}_{market_clean}_{period}"
        now = time.time()

        if cache_key in self._cache:
            ts, cached_data = self._cache[cache_key]
            if now - ts < self._cache_ttl:
                return cached_data

        timeout = httpx.Timeout(6.0, connect=3.0)
        base_fapi = "https://fapi.binance.com/futures/data"

        # Endpoints (Fetch last 6 candles of 5m/15m data to compute 30m delta trend)
        top_pos_url = f"{base_fapi}/topLongShortPositionRatio?symbol={sym}&period={period}&limit=6"
        top_acc_url = f"{base_fapi}/topLongShortAccountRatio?symbol={sym}&period={period}&limit=6"
        global_acc_url = f"{base_fapi}/globalLongShortAccountRatio?symbol={sym}&period={period}&limit=6"
        taker_url = f"{base_fapi}/takerlongshortRatio?symbol={sym}&period={period}&limit=6"

        top_pos_data: List[Dict[str, Any]] = []
        top_acc_data: List[Dict[str, Any]] = []
        global_acc_data: List[Dict[str, Any]] = []
        taker_data: List[Dict[str, Any]] = []

        try:
            async with httpx.AsyncClient(headers=HEADERS, timeout=timeout, verify=settings.TLS_VERIFY) as client:
                res_pos, res_acc, res_gl, res_tk = await asyncio.gather(
                    client.get(top_pos_url),
                    client.get(top_acc_url),
                    client.get(global_acc_url),
                    client.get(taker_url),
                    return_exceptions=True
                )

                if not isinstance(res_pos, Exception) and res_pos.status_code == 200:
                    top_pos_data = res_pos.json() or []
                if not isinstance(res_acc, Exception) and res_acc.status_code == 200:
                    top_acc_data = res_acc.json() or []
                if not isinstance(res_gl, Exception) and res_gl.status_code == 200:
                    global_acc_data = res_gl.json() or []
                if not isinstance(res_tk, Exception) and res_tk.status_code == 200:
                    taker_data = res_tk.json() or []

        except Exception as e:
            logger.error(f"Error fetching sentiment matrix from Binance for {sym}: {e}")

        # Fallback values if API returns empty
        latest_pos = top_pos_data[-1] if top_pos_data else {}
        first_pos = top_pos_data[0] if len(top_pos_data) > 1 else latest_pos

        latest_acc = top_acc_data[-1] if top_acc_data else {}
        latest_gl = global_acc_data[-1] if global_acc_data else {}
        first_gl = global_acc_data[0] if len(global_acc_data) > 1 else latest_gl

        latest_tk = taker_data[-1] if taker_data else {}

        # 1. Whale Position (Top Trader Position)
        whale_pos_long_pct = round(float(latest_pos.get("longPosition", 0.50)) * 100.0, 1)
        whale_pos_short_pct = round(float(latest_pos.get("shortPosition", 0.50)) * 100.0, 1)
        whale_pos_ratio = round(float(latest_pos.get("longShortRatio", 1.0)), 2)

        prev_whale_pos_long = float(first_pos.get("longPosition", latest_pos.get("longPosition", 0.50))) * 100.0
        whale_pos_delta = round(whale_pos_long_pct - prev_whale_pos_long, 1)

        # 2. Whale Accounts (Top Trader Accounts)
        whale_acc_long_pct = round(float(latest_acc.get("longAccount", 0.50)) * 100.0, 1)
        whale_acc_short_pct = round(float(latest_acc.get("shortAccount", 0.50)) * 100.0, 1)
        whale_acc_ratio = round(float(latest_acc.get("longShortRatio", 1.0)), 2)

        # 3. Retail Accounts (Global Retail Accounts)
        retail_long_pct = round(float(latest_gl.get("longAccount", 0.50)) * 100.0, 1)
        retail_short_pct = round(float(latest_gl.get("shortAccount", 0.50)) * 100.0, 1)
        retail_ratio = round(float(latest_gl.get("longShortRatio", 1.0)), 2)

        prev_retail_long = float(first_gl.get("longAccount", latest_gl.get("longAccount", 0.50))) * 100.0
        retail_delta = round(retail_long_pct - prev_retail_long, 1)

        # 4. Taker Buy/Sell Aggression
        b_vol = float(latest_tk.get("buyVol", 1.0))
        s_vol = float(latest_tk.get("sellVol", 1.0))
        tot_vol = max(1e-6, b_vol + s_vol)
        taker_buy_pct = round((b_vol / tot_vol) * 100.0, 1)
        taker_sell_pct = round((s_vol / tot_vol) * 100.0, 1)
        taker_ratio = round(float(latest_tk.get("buySellRatio", 1.0)), 2)

        # 5. Smart Money Divergence Analysis
        # Divergence delta: positive when Whales are more Long than Retail
        divergence_delta = round(whale_pos_long_pct - retail_long_pct, 1)

        # Determine Regime, Confidence & Actionable Guidance
        if whale_pos_long_pct >= 58.0 and retail_long_pct <= 49.0:
            regime = "WHALE_LONG_DIVERGENCE"
            badge_label = "🔥 WHALE LONG DIVERGENCE"
            bias = "BULLISH_EDGE"
            confidence = min(95, int(60 + (whale_pos_long_pct - 50) * 2.0 + (50 - retail_long_pct) * 1.5))
            action_advice = f"Smart Money akumulasi LONG (+{whale_pos_long_pct}%), Retail pasang SHORT. Potensi forced covering / Short Squeeze pump."
        elif whale_pos_long_pct <= 42.0 and retail_long_pct >= 52.0:
            regime = "WHALE_SHORT_DIVERGENCE"
            badge_label = "🔴 WHALE SHORT DIVERGENCE"
            bias = "BEARISH_EDGE"
            confidence = min(95, int(60 + (50 - whale_pos_long_pct) * 2.0 + (retail_long_pct - 50) * 1.5))
            action_advice = f"Smart Money pasang SHORT ({whale_pos_short_pct}%), Retail FOMO LONG. Rawan pembantaian likuidasi long dump."
        elif whale_pos_long_pct >= 62.0 and retail_long_pct >= 62.0:
            regime = "CROWDED_LONGS"
            badge_label = "⚠️ OVERLEVERAGED LONGS"
            bias = "HIGH_RISK_FLUSH"
            confidence = 75
            action_advice = "Pasar terlalu padat posisi Long (Paus & Retail kompak Long). Sangat rawan terjadi flush / long liquidation mendadak."
        elif whale_pos_long_pct <= 38.0 and retail_long_pct <= 38.0:
            regime = "CROWDED_SHORTS"
            badge_label = "⚡ OVERLEVERAGED SHORTS"
            bias = "HIGH_RISK_SQUEEZE"
            confidence = 75
            action_advice = "Pasar terlalu padat posisi Short. Biaya pinjam mahal, sangat rawan lonjakan Short Squeeze mendadak."
        elif taker_buy_pct >= 56.0:
            regime = "TAKER_BUY_AGGRESSION"
            badge_label = "🟢 TAKER BUY DOMINAN"
            bias = "BULLISH_PRESSURE"
            confidence = 68
            action_advice = "Order market hajar kanan (Taker Buy) lebih agresif dari seller. Menunjukkan dorongan volume instan."
        elif taker_sell_pct >= 56.0:
            regime = "TAKER_SELL_AGGRESSION"
            badge_label = "🔴 TAKER SELL DOMINAN"
            bias = "BEARISH_PRESSURE"
            confidence = 68
            action_advice = "Order market hajar kiri (Taker Sell) dominan. Menunjukkan tekanan jual mendadak."
        else:
            regime = "BALANCED_ACCUMULATION"
            badge_label = "⚖️ NETRAL / SEIMBANG"
            bias = "NEUTRAL"
            confidence = 50
            action_advice = "Posisi Paus dan Retail relatif seimbang. Tunggu divergensi yang lebih jelas sebelum ambil posisi besar."

        result = {
            "symbol": sym,
            "market": market_clean,
            "period": period,
            "updated_at": int(now),
            "regime": regime,
            "badge_label": badge_label,
            "bias": bias,
            "confidence": confidence,
            "divergence_delta": divergence_delta,
            "action_advice": action_advice,
            "whale_position": {
                "long_pct": whale_pos_long_pct,
                "short_pct": whale_pos_short_pct,
                "ratio": whale_pos_ratio,
                "delta_30m": whale_pos_delta
            },
            "whale_accounts": {
                "long_pct": whale_acc_long_pct,
                "short_pct": whale_acc_short_pct,
                "ratio": whale_acc_ratio
            },
            "retail_accounts": {
                "long_pct": retail_long_pct,
                "short_pct": retail_short_pct,
                "ratio": retail_ratio,
                "delta_30m": retail_delta
            },
            "taker_aggression": {
                "buy_pct": taker_buy_pct,
                "sell_pct": taker_sell_pct,
                "ratio": taker_ratio
            }
        }

        self._cache[cache_key] = (now, result)
        return result

whale_sentiment_service = WhaleSentimentService()
