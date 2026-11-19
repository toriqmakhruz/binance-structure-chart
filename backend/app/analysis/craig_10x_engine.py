import math
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional, Tuple
from ..models.schemas import Candle, SmcAnalysisResult, PatternAnalysisResult
from .utils import dynamic_round


def compute_ema_series(values: List[float], period: int) -> List[float]:
    """Calculate Exponential Moving Average series for a given period."""
    if len(values) < period:
        return []
    k = 2.0 / (period + 1)
    ema = [sum(values[:period]) / period]
    for v in values[period:]:
        ema.append(v * k + ema[-1] * (1.0 - k))
    return ema


class Craig10xEngine:
    """
    Craig Percoco 10x Asymmetric Day Trading Engine.
    
    Berdasarkan metode dari serial Live Day Trading Craig Percoco (Inevitrade):
    1. Multi-Timeframe Trend Confirmation (EMA Stack: 20, 50, 200).
    2. Session Timing Filter (New York Open 13:00-21:00 UTC, London 07:00-16:00 UTC).
    3. Liquidity Sweep (Pengambilan likuiditas ekstrim / Trendline Liquidity / PDH / PDL).
    4. Market Structure Shift (MSS / CHoCH) & Fair Value Gap (FVG) creation pada candle impulsif.
    5. Precision Retest Entry (Limit order pada 50% equilibrium / batas FVG).
    6. Micro-Invalidation Stop Loss (SL sangat rapat tepat di wick sweep).
    7. Asymmetric Risk-to-Reward (Wajib R:R >= 3.0, target 4R s/d 8R+).
    8. Rule Auto-Breakeven (Lock BE saat harga bergerak 1.5R).
    """

    @staticmethod
    def get_session_info(timestamp_ms: int) -> Dict[str, Any]:
        """
        Deteksi status sesi pasar (New York / London) dalam UTC.
        """
        try:
            ts_sec = timestamp_ms / 1000.0 if timestamp_ms > 1e11 else timestamp_ms
            dt = datetime.fromtimestamp(ts_sec, tz=timezone.utc)
            hour = dt.hour
            minute = dt.minute
            
            # London Session: 07:00 - 16:00 UTC
            in_london = 7 <= hour < 16
            
            # NY Session: 13:00 - 21:00 UTC (Core US open 13:30 - 17:00 UTC)
            in_ny = 13 <= hour < 21
            is_ny_open = (hour == 13 and minute >= 30) or (14 <= hour < 17)
            
            session_name = "OFF_HOURS"
            if in_ny and in_london:
                session_name = "NY_LONDON_OVERLAP"
            elif is_ny_open:
                session_name = "NY_OPEN_PRIME"
            elif in_ny:
                session_name = "NY_SESSION"
            elif in_london:
                session_name = "LONDON_SESSION"
                
            return {
                "in_prime_session": in_ny or in_london,
                "session_name": session_name,
                "utc_hour": hour,
                "utc_minute": minute
            }
        except Exception:
            return {
                "in_prime_session": True,
                "session_name": "UNKNOWN",
                "utc_hour": 14,
                "utc_minute": 0
            }

    @staticmethod
    def check_ema_lineup(candles: List[Candle]) -> Dict[str, Any]:
        """
        Hitung susunan EMA 20, 50, dan 200 (IT Foundation Lineup).
        """
        closes = [c.close for c in candles]
        if len(closes) < 50:
            return {"status": "INSUFFICIENT_BARS", "bias": "NEUTRAL", "ema20": None, "ema50": None, "ema200": None}
            
        ema20_all = compute_ema_series(closes, 20)
        ema50_all = compute_ema_series(closes, 50)
        ema200_all = compute_ema_series(closes, min(200, len(closes) - 5)) if len(closes) >= 100 else []
        
        last_ema20 = ema20_all[-1] if ema20_all else None
        last_ema50 = ema50_all[-1] if ema50_all else None
        last_ema200 = ema200_all[-1] if ema200_all else None
        
        if last_ema20 is not None and last_ema50 is not None:
            if last_ema200 is not None:
                if last_ema20 > last_ema50 > last_ema200:
                    return {"status": "BULLISH_STACK", "bias": "BULLISH", "ema20": last_ema20, "ema50": last_ema50, "ema200": last_ema200}
                elif last_ema20 < last_ema50 < last_ema200:
                    return {"status": "BEARISH_STACK", "bias": "BEARISH", "ema20": last_ema20, "ema50": last_ema50, "ema200": last_ema200}
            
            # Jika bar belum cukup 200, gunakan 20 & 50
            if last_ema20 > last_ema50:
                return {"status": "BULLISH_FAST", "bias": "BULLISH", "ema20": last_ema20, "ema50": last_ema50, "ema200": last_ema200}
            elif last_ema20 < last_ema50:
                return {"status": "BEARISH_FAST", "bias": "BEARISH", "ema20": last_ema20, "ema50": last_ema50, "ema200": last_ema200}
                
        return {"status": "NEUTRAL_CROSS", "bias": "NEUTRAL", "ema20": last_ema20, "ema50": last_ema50, "ema200": last_ema200}

    @staticmethod
    def is_rejection_candle(candle: Candle, direction: str) -> bool:
        """
        Validasi rejection wick yang kuat pada candle sweep.
        """
        rng = candle.high - candle.low
        if rng <= 0:
            return True
        if direction == "LONG":
            lower_wick = min(candle.open, candle.close) - candle.low
            return (lower_wick / rng) >= 0.20 or (candle.close > candle.open and (candle.close - candle.low) / rng >= 0.50)
        else: # SHORT
            upper_wick = candle.high - max(candle.open, candle.close)
            return (upper_wick / rng) >= 0.20 or (candle.close < candle.open and (candle.high - candle.close) / rng >= 0.50)

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
        """
        Pindai dan evaluasi setup Craig 10x Asymmetric R:R.
        """
        active_candidates: List[Dict[str, Any]] = []
        if len(candles) < 30:
            return active_candidates

        # 1. Analisis EMA Lineup (IT Foundation)
        ema_info = cls.check_ema_lineup(candles)
        ema_bias = ema_info["bias"]

        # 2. Analisis Sesi Pasar
        session_info = cls.get_session_info(last_time)
        session_boost = 10.0 if session_info["in_prime_session"] else 0.0

        lookback_candles = 40
        lookback_start = max(0, len(candles) - lookback_candles)

        # ------------------------------------------------------------------
        # KANDIDAT A: TURTLE SOUP / LIQUIDITY SWEEP + FVG RETEST (Craig 10x Core)
        # ------------------------------------------------------------------
        if smc and smc.liquidity_pools:
            for lp in smc.liquidity_pools:
                if lp.swept and lp.sweep_time:
                    sweep_idx = next((i for i, c in enumerate(candles) if c.time >= lp.sweep_time), None)
                    if sweep_idx is None or (len(candles) - 1 - sweep_idx) > 25:
                        continue

                    # LONG Setup (EQL Sweep / Liquidity Grab Low)
                    if lp.type == "EQL":
                        # Trend Permission Check: Craig tidak melawan tren utama EMA/HTF
                        if ema_bias == "BEARISH" or htf_trend == "BEARISH":
                            continue

                        sweep_candle = candles[sweep_idx]
                        if not cls.is_rejection_candle(sweep_candle, "LONG"):
                            continue

                        # Micro-Invalidation SL: Tepat di wick sweep terendah
                        lowest_sweep_wick = min(c.low for c in candles[sweep_idx:])
                        sl = dynamic_round(lowest_sweep_wick - max(atr * 0.15, current_price * 0.0008))

                        # Entry: Retest batas sweep / equilibrium
                        entry_p = dynamic_round(lp.price)
                        entry_t = sweep_candle.time

                        # Target Asymmetric 10x: Cari opposing liquidity (EQH) atau min 4R s/d 8R
                        eqh_targets = [p.price for p in smc.liquidity_pools if p.type == "EQH" and p.price > entry_p]
                        supply_targets = [ob.bottom for ob in smc.order_blocks if ob.direction == "BEARISH" and ob.bottom > entry_p]
                        possible_tps = eqh_targets + supply_targets

                        risk_dist = max(entry_p * 0.0005, abs(entry_p - sl))
                        # Minimal R:R 3.0x (10x Asymmetric standard)
                        min_tp_dist = risk_dist * 3.0
                        valid_tps = [t for t in possible_tps if (t - entry_p) >= min_tp_dist]

                        if valid_tps:
                            tp = dynamic_round(min(valid_tps))
                        else:
                            # Default ekspansi 10x Craig: 4.5R s/d 6.0R
                            tp = dynamic_round(entry_p + max(atr * 4.5, risk_dist * 4.5))

                        rr = round(abs(tp - entry_p) / risk_dist, 2)
                        if rr >= 3.0:
                            sub_candles = candles[sweep_idx:]
                            sl_hit = any(c.low <= sl for c in sub_candles)
                            tp_hit = any(c.high >= tp for c in sub_candles)

                            if not sl_hit and not tp_hit:
                                be_price = dynamic_round(entry_p + (risk_dist * 1.5))
                                active_candidates.append({
                                    "direction": "LONG",
                                    "entry_time": entry_t,
                                    "entry_price": entry_p,
                                    "entry_zone_high": dynamic_round(entry_p + (atr * 0.1)),
                                    "entry_zone_low": dynamic_round(entry_p - (atr * 0.05)),
                                    "sl": sl,
                                    "tp": tp,
                                    "rr": rr,
                                    "be_price": be_price,
                                    "name": f"🎯 Craig 10x: EQL Sweep Retest [R:R {rr} | BE @ {be_price}]",
                                    "weight": min(95.0, 75.0 + session_boost + (5.0 if ema_bias == 'BULLISH' else 0.0))
                                })

                    # SHORT Setup (EQH Sweep / Liquidity Grab High)
                    elif lp.type == "EQH":
                        if ema_bias == "BULLISH" or htf_trend == "BULLISH":
                            continue

                        sweep_candle = candles[sweep_idx]
                        if not cls.is_rejection_candle(sweep_candle, "SHORT"):
                            continue

                        highest_sweep_wick = max(c.high for c in candles[sweep_idx:])
                        sl = dynamic_round(highest_sweep_wick + max(atr * 0.15, current_price * 0.0008))

                        entry_p = dynamic_round(lp.price)
                        entry_t = sweep_candle.time

                        eql_targets = [p.price for p in smc.liquidity_pools if p.type == "EQL" and p.price < entry_p]
                        demand_targets = [ob.top for ob in smc.order_blocks if ob.direction == "BULLISH" and ob.top < entry_p]
                        possible_tps = eql_targets + demand_targets

                        risk_dist = max(entry_p * 0.0005, abs(sl - entry_p))
                        min_tp_dist = risk_dist * 3.0
                        valid_tps = [t for t in possible_tps if (entry_p - t) >= min_tp_dist]

                        if valid_tps:
                            tp = dynamic_round(max(valid_tps))
                        else:
                            tp = dynamic_round(entry_p - max(atr * 4.5, risk_dist * 4.5))

                        rr = round(abs(entry_p - tp) / risk_dist, 2)
                        if rr >= 3.0:
                            sub_candles = candles[sweep_idx:]
                            sl_hit = any(c.high >= sl for c in sub_candles)
                            tp_hit = any(c.low <= tp for c in sub_candles)

                            if not sl_hit and not tp_hit:
                                be_price = dynamic_round(entry_p - (risk_dist * 1.5))
                                active_candidates.append({
                                    "direction": "SHORT",
                                    "entry_time": entry_t,
                                    "entry_price": entry_p,
                                    "entry_zone_high": dynamic_round(entry_p + (atr * 0.05)),
                                    "entry_zone_low": dynamic_round(entry_p - (atr * 0.1)),
                                    "sl": sl,
                                    "tp": tp,
                                    "rr": rr,
                                    "be_price": be_price,
                                    "name": f"🎯 Craig 10x: EQH Sweep Retest [R:R {rr} | BE @ {be_price}]",
                                    "weight": min(95.0, 75.0 + session_boost + (5.0 if ema_bias == 'BEARISH' else 0.0))
                                })

        # ------------------------------------------------------------------
        # KANDIDAT B: FAIR VALUE GAP (FVG) IMPULSE RETEST DENGAN MICRO-SL
        # ------------------------------------------------------------------
        if smc and smc.fvgs:
            for fvg in smc.fvgs:
                if fvg.direction == "BULLISH":
                    if ema_bias == "BEARISH" or htf_trend == "BEARISH":
                        continue

                    tap_idx = None
                    tap_count = 0
                    for i in range(lookback_start, len(candles)):
                        c = candles[i]
                        if c.time >= fvg.time:
                            # Cek retest ke dalam FVG
                            if c.low <= (fvg.top + atr * 0.1) and c.close >= (fvg.bottom - atr * 0.15):
                                tap_count += 1
                                if cls.is_rejection_candle(c, "LONG") and tap_idx is None:
                                    tap_idx = i
                    if tap_idx is not None and tap_count <= 2:
                        entry_t = candles[tap_idx].time
                        # Craig entry pada equilibrium (50%) atau top FVG
                        entry_p = dynamic_round((fvg.top + fvg.bottom) / 2.0)
                        # Micro SL: Tepat di bottom FVG dengan buffer kecil
                        sl = dynamic_round(fvg.bottom - max(atr * 0.15, entry_p * 0.0008))
                        risk_dist = max(entry_p * 0.0005, abs(entry_p - sl))

                        # Target asimetris berbasis struktur (EQH / Supply OB >= 3.0R)
                        eqh_targets = [p.price for p in (smc.liquidity_pools or []) if p.type == "EQH" and p.price > entry_p]
                        supply_targets = [ob.bottom for ob in (smc.order_blocks or []) if ob.direction == "BEARISH" and ob.bottom > entry_p]
                        valid_tps = [t for t in (eqh_targets + supply_targets) if (t - entry_p) >= risk_dist * 3.0]
                        tp = dynamic_round(min(valid_tps)) if valid_tps else dynamic_round(entry_p + max(atr * 4.0, risk_dist * 4.0))
                        rr = round(abs(tp - entry_p) / risk_dist, 2)

                        if rr >= 3.0:
                            sub_candles = candles[tap_idx:]
                            sl_hit = any(c.low <= sl for c in sub_candles)
                            tp_hit = any(c.high >= tp for c in sub_candles)
                            if not sl_hit and not tp_hit:
                                be_price = dynamic_round(entry_p + (risk_dist * 1.5))
                                active_candidates.append({
                                    "direction": "LONG",
                                    "entry_time": entry_t,
                                    "entry_price": entry_p,
                                    "entry_zone_high": dynamic_round(fvg.top),
                                    "entry_zone_low": dynamic_round(fvg.bottom),
                                    "sl": sl,
                                    "tp": tp,
                                    "rr": rr,
                                    "be_price": be_price,
                                    "name": f"🎯 Craig 10x: Bullish FVG 50% Retest [R:R {rr} | BE @ {be_price}]",
                                    "weight": min(90.0, 70.0 + session_boost + (5.0 if ema_bias == 'BULLISH' else 0.0))
                                })

                elif fvg.direction == "BEARISH":
                    if ema_bias == "BULLISH" or htf_trend == "BULLISH":
                        continue

                    tap_idx = None
                    tap_count = 0
                    for i in range(lookback_start, len(candles)):
                        c = candles[i]
                        if c.time >= fvg.time:
                            if c.high >= (fvg.bottom - atr * 0.1) and c.close <= (fvg.top + atr * 0.15):
                                tap_count += 1
                                if cls.is_rejection_candle(c, "SHORT") and tap_idx is None:
                                    tap_idx = i
                    if tap_idx is not None and tap_count <= 2:
                        entry_t = candles[tap_idx].time
                        entry_p = dynamic_round((fvg.top + fvg.bottom) / 2.0)
                        sl = dynamic_round(fvg.top + max(atr * 0.15, entry_p * 0.0008))
                        risk_dist = max(entry_p * 0.0005, abs(sl - entry_p))

                        eql_targets = [p.price for p in (smc.liquidity_pools or []) if p.type == "EQL" and p.price < entry_p]
                        demand_targets = [ob.top for ob in (smc.order_blocks or []) if ob.direction == "BULLISH" and ob.top < entry_p]
                        valid_tps = [t for t in (eql_targets + demand_targets) if (entry_p - t) >= risk_dist * 3.0]
                        tp = dynamic_round(max(valid_tps)) if valid_tps else dynamic_round(entry_p - max(atr * 4.0, risk_dist * 4.0))
                        rr = round(abs(entry_p - tp) / risk_dist, 2)

                        if rr >= 3.0:
                            sub_candles = candles[tap_idx:]
                            sl_hit = any(c.high >= sl for c in sub_candles)
                            tp_hit = any(c.low <= tp for c in sub_candles)
                            if not sl_hit and not tp_hit:
                                be_price = dynamic_round(entry_p - (risk_dist * 1.5))
                                active_candidates.append({
                                    "direction": "SHORT",
                                    "entry_time": entry_t,
                                    "entry_price": entry_p,
                                    "entry_zone_high": dynamic_round(fvg.top),
                                    "entry_zone_low": dynamic_round(fvg.bottom),
                                    "sl": sl,
                                    "tp": tp,
                                    "rr": rr,
                                    "be_price": be_price,
                                    "name": f"🎯 Craig 10x: Bearish FVG 50% Retest [R:R {rr} | BE @ {be_price}]",
                                    "weight": min(90.0, 70.0 + session_boost + (5.0 if ema_bias == 'BEARISH' else 0.0))
                                })

        # ------------------------------------------------------------------
        # KANDIDAT C: ORDER BLOCK MITIGATION WITH ASYMMETRIC R:R
        # ------------------------------------------------------------------
        if smc and smc.order_blocks:
            for ob in smc.order_blocks:
                if ob.direction == "BULLISH":
                    if ema_bias == "BEARISH" or htf_trend == "BEARISH":
                        continue
                    tap_idx = None
                    tap_count = 0
                    for i in range(lookback_start, len(candles)):
                        c = candles[i]
                        if c.time > ob.start_time:
                            if c.low <= (ob.top + atr * 0.1) and c.close >= (ob.bottom - atr * 0.15):
                                tap_count += 1
                                if cls.is_rejection_candle(c, "LONG") and tap_idx is None:
                                    tap_idx = i
                    if tap_idx is not None and tap_count <= 2:
                        entry_t = candles[tap_idx].time
                        entry_p = dynamic_round(ob.top)
                        sl = dynamic_round(ob.bottom - max(atr * 0.15, entry_p * 0.0008))
                        risk_dist = max(entry_p * 0.0005, abs(entry_p - sl))
                        eqh_targets = [p.price for p in (smc.liquidity_pools or []) if p.type == "EQH" and p.price > entry_p]
                        supply_targets = [o.bottom for o in (smc.order_blocks or []) if o.direction == "BEARISH" and o.bottom > entry_p]
                        valid_tps = [t for t in (eqh_targets + supply_targets) if (t - entry_p) >= risk_dist * 3.0]
                        tp = dynamic_round(min(valid_tps)) if valid_tps else dynamic_round(entry_p + max(atr * 4.0, risk_dist * 4.0))
                        rr = round(abs(tp - entry_p) / risk_dist, 2)
                        if rr >= 3.0:
                            sub_candles = candles[tap_idx:]
                            sl_hit = any(c.low <= sl for c in sub_candles)
                            tp_hit = any(c.high >= tp for c in sub_candles)
                            if not sl_hit and not tp_hit:
                                be_price = dynamic_round(entry_p + (risk_dist * 1.5))
                                active_candidates.append({
                                    "direction": "LONG",
                                    "entry_time": entry_t,
                                    "entry_price": entry_p,
                                    "entry_zone_high": dynamic_round(ob.top),
                                    "entry_zone_low": dynamic_round((ob.top + ob.bottom) / 2),
                                    "sl": sl,
                                    "tp": tp,
                                    "rr": rr,
                                    "be_price": be_price,
                                    "name": f"🎯 Craig 10x: Demand OB Retest ({ob.id}) [R:R {rr} | BE @ {be_price}]",
                                    "weight": min(92.0, 72.0 + session_boost + (5.0 if ema_bias == 'BULLISH' else 0.0))
                                })

                elif ob.direction == "BEARISH":
                    if ema_bias == "BULLISH" or htf_trend == "BULLISH":
                        continue
                    tap_idx = None
                    tap_count = 0
                    for i in range(lookback_start, len(candles)):
                        c = candles[i]
                        if c.time > ob.start_time:
                            if c.high >= (ob.bottom - atr * 0.1) and c.close <= (ob.top + atr * 0.15):
                                tap_count += 1
                                if cls.is_rejection_candle(c, "SHORT") and tap_idx is None:
                                    tap_idx = i
                    if tap_idx is not None and tap_count <= 2:
                        entry_t = candles[tap_idx].time
                        entry_p = dynamic_round(ob.bottom)
                        sl = dynamic_round(ob.top + max(atr * 0.15, entry_p * 0.0008))
                        risk_dist = max(entry_p * 0.0005, abs(sl - entry_p))
                        eql_targets = [p.price for p in (smc.liquidity_pools or []) if p.type == "EQL" and p.price < entry_p]
                        demand_targets = [o.top for o in (smc.order_blocks or []) if o.direction == "BULLISH" and o.top < entry_p]
                        valid_tps = [t for t in (eql_targets + demand_targets) if (entry_p - t) >= risk_dist * 3.0]
                        tp = dynamic_round(max(valid_tps)) if valid_tps else dynamic_round(entry_p - max(atr * 4.0, risk_dist * 4.0))
                        rr = round(abs(entry_p - tp) / risk_dist, 2)
                        if rr >= 3.0:
                            sub_candles = candles[tap_idx:]
                            sl_hit = any(c.high >= sl for c in sub_candles)
                            tp_hit = any(c.low <= tp for c in sub_candles)
                            if not sl_hit and not tp_hit:
                                be_price = dynamic_round(entry_p - (risk_dist * 1.5))
                                active_candidates.append({
                                    "direction": "SHORT",
                                    "entry_time": entry_t,
                                    "entry_price": entry_p,
                                    "entry_zone_high": dynamic_round((ob.top + ob.bottom) / 2),
                                    "entry_zone_low": dynamic_round(ob.bottom),
                                    "sl": sl,
                                    "tp": tp,
                                    "rr": rr,
                                    "be_price": be_price,
                                    "name": f"🎯 Craig 10x: Supply OB Retest ({ob.id}) [R:R {rr} | BE @ {be_price}]",
                                    "weight": min(92.0, 72.0 + session_boost + (5.0 if ema_bias == 'BEARISH' else 0.0))
                                })

        active_candidates.sort(key=lambda x: (x["entry_time"], x["rr"]), reverse=True)
        return active_candidates

