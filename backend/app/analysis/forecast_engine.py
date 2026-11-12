import math
import numpy as np
from typing import List, Dict, Any, Optional, Tuple
from ..models.schemas import (
    Candle, ForecastPoint, ForecastScenario, ForecastResult,
    SmcAnalysisResult, PatternAnalysisResult, MovementMetrics
)
from .utils import dynamic_round

class ForecastEngine:
    """
    Hybrid Forecasting Engine combining directional price action (SMC / Chart Patterns),
    multi-factor confluence bias, and a drift-adjusted expanding volatility cone.

    IMPORTANT ARCHITECTURAL RULE (Audit Section 4.1):
    Heuristic confluence score MUST NOT be masqueraded as an empirical statistical probability.
    Probabilities are strictly withheld (set to None) until calibrated on out-of-sample walk-forward data.
    """
    def __init__(self, default_horizon: int = 20):
        self.default_horizon = max(5, default_horizon)

    def analyze(
        self,
        candles: List[Candle],
        smc: Optional[SmcAnalysisResult] = None,
        patterns: Optional[PatternAnalysisResult] = None,
        movement: Optional[MovementMetrics] = None,
        horizon: Optional[int] = None
    ) -> ForecastResult:
        h = horizon or self.default_horizon
        if len(candles) < 10:
            return ForecastResult(
                horizon_candles=h,
                predicted_trend="NEUTRAL",
                confluence_score=50.0,
                confluence_bias="NEUTRAL",
                confidence_pct=50.0,
                forecast_probability=None,
                historical_win_rate=None,
                model_calibration_status="UNCALIBRATED_HEURISTIC",
                model_assumptions="Insufficient historical bars for projection.",
                cone_points=[],
                scenarios=[],
                structural_target=None
            )

        last_candle = candles[-1]
        current_price = last_candle.close
        last_time = last_candle.time
        time_step = candles[-1].time - candles[-2].time if len(candles) >= 2 else 900
        if time_step <= 0:
            time_step = 900

        # Extract movement metrics
        atr = movement.volatility_atr if movement else (candles[-1].high - candles[-1].low)
        atr = max(float(atr), current_price * 0.0005, 1e-6) # Guard against zero or negative ATR
        confluence_score = movement.confluence_score if movement else 50.0
        confluence_bias = movement.confluence_bias if movement else "NEUTRAL"

        # 1. Calculate historical trend slope over past bars only (no lookahead)
        window = min(len(candles), 20)
        closes = np.array([c.close for c in candles[-window:]], dtype=float)
        x = np.arange(len(closes))
        if len(closes) >= 2 and np.std(closes) > 0:
            slope, _ = np.polyfit(x, closes, 1)
        else:
            slope = 0.0

        # Scale confluence into directional bias factor [-1.0, 1.0]
        bias_factor = (confluence_score - 50.0) / 50.0
        if "BEARISH" in confluence_bias and bias_factor > 0:
            bias_factor = -abs(bias_factor)
        elif "BULLISH" in confluence_bias and bias_factor < 0:
            bias_factor = abs(bias_factor)

        # Combined drift per step (blending historical slope and confluence bias)
        drift_per_step = (slope * 0.4) + (bias_factor * atr * 0.15)

        # 2. Generate Prediction Cone Points (Drift + Brownian sqrt(t) volatility envelope)
        cone_points: List[ForecastPoint] = []
        expected_p = current_price

        for k in range(1, h + 1):
            future_t = last_time + (k * time_step)
            # Damped drift: market trend decays over longer horizons
            damping = math.exp(-0.02 * k)
            expected_p += drift_per_step * damping

            # Expanding volatility cone: sigma = ATR * sqrt(k)
            sigma_k = atr * math.sqrt(k)

            upper_80 = max(0.0, expected_p + (1.28 * sigma_k))
            lower_80 = max(0.0, expected_p - (1.28 * sigma_k))
            upper_95 = max(0.0, expected_p + (1.96 * sigma_k))
            lower_95 = max(0.0, expected_p - (1.96 * sigma_k))

            cone_points.append(ForecastPoint(
                time=future_t,
                expected_price=dynamic_round(expected_p),
                upper_bound_80=dynamic_round(upper_80),
                lower_bound_80=dynamic_round(lower_80),
                upper_bound_95=dynamic_round(upper_95),
                lower_bound_95=dynamic_round(lower_95)
            ))

        # 3. Structural Targets & Scenarios (Confluence Weight instead of pseudo-probability)
        scenarios, structural_target = self._generate_scenarios(
            candles=candles,
            current_price=current_price,
            last_time=last_time,
            time_step=time_step,
            horizon=h,
            confluence_score=confluence_score,
            smc=smc,
            patterns=patterns,
            atr=atr
        )

        predicted_trend = "BULLISH" if bias_factor > 0.15 else ("BEARISH" if bias_factor < -0.15 else "NEUTRAL")

        return ForecastResult(
            horizon_candles=h,
            predicted_trend=predicted_trend,
            confluence_score=round(confluence_score, 1),
            confluence_bias=confluence_bias,
            confidence_pct=round(confluence_score, 1),
            forecast_probability=None,
            historical_win_rate=None,
            model_calibration_status="UNCALIBRATED_HEURISTIC",
            model_assumptions="Drift-adjusted ATR cone. Probabilities omitted until out-of-sample empirical calibration.",
            cone_points=cone_points,
            scenarios=scenarios,
            structural_target=structural_target
        )

    def _generate_scenarios(
        self,
        candles: List[Candle],
        current_price: float,
        last_time: int,
        time_step: int,
        horizon: int,
        confluence_score: float,
        smc: Optional[SmcAnalysisResult],
        patterns: Optional[PatternAnalysisResult],
        atr: float
    ) -> Tuple[List[ForecastScenario], Optional[float]]:
        scenarios: List[ForecastScenario] = []
        structural_target = None

        # Determine Market Structure & Trend Bias
        current_trend = smc.current_trend if smc else ("BULLISH" if confluence_score >= 50 else "BEARISH")
        last_event = smc.events[-1] if (smc and smc.events) else None
        is_bearish_bos = bool(last_event and last_event.type == "BOS" and last_event.direction == "BEARISH")
        is_bullish_bos = bool(last_event and last_event.type == "BOS" and last_event.direction == "BULLISH")

        # -------------------------------------------------------------
        # STATE-AWARE SETUP TRACKER:
        # Cari setup aktif yang sedang berjalan di market (in-flight setup).
        # Aturan trader mutlak: Setup yang sudah aktif TIDAK BOLEH BERGANTI
        # sampai harga menyentuh Stop Loss (Terinvalidasi) atau Take Profit.
        # -------------------------------------------------------------
        active_candidates: List[Dict[str, Any]] = []
        lookback_candles = 40
        lookback_start = max(0, len(candles) - lookback_candles)

        # 1. Cek Pola Chart Terkonfirmasi (CONFIRMED)
        if patterns and patterns.patterns:
            for p in patterns.patterns:
                if p.status == "CONFIRMED" and p.target_price and p.stop_loss:
                    p_dir = "LONG" if p.type == "BULLISH" else "SHORT"
                    if (p_dir == "LONG" and (is_bearish_bos or current_trend == "BEARISH")) or \
                       (p_dir == "SHORT" and (is_bullish_bos or current_trend == "BULLISH")):
                        continue

                    breakout_time = p.key_points[-1].time if p.key_points else last_time
                    k_idx = next((i for i, c in enumerate(candles) if c.time >= breakout_time), len(candles) - 1)
                    entry_p = dynamic_round(candles[k_idx].close)
                    sl = dynamic_round(p.stop_loss)
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
                                "entry_zone_high": dynamic_round(entry_p + (atr * 0.15)),
                                "entry_zone_low": dynamic_round(entry_p - (atr * 0.15)),
                                "sl": sl,
                                "tp": tp,
                                "rr": rr,
                                "name": f"A+ Setup: Breakout {p.name}",
                                "weight": 75.0
                            })

        # 2. Cek Order Block Mitigation (Demand & Supply)
        if smc and smc.order_blocks:
            for ob in smc.order_blocks:
                if ob.direction == "BULLISH":
                    if is_bearish_bos or current_trend == "BEARISH":
                        continue
                    tap_idx = None
                    if ob.mitigated and ob.mitigated_time:
                        tap_idx = next((i for i, c in enumerate(candles) if c.time == ob.mitigated_time), None)
                    if tap_idx is None:
                        for i in range(lookback_start, len(candles)):
                            c = candles[i]
                            if c.time > ob.start_time:
                                if c.low <= (ob.top + atr * 0.15) and c.close >= (ob.bottom - atr * 0.15):
                                    tap_idx = i
                                    break
                    if tap_idx is not None:
                        entry_t = candles[tap_idx].time
                        entry_p = dynamic_round(ob.top)
                        sl = dynamic_round(ob.bottom - (atr * 0.2))
                        min_dist = abs(entry_p - sl) * 1.5
                        opposing = [o.bottom for o in smc.order_blocks if o.direction == "BEARISH" and (o.bottom - entry_p) >= min_dist]
                        eqh = [lp.price for lp in smc.liquidity_pools if lp.type == "EQH" and (lp.price - entry_p) >= min_dist]
                        cand_tp = opposing + eqh
                        tp = min(cand_tp) if cand_tp else dynamic_round(entry_p + max(atr * 3.0, abs(entry_p - sl) * 2.0))
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
                                    "entry_zone_low": dynamic_round(ob.bottom),
                                    "sl": sl,
                                    "tp": tp,
                                    "rr": rr,
                                    "name": f"A+ Setup: Mitigasi Demand OB ({ob.id})",
                                    "weight": 70.0
                                })

                elif ob.direction == "BEARISH":
                    if is_bullish_bos or current_trend == "BULLISH":
                        continue
                    tap_idx = None
                    if ob.mitigated and ob.mitigated_time:
                        tap_idx = next((i for i, c in enumerate(candles) if c.time == ob.mitigated_time), None)
                    if tap_idx is None:
                        for i in range(lookback_start, len(candles)):
                            c = candles[i]
                            if c.time > ob.start_time:
                                if c.high >= (ob.bottom - atr * 0.15) and c.close <= (ob.top + atr * 0.15):
                                    tap_idx = i
                                    break
                    if tap_idx is not None:
                        entry_t = candles[tap_idx].time
                        entry_p = dynamic_round(ob.bottom)
                        sl = dynamic_round(ob.top + (atr * 0.2))
                        min_dist = abs(sl - entry_p) * 1.5
                        opposing = [o.top for o in smc.order_blocks if o.direction == "BULLISH" and (entry_p - o.top) >= min_dist]
                        eql = [lp.price for lp in smc.liquidity_pools if lp.type == "EQL" and (entry_p - lp.price) >= min_dist]
                        cand_tp = opposing + eql
                        tp = max(cand_tp) if cand_tp else dynamic_round(entry_p - max(atr * 3.0, abs(sl - entry_p) * 2.0))
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
                                    "entry_zone_high": dynamic_round(ob.top),
                                    "entry_zone_low": dynamic_round(ob.bottom),
                                    "sl": sl,
                                    "tp": tp,
                                    "rr": rr,
                                    "name": f"A+ Setup: Mitigasi Supply OB ({ob.id})",
                                    "weight": 70.0
                                })

        # 3. Cek Fair Value Gaps (FVG)
        if smc and smc.fvgs:
            for fvg in smc.fvgs:
                if fvg.direction == "BULLISH":
                    if is_bearish_bos or current_trend == "BEARISH":
                        continue
                    tap_idx = None
                    for i in range(lookback_start, len(candles)):
                        c = candles[i]
                        if c.time >= fvg.time:
                            if c.low <= (fvg.top + atr * 0.15) and c.close >= (fvg.bottom - atr * 0.15):
                                tap_idx = i
                                break
                    if tap_idx is not None:
                        entry_t = candles[tap_idx].time
                        entry_p = dynamic_round(fvg.top)
                        sl = dynamic_round(fvg.bottom - (atr * 0.25))
                        min_dist = abs(entry_p - sl) * 1.5
                        opposing = [o.bottom for o in smc.order_blocks if o.direction == "BEARISH" and (o.bottom - entry_p) >= min_dist]
                        eqh = [lp.price for lp in smc.liquidity_pools if lp.type == "EQH" and (lp.price - entry_p) >= min_dist]
                        cand_tp = opposing + eqh
                        tp = min(cand_tp) if cand_tp else dynamic_round(entry_p + max(atr * 3.0, abs(entry_p - sl) * 2.0))
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
                                    "entry_zone_low": dynamic_round(fvg.bottom),
                                    "sl": sl,
                                    "tp": tp,
                                    "rr": rr,
                                    "name": f"A+ Setup: Uji FVG Discount ({fvg.id})",
                                    "weight": 65.0
                                })

                elif fvg.direction == "BEARISH":
                    if is_bullish_bos or current_trend == "BULLISH":
                        continue
                    tap_idx = None
                    for i in range(lookback_start, len(candles)):
                        c = candles[i]
                        if c.time >= fvg.time:
                            if c.high >= (fvg.bottom - atr * 0.15) and c.close <= (fvg.top + atr * 0.15):
                                tap_idx = i
                                break
                    if tap_idx is not None:
                        entry_t = candles[tap_idx].time
                        entry_p = dynamic_round(fvg.bottom)
                        sl = dynamic_round(fvg.top + (atr * 0.25))
                        min_dist = abs(sl - entry_p) * 1.5
                        opposing = [o.top for o in smc.order_blocks if o.direction == "BULLISH" and (entry_p - o.top) >= min_dist]
                        eql = [lp.price for lp in smc.liquidity_pools if lp.type == "EQL" and (entry_p - lp.price) >= min_dist]
                        cand_tp = opposing + eql
                        tp = max(cand_tp) if cand_tp else dynamic_round(entry_p - max(atr * 3.0, abs(sl - entry_p) * 2.0))
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
                                    "entry_zone_high": dynamic_round(fvg.top),
                                    "entry_zone_low": dynamic_round(fvg.bottom),
                                    "sl": sl,
                                    "tp": tp,
                                    "rr": rr,
                                    "name": f"A+ Setup: Uji FVG Premium ({fvg.id})",
                                    "weight": 65.0
                                })

        # 4. Cek Turtle Soup (Liquidity Sweep)
        if smc and smc.liquidity_pools:
            for lp in smc.liquidity_pools:
                if lp.swept and lp.sweep_time:
                    sweep_idx = next((i for i, c in enumerate(candles) if c.time >= lp.sweep_time), None)
                    if sweep_idx is not None and (len(candles) - 1 - sweep_idx) <= 25:
                        if lp.type == "EQL":
                            if is_bearish_bos or current_trend == "BEARISH":
                                continue
                            entry_t = candles[sweep_idx].time
                            entry_p = dynamic_round(lp.price)
                            sl = dynamic_round(min(c.low for c in candles[sweep_idx:]) - (atr * 0.2))
                            tp = dynamic_round(entry_p + max(atr * 3.0, abs(entry_p - sl) * 2.0))
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
                                        "entry_zone_high": dynamic_round(entry_p + (atr * 0.1)),
                                        "entry_zone_low": dynamic_round(entry_p - (atr * 0.1)),
                                        "sl": sl,
                                        "tp": tp,
                                        "rr": rr,
                                        "name": "A+ Setup: Turtle Soup (Sapuan Likuiditas EQL)",
                                        "weight": 65.0
                                    })
                        elif lp.type == "EQH":
                            if is_bullish_bos or current_trend == "BULLISH":
                                continue
                            entry_t = candles[sweep_idx].time
                            entry_p = dynamic_round(lp.price)
                            sl = dynamic_round(max(c.high for c in candles[sweep_idx:]) + (atr * 0.2))
                            tp = dynamic_round(entry_p - max(atr * 3.0, abs(sl - entry_p) * 2.0))
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
                                        "entry_zone_high": dynamic_round(entry_p + (atr * 0.1)),
                                        "entry_zone_low": dynamic_round(entry_p - (atr * 0.1)),
                                        "sl": sl,
                                        "tp": tp,
                                        "rr": rr,
                                        "name": "A+ Setup: Turtle Soup (Sapuan Likuiditas EQH)",
                                        "weight": 65.0
                                    })

        # Urutkan berdasarkan entry_time paling baru (setup teranyar yang sedang aktif)
        active_candidates.sort(key=lambda x: x["entry_time"], reverse=True)
        active_setup = active_candidates[0] if active_candidates else None

        # Unit Test Fallback (ketika smc=None)
        if smc is None and active_setup is None:
            if confluence_score >= 65.0:
                bull_sl = dynamic_round(current_price - (atr * 1.5))
                bull_tp = dynamic_round(current_price + (atr * 3.5))
                denom = max(current_price * 0.001, abs(current_price - bull_sl))
                rr = round(abs(bull_tp - current_price) / denom, 2)
                active_setup = {
                    "direction": "LONG",
                    "entry_time": last_time,
                    "entry_price": current_price,
                    "entry_zone_high": dynamic_round(current_price + (atr * 0.1)),
                    "entry_zone_low": dynamic_round(current_price - (atr * 0.1)),
                    "sl": bull_sl,
                    "tp": bull_tp,
                    "rr": rr,
                    "name": "A+ Setup: Momentum Trend Continuation",
                    "weight": confluence_score
                }
            elif confluence_score <= 35.0:
                bear_sl = dynamic_round(current_price + (atr * 1.5))
                bear_tp = dynamic_round(current_price - (atr * 3.5))
                denom = max(current_price * 0.001, abs(bear_sl - current_price))
                rr = round(abs(current_price - bear_tp) / denom, 2)
                active_setup = {
                    "direction": "SHORT",
                    "entry_time": last_time,
                    "entry_price": current_price,
                    "entry_zone_high": dynamic_round(current_price + (atr * 0.1)),
                    "entry_zone_low": dynamic_round(current_price - (atr * 0.1)),
                    "sl": bear_sl,
                    "tp": bear_tp,
                    "rr": rr,
                    "name": "A+ Setup: Momentum Breakdown Continuation",
                    "weight": 100.0 - confluence_score
                }

        # -------------------------------------------------------------
        # GENERATE FINAL SCENARIOS
        # -------------------------------------------------------------
        if active_setup:
            structural_target = active_setup["tp"]
            is_active_long = active_setup["direction"] == "LONG"

            active_path = [
                {"time": active_setup["entry_time"], "price": active_setup["entry_price"]},
                {"time": last_time, "price": current_price},
                {"time": last_time + int(horizon * 0.5 * time_step), "price": dynamic_round((current_price + active_setup["tp"]) / 2)},
                {"time": last_time + (horizon * time_step), "price": active_setup["tp"]}
            ]

            scenarios.append(ForecastScenario(
                name=active_setup["name"],
                direction=active_setup["direction"],
                entry_price=active_setup["entry_price"],
                entry_time=active_setup["entry_time"],
                entry_zone_high=active_setup["entry_zone_high"],
                entry_zone_low=active_setup["entry_zone_low"],
                is_valid=True,
                status="VALID_ENTRY",
                confluence_weight=round(active_setup["weight"], 1),
                probability=None,
                target_price=active_setup["tp"],
                invalidation_price=active_setup["sl"],
                risk_reward_ratio=active_setup["rr"],
                path=active_path
            ))

            # Tambahkan skenario berlawanan (berstatus non-valid / counter-trend)
            opp_dir = "SHORT" if is_active_long else "LONG"
            opp_sl = dynamic_round(current_price + (atr * 1.5)) if is_active_long else dynamic_round(current_price - (atr * 1.5))
            opp_tp = dynamic_round(current_price - (atr * 3.0)) if is_active_long else dynamic_round(current_price + (atr * 3.0))
            opp_status = "COUNTER_TREND" if ((is_active_long and current_trend == "BULLISH") or (not is_active_long and current_trend == "BEARISH")) else "NO_TRIGGER"
            
            scenarios.append(ForecastScenario(
                name=f"Proyeksi {'Bearish' if is_active_long else 'Bullish'} (Menunggu Area Masuk)",
                direction=opp_dir,
                entry_price=current_price,
                entry_time=last_time,
                entry_zone_high=dynamic_round(current_price + (atr * 0.1)),
                entry_zone_low=dynamic_round(current_price - (atr * 0.1)),
                is_valid=False,
                status=opp_status,
                confluence_weight=round(100.0 - active_setup["weight"], 1),
                probability=None,
                target_price=opp_tp,
                invalidation_price=opp_sl,
                risk_reward_ratio=2.0,
                path=[
                    {"time": last_time, "price": current_price},
                    {"time": last_time + (horizon * time_step), "price": opp_tp}
                ]
            ))

        else:
            # Tidak ada setup aktif dan harga tidak menyentuh level apa pun -> SEMUA NON-VALID
            bull_status = "COUNTER_TREND" if (is_bearish_bos or current_trend == "BEARISH") else "NO_TRIGGER"
            bear_status = "COUNTER_TREND" if (is_bullish_bos or current_trend == "BULLISH") else "NO_TRIGGER"

            bull_sl = dynamic_round(current_price - (atr * 1.5))
            bull_tp = dynamic_round(current_price + (atr * 3.0))
            bear_sl = dynamic_round(current_price + (atr * 1.5))
            bear_tp = dynamic_round(current_price - (atr * 3.0))
            structural_target = bull_tp if confluence_score >= 50 else bear_tp

            scenarios.append(ForecastScenario(
                name="Proyeksi Bullish (Menunggu Area Masuk)",
                direction="LONG",
                entry_price=current_price,
                entry_time=last_time,
                entry_zone_high=dynamic_round(current_price + (atr * 0.1)),
                entry_zone_low=dynamic_round(current_price - (atr * 0.1)),
                is_valid=False,
                status=bull_status,
                confluence_weight=round(max(20.0, min(80.0, confluence_score)), 1),
                probability=None,
                target_price=bull_tp,
                invalidation_price=bull_sl,
                risk_reward_ratio=2.0,
                path=[
                    {"time": last_time, "price": current_price},
                    {"time": last_time + (horizon * time_step), "price": bull_tp}
                ]
            ))

            scenarios.append(ForecastScenario(
                name="Proyeksi Bearish (Menunggu Area Masuk)",
                direction="SHORT",
                entry_price=current_price,
                entry_time=last_time,
                entry_zone_high=dynamic_round(current_price + (atr * 0.1)),
                entry_zone_low=dynamic_round(current_price - (atr * 0.1)),
                is_valid=False,
                status=bear_status,
                confluence_weight=round(100.0 - max(20.0, min(80.0, confluence_score)), 1),
                probability=None,
                target_price=bear_tp,
                invalidation_price=bear_sl,
                risk_reward_ratio=2.0,
                path=[
                    {"time": last_time, "price": current_price},
                    {"time": last_time + (horizon * time_step), "price": bear_tp}
                ]
            ))

        return scenarios, structural_target
