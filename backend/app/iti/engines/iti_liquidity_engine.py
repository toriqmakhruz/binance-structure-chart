from typing import List, Dict, Any
from ...models.schemas import Candle
from ...models.iti_schemas import ITILiquidityFeatures

class ITILiquidityEngine:
    """
    Engine 2: Liquidity Mapping & Pool Detection.
    Maps:
      - Buy-Side Liquidity (BSL) pools above highs
      - Sell-Side Liquidity (SSL) pools below lows
      - Equal Highs (EQH) / Equal Lows (EQL) resting liquidity
      - Previous Day High (PDH) / Previous Day Low (PDL)
      - Previous Week High (PWH) / Previous Week Low (PWL)
    """
    def analyze(self, candles: List[Candle]) -> ITILiquidityFeatures:
        if not candles or len(candles) < 20:
            return ITILiquidityFeatures()

        current_price = candles[-1].close
        highs = [c.high for c in candles]
        lows = [c.low for c in candles]

        # 1. BSL & SSL Candidate Peaks
        recent_sh = []
        recent_sl = []
        for i in range(2, len(candles) - 2):
            if highs[i] > highs[i - 1] and highs[i] > highs[i - 2] and highs[i] > highs[i + 1] and highs[i] > highs[i + 2]:
                recent_sh.append(highs[i])
            if lows[i] < lows[i - 1] and lows[i] < lows[i - 2] and lows[i] < lows[i + 1] and lows[i] < lows[i + 2]:
                recent_sl.append(lows[i])

        bsl_candidates = [p for p in recent_sh if p > current_price]
        ssl_candidates = [p for p in recent_sl if p < current_price]

        nearest_bsl_price = min(bsl_candidates) if bsl_candidates else max(highs[-24:])
        nearest_ssl_price = max(ssl_candidates) if ssl_candidates else min(lows[-24:])

        dist_bsl_pct = round(((nearest_bsl_price - current_price) / current_price) * 100.0, 2)
        dist_ssl_pct = round(((nearest_ssl_price - current_price) / current_price) * 100.0, 2)

        # 2. Equal Highs (EQH) & Equal Lows (EQL)
        eqh_detected = False
        eqh_price = 0.0
        if len(recent_sh) >= 2:
            for i in range(len(recent_sh) - 1):
                for j in range(i + 1, len(recent_sh)):
                    p1 = recent_sh[i]
                    p2 = recent_sh[j]
                    if abs(p1 - p2) / max(1e-6, p1) <= 0.0008:  # 0.08% tolerance
                        eqh_detected = True
                        eqh_price = round((p1 + p2) / 2.0, 2)
                        break

        eql_detected = False
        eql_price = 0.0
        if len(recent_sl) >= 2:
            for i in range(len(recent_sl) - 1):
                for j in range(i + 1, len(recent_sl)):
                    p1 = recent_sl[i]
                    p2 = recent_sl[j]
                    if abs(p1 - p2) / max(1e-6, p1) <= 0.0008:
                        eql_detected = True
                        eql_price = round((p1 + p2) / 2.0, 2)
                        break

        # 3. Previous Day & Week Proxies (based on bar count or timestamps)
        day_bars = min(len(candles), 96)  # Approx 24h of 15m bars
        pdh = max(c.high for c in candles[-day_bars:])
        pdl = min(c.low for c in candles[-day_bars:])

        week_bars = min(len(candles), 672)  # Approx 7d of 15m bars
        pwh = max(c.high for c in candles[-week_bars:])
        pwl = min(c.low for c in candles[-week_bars:])

        return ITILiquidityFeatures(
            nearest_bsl={
                "price": round(nearest_bsl_price, 2),
                "distance_pct": dist_bsl_pct,
                "label": f"BSL Target ({'+' if dist_bsl_pct > 0 else ''}{dist_bsl_pct}%)"
            },
            nearest_ssl={
                "price": round(nearest_ssl_price, 2),
                "distance_pct": dist_ssl_pct,
                "label": f"SSL Target ({dist_ssl_pct}%)"
            },
            eqh_detected=eqh_detected,
            eqh_price=eqh_price,
            eql_detected=eql_detected,
            eql_price=eql_price,
            pdh=round(pdh, 2),
            pdl=round(pdl, 2),
            pwh=round(pwh, 2),
            pwl=round(pwl, 2)
        )

liquidity_engine = ITILiquidityEngine()
