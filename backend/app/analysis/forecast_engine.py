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

        # Check if an active pattern has a defined target
        if patterns and patterns.patterns:
            for p in patterns.patterns:
                if p.target_price and p.stop_loss:
                    structural_target = p.target_price
                    weight = 65.0 if (confluence_score >= 50 and p.type == "BULLISH") or (confluence_score < 50 and p.type == "BEARISH") else 45.0
                    denom = max(current_price * 0.001, abs(current_price - p.stop_loss))
                    rr = abs(p.target_price - current_price) / denom
                    p_dir = "LONG" if p.type == "BULLISH" else "SHORT"
                    p_valid = rr >= 1.5 and ((p_dir == "LONG" and confluence_score >= 50) or (p_dir == "SHORT" and confluence_score <= 50))

                    path = [
                        {"time": last_time, "price": current_price},
                        {"time": last_time + int(horizon * 0.4 * time_step), "price": dynamic_round((current_price + p.target_price) / 2)},
                        {"time": last_time + (horizon * time_step), "price": p.target_price}
                    ]

                    scenarios.append(ForecastScenario(
                        name=f"Proyeksi Pola: {p.name}",
                        direction=p_dir,
                        entry_price=current_price,
                        entry_time=last_time,
                        entry_zone_high=dynamic_round(current_price + (atr * 0.2)),
                        entry_zone_low=dynamic_round(current_price - (atr * 0.2)),
                        is_valid=p_valid,
                        status="VALID_ENTRY" if p_valid else ("PENDING_CONFLUENCE" if rr >= 1.5 else "LOW_RR"),
                        confluence_weight=round(weight, 1),
                        probability=None,
                        target_price=p.target_price,
                        invalidation_price=p.stop_loss,
                        risk_reward_ratio=round(rr, 2),
                        path=path
                    ))
                    break

        # Determine Market Structure & Trend Bias
        current_trend = smc.current_trend if smc else ("BULLISH" if confluence_score >= 50 else "BEARISH")
        last_event = smc.events[-1] if (smc and smc.events) else None
        is_bearish_bos = bool(last_event and last_event.type == "BOS" and last_event.direction == "BEARISH")
        is_bullish_bos = bool(last_event and last_event.type == "BOS" and last_event.direction == "BULLISH")

        # 1. Bullish SL: TIGHT SMC SL based on immediate local support / order block
        bullish_sl = dynamic_round(current_price - (atr * 1.5))
        bullish_entry_high = dynamic_round(current_price + (atr * 0.1))
        bullish_entry_low = dynamic_round(current_price - (atr * 0.25))

        if smc:
            nearby_bullish_obs = [ob for ob in smc.order_blocks if ob.direction == "BULLISH" and not ob.mitigated and (current_price - ob.top) <= (atr * 2.5) and ob.bottom < current_price]
            if nearby_bullish_obs:
                best_ob = max(nearby_bullish_obs, key=lambda x: x.top)
                bullish_sl = dynamic_round(best_ob.bottom - (atr * 0.2))
                bullish_entry_high = dynamic_round(best_ob.top)
                bullish_entry_low = dynamic_round(best_ob.bottom)
            else:
                recent_lows = [s.price for s in smc.swings if s.type in ("L", "HL", "LL") and s.price < current_price and (current_price - s.price) <= (atr * 2.5)]
                if recent_lows:
                    bullish_sl = dynamic_round(recent_lows[-1] - (atr * 0.2))

        # 2. Bullish Target (TP): Target opposing liquidity pool at least 1.5x SL distance away
        min_bullish_target_dist = abs(current_price - bullish_sl) * 1.5
        bullish_target = None
        if smc:
            valid_bearish_obs = [ob.bottom for ob in smc.order_blocks if ob.direction == "BEARISH" and not ob.mitigated and (ob.bottom - current_price) >= min_bullish_target_dist]
            if valid_bearish_obs:
                bullish_target = min(valid_bearish_obs)
            
            valid_eqh = [lp.price for lp in smc.liquidity_pools if lp.type == "EQH" and (lp.price - current_price) >= min_bullish_target_dist]
            if valid_eqh and (bullish_target is None or min(valid_eqh) < bullish_target):
                bullish_target = min(valid_eqh)

        if bullish_target is None:
            bullish_target = dynamic_round(current_price + max(atr * 3.0, abs(current_price - bullish_sl) * 2.0))

        # 3. Bearish SL: TIGHT SMC SL based on immediate local resistance / order block
        bearish_sl = dynamic_round(current_price + (atr * 1.5))
        bearish_entry_high = dynamic_round(current_price + (atr * 0.25))
        bearish_entry_low = dynamic_round(current_price - (atr * 0.1))

        if smc:
            nearby_bearish_obs = [ob for ob in smc.order_blocks if ob.direction == "BEARISH" and not ob.mitigated and (ob.bottom - current_price) <= (atr * 2.5) and ob.top > current_price]
            if nearby_bearish_obs:
                best_ob_b = min(nearby_bearish_obs, key=lambda x: x.bottom)
                bearish_sl = dynamic_round(best_ob_b.top + (atr * 0.2))
                bearish_entry_high = dynamic_round(best_ob_b.top)
                bearish_entry_low = dynamic_round(best_ob_b.bottom)
            else:
                recent_highs = [s.price for s in smc.swings if s.type in ("H", "HH", "LH") and s.price > current_price and (s.price - current_price) <= (atr * 2.5)]
                if recent_highs:
                    bearish_sl = dynamic_round(recent_highs[-1] + (atr * 0.2))

        # 4. Bearish Target (TP): Target opposing liquidity pool below at least 1.5x SL distance away
        min_bearish_target_dist = abs(bearish_sl - current_price) * 1.5
        bearish_target = None
        if smc:
            valid_bullish_obs = [ob.top for ob in smc.order_blocks if ob.direction == "BULLISH" and not ob.mitigated and (current_price - ob.top) >= min_bearish_target_dist]
            if valid_bullish_obs:
                bearish_target = max(valid_bullish_obs)
            
            valid_eql = [lp.price for lp in smc.liquidity_pools if lp.type == "EQL" and (current_price - lp.price) >= min_bearish_target_dist]
            if valid_eql and (bearish_target is None or max(valid_eql) > bearish_target):
                bearish_target = max(valid_eql)

        if bearish_target is None:
            bearish_target = dynamic_round(current_price - max(atr * 3.0, abs(bearish_sl - current_price) * 2.0))

        if structural_target is None:
            structural_target = bullish_target if confluence_score >= 50 else bearish_target

        # Strict R:R calculation
        denom_b = max(current_price * 0.001, abs(current_price - bullish_sl))
        bullish_rr = abs(bullish_target - current_price) / denom_b

        denom_s = max(current_price * 0.001, abs(bearish_sl - current_price))
        bearish_rr = abs(current_price - bearish_target) / denom_s

        # Long is INVALID if:
        # - Market is in Bearish BOS continuation or Bearish trend
        # - Confluence score < 52.0
        # - R:R < 1.5
        # - Or immediate resistance obstacle blocks path
        has_immediate_bearish_wall = False
        if smc:
            immediate_walls = [ob.bottom for ob in smc.order_blocks if ob.direction == "BEARISH" and not ob.mitigated and 0 < (ob.bottom - current_price) < (atr * 0.8)]
            if immediate_walls:
                has_immediate_bearish_wall = True

        bullish_is_valid = (
            bullish_rr >= 1.5 and
            confluence_score >= 52.0 and
            not is_bearish_bos and
            current_trend != "BEARISH" and
            not has_immediate_bearish_wall
        )

        bullish_status = "VALID_ENTRY" if bullish_is_valid else (
            "LOW_RR" if bullish_rr < 1.5 else (
                "COUNTER_TREND" if (is_bearish_bos or current_trend == "BEARISH") else (
                    "IMMEDIATE_RESISTANCE" if has_immediate_bearish_wall else "PENDING_CONFLUENCE"
                )
            )
        )

        # Short is INVALID if:
        # - Market is in Bullish BOS continuation or Bullish trend
        # - Confluence score > 48.0
        # - R:R < 1.5
        # - Or immediate support obstacle blocks path
        has_immediate_bullish_floor = False
        if smc:
            immediate_floors = [ob.top for ob in smc.order_blocks if ob.direction == "BULLISH" and not ob.mitigated and 0 < (current_price - ob.top) < (atr * 0.8)]
            if immediate_floors:
                has_immediate_bullish_floor = True

        bearish_is_valid = (
            bearish_rr >= 1.5 and
            confluence_score <= 48.0 and
            not is_bullish_bos and
            current_trend != "BULLISH" and
            not has_immediate_bullish_floor
        )

        bearish_status = "VALID_ENTRY" if bearish_is_valid else (
            "LOW_RR" if bearish_rr < 1.5 else (
                "COUNTER_TREND" if (is_bullish_bos or current_trend == "BULLISH") else (
                    "IMMEDIATE_SUPPORT" if has_immediate_bullish_floor else "PENDING_CONFLUENCE"
                )
            )
        )

        # Scenario A: Bullish Scenario (Long Position)
        bullish_weight = max(20.0, min(80.0, confluence_score))
        scenarios.append(ForecastScenario(
            name="Skenario Bullish (Breakout & Likuiditas Atas)",
            direction="LONG",
            entry_price=current_price,
            entry_time=last_time,
            entry_zone_high=bullish_entry_high,
            entry_zone_low=bullish_entry_low,
            is_valid=bullish_is_valid,
            status=bullish_status,
            confluence_weight=round(bullish_weight, 1),
            probability=None,
            target_price=bullish_target,
            invalidation_price=dynamic_round(bullish_sl),
            risk_reward_ratio=round(bullish_rr, 2),
            path=[
                {"time": last_time, "price": current_price},
                {"time": last_time + int(horizon * 0.3 * time_step), "price": dynamic_round(current_price - (atr * 0.4))},
                {"time": last_time + int(horizon * 0.7 * time_step), "price": dynamic_round(current_price + (bullish_target - current_price) * 0.6)},
                {"time": last_time + (horizon * time_step), "price": bullish_target}
            ]
        ))

        # Scenario B: Bearish Scenario (Short Position)
        bearish_weight = round(100.0 - bullish_weight, 1)
        scenarios.append(ForecastScenario(
            name="Skenario Bearish (Koreksi / Sapu Likuiditas Bawah)",
            direction="SHORT",
            entry_price=current_price,
            entry_time=last_time,
            entry_zone_high=bearish_entry_high,
            entry_zone_low=bearish_entry_low,
            is_valid=bearish_is_valid,
            status=bearish_status,
            confluence_weight=bearish_weight,
            probability=None,
            target_price=bearish_target,
            invalidation_price=dynamic_round(bearish_sl),
            risk_reward_ratio=round(bearish_rr, 2),
            path=[
                {"time": last_time, "price": current_price},
                {"time": last_time + int(horizon * 0.3 * time_step), "price": dynamic_round(current_price + (atr * 0.4))},
                {"time": last_time + int(horizon * 0.7 * time_step), "price": dynamic_round(current_price - (current_price - bearish_target) * 0.6)},
                {"time": last_time + (horizon * time_step), "price": bearish_target}
            ]
        ))

        return scenarios, structural_target
