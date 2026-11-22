from typing import List, Dict, Any
from ...models.iti_schemas import ITIFootprintFeatures

class ITIFootprintEngine:
    """
    Engine 5: Footprint & Order Flow (CVD / Volume Delta).
    Calculates:
      - Aggressor buy vs sell classification
      - Bar Volume Delta & Cumulative Volume Delta (CVD)
      - CVD Absorption Divergence (Bullish Absorption vs Bearish Exhaustion)
      - Stacked Imbalance detection (>= 3:1 aggressive buy/sell ratio)
    """
    def analyze(self, trades: List[Dict[str, Any]], current_price: float) -> ITIFootprintFeatures:
        if not trades:
            return ITIFootprintFeatures()

        buy_vol_usd = 0.0
        sell_vol_usd = 0.0
        price_buckets: Dict[float, Dict[str, float]] = {}

        for t in trades:
            usd = t.get("usd", 0.0)
            p = round(t.get("p", current_price), 1)
            is_buyer_maker = t.get("is_buyer_maker", False)

            if p not in price_buckets:
                price_buckets[p] = {"buy": 0.0, "sell": 0.0}

            if not is_buyer_maker:
                buy_vol_usd += usd
                price_buckets[p]["buy"] += usd
            else:
                sell_vol_usd += usd
                price_buckets[p]["sell"] += usd

        tot_vol = buy_vol_usd + sell_vol_usd
        taker_ratio = (buy_vol_usd / max(1e-6, tot_vol)) * 100.0 if tot_vol > 0 else 50.0
        delta = buy_vol_usd - sell_vol_usd

        # Stacked Imbalance (check consecutive price levels with >= 3:1 ratio)
        stacked_buy = False
        stacked_sell = False
        sorted_p = sorted(price_buckets.keys())
        consec_buy = 0
        consec_sell = 0

        for p in sorted_p:
            b = price_buckets[p]["buy"]
            s = price_buckets[p]["sell"]
            if b >= s * 3.0 and b > 20000.0:
                consec_buy += 1
                consec_sell = 0
            elif s >= b * 3.0 and s > 20000.0:
                consec_sell += 1
                consec_buy = 0
            else:
                consec_buy = 0
                consec_sell = 0

            if consec_buy >= 3:
                stacked_buy = True
            if consec_sell >= 3:
                stacked_sell = True

        # CVD Divergence proxy
        cvd_divergence = "NONE"
        if delta < -500000.0 and current_price >= sorted_p[0]:
            cvd_divergence = "BULLISH_ABSORPTION"
        elif delta > 500000.0 and current_price <= sorted_p[-1]:
            cvd_divergence = "BEARISH_EXHAUSTION"

        return ITIFootprintFeatures(
            current_bar_delta=round(delta, 2),
            cvd_value=round(delta, 2),
            cvd_divergence=cvd_divergence,
            stacked_buy_imbalance=stacked_buy,
            stacked_sell_imbalance=stacked_sell,
            taker_aggression_ratio=round(taker_ratio, 1)
        )

footprint_engine = ITIFootprintEngine()
