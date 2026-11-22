from typing import Tuple, Optional
from ..models.iti_schemas import (
    ITIHardGates,
    ITIGateDetail,
    ITITradePlan,
    ITISmcFeatures,
    ITILiquidityFeatures,
    ITISLHunterFeatures,
    ITIDomFeatures,
    ITIFootprintFeatures,
    ITIVolumeProfileFeatures,
    ITIDerivativesFeatures,
    ITIDataHealth
)

class ITIDecisionEngine:
    """
    Core Decision & Risk Management Engine for ITI.
    Evaluates:
      1. Hard Gates (Strict binary filters: Spread, Freshness, Volatility, Whale Counter)
      2. Multi-disciplinary Confluence Scoring (Long Score vs Short Score 0-100)
      3. Signal Lifecycle State Machine (WATCH -> PREPARE -> CONFIRMED -> INVALIDATED)
      4. Complete Trade Plan Builder (Entry, Invalidation SL, Dynamic TPs, Sizing)
    """
    def evaluate_gates(
        self,
        dom: ITIDomFeatures,
        data_health: ITIDataHealth,
        current_price: float,
        proposed_dir: str
    ) -> ITIHardGates:
        # 1. Spread Gate: Maximum allowable spread 0.05%
        spread_pass = dom.spread_pct <= 0.05
        spread_gate = ITIGateDetail(
            name="Spread Gate",
            status="PASS" if spread_pass else "FAIL",
            reason="Spread ideal (< 0.05%)" if spread_pass else f"Spread terlalu lebar ({dom.spread_pct}%)",
            value=dom.spread_pct,
            threshold=0.05
        )

        # 2. Data Freshness Gate: Maximum latency 3.5s
        freshness_pass = data_health.feed_status == "ONLINE" and data_health.last_update_age_s < 3.5
        freshness_gate = ITIGateDetail(
            name="Data Freshness Gate",
            status="PASS" if freshness_pass else "FAIL",
            reason="Data real-time sinkron" if freshness_pass else f"Data stale ({data_health.last_update_age_s}s)",
            value=data_health.last_update_age_s,
            threshold=3.5
        )

        # 3. Volatility Gate
        vol_pass = not dom.iceberg_warning
        vol_gate = ITIGateDetail(
            name="Microstructure Volatility Gate",
            status="PASS" if vol_pass else "FAIL",
            reason="Struktur orderbook teratur" if vol_pass else "Anomali likuiditas tipis terdeteksi",
            value=1.0 if vol_pass else 0.0,
            threshold=1.0
        )

        # 4. Whale Counter-Wall Gate: Don't long directly into a Whale Ask Wall < 0.35%
        whale_pass = True
        whale_reason = "Tidak ada benturan tembok paus"
        if proposed_dir == "LONG" and dom.whale_ask_wall:
            dist = dom.whale_ask_wall.get("distance_pct", 99.0)
            if 0 < dist < 0.35:
                whale_pass = False
                whale_reason = f"Terhalang Whale Ask Wall di +{dist}%"
        elif proposed_dir == "SHORT" and dom.whale_bid_wall:
            dist = abs(dom.whale_bid_wall.get("distance_pct", -99.0))
            if 0 < dist < 0.35:
                whale_pass = False
                whale_reason = f"Terhalang Whale Bid Wall di -{dist}%"

        whale_gate = ITIGateDetail(
            name="Whale Counter Gate",
            status="PASS" if whale_pass else "FAIL",
            reason=whale_reason,
            value=1.0 if whale_pass else 0.0,
            threshold=1.0
        )

        all_passed = spread_pass and freshness_pass and vol_pass and whale_pass

        return ITIHardGates(
            spread_gate=spread_gate,
            data_freshness_gate=freshness_gate,
            volatility_gate=vol_gate,
            whale_counter_gate=whale_gate,
            all_passed=all_passed
        )

    def calculate_scores(
        self,
        smc: ITISmcFeatures,
        liq: ITILiquidityFeatures,
        sl: ITISLHunterFeatures,
        dom: ITIDomFeatures,
        footprint: ITIFootprintFeatures,
        vp: ITIVolumeProfileFeatures,
        deriv: ITIDerivativesFeatures
    ) -> Tuple[float, float]:
        long_score = 30.0
        short_score = 30.0

        # 1. SMC Structure
        if smc.current_structure in ["BULLISH_MSS", "BULLISH_CONTINUATION"]:
            long_score += 20.0
        elif smc.current_structure in ["BEARISH_MSS", "BEARISH_CONTINUATION"]:
            short_score += 20.0

        if smc.premium_discount == "DISCOUNT":
            long_score += 8.0
        elif smc.premium_discount == "PREMIUM":
            short_score += 8.0

        # 2. SL Hunter & Sweep Reclaim
        if sl.last_sweep_type == "BEAR_TRAP_SWEEP":
            long_score += 15.0
            if sl.reclaim_confirmed:
                long_score += 10.0
        elif sl.last_sweep_type == "BULL_TRAP_SWEEP":
            short_score += 15.0
            if sl.reclaim_confirmed:
                short_score += 10.0

        # 3. DOM Imbalance
        if dom.obi > 0.15:
            long_score += 12.0
        elif dom.obi < -0.15:
            short_score += 12.0

        # 4. Footprint & CVD
        if footprint.cvd_divergence == "BULLISH_ABSORPTION" or footprint.stacked_buy_imbalance:
            long_score += 12.0
        elif footprint.cvd_divergence == "BEARISH_EXHAUSTION" or footprint.stacked_sell_imbalance:
            short_score += 12.0

        # 5. Derivatives
        if deriv.top_trader_long_pct >= 55.0 and deriv.taker_buy_pct >= 52.0:
            long_score += 10.0
        elif deriv.top_trader_long_pct <= 45.0 and deriv.taker_buy_pct <= 48.0:
            short_score += 10.0

        return min(100.0, round(long_score, 1)), min(100.0, round(short_score, 1))

    def evaluate_decision(
        self,
        current_price: float,
        smc: ITISmcFeatures,
        liq: ITILiquidityFeatures,
        sl: ITISLHunterFeatures,
        dom: ITIDomFeatures,
        footprint: ITIFootprintFeatures,
        vp: ITIVolumeProfileFeatures,
        deriv: ITIDerivativesFeatures,
        data_health: ITIDataHealth
    ) -> Tuple[str, str, float, float, float, ITIHardGates, Optional[ITITradePlan]]:
        long_score, short_score = self.calculate_scores(smc, liq, sl, dom, footprint, vp, deriv)

        if long_score >= short_score + 10.0 and long_score >= 50.0:
            direction = "LONG"
            confidence = long_score
        elif short_score >= long_score + 10.0 and short_score >= 50.0:
            direction = "SHORT"
            confidence = short_score
        else:
            direction = "NEUTRAL"
            confidence = max(long_score, short_score)

        hard_gates = self.evaluate_gates(dom, data_health, current_price, direction)

        # Lifecycle State determination
        if confidence >= 72.0 and hard_gates.all_passed and direction != "NEUTRAL":
            lifecycle_state = "CONFIRMED"
        elif confidence >= 58.0 or sl.last_sweep_type != "NONE":
            lifecycle_state = "PREPARE"
        elif confidence >= 45.0:
            lifecycle_state = "WATCH"
        else:
            lifecycle_state = "WATCH"

        # Trade Plan Construction
        trade_plan = None
        if direction == "LONG":
            entry = smc.active_ob["high"] if (smc.active_ob and smc.active_ob["type"] == "BULLISH" and smc.active_ob["high"] < current_price) else current_price
            stop_loss = sl.sweep_price if (sl.last_sweep_type == "BEAR_TRAP_SWEEP" and sl.sweep_price < entry) else (smc.active_ob["low"] * 0.998 if smc.active_ob else current_price * 0.988)
            risk = max(1e-6, entry - stop_loss)
            tp1 = round(entry + risk * 1.5, 2)
            tp2 = round(entry + risk * 2.5, 2)
            tp3 = round(entry + risk * 4.0, 2)
            rr = round((tp1 - entry) / risk, 2)

            trade_plan = ITITradePlan(
                direction="LONG",
                entry_type="LIMIT_OB" if entry < current_price else "MARKET_RECLAIM",
                entry_price=round(entry, 2),
                entry_zone_high=round(entry * 1.002, 2),
                entry_zone_low=round(entry * 0.998, 2),
                invalidation_stop_loss=round(stop_loss, 2),
                tp1_price=tp1,
                tp2_price=tp2,
                tp3_price=tp3,
                risk_reward_ratio=rr,
                recommended_leverage=15,
                suggested_risk_pct=1.5
            )
        elif direction == "SHORT":
            entry = smc.active_ob["low"] if (smc.active_ob and smc.active_ob["type"] == "BEARISH" and smc.active_ob["low"] > current_price) else current_price
            stop_loss = sl.sweep_price if (sl.last_sweep_type == "BULL_TRAP_SWEEP" and sl.sweep_price > entry) else (smc.active_ob["high"] * 1.002 if smc.active_ob else current_price * 1.012)
            risk = max(1e-6, stop_loss - entry)
            tp1 = round(entry - risk * 1.5, 2)
            tp2 = round(entry - risk * 2.5, 2)
            tp3 = round(entry - risk * 4.0, 2)
            rr = round((entry - tp1) / risk, 2)

            trade_plan = ITITradePlan(
                direction="SHORT",
                entry_type="LIMIT_OB" if entry > current_price else "MARKET_RECLAIM",
                entry_price=round(entry, 2),
                entry_zone_high=round(entry * 1.002, 2),
                entry_zone_low=round(entry * 0.998, 2),
                invalidation_stop_loss=round(stop_loss, 2),
                tp1_price=tp1,
                tp2_price=tp2,
                tp3_price=tp3,
                risk_reward_ratio=rr,
                recommended_leverage=15,
                suggested_risk_pct=1.5
            )

        return (
            lifecycle_state,
            direction,
            confidence,
            long_score,
            short_score,
            hard_gates,
            trade_plan
        )

decision_engine = ITIDecisionEngine()
