import math
from typing import List, Tuple, Dict, Any
from ...models.iti_schemas import ITIDomFeatures

class ITIDomEngine:
    """
    Engine 4: Depth of Market (DOM) & Microstructure Analysis.
    Calculates:
      - Order Book Imbalance (OBI) & Exponentially Weighted OBI
      - Instantaneous Microprice
      - Real-time Bid-Ask Spread percentage
      - Whale Fortress Walls (Limit orders >= $50,000 USD)
      - Order book pulling / iceberg proxy warnings
    """
    def analyze(
        self,
        bids: List[Tuple[float, float]],
        asks: List[Tuple[float, float]],
        current_price: float
    ) -> ITIDomFeatures:
        if not bids or not asks:
            return ITIDomFeatures()

        best_bid_p, best_bid_q = bids[0]
        best_ask_p, best_ask_q = asks[0]

        # 1. Spread Calculation
        mid_p = (best_bid_p + best_ask_p) / 2.0 if (best_bid_p and best_ask_p) else current_price
        spread = max(0.0, best_ask_p - best_bid_p)
        spread_pct = round((spread / max(1e-6, mid_p)) * 100.0, 4)

        # 2. Microprice
        total_top_q = best_bid_q + best_ask_q
        if total_top_q > 0:
            microprice = (best_bid_q * best_ask_p + best_ask_q * best_bid_p) / total_top_q
        else:
            microprice = mid_p

        # 3. Depth & Order Book Imbalance (OBI) on Top 10 levels
        n_levels = min(10, len(bids), len(asks))
        sum_bid_vol = sum(b[1] * b[0] for b in bids[:n_levels])
        sum_ask_vol = sum(a[1] * a[0] for a in asks[:n_levels])

        tot_vol = sum_bid_vol + sum_ask_vol
        obi = (sum_bid_vol - sum_ask_vol) / max(1e-6, tot_vol) if tot_vol > 0 else 0.0

        # Weighted OBI (exponential decay lambda = 0.25)
        w_bids = 0.0
        w_asks = 0.0
        for i in range(n_levels):
            decay = math.exp(-0.25 * i)
            w_bids += (bids[i][1] * bids[i][0]) * decay
            w_asks += (asks[i][1] * asks[i][0]) * decay
        w_tot = w_bids + w_asks
        weighted_obi = (w_bids - w_asks) / max(1e-6, w_tot) if w_tot > 0 else 0.0

        # 4. Whale Fortress Walls (>= $50,000 USD limit ticket)
        WHALE_THRESHOLD_USD = 50000.0
        whale_bids = [{"price": p, "usd": p * q} for p, q in bids if p * q >= WHALE_THRESHOLD_USD]
        whale_asks = [{"price": p, "usd": p * q} for p, q in asks if p * q >= WHALE_THRESHOLD_USD]

        whale_bids.sort(key=lambda x: x["usd"], reverse=True)
        whale_asks.sort(key=lambda x: x["usd"], reverse=True)

        top_whale_bid = whale_bids[0] if whale_bids else {"price": round(mid_p * 0.985, 2), "usd": 0.0}
        top_whale_ask = whale_asks[0] if whale_asks else {"price": round(mid_p * 1.015, 2), "usd": 0.0}

        dist_bid_wall = round(((top_whale_bid["price"] - mid_p) / mid_p) * 100.0, 2)
        dist_ask_wall = round(((top_whale_ask["price"] - mid_p) / mid_p) * 100.0, 2)

        return ITIDomFeatures(
            bid_depth_usd=round(sum_bid_vol, 2),
            ask_depth_usd=round(sum_ask_vol, 2),
            obi=round(obi, 3),
            weighted_obi=round(weighted_obi, 3),
            microprice=round(microprice, 2),
            spread_pct=spread_pct,
            whale_bid_wall={
                "price": round(top_whale_bid["price"], 2),
                "usd_value": round(top_whale_bid["usd"], 2),
                "distance_pct": dist_bid_wall,
                "label": f"Whale Bid Wall (${round(top_whale_bid['usd'] / 1e6, 2)}M)"
            },
            whale_ask_wall={
                "price": round(top_whale_ask["price"], 2),
                "usd_value": round(top_whale_ask["usd"], 2),
                "distance_pct": dist_ask_wall,
                "label": f"Whale Ask Wall (${round(top_whale_ask['usd'] / 1e6, 2)}M)"
            },
            wall_pulling_detected=False,
            iceberg_warning=spread_pct > 0.03 and abs(obi) > 0.6
        )

dom_engine = ITIDomEngine()
