import math
from typing import List, Dict, Any, Optional
from ...models.schemas import Candle
from ...models.iti_schemas import ITISmcFeatures

class ITISmcEngine:
    """
    Engine 1: Smart Money Concepts (SMC) & Market Structure.
    Analyzes:
      - Swings (HH, HL, LH, LL)
      - Break of Structure (BOS) vs Change of Character (CHoCH)
      - Market Structure Shift (MSS) with displacement
      - Institutional Order Blocks (OB) & Fair Value Gaps (FVG)
      - Premium vs Discount Range (Equilibrium)
    """
    def analyze(self, candles: List[Candle]) -> ITISmcFeatures:
        if not candles or len(candles) < 15:
            return ITISmcFeatures()

        n = len(candles)
        closes = [c.close for c in candles]
        highs = [c.high for c in candles]
        lows = [c.low for c in candles]
        volumes = [c.volume for c in candles]

        # 1. Swing Highs & Lows (5-bar pivot window)
        swing_highs = []
        swing_lows = []
        pivot_window = 3

        for i in range(pivot_window, n - pivot_window):
            is_high = True
            is_low = True
            for k in range(1, pivot_window + 1):
                if highs[i] <= highs[i - k] or highs[i] <= highs[i + k]:
                    is_high = False
                if lows[i] >= lows[i - k] or lows[i] >= lows[i + k]:
                    is_low = False
            if is_high:
                swing_highs.append({"index": i, "time": candles[i].time, "price": highs[i]})
            if is_low:
                swing_lows.append({"index": i, "time": candles[i].time, "price": lows[i]})

        last_sh = swing_highs[-1]["price"] if swing_highs else max(highs[-10:])
        last_sl = swing_lows[-1]["price"] if swing_lows else min(lows[-10:])

        # 2. Market Structure & Displacement
        current_price = closes[-1]
        range_span = max(1e-6, last_sh - last_sl)
        eq_level = (last_sh + last_sl) / 2.0

        # Premium vs Discount
        if current_price > eq_level + range_span * 0.1:
            prem_disc = "PREMIUM"
        elif current_price < eq_level - range_span * 0.1:
            prem_disc = "DISCOUNT"
        else:
            prem_disc = "EQUILIBRIUM"

        # Displacement score (magnitude of recent candle body compared to ATR)
        recent_bodies = [abs(candles[i].close - candles[i].open) for i in range(max(0, n - 10), n)]
        avg_body = sum(recent_bodies) / max(1, len(recent_bodies))
        last_body = abs(candles[-1].close - candles[-1].open)
        displacement_score = min(100.0, round((last_body / max(1e-6, avg_body)) * 50.0, 1))

        # 3. Structure Shift (MSS)
        structure = "RANGING"
        last_bos = None
        last_choch = None

        if len(swing_highs) >= 2 and len(swing_lows) >= 2:
            prev_sh = swing_highs[-2]["price"]
            prev_sl = swing_lows[-2]["price"]

            if current_price > last_sh:
                structure = "BULLISH_MSS" if last_sl > prev_sl else "BULLISH_CONTINUATION"
                last_bos = {"price": last_sh, "type": "BULLISH", "time": candles[-1].time}
            elif current_price < last_sl:
                structure = "BEARISH_MSS" if last_sh < prev_sh else "BEARISH_CONTINUATION"
                last_choch = {"price": last_sl, "type": "BEARISH", "time": candles[-1].time}
            elif last_sh > prev_sh and last_sl > prev_sl:
                structure = "BULLISH_CONTINUATION"
            elif last_sh < prev_sh and last_sl < prev_sl:
                structure = "BEARISH_CONTINUATION"

        # 4. Active Order Block (OB)
        active_ob = None
        for i in range(n - 2, max(0, n - 25), -1):
            c = candles[i]
            # Bullish OB: down candle followed by strong bullish displacement
            if c.close < c.open and candles[i + 1].close > c.high:
                if current_price >= c.low:  # Unmitigated / holding
                    active_ob = {
                        "type": "BULLISH",
                        "high": round(c.high, 2),
                        "low": round(c.low, 2),
                        "time": c.time,
                        "mitigated": current_price < c.low
                    }
                    break
            # Bearish OB: up candle followed by strong bearish displacement
            elif c.close > c.open and candles[i + 1].close < c.low:
                if current_price <= c.high:
                    active_ob = {
                        "type": "BEARISH",
                        "high": round(c.high, 2),
                        "low": round(c.low, 2),
                        "time": c.time,
                        "mitigated": current_price > c.high
                    }
                    break

        # 5. Fair Value Gap (FVG)
        active_fvg = None
        for i in range(n - 2, max(1, n - 20), -1):
            c_prev = candles[i - 1]
            c_next = candles[i + 1]
            # Bullish FVG: low of candle i+1 > high of candle i-1
            if c_next.low > c_prev.high:
                active_fvg = {
                    "type": "BULLISH",
                    "top": round(c_next.low, 2),
                    "bottom": round(c_prev.high, 2),
                    "time": candles[i].time,
                    "mitigated": current_price <= c_prev.high
                }
                break
            # Bearish FVG: high of candle i+1 < low of candle i-1
            elif c_next.high < c_prev.low:
                active_fvg = {
                    "type": "BEARISH",
                    "top": round(c_prev.low, 2),
                    "bottom": round(c_next.high, 2),
                    "time": candles[i].time,
                    "mitigated": current_price >= c_prev.low
                }
                break

        return ITISmcFeatures(
            current_structure=structure,
            swing_high=round(last_sh, 2),
            swing_low=round(last_sl, 2),
            last_bos=last_bos,
            last_choch=last_choch,
            active_ob=active_ob,
            active_fvg=active_fvg,
            premium_discount=prem_disc,
            displacement_score=displacement_score
        )

smc_engine = ITISmcEngine()
