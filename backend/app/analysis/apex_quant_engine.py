from datetime import datetime, timezone
from typing import List, Dict, Any, Optional, Tuple
from ..models.schemas import Candle, SmcAnalysisResult, PatternAnalysisResult
from .utils import dynamic_round
from .craig_10x_engine import Craig10xEngine


class ApexQuantEngine:
    """
    Apex Quant A++ Hybrid Engine (Kombinasi Ultimate: SMC + Pro Shield + Craig 10x + Quantitative Fibonacci OTE).

    8 Pilar Algoritma Institusional Apex Quant:
    1. Multi-Factor Trend & EMA Stack (EMA 20/50/200 + BOS/CHoCH + HTF Trend Guard).
    2. Fibonacci OTE & Premium/Discount Gatekeeper (0.50 Equilibrium & 0.618-0.786 Golden Pocket).
    3. Institutional Displacement & Volume RVOL Confirmation (Volume > Rata-rata & Body Impulsif).
    4. Fresh Zone Filter (Maksimal 2x sentuhan/retest agar likuiditas zona belum habis).
    5. Multi-Confluence Overlap Detection ("Unicorn Setup": OB + FVG + Fib OTE / Liquidity Sweep).
    6. Adaptive Volatility Shield SL (0.35 * ATR di luar struktur invalidasi: tahan stop-hunt namun tetap R:R tinggi).
    7. Structural Liquidity TP & Auto-Breakeven (Target ke EQH/EQL/OB lawan dengan min R:R >= 2.2 s/d 8R+, Lock BE @ 1.5R).
    8. Actionable Proximity Guard (Menolak sinyal basi yang harganya sudah lari > 45% menuju TP).
    """

    @staticmethod
    def compute_active_fib_range(
        candles: List[Candle],
        smc: Optional[SmcAnalysisResult]
    ) -> Tuple[float, float]:
        """
        Hitung Swing High dan Swing Low struktural aktif (Anti-Repaint) untuk menentukan
        zona Premium (> 0.5), Equilibrium (0.5), Discount (< 0.5), dan Golden Pocket OTE (0.618 - 0.786).
        """
        if smc and smc.swings and len(smc.swings) >= 2:
            highs = [s.price for s in smc.swings[-12:] if s.type in ("H", "HH", "LH")]
            lows = [s.price for s in smc.swings[-12:] if s.type in ("L", "LL", "HL")]
            if highs and lows:
                hi = max(highs)
                lo = min(lows)
                if hi > lo:
                    return hi, lo

        lookback = candles[-60:] if len(candles) >= 60 else candles
        hi = max(c.high for c in lookback)
        lo = min(c.low for c in lookback)
        return hi, lo

    @staticmethod
    def evaluate_fib_position(
        entry_price: float,
        direction: str,
        swing_high: float,
        swing_low: float
    ) -> Dict[str, Any]:
        """
        Evaluasi posisi harga entry terhadap rentang Fibonacci aktif.
        Untuk LONG: Retracement dihitung dari High (0.0) turun ke Low (1.0).
          - >= 0.45 adalah Discount / Equilibrium.
          - 0.60 s/d 0.82 adalah Golden Pocket / OTE.
        Untuk SHORT: Retracement dihitung dari Low (0.0) naik ke High (1.0).
          - >= 0.45 adalah Premium / Equilibrium.
          - 0.60 s/d 0.82 adalah Golden Pocket / OTE.
        """
        rng = swing_high - swing_low
        if rng <= 0:
            return {"valid": True, "in_ote": False, "fib_ratio": 0.5, "bonus": 0.0, "zone_tag": "EQ"}

        if direction == "LONG":
            fib_retracement = (swing_high - entry_price) / rng
        else:
            fib_retracement = (entry_price - swing_low) / rng

        in_ote = 0.58 <= fib_retracement <= 0.82
        in_discount_or_premium = fib_retracement >= 0.42

        bonus = 15.0 if in_ote else (8.0 if in_discount_or_premium else 0.0)
        zone_tag = "OTE Golden Pocket" if in_ote else ("Discount/Premium" if in_discount_or_premium else "Shallow")

        return {
            "valid": in_discount_or_premium,
            "in_ote": in_ote,
            "fib_ratio": round(fib_retracement, 3),
            "bonus": bonus,
            "zone_tag": zone_tag
        }

    @staticmethod
    def compute_avg_volume(candles: List[Candle], period: int = 20) -> float:
        sample = candles[-period:] if len(candles) >= period else candles
        if not sample:
            return 1.0
        return max(1e-9, sum(c.volume for c in sample) / len(sample))

    @staticmethod
    def is_strong_rejection(candle: Candle, direction: str, avg_vol: float) -> Tuple[bool, float]:
        """
        Validasi penolakan harga institusional (Rejection Wick + Close Momentum + Volume Absorption).
        Mengembalikan (is_valid, quality_bonus).
        """
        rng = candle.high - candle.low
        if rng <= 0:
            return False, 0.0

        rvol = candle.volume / max(1e-9, avg_vol)
        vol_bonus = 6.0 if rvol >= 1.25 else (3.0 if rvol >= 0.9 else 0.0)

        if direction == "LONG":
            lower_wick = min(candle.open, candle.close) - candle.low
            wick_ratio = lower_wick / rng
            bull_close = (candle.close - candle.low) / rng
            is_valid = (wick_ratio >= 0.22 and bull_close >= 0.45) or (candle.close > candle.open and bull_close >= 0.55)
            return is_valid, vol_bonus + (4.0 if wick_ratio >= 0.35 else 0.0)
        else:
            upper_wick = candle.high - max(candle.open, candle.close)
            wick_ratio = upper_wick / rng
            bear_close = (candle.high - candle.close) / rng
            is_valid = (wick_ratio >= 0.22 and bear_close >= 0.45) or (candle.close < candle.open and bear_close >= 0.55)
            return is_valid, vol_bonus + (4.0 if wick_ratio >= 0.35 else 0.0)

    @staticmethod
    def select_structural_target(
        direction: str,
        entry_price: float,
        risk_dist: float,
        atr: float,
        smc: Optional[SmcAnalysisResult],
        min_rr: float = 2.2
    ) -> Tuple[float, float]:
        """
        Pilih target Take Profit berbasis struktur likuiditas (EQH/EQL & Opposing Unmitigated OB).
        Mengembalikan (tp_price, rr_ratio).
        """
        min_dist = risk_dist * min_rr
        candidates: List[float] = []

        if smc:
            if direction == "LONG":
                eqh = [lp.price for lp in smc.liquidity_pools if lp.type == "EQH" and (lp.price - entry_price) >= min_dist]
                opp_ob = [ob.bottom for ob in smc.order_blocks if ob.direction == "BEARISH" and not ob.mitigated and (ob.bottom - entry_price) >= min_dist]
                opp_fvg = [f.bottom for f in smc.fvgs if f.direction == "BEARISH" and (f.bottom - entry_price) >= min_dist]
                candidates = eqh + opp_ob + opp_fvg
                if candidates:
                    # Pilih target struktural terdekat yang sudah memenuhi syarat min_rr (>= 2.2R)
                    valid_cands = [t for t in candidates if (t - entry_price) <= risk_dist * 8.5]
                    tp = dynamic_round(min(valid_cands) if valid_cands else min(candidates))
                else:
                    tp = dynamic_round(entry_price + max(atr * 3.8, risk_dist * 3.2))
            else:
                eql = [lp.price for lp in smc.liquidity_pools if lp.type == "EQL" and (entry_price - lp.price) >= min_dist]
                opp_ob = [ob.top for ob in smc.order_blocks if ob.direction == "BULLISH" and not ob.mitigated and (entry_price - ob.top) >= min_dist]
                opp_fvg = [f.top for f in smc.fvgs if f.direction == "BULLISH" and (entry_price - f.top) >= min_dist]
                candidates = eql + opp_ob + opp_fvg
                if candidates:
                    valid_cands = [t for t in candidates if (entry_price - t) <= risk_dist * 8.5]
                    tp = dynamic_round(max(valid_cands) if valid_cands else max(candidates))
                else:
                    tp = dynamic_round(entry_price - max(atr * 3.8, risk_dist * 3.2))
        else:
            if direction == "LONG":
                tp = dynamic_round(entry_price + max(atr * 3.8, risk_dist * 3.2))
            else:
                tp = dynamic_round(entry_price - max(atr * 3.8, risk_dist * 3.2))

        rr = round(abs(tp - entry_price) / max(entry_price * 0.0005, risk_dist), 2)
        return tp, rr

    @staticmethod
    def is_actionable_proximity(
        current_price: float,
        entry_price: float,
        tp_price: float,
        sl_price: float,
        direction: str
    ) -> bool:
        """
        Pastikan harga saat ini belum lari terlalu jauh menuju TP (> 45% perjalanan ke TP),
        sehingga setup masih layak dieksekusi dengan Risk-to-Reward yang sehat.
        """
        total_reward = abs(tp_price - entry_price)
        if total_reward <= 0:
            return False

        if direction == "LONG":
            if current_price <= sl_price or current_price >= tp_price:
                return False
            progress = (current_price - entry_price) / total_reward
        else:
            if current_price >= sl_price or current_price <= tp_price:
                return False
            progress = (entry_price - current_price) / total_reward

        return progress <= 0.45

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
        if len(candles) < 35:
            return active_candidates

        # 1. Konteks Tren Multi-Faktor (SMC + EMA Stack + HTF)
        ema_info = Craig10xEngine.check_ema_lineup(candles)
        ema_bias = ema_info["bias"]
        session_info = Craig10xEngine.get_session_info(last_time)
        session_boost = 8.0 if session_info["in_prime_session"] else 0.0
        avg_vol = cls.compute_avg_volume(candles, 20)

        current_trend = smc.current_trend if smc else ("BULLISH" if confluence_score >= 50 else "BEARISH")
        last_event = smc.events[-1] if (smc and smc.events) else None
        is_bearish_bos = bool(last_event and last_event.type == "BOS" and last_event.direction == "BEARISH")
        is_bullish_bos = bool(last_event and last_event.type == "BOS" and last_event.direction == "BULLISH")

        # 2. Rentang Fibonacci Aktif (Anti-Repaint)
        swing_high, swing_low = cls.compute_active_fib_range(candles, smc)

        lookback_candles = 36
        lookback_start = max(0, len(candles) - lookback_candles)

        # ------------------------------------------------------------------
        # PILAR 1: UNICORN & ORDER BLOCK CONFLUENCE (OB + FVG Overlap + Fib OTE)
        # ------------------------------------------------------------------
        if smc and smc.order_blocks:
            for ob in smc.order_blocks:
                if ob.direction == "BULLISH":
                    if is_bearish_bos or current_trend == "BEARISH" or htf_trend == "BEARISH":
                        continue

                    # Cek apakah OB memiliki konfluensi overlap dengan Bullish FVG (Unicorn Setup)
                    has_fvg_overlap = any(
                        f.direction == "BULLISH" and f.bottom <= ob.top + (atr * 0.3) and f.top >= ob.bottom - (atr * 0.3)
                        for f in (smc.fvgs or [])
                    )

                    # Optimal Entry di 65% batas atas OB (lebih dalam dari pucuk agar R:R tajam, tidak terlalu bawah agar terjemput)
                    optimal_entry = dynamic_round(ob.bottom + (ob.top - ob.bottom) * 0.65)
                    fib_eval = cls.evaluate_fib_position(optimal_entry, "LONG", swing_high, swing_low)

                    # Wajib berada di Discount/Equilibrium atau merupakan Unicorn Setup
                    if not fib_eval["valid"] and not has_fvg_overlap:
                        continue

                    tap_idx = None
                    tap_count = 0
                    rej_bonus = 0.0
                    for i in range(lookback_start, len(candles)):
                        c = candles[i]
                        if c.time > ob.start_time:
                            if c.low <= (ob.top + atr * 0.12) and c.close >= (ob.bottom - atr * 0.15):
                                tap_count += 1
                                is_rej, r_bon = cls.is_strong_rejection(c, "LONG", avg_vol)
                                if not is_rej and i + 1 < len(candles):
                                    is_rej, r_bon = cls.is_strong_rejection(candles[i + 1], "LONG", avg_vol)
                                if is_rej and tap_idx is None:
                                    tap_idx = i
                                    rej_bonus = r_bon

                    # Fresh Zone Rule: Abaikan zona yang sudah ditusuk lebih dari 2 kali
                    if tap_idx is not None and tap_count <= 2:
                        entry_t = candles[tap_idx].time
                        entry_p = optimal_entry
                        # Adaptive Volatility Shield SL: 0.35 * ATR di bawah dasar OB
                        sl = dynamic_round(ob.bottom - max(atr * 0.35, entry_p * 0.0015))
                        risk_dist = max(entry_p * 0.0005, abs(entry_p - sl))

                        tp, rr = cls.select_structural_target("LONG", entry_p, risk_dist, atr, smc, min_rr=2.2)

                        if rr >= 2.2:
                            sub_candles = candles[tap_idx:]
                            sl_hit = any(c.low <= sl for c in sub_candles)
                            tp_hit = any(c.high >= tp for c in sub_candles)
                            if not sl_hit and not tp_hit and cls.is_actionable_proximity(current_price, entry_p, tp, sl, "LONG"):
                                be_price = dynamic_round(entry_p + (risk_dist * 1.5))
                                unicorn_tag = "Unicorn OB+FVG" if has_fvg_overlap else "Institutional OB"
                                fib_tag = f" + {fib_eval['zone_tag']}" if fib_eval["in_ote"] else ""
                                score = min(98.0, 74.0 + fib_eval["bonus"] + rej_bonus + session_boost + (7.0 if has_fvg_overlap else 0.0) + (4.0 if ema_bias == "BULLISH" else 0.0))

                                active_candidates.append({
                                    "direction": "LONG",
                                    "entry_time": entry_t,
                                    "entry_price": entry_p,
                                    "entry_zone_high": dynamic_round(ob.top),
                                    "entry_zone_low": dynamic_round(ob.bottom),
                                    "sl": sl,
                                    "tp": tp,
                                    "rr": rr,
                                    "be_price": be_price,
                                    "name": f"💎 Apex Quant: {unicorn_tag}{fib_tag} [R:R {rr} | BE @ {be_price}]",
                                    "weight": score
                                })

                elif ob.direction == "BEARISH":
                    if is_bullish_bos or current_trend == "BULLISH" or htf_trend == "BULLISH":
                        continue

                    has_fvg_overlap = any(
                        f.direction == "BEARISH" and f.bottom <= ob.top + (atr * 0.3) and f.top >= ob.bottom - (atr * 0.3)
                        for f in (smc.fvgs or [])
                    )

                    optimal_entry = dynamic_round(ob.top - (ob.top - ob.bottom) * 0.65)
                    fib_eval = cls.evaluate_fib_position(optimal_entry, "SHORT", swing_high, swing_low)

                    if not fib_eval["valid"] and not has_fvg_overlap:
                        continue

                    tap_idx = None
                    tap_count = 0
                    rej_bonus = 0.0
                    for i in range(lookback_start, len(candles)):
                        c = candles[i]
                        if c.time > ob.start_time:
                            if c.high >= (ob.bottom - atr * 0.12) and c.close <= (ob.top + atr * 0.15):
                                tap_count += 1
                                is_rej, r_bon = cls.is_strong_rejection(c, "SHORT", avg_vol)
                                if not is_rej and i + 1 < len(candles):
                                    is_rej, r_bon = cls.is_strong_rejection(candles[i + 1], "SHORT", avg_vol)
                                if is_rej and tap_idx is None:
                                    tap_idx = i
                                    rej_bonus = r_bon

                    if tap_idx is not None and tap_count <= 2:
                        entry_t = candles[tap_idx].time
                        entry_p = optimal_entry
                        sl = dynamic_round(ob.top + max(atr * 0.35, entry_p * 0.0015))
                        risk_dist = max(entry_p * 0.0005, abs(sl - entry_p))

                        tp, rr = cls.select_structural_target("SHORT", entry_p, risk_dist, atr, smc, min_rr=2.2)

                        if rr >= 2.2:
                            sub_candles = candles[tap_idx:]
                            sl_hit = any(c.high >= sl for c in sub_candles)
                            tp_hit = any(c.low <= tp for c in sub_candles)
                            if not sl_hit and not tp_hit and cls.is_actionable_proximity(current_price, entry_p, tp, sl, "SHORT"):
                                be_price = dynamic_round(entry_p - (risk_dist * 1.5))
                                unicorn_tag = "Unicorn OB+FVG" if has_fvg_overlap else "Institutional OB"
                                fib_tag = f" + {fib_eval['zone_tag']}" if fib_eval["in_ote"] else ""
                                score = min(98.0, 74.0 + fib_eval["bonus"] + rej_bonus + session_boost + (7.0 if has_fvg_overlap else 0.0) + (4.0 if ema_bias == "BEARISH" else 0.0))

                                active_candidates.append({
                                    "direction": "SHORT",
                                    "entry_time": entry_t,
                                    "entry_price": entry_p,
                                    "entry_zone_high": dynamic_round(ob.top),
                                    "entry_zone_low": dynamic_round(ob.bottom),
                                    "sl": sl,
                                    "tp": tp,
                                    "rr": rr,
                                    "be_price": be_price,
                                    "name": f"💎 Apex Quant: {unicorn_tag}{fib_tag} [R:R {rr} | BE @ {be_price}]",
                                    "weight": score
                                })

        # ------------------------------------------------------------------
        # PILAR 2: LIQUIDITY SWEEP + DISPLACEMENT REVERSAL (Silver Bullet / Turtle Soup)
        # ------------------------------------------------------------------
        if smc and smc.liquidity_pools:
            for lp in smc.liquidity_pools:
                if lp.swept and lp.sweep_time:
                    sweep_idx = next((i for i, c in enumerate(candles) if c.time >= lp.sweep_time), None)
                    if sweep_idx is None or (len(candles) - 1 - sweep_idx) > 20:
                        continue

                    if lp.type == "EQL":
                        if is_bearish_bos or current_trend == "BEARISH" or htf_trend == "BEARISH":
                            continue

                        sweep_candle = candles[sweep_idx]
                        is_rej, rej_bonus = cls.is_strong_rejection(sweep_candle, "LONG", avg_vol)
                        if not is_rej:
                            continue

                        lowest_wick = min(c.low for c in candles[sweep_idx:])
                        entry_p = dynamic_round(lp.price)
                        sl = dynamic_round(lowest_wick - max(atr * 0.30, entry_p * 0.0012))
                        risk_dist = max(entry_p * 0.0005, abs(entry_p - sl))

                        tp, rr = cls.select_structural_target("LONG", entry_p, risk_dist, atr, smc, min_rr=2.5)
                        if rr >= 2.5:
                            sub_candles = candles[sweep_idx:]
                            sl_hit = any(c.low <= sl for c in sub_candles)
                            tp_hit = any(c.high >= tp for c in sub_candles)
                            if not sl_hit and not tp_hit and cls.is_actionable_proximity(current_price, entry_p, tp, sl, "LONG"):
                                be_price = dynamic_round(entry_p + (risk_dist * 1.5))
                                fib_eval = cls.evaluate_fib_position(entry_p, "LONG", swing_high, swing_low)
                                score = min(98.0, 78.0 + fib_eval["bonus"] + rej_bonus + session_boost + (5.0 if ema_bias == "BULLISH" else 0.0))

                                active_candidates.append({
                                    "direction": "LONG",
                                    "entry_time": sweep_candle.time,
                                    "entry_price": entry_p,
                                    "entry_zone_high": dynamic_round(entry_p + (atr * 0.12)),
                                    "entry_zone_low": dynamic_round(lowest_wick),
                                    "sl": sl,
                                    "tp": tp,
                                    "rr": rr,
                                    "be_price": be_price,
                                    "name": f"💎 Apex Quant: EQL Liquidity Sweep + Absorption [R:R {rr} | BE @ {be_price}]",
                                    "weight": score
                                })

                    elif lp.type == "EQH":
                        if is_bullish_bos or current_trend == "BULLISH" or htf_trend == "BULLISH":
                            continue

                        sweep_candle = candles[sweep_idx]
                        is_rej, rej_bonus = cls.is_strong_rejection(sweep_candle, "SHORT", avg_vol)
                        if not is_rej:
                            continue

                        highest_wick = max(c.high for c in candles[sweep_idx:])
                        entry_p = dynamic_round(lp.price)
                        sl = dynamic_round(highest_wick + max(atr * 0.30, entry_p * 0.0012))
                        risk_dist = max(entry_p * 0.0005, abs(sl - entry_p))

                        tp, rr = cls.select_structural_target("SHORT", entry_p, risk_dist, atr, smc, min_rr=2.5)
                        if rr >= 2.5:
                            sub_candles = candles[sweep_idx:]
                            sl_hit = any(c.high >= sl for c in sub_candles)
                            tp_hit = any(c.low <= tp for c in sub_candles)
                            if not sl_hit and not tp_hit and cls.is_actionable_proximity(current_price, entry_p, tp, sl, "SHORT"):
                                be_price = dynamic_round(entry_p - (risk_dist * 1.5))
                                fib_eval = cls.evaluate_fib_position(entry_p, "SHORT", swing_high, swing_low)
                                score = min(98.0, 78.0 + fib_eval["bonus"] + rej_bonus + session_boost + (5.0 if ema_bias == "BEARISH" else 0.0))

                                active_candidates.append({
                                    "direction": "SHORT",
                                    "entry_time": sweep_candle.time,
                                    "entry_price": entry_p,
                                    "entry_zone_high": dynamic_round(highest_wick),
                                    "entry_zone_low": dynamic_round(entry_p - (atr * 0.12)),
                                    "sl": sl,
                                    "tp": tp,
                                    "rr": rr,
                                    "be_price": be_price,
                                    "name": f"💎 Apex Quant: EQH Liquidity Sweep + Absorption [R:R {rr} | BE @ {be_price}]",
                                    "weight": score
                                })

        # ------------------------------------------------------------------
        # PILAR 3: FVG 50% EQUILIBRIUM IN GOLDEN POCKET OTE
        # ------------------------------------------------------------------
        if smc and smc.fvgs:
            for fvg in smc.fvgs:
                if fvg.direction == "BULLISH":
                    if is_bearish_bos or current_trend == "BEARISH" or htf_trend == "BEARISH":
                        continue

                    eq_entry = dynamic_round((fvg.top + fvg.bottom) / 2.0)
                    fib_eval = cls.evaluate_fib_position(eq_entry, "LONG", swing_high, swing_low)
                    if not fib_eval["valid"]:
                        continue

                    tap_idx = None
                    tap_count = 0
                    rej_bonus = 0.0
                    for i in range(lookback_start, len(candles)):
                        c = candles[i]
                        if c.time >= fvg.time:
                            if c.low <= (fvg.top + atr * 0.1) and c.close >= (fvg.bottom - atr * 0.15):
                                tap_count += 1
                                is_rej, r_bon = cls.is_strong_rejection(c, "LONG", avg_vol)
                                if is_rej and tap_idx is None:
                                    tap_idx = i
                                    rej_bonus = r_bon

                    if tap_idx is not None and tap_count <= 2:
                        entry_t = candles[tap_idx].time
                        sl = dynamic_round(fvg.bottom - max(atr * 0.35, eq_entry * 0.0012))
                        risk_dist = max(eq_entry * 0.0005, abs(eq_entry - sl))

                        tp, rr = cls.select_structural_target("LONG", eq_entry, risk_dist, atr, smc, min_rr=2.2)
                        if rr >= 2.2:
                            sub_candles = candles[tap_idx:]
                            sl_hit = any(c.low <= sl for c in sub_candles)
                            tp_hit = any(c.high >= tp for c in sub_candles)
                            if not sl_hit and not tp_hit and cls.is_actionable_proximity(current_price, eq_entry, tp, sl, "LONG"):
                                be_price = dynamic_round(eq_entry + (risk_dist * 1.5))
                                score = min(96.0, 72.0 + fib_eval["bonus"] + rej_bonus + session_boost)
                                active_candidates.append({
                                    "direction": "LONG",
                                    "entry_time": entry_t,
                                    "entry_price": eq_entry,
                                    "entry_zone_high": dynamic_round(fvg.top),
                                    "entry_zone_low": dynamic_round(fvg.bottom),
                                    "sl": sl,
                                    "tp": tp,
                                    "rr": rr,
                                    "be_price": be_price,
                                    "name": f"💎 Apex Quant: FVG 50% EQ + {fib_eval['zone_tag']} [R:R {rr} | BE @ {be_price}]",
                                    "weight": score
                                })

                elif fvg.direction == "BEARISH":
                    if is_bullish_bos or current_trend == "BULLISH" or htf_trend == "BULLISH":
                        continue

                    eq_entry = dynamic_round((fvg.top + fvg.bottom) / 2.0)
                    fib_eval = cls.evaluate_fib_position(eq_entry, "SHORT", swing_high, swing_low)
                    if not fib_eval["valid"]:
                        continue

                    tap_idx = None
                    tap_count = 0
                    rej_bonus = 0.0
                    for i in range(lookback_start, len(candles)):
                        c = candles[i]
                        if c.time >= fvg.time:
                            if c.high >= (fvg.bottom - atr * 0.1) and c.close <= (fvg.top + atr * 0.15):
                                tap_count += 1
                                is_rej, r_bon = cls.is_strong_rejection(c, "SHORT", avg_vol)
                                if is_rej and tap_idx is None:
                                    tap_idx = i
                                    rej_bonus = r_bon

                    if tap_idx is not None and tap_count <= 2:
                        entry_t = candles[tap_idx].time
                        sl = dynamic_round(fvg.top + max(atr * 0.35, eq_entry * 0.0012))
                        risk_dist = max(eq_entry * 0.0005, abs(sl - eq_entry))

                        tp, rr = cls.select_structural_target("SHORT", eq_entry, risk_dist, atr, smc, min_rr=2.2)
                        if rr >= 2.2:
                            sub_candles = candles[tap_idx:]
                            sl_hit = any(c.high >= sl for c in sub_candles)
                            tp_hit = any(c.low <= tp for c in sub_candles)
                            if not sl_hit and not tp_hit and cls.is_actionable_proximity(current_price, eq_entry, tp, sl, "SHORT"):
                                be_price = dynamic_round(eq_entry - (risk_dist * 1.5))
                                score = min(96.0, 72.0 + fib_eval["bonus"] + rej_bonus + session_boost)
                                active_candidates.append({
                                    "direction": "SHORT",
                                    "entry_time": entry_t,
                                    "entry_price": eq_entry,
                                    "entry_zone_high": dynamic_round(fvg.top),
                                    "entry_zone_low": dynamic_round(fvg.bottom),
                                    "sl": sl,
                                    "tp": tp,
                                    "rr": rr,
                                    "be_price": be_price,
                                    "name": f"💎 Apex Quant: FVG 50% EQ + {fib_eval['zone_tag']} [R:R {rr} | BE @ {be_price}]",
                                    "weight": score
                                })

        # Urutkan berdasarkan kombinasi bobot konfluensi tertinggi, kesegaran waktu entry, dan R:R
        active_candidates.sort(key=lambda x: (x["entry_time"], x["weight"], x["rr"]), reverse=True)
        return active_candidates
