import numpy as np
from typing import List, Dict, Any, Optional
from ..models.schemas import (
    Candle, SwingPoint, StructureEvent, OrderBlock, FairValueGap, LiquidityPool, SmcAnalysisResult
)

class SmcEngine:
    def __init__(self, swing_length: int = 5, fvg_min_pct: float = 0.05):
        self.swing_length = swing_length
        self.fvg_min_pct = fvg_min_pct

    def analyze(self, candles: List[Candle]) -> SmcAnalysisResult:
        n = len(candles)
        if n < self.swing_length * 2 + 1:
            return SmcAnalysisResult(
                swings=[],
                events=[],
                order_blocks=[],
                fvgs=[],
                liquidity_pools=[],
                current_trend="NEUTRAL"
            )

        # 1. Swing High & Swing Low Detection
        swings = self._detect_swings(candles)

        # 2. BOS & CHoCH Structure Events
        events, current_trend = self._detect_structure_events(candles, swings)

        # 3. Order Blocks (OB)
        order_blocks = self._detect_order_blocks(candles, events)

        # 4. Fair Value Gaps (FVG)
        fvgs = self._detect_fvgs(candles)

        # 5. Liquidity Pools (EQH / EQL)
        liquidity_pools = self._detect_liquidity_pools(swings)

        return SmcAnalysisResult(
            swings=swings,
            events=events,
            order_blocks=order_blocks,
            fvgs=fvgs,
            liquidity_pools=liquidity_pools,
            current_trend=current_trend
        )

    def _detect_swings(self, candles: List[Candle]) -> List[SwingPoint]:
        L = self.swing_length
        n = len(candles)
        swings: List[SwingPoint] = []
        
        last_high: Optional[float] = None
        last_low: Optional[float] = None

        for i in range(L, n - L):
            current_high = candles[i].high
            current_low = candles[i].low

            # Check Swing High
            is_high = True
            for k in range(1, L + 1):
                if candles[i - k].high >= current_high or candles[i + k].high > current_high:
                    is_high = False
                    break
            
            if is_high:
                swing_type = 'HH' if (last_high is not None and current_high > last_high) else 'LH'
                last_high = current_high
                swings.append(SwingPoint(
                    time=candles[i].time,
                    price=current_high,
                    type=swing_type,
                    index=i
                ))
                continue

            # Check Swing Low
            is_low = True
            for k in range(1, L + 1):
                if candles[i - k].low <= current_low or candles[i + k].low < current_low:
                    is_low = False
                    break

            if is_low:
                swing_type = 'HL' if (last_low is not None and current_low > last_low) else 'LL'
                last_low = current_low
                swings.append(SwingPoint(
                    time=candles[i].time,
                    price=current_low,
                    type=swing_type,
                    index=i
                ))

        return swings

    def _detect_structure_events(
        self, candles: List[Candle], swings: List[SwingPoint]
    ) -> tuple[List[StructureEvent], str]:
        events: List[StructureEvent] = []
        if len(swings) < 2:
            return events, "RANGING"

        # Determine initial trend from first swings
        current_trend = "BULLISH" if swings[0].type in ['HH', 'HL'] else "BEARISH"

        last_swing_high = None
        last_swing_low = None

        # Sort swings chronologically
        sorted_swings = sorted(swings, key=lambda s: s.index)

        # Build map of broken levels
        broken_swing_ids = set()

        for s in sorted_swings:
            if s.type in ['HH', 'LH']:
                last_swing_high = s
            else:
                last_swing_low = s

            # Check candles after this swing up to next or end
            # Search for candle close breaking the swing
            target_high = last_swing_high
            target_low = last_swing_low

            # Scan candles ahead to find breaks
            for c_idx in range(s.index + 1, len(candles)):
                c = candles[c_idx]

                # Check break of swing high
                if target_high and id(target_high) not in broken_swing_ids and c.close > target_high.price:
                    # Break occurred
                    broken_swing_ids.add(id(target_high))
                    if current_trend == "BULLISH":
                        event_type = "BOS"
                    else:
                        event_type = "CHoCH"
                        current_trend = "BULLISH"

                    events.append(StructureEvent(
                        id=f"{event_type}_{target_high.time}_{c.time}",
                        type=event_type,
                        direction="BULLISH",
                        break_time=c.time,
                        break_price=c.close,
                        level_price=target_high.price,
                        level_time=target_high.time
                    ))

                # Check break of swing low
                if target_low and id(target_low) not in broken_swing_ids and c.close < target_low.price:
                    broken_swing_ids.add(id(target_low))
                    if current_trend == "BEARISH":
                        event_type = "BOS"
                    else:
                        event_type = "CHoCH"
                        current_trend = "BEARISH"

                    events.append(StructureEvent(
                        id=f"{event_type}_{target_low.time}_{c.time}",
                        type=event_type,
                        direction="BEARISH",
                        break_time=c.time,
                        break_price=c.close,
                        level_price=target_low.price,
                        level_time=target_low.time
                    ))

        return events, current_trend

    def _detect_order_blocks(
        self, candles: List[Candle], events: List[StructureEvent]
    ) -> List[OrderBlock]:
        order_blocks: List[OrderBlock] = []
        n = len(candles)
        candle_map = {c.time: idx for idx, c in enumerate(candles)}

        for ev in events:
            break_idx = candle_map.get(ev.break_time)
            level_idx = candle_map.get(ev.level_time)
            if break_idx is None or level_idx is None or break_idx <= level_idx:
                continue

            # Look for the origin candle before the impulsive break
            if ev.direction == "BULLISH":
                # Find last bearish candle before the rally
                ob_idx = None
                for idx in range(break_idx - 1, max(0, level_idx - 5), -1):
                    if candles[idx].close < candles[idx].open:
                        ob_idx = idx
                        break
                if ob_idx is not None:
                    ob_candle = candles[ob_idx]
                    top = max(ob_candle.open, ob_candle.high)
                    bottom = ob_candle.low

                    # Check mitigation in subsequent candles
                    mitigated = False
                    mitigated_time = None
                    for m_idx in range(break_idx + 1, n):
                        if candles[m_idx].low <= top:
                            mitigated = True
                            mitigated_time = candles[m_idx].time
                            break

                    order_blocks.append(OrderBlock(
                        id=f"OB_BULL_{ob_candle.time}",
                        direction="BULLISH",
                        start_time=ob_candle.time,
                        top=top,
                        bottom=bottom,
                        mitigated=mitigated,
                        mitigated_time=mitigated_time
                    ))

            elif ev.direction == "BEARISH":
                # Find last bullish candle before the drop
                ob_idx = None
                for idx in range(break_idx - 1, max(0, level_idx - 5), -1):
                    if candles[idx].close > candles[idx].open:
                        ob_idx = idx
                        break
                if ob_idx is not None:
                    ob_candle = candles[ob_idx]
                    top = ob_candle.high
                    bottom = min(ob_candle.open, ob_candle.low)

                    # Check mitigation
                    mitigated = False
                    mitigated_time = None
                    for m_idx in range(break_idx + 1, n):
                        if candles[m_idx].high >= bottom:
                            mitigated = True
                            mitigated_time = candles[m_idx].time
                            break

                    order_blocks.append(OrderBlock(
                        id=f"OB_BEAR_{ob_candle.time}",
                        direction="BEARISH",
                        start_time=ob_candle.time,
                        top=top,
                        bottom=bottom,
                        mitigated=mitigated,
                        mitigated_time=mitigated_time
                    ))

        # Deduplicate order blocks by time and limit to recent 15
        unique_obs = {}
        for ob in reversed(order_blocks):
            if ob.start_time not in unique_obs:
                unique_obs[ob.start_time] = ob
        return list(reversed(list(unique_obs.values())))[-15:]

    def _detect_fvgs(self, candles: List[Candle]) -> List[FairValueGap]:
        fvgs: List[FairValueGap] = []
        n = len(candles)
        if n < 3:
            return fvgs

        for i in range(2, n):
            c1 = candles[i - 2]
            c2 = candles[i - 1]
            c3 = candles[i]

            # Bullish FVG: Low of candle 3 is higher than High of candle 1
            if c3.low > c1.high:
                gap = c3.low - c1.high
                mid_price = (c3.low + c1.high) / 2
                pct = (gap / mid_price) * 100
                if pct >= self.fvg_min_pct:
                    # Check mitigation in candles after i
                    mitigated = False
                    for k in range(i + 1, n):
                        if candles[k].low <= c1.high:
                            mitigated = True
                            break
                    fvgs.append(FairValueGap(
                        id=f"FVG_BULL_{c2.time}",
                        direction="BULLISH",
                        time=c2.time,
                        top=c3.low,
                        bottom=c1.high,
                        mitigated=mitigated
                    ))

            # Bearish FVG: High of candle 3 is lower than Low of candle 1
            elif c3.high < c1.low:
                gap = c1.low - c3.high
                mid_price = (c3.high + c1.low) / 2
                pct = (gap / mid_price) * 100
                if pct >= self.fvg_min_pct:
                    mitigated = False
                    for k in range(i + 1, n):
                        if candles[k].high >= c1.low:
                            mitigated = True
                            break
                    fvgs.append(FairValueGap(
                        id=f"FVG_BEAR_{c2.time}",
                        direction="BEARISH",
                        time=c2.time,
                        top=c1.low,
                        bottom=c3.high,
                        mitigated=mitigated
                    ))

        return fvgs[-25:] # Keep recent 25 FVGs

    def _detect_liquidity_pools(self, swings: List[SwingPoint]) -> List[LiquidityPool]:
        pools: List[LiquidityPool] = []
        highs = [s for s in swings if s.type in ['HH', 'LH']]
        lows = [s for s in swings if s.type in ['HL', 'LL']]

        # Tolerance: 0.15% difference
        tolerance = 0.0015

        # Check Equal Highs (EQH)
        for i in range(len(highs) - 1):
            h1 = highs[i]
            for j in range(i + 1, len(highs)):
                h2 = highs[j]
                if abs(h1.price - h2.price) / h1.price <= tolerance:
                    pools.append(LiquidityPool(
                        id=f"EQH_{h1.time}_{h2.time}",
                        type="EQH",
                        price=(h1.price + h2.price) / 2,
                        times=[h1.time, h2.time]
                    ))

        # Check Equal Lows (EQL)
        for i in range(len(lows) - 1):
            l1 = lows[i]
            for j in range(i + 1, len(lows)):
                l2 = lows[j]
                if abs(l1.price - l2.price) / l1.price <= tolerance:
                    pools.append(LiquidityPool(
                        id=f"EQL_{l1.time}_{l2.time}",
                        type="EQL",
                        price=(l1.price + l2.price) / 2,
                        times=[l1.time, l2.time]
                    ))

        return pools[-10:]
