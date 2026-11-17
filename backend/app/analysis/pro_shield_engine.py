from typing import List, Dict, Any, Optional, Tuple
from ..models.schemas import Candle, SmcAnalysisResult, PatternAnalysisResult
from .utils import dynamic_round

class ProShieldEngine:
    """
    Pro Shield Engine (Modul Terpisah untuk Proteksi Posisi & Anti-Stop Hunt).
    
    Karakteristik & Fitur:
    1. Buffer Stop Loss Dinamis Diperlebar:
       - OB Buffer: 0.8 * ATR di luar batas zona (menghindari sapuan likuiditas wajar).
       - FVG Buffer: 0.75 * ATR di luar batas imbalance.
       - Pattern Buffer: 0.8 * ATR atau min 0.8% di luar puncak/lembah.
    2. Rejection Candle Confirmation (Anti-Falling Knife):
       - Memerlukan ekor penolakan (rejection wick >= 25% dari range candle) atau
         candle reversal yang ditutup berbalik arah sebelum mengaktifkan entry.
    3. Multi-Timeframe Trend Guard:
       - Menyaring setup yang melawan tren Higher Timeframe (HTF 1h/4h).
    4. Optimal Trade Entry (OTE) Zone:
       - Menandai area diskon 50% (Equilibrium) untuk rekomendasi LIMIT order.
    """

    @staticmethod
    def is_rejection_candle(candle: Candle, direction: str) -> bool:
        """
        Validasi apakah candle memiliki ekor penolakan atau merupakan reversal candle,
        bukan candle marubozu impulsif yang sedang menembus zona (falling knife).
        """
        total_range = candle.high - candle.low
        if total_range <= 0:
            return True

        if direction == "LONG":
            lower_wick = min(candle.open, candle.close) - candle.low
            wick_ratio = lower_wick / total_range
            is_green_reversal = candle.close > candle.open and (candle.close - candle.low) / total_range >= 0.50
            return (wick_ratio >= 0.25) or is_green_reversal
        else: # SHORT
            upper_wick = candle.high - max(candle.open, candle.close)
            wick_ratio = upper_wick / total_range
            is_red_reversal = candle.close < candle.open and (candle.high - candle.close) / total_range >= 0.50
            return (wick_ratio >= 0.25) or is_red_reversal

    @classmethod
    def evaluate_candidates(
        cls,
        candles: List[Candle],
        current_price: float,
        last_time: int,
        horizon: int,
        confluence_score: float,
        smc: Optional[SmcAnalysisResult],
        patterns: Optional[PatternAnalysisResult],
        atr: float,
        htf_trend: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        active_candidates: List[Dict[str, Any]] = []
        lookback_candles = 40
        lookback_start = max(0, len(candles) - lookback_candles)

        current_trend = smc.current_trend if smc else ("BULLISH" if confluence_score >= 50 else "BEARISH")
        last_event = smc.events[-1] if (smc and smc.events) else None
        is_bearish_bos = bool(last_event and last_event.type == "BOS" and last_event.direction == "BEARISH")
        is_bullish_bos = bool(last_event and last_event.type == "BOS" and last_event.direction == "BULLISH")

        # 1. Chart Patterns dengan Expanded Buffer
        if patterns and patterns.patterns:
            for p in patterns.patterns:
                if p.status == "CONFIRMED" and p.target_price and p.stop_loss:
                    p_dir = "LONG" if p.type == "BULLISH" else "SHORT"

                    # Multi-Timeframe & BOS Guard
                    if p_dir == "LONG" and (is_bearish_bos or current_trend == "BEARISH" or (htf_trend == "BEARISH")):
                        continue
                    if p_dir == "SHORT" and (is_bullish_bos or current_trend == "BULLISH" or (htf_trend == "BULLISH")):
                        continue

                    last_kp = p.key_points[-1] if p.key_points else {}
                    breakout_time = last_kp.get("time", last_time) if isinstance(last_kp, dict) else getattr(last_kp, "time", last_time)
                    k_idx = next((i for i, c in enumerate(candles) if c.time >= breakout_time), len(candles) - 1)
                    entry_p = dynamic_round(candles[k_idx].close)

                    # Expanded SL: Min 0.8*ATR atau 0.8% jarak dari level invalidasi
                    if p_dir == "LONG":
                        sl = dynamic_round(min(p.stop_loss, entry_p - max(atr * 0.8, entry_p * 0.008)))
                    else:
                        sl = dynamic_round(max(p.stop_loss, entry_p + max(atr * 0.8, entry_p * 0.008)))

                    tp = dynamic_round(p.target_price)
                    denom = max(entry_p * 0.001, abs(entry_p - sl))
                    rr = round(abs(tp - entry_p) / denom, 2)

                    if rr >= 1.5:
                        sub_candles = candles[k_idx:]
                        if p_dir == "LONG":
                            sl_hit = any(c.low <= sl for c in sub_candles)
                            tp_hit = any(c.high >= tp for c in sub_candles)
                        else:
                            sl_hit = any(c.high >= sl for c in sub_candles)
                            tp_hit = any(c.low <= tp for c in sub_candles)

                        if not sl_hit and not tp_hit:
                            active_candidates.append({
                                "direction": p_dir,
                                "entry_time": candles[k_idx].time,
                                "entry_price": entry_p,
                                "entry_zone_high": dynamic_round(entry_p + (atr * 0.2)),
                                "entry_zone_low": dynamic_round(entry_p - (atr * 0.2)),
                                "sl": sl,
                                "tp": tp,
                                "rr": rr,
                                "name": f"🛡️ Pro Shield: Breakout {p.name}",
                                "weight": 85.0
                            })

        # 2. Order Block Mitigation dengan Rejection Wick & 0.8*ATR Buffer
        if smc and smc.order_blocks:
            for ob in smc.order_blocks:
                if ob.direction == "BULLISH":
                    if is_bearish_bos or current_trend == "BEARISH" or (htf_trend == "BEARISH"):
                        continue
                    tap_idx = None
                    for i in range(lookback_start, len(candles)):
                        c = candles[i]
                        if c.time > ob.start_time:
                            if c.low <= (ob.top + atr * 0.15) and c.close >= (ob.bottom - atr * 0.2):
                                # Rejection Check: pastikan candle ada ekor penolakan atau candle hijau
                                if cls.is_rejection_candle(c, "LONG") or (i + 1 < len(candles) and cls.is_rejection_candle(candles[i+1], "LONG")):
                                    tap_idx = i
                                    break
                    if tap_idx is not None:
                        entry_t = candles[tap_idx].time
                        entry_p = dynamic_round(ob.top)
                        # Pro Shield Buffer: 0.8 * ATR di bawah dasar OB
                        sl = dynamic_round(ob.bottom - (atr * 0.8))
                        min_dist = abs(entry_p - sl) * 1.5
                        opposing = [o.bottom for o in smc.order_blocks if o.direction == "BEARISH" and (o.bottom - entry_p) >= min_dist]
                        eqh = [lp.price for lp in smc.liquidity_pools if lp.type == "EQH" and (lp.price - entry_p) >= min_dist]
                        cand_tp = opposing + eqh
                        tp = min(cand_tp) if cand_tp else dynamic_round(entry_p + max(atr * 3.5, abs(entry_p - sl) * 2.0))
                        denom = max(entry_p * 0.001, abs(entry_p - sl))
                        rr = round(abs(tp - entry_p) / denom, 2)

                        if rr >= 1.5:
                            sub_candles = candles[tap_idx:]
                            sl_hit = any(c.low <= sl for c in sub_candles)
                            tp_hit = any(c.high >= tp for c in sub_candles)
                            if not sl_hit and not tp_hit:
                                active_candidates.append({
                                    "direction": "LONG",
                                    "entry_time": entry_t,
                                    "entry_price": entry_p,
                                    "entry_zone_high": dynamic_round(ob.top),
                                    "entry_zone_low": dynamic_round((ob.top + ob.bottom) / 2), # OTE 50% discount
                                    "sl": sl,
                                    "tp": tp,
                                    "rr": rr,
                                    "name": f"🛡️ Pro Shield: Demand OB ({ob.id})",
                                    "weight": 80.0
                                })

                elif ob.direction == "BEARISH":
                    if is_bullish_bos or current_trend == "BULLISH" or (htf_trend == "BULLISH"):
                        continue
                    tap_idx = None
                    for i in range(lookback_start, len(candles)):
                        c = candles[i]
                        if c.time > ob.start_time:
                            if c.high >= (ob.bottom - atr * 0.15) and c.close <= (ob.top + atr * 0.2):
                                if cls.is_rejection_candle(c, "SHORT") or (i + 1 < len(candles) and cls.is_rejection_candle(candles[i+1], "SHORT")):
                                    tap_idx = i
                                    break
                    if tap_idx is not None:
                        entry_t = candles[tap_idx].time
                        entry_p = dynamic_round(ob.bottom)
                        # Pro Shield Buffer: 0.8 * ATR di atas puncak OB
                        sl = dynamic_round(ob.top + (atr * 0.8))
                        min_dist = abs(sl - entry_p) * 1.5
                        opposing = [o.top for o in smc.order_blocks if o.direction == "BULLISH" and (entry_p - o.top) >= min_dist]
                        eql = [lp.price for lp in smc.liquidity_pools if lp.type == "EQL" and (entry_p - lp.price) >= min_dist]
                        cand_tp = opposing + eql
                        tp = max(cand_tp) if cand_tp else dynamic_round(entry_p - max(atr * 3.5, abs(sl - entry_p) * 2.0))
                        denom = max(entry_p * 0.001, abs(sl - entry_p))
                        rr = round(abs(entry_p - tp) / denom, 2)

                        if rr >= 1.5:
                            sub_candles = candles[tap_idx:]
                            sl_hit = any(c.high >= sl for c in sub_candles)
                            tp_hit = any(c.low <= tp for c in sub_candles)
                            if not sl_hit and not tp_hit:
                                active_candidates.append({
                                    "direction": "SHORT",
                                    "entry_time": entry_t,
                                    "entry_price": entry_p,
                                    "entry_zone_high": dynamic_round((ob.top + ob.bottom) / 2),
                                    "entry_zone_low": dynamic_round(ob.bottom),
                                    "sl": sl,
                                    "tp": tp,
                                    "rr": rr,
                                    "name": f"🛡️ Pro Shield: Supply OB ({ob.id})",
                                    "weight": 80.0
                                })

        # 3. Fair Value Gaps (FVG) dengan Rejection Check & 0.75*ATR Buffer
        if smc and smc.fvgs:
            for fvg in smc.fvgs:
                if fvg.direction == "BULLISH":
                    if is_bearish_bos or current_trend == "BEARISH" or (htf_trend == "BEARISH"):
                        continue
                    tap_idx = None
                    for i in range(lookback_start, len(candles)):
                        c = candles[i]
                        if c.time >= fvg.time:
                            if c.low <= (fvg.top + atr * 0.15) and c.close >= (fvg.bottom - atr * 0.2):
                                if cls.is_rejection_candle(c, "LONG"):
                                    tap_idx = i
                                    break
                    if tap_idx is not None:
                        entry_t = candles[tap_idx].time
                        entry_p = dynamic_round(fvg.top)
                        sl = dynamic_round(fvg.bottom - (atr * 0.75))
                        min_dist = abs(entry_p - sl) * 1.5
                        opposing = [o.bottom for o in smc.order_blocks if o.direction == "BEARISH" and (o.bottom - entry_p) >= min_dist]
                        eqh = [lp.price for lp in smc.liquidity_pools if lp.type == "EQH" and (lp.price - entry_p) >= min_dist]
                        cand_tp = opposing + eqh
                        tp = min(cand_tp) if cand_tp else dynamic_round(entry_p + max(atr * 3.5, abs(entry_p - sl) * 2.0))
                        denom = max(entry_p * 0.001, abs(entry_p - sl))
                        rr = round(abs(tp - entry_p) / denom, 2)

                        if rr >= 1.5:
                            sub_candles = candles[tap_idx:]
                            sl_hit = any(c.low <= sl for c in sub_candles)
                            tp_hit = any(c.high >= tp for c in sub_candles)
                            if not sl_hit and not tp_hit:
                                active_candidates.append({
                                    "direction": "LONG",
                                    "entry_time": entry_t,
                                    "entry_price": entry_p,
                                    "entry_zone_high": dynamic_round(fvg.top),
                                    "entry_zone_low": dynamic_round((fvg.top + fvg.bottom) / 2),
                                    "sl": sl,
                                    "tp": tp,
                                    "rr": rr,
                                    "name": f"🛡️ Pro Shield: FVG Discount ({fvg.id})",
                                    "weight": 75.0
                                })

                elif fvg.direction == "BEARISH":
                    if is_bullish_bos or current_trend == "BULLISH" or (htf_trend == "BULLISH"):
                        continue
                    tap_idx = None
                    for i in range(lookback_start, len(candles)):
                        c = candles[i]
                        if c.time >= fvg.time:
                            if c.high >= (fvg.bottom - atr * 0.15) and c.close <= (fvg.top + atr * 0.2):
                                if cls.is_rejection_candle(c, "SHORT"):
                                    tap_idx = i
                                    break
                    if tap_idx is not None:
                        entry_t = candles[tap_idx].time
                        entry_p = dynamic_round(fvg.bottom)
                        sl = dynamic_round(fvg.top + (atr * 0.75))
                        min_dist = abs(sl - entry_p) * 1.5
                        opposing = [o.top for o in smc.order_blocks if o.direction == "BULLISH" and (entry_p - o.top) >= min_dist]
                        eql = [lp.price for lp in smc.liquidity_pools if lp.type == "EQL" and (entry_p - lp.price) >= min_dist]
                        cand_tp = opposing + eql
                        tp = max(cand_tp) if cand_tp else dynamic_round(entry_p - max(atr * 3.5, abs(sl - entry_p) * 2.0))
                        denom = max(entry_p * 0.001, abs(sl - entry_p))
                        rr = round(abs(entry_p - tp) / denom, 2)

                        if rr >= 1.5:
                            sub_candles = candles[tap_idx:]
                            sl_hit = any(c.high >= sl for c in sub_candles)
                            tp_hit = any(c.low <= tp for c in sub_candles)
                            if not sl_hit and not tp_hit:
                                active_candidates.append({
                                    "direction": "SHORT",
                                    "entry_time": entry_t,
                                    "entry_price": entry_p,
                                    "entry_zone_high": dynamic_round((fvg.top + fvg.bottom) / 2),
                                    "entry_zone_low": dynamic_round(fvg.bottom),
                                    "sl": sl,
                                    "tp": tp,
                                    "rr": rr,
                                    "name": f"🛡️ Pro Shield: FVG Premium ({fvg.id})",
                                    "weight": 75.0
                                })

        # 4. Turtle Soup (Liquidity Sweep) dengan 0.8*ATR Buffer
        if smc and smc.liquidity_pools:
            for lp in smc.liquidity_pools:
                if lp.swept and lp.sweep_time:
                    sweep_idx = next((i for i, c in enumerate(candles) if c.time >= lp.sweep_time), None)
                    if sweep_idx is not None and (len(candles) - 1 - sweep_idx) <= 25:
                        if lp.type == "EQL":
                            if is_bearish_bos or current_trend == "BEARISH" or (htf_trend == "BEARISH"):
                                continue
                            entry_t = candles[sweep_idx].time
                            entry_p = dynamic_round(lp.price)
                            lowest_wick = min(c.low for c in candles[sweep_idx:])
                            sl = dynamic_round(lowest_wick - (atr * 0.8))
                            tp = dynamic_round(entry_p + max(atr * 3.5, abs(entry_p - sl) * 2.0))
                            denom = max(entry_p * 0.001, abs(entry_p - sl))
                            rr = round(abs(tp - entry_p) / denom, 2)
                            if rr >= 1.5:
                                sub_candles = candles[sweep_idx:]
                                sl_hit = any(c.low <= sl for c in sub_candles)
                                tp_hit = any(c.high >= tp for c in sub_candles)
                                if not sl_hit and not tp_hit:
                                    active_candidates.append({
                                        "direction": "LONG",
                                        "entry_time": entry_t,
                                        "entry_price": entry_p,
                                        "entry_zone_high": dynamic_round(entry_p + (atr * 0.15)),
                                        "entry_zone_low": dynamic_round(entry_p - (atr * 0.15)),
                                        "sl": sl,
                                        "tp": tp,
                                        "rr": rr,
                                        "name": "🛡️ Pro Shield: Turtle Soup (EQL Sweep)",
                                        "weight": 80.0
                                    })
                        elif lp.type == "EQH":
                            if is_bullish_bos or current_trend == "BULLISH" or (htf_trend == "BULLISH"):
                                continue
                            entry_t = candles[sweep_idx].time
                            entry_p = dynamic_round(lp.price)
                            highest_wick = max(c.high for c in candles[sweep_idx:])
                            sl = dynamic_round(highest_wick + (atr * 0.8))
                            tp = dynamic_round(entry_p - max(atr * 3.5, abs(sl - entry_p) * 2.0))
                            denom = max(entry_p * 0.001, abs(sl - entry_p))
                            rr = round(abs(entry_p - tp) / denom, 2)
                            if rr >= 1.5:
                                sub_candles = candles[sweep_idx:]
                                sl_hit = any(c.high >= sl for c in sub_candles)
                                tp_hit = any(c.low <= tp for c in sub_candles)
                                if not sl_hit and not tp_hit:
                                    active_candidates.append({
                                        "direction": "SHORT",
                                        "entry_time": entry_t,
                                        "entry_price": entry_p,
                                        "entry_zone_high": dynamic_round(entry_p + (atr * 0.15)),
                                        "entry_zone_low": dynamic_round(entry_p - (atr * 0.15)),
                                        "sl": sl,
                                        "tp": tp,
                                        "rr": rr,
                                        "name": "🛡️ Pro Shield: Turtle Soup (EQH Sweep)",
                                        "weight": 80.0
                                    })

        active_candidates.sort(key=lambda x: x["entry_time"], reverse=True)
        return active_candidates
