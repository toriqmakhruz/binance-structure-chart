from typing import List, Dict, Any
from ...models.schemas import Candle
from ...models.iti_schemas import ITISLHunterFeatures

class ITISLHunterEngine:
    """
    Engine 3: Stop Loss Hunter & Liquidity Sweep / Fakeout Detector.
    Identifies:
      - Stop loss hunting wick sweeps (Wick Rejection)
      - Candle Reclaims of key liquidity levels
      - Volume spikes during stop sweeps (Smart Money Absorption)
      - False Breakout Probability Score
    """
    def analyze(self, candles: List[Candle], bsl_price: float, ssl_price: float) -> ITISLHunterFeatures:
        if not candles or len(candles) < 10:
            return ITISLHunterFeatures()

        n = len(candles)
        last_c = candles[-1]
        prev_c = candles[-2] if n >= 2 else last_c

        sweep_type = "NONE"
        sweep_price = 0.0
        reclaim_confirmed = False
        reclaim_price = 0.0
        absorption = False
        score = 0.0

        avg_vol = sum(c.volume for c in candles[-15:]) / max(1, min(15, n))

        # Check Bear Trap Sweep (Sweep of SSL / Lows below, followed by reclaim above)
        if ssl_price > 0:
            for i in range(n - 1, max(0, n - 6), -1):
                c = candles[i]
                if c.low < ssl_price and c.close > ssl_price:
                    sweep_type = "BEAR_TRAP_SWEEP"
                    sweep_price = c.low
                    reclaim_price = ssl_price
                    reclaim_confirmed = last_c.close > ssl_price
                    absorption = c.volume >= avg_vol * 1.25
                    score = 75.0 if reclaim_confirmed else 50.0
                    if absorption:
                        score += 20.0
                    break

        # Check Bull Trap Sweep (Sweep of BSL / Highs above, followed by drop below)
        if sweep_type == "NONE" and bsl_price > 0:
            for i in range(n - 1, max(0, n - 6), -1):
                c = candles[i]
                if c.high > bsl_price and c.close < bsl_price:
                    sweep_type = "BULL_TRAP_SWEEP"
                    sweep_price = c.high
                    reclaim_price = bsl_price
                    reclaim_confirmed = last_c.close < bsl_price
                    absorption = c.volume >= avg_vol * 1.25
                    score = 75.0 if reclaim_confirmed else 50.0
                    if absorption:
                        score += 20.0
                    break

        return ITISLHunterFeatures(
            last_sweep_type=sweep_type,
            sweep_price=round(sweep_price, 2),
            reclaim_confirmed=reclaim_confirmed,
            reclaim_price=round(reclaim_price, 2),
            absorption_confirmed=absorption,
            false_breakout_score=min(100.0, score)
        )

sl_hunter_engine = ITISLHunterEngine()
