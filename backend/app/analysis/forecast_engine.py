import math
import numpy as np
from typing import List, Dict, Any, Optional
from ..models.schemas import (
    Candle, ForecastPoint, ForecastScenario, ForecastResult,
    SmcAnalysisResult, PatternAnalysisResult, MovementMetrics
)
from .utils import dynamic_round

class ForecastEngine:
    def __init__(self, default_horizon: int = 20):
        self.default_horizon = default_horizon

    def analyze(
        self,
        candles: List[Candle],
        smc: Optional[SmcAnalysisResult] = None,
        patterns: Optional[PatternAnalysisResult] = None,
        movement: Optional[MovementMetrics] = None,
        horizon: Optional[int] = None
    ) -> ForecastResult:
        h = horizon or self.default_horizon
        if len(candles) < 30:
            return ForecastResult(
                horizon_candles=h,
                predicted_trend="NEUTRAL",
                confidence_pct=50.0,
                cone_points=[],
                scenarios=[],
                structural_target=None
            )

        last_candle = candles[-1]
        current_price = last_candle.close
        last_time = last_candle.time
        time_step = candles[-1].time - candles[-2].time if len(candles) >= 2 else 900

        # Extract movement metrics
        atr = movement.volatility_atr if movement else (candles[-1].high - candles[-1].low)
        atr = max(atr, current_price * 0.001) # Avoid zero
        confluence_score = movement.confluence_score if movement else 50.0
        confluence_bias = movement.confluence_bias if movement else "NEUTRAL"

        # 1. Calculate historical trend slope over recent 20 candles
        closes = np.array([c.close for c in candles[-20:]])
        x = np.arange(len(closes))
        slope, _ = np.polyfit(x, closes, 1)

        # Scale confluence into directional bias factor [-1.0, 1.0]
        bias_factor = (confluence_score - 50.0) / 50.0
        if "BEARISH" in confluence_bias and bias_factor > 0:
            bias_factor = -abs(bias_factor)
        elif "BULLISH" in confluence_bias and bias_factor < 0:
            bias_factor = abs(bias_factor)

        # Combined drift per step (blending recent slope and confluence bias)
        drift_per_step = (slope * 0.4) + (bias_factor * atr * 0.15)

        # 2. Generate Prediction Cone Points
        cone_points: List[ForecastPoint] = []
        expected_p = current_price

        for k in range(1, h + 1):
            future_t = last_time + (k * time_step)
            # Damped drift
            damping = math.exp(-0.02 * k)
            expected_p += drift_per_step * damping

            # Expanding standard deviation cone: sigma = ATR * sqrt(k)
            sigma_k = atr * math.sqrt(k)

            upper_80 = expected_p + (1.28 * sigma_k)
            lower_80 = expected_p - (1.28 * sigma_k)
            upper_95 = expected_p + (1.96 * sigma_k)
            lower_95 = expected_p - (1.96 * sigma_k)

            cone_points.append(ForecastPoint(
                time=future_t,
                expected_price=dynamic_round(expected_p),
                upper_bound_80=dynamic_round(upper_80),
                lower_bound_80=dynamic_round(lower_80),
                upper_bound_95=dynamic_round(upper_95),
                lower_bound_95=dynamic_round(lower_95)
            ))

        # 3. Structural Targets & Scenarios
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
            confidence_pct=round(confluence_score, 1),
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
    ) -> tuple[List[ForecastScenario], Optional[float]]:
        scenarios: List[ForecastScenario] = []
        structural_target = None

        # Check if an active pattern has a defined target
        if patterns and patterns.patterns:
            for p in patterns.patterns:
                if p.target_price and p.stop_loss:
                    structural_target = p.target_price
                    prob = 65.0 if (confluence_score >= 50 and p.type == "BULLISH") or (confluence_score < 50 and p.type == "BEARISH") else 45.0
                    denom = max(current_price * 0.001, abs(current_price - p.stop_loss))
                    rr = abs(p.target_price - current_price) / denom

                    # Path
                    path = [
                        {"time": last_time, "price": current_price},
                        {"time": last_time + int(horizon * 0.4 * time_step), "price": dynamic_round((current_price + p.target_price) / 2)},
                        {"time": last_time + (horizon * time_step), "price": p.target_price}
                    ]

                    scenarios.append(ForecastScenario(
                        name=f"Proyeksi Pola: {p.name}",
                        probability=round(prob, 1),
                        target_price=p.target_price,
                        invalidation_price=p.stop_loss,
                        risk_reward_ratio=round(rr, 2),
                        path=path
                    ))
                    break

        # Check SMC Liquidity Pools & Order Blocks for primary scenario
        bullish_target = None
        bearish_target = None
        bullish_sl = current_price - (atr * 2.0)
        bearish_sl = current_price + (atr * 2.0)

        if smc:
            bearish_obs_above = [ob.bottom for ob in smc.order_blocks if ob.direction == "BEARISH" and ob.bottom > current_price and not ob.mitigated]
            if bearish_obs_above:
                bullish_target = min(bearish_obs_above)
            
            eqh_above = [lp.price for lp in smc.liquidity_pools if lp.type == "EQH" and lp.price > current_price]
            if eqh_above and (bullish_target is None or min(eqh_above) < bullish_target):
                bullish_target = min(eqh_above)

            bullish_obs_below = [ob.top for ob in smc.order_blocks if ob.direction == "BULLISH" and ob.top < current_price and not ob.mitigated]
            if bullish_obs_below:
                bearish_target = max(bullish_obs_below)
                bullish_sl = max(bullish_obs_below) * 0.998

        # Fallback targets if no OB/Liquidity pool nearby
        if bullish_target is None:
            bullish_target = dynamic_round(current_price + (atr * 3.5))
        if bearish_target is None:
            bearish_target = dynamic_round(current_price - (atr * 3.5))

        if structural_target is None:
            structural_target = bullish_target if confluence_score >= 50 else bearish_target

        # Scenario A: Bullish Scenario
        bullish_prob = max(20.0, min(80.0, confluence_score))
        denom_b = max(current_price * 0.001, abs(current_price - bullish_sl))
        bullish_rr = abs(bullish_target - current_price) / denom_b
        scenarios.append(ForecastScenario(
            name="Skenario Bullish (Breakout & Likuiditas Atas)",
            probability=round(bullish_prob, 1),
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

        # Scenario B: Bearish Scenario
        bearish_prob = round(100.0 - bullish_prob, 1)
        denom_s = max(current_price * 0.001, abs(bearish_sl - current_price))
        bearish_rr = abs(current_price - bearish_target) / denom_s
        scenarios.append(ForecastScenario(
            name="Skenario Bearish (Koreksi / Sapu Likuiditas Bawah)",
            probability=bearish_prob,
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
