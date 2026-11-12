import numpy as np
from typing import List, Dict, Any, Optional, Tuple, Set
from ..models.schemas import (
    Candle, SwingPoint, StructureEvent, OrderBlock, FairValueGap, LiquidityPool, SmcAnalysisResult
)

class SmcEngine:
    def __init__(self, swing_length: int = 5, fvg_min_pct: float = 0.05, break_mode: str = "close"):
        """
        :param swing_length: Number of bars to left and right to confirm a swing point.
        :param fvg_min_pct: Minimum gap size as percentage of mid-price.
        :param break_mode: Break evaluation method: 'close' (default) requires candle close beyond swing level.
        """
        self.swing_length = max(2, swing_length)
        self.fvg_min_pct = fvg_min_pct
        self.break_mode = break_mode.lower()

    def analyze(self, candles: List[Candle]) -> SmcAnalysisResult:
        n = len(candles)
        if n < 3:
            return SmcAnalysisResult(
                swings=[],
                events=[],
                order_blocks=[],
                fvgs=[],
                liquidity_pools=[],
                current_trend="NEUTRAL"
            )

        # 1. Deterministic Swing Detection
        swings = self._detect_swings(candles)

        # 2. Chronological BOS & CHoCH Structure Events via State Machine
        events, current_trend = self._detect_structure_events_chronological(candles, swings)

        # 3. Order Blocks with Overlap and Status Lifecycle
        order_blocks = self._detect_order_blocks(candles, events)

        # 4. Fair Value Gaps with Partial Fill and Invalidation Tracking
        fvgs = self._detect_fvgs(candles)

        # 5. Liquidity Pools with Multi-touch Clustering and Sweep Detection
        liquidity_pools = self._detect_liquidity_pools(candles, swings)

        return SmcAnalysisResult(
            swings=swings,
            events=events,
            order_blocks=order_blocks,
            fvgs=fvgs,
            liquidity_pools=liquidity_pools,
            current_trend=current_trend
        )

    def _detect_swings(self, candles: List[Candle]) -> List[SwingPoint]:
        """
        Detect swing highs and swing lows with right-bars confirmation.
        Avoids assigning HH/LH/HL/LL to initial swings without structural comparison.
        """
        L = self.swing_length
        n = len(candles)
        swings: List[SwingPoint] = []

        last_high: Optional[float] = None
        last_low: Optional[float] = None

        for i in range(L, n - L):
            current_high = candles[i].high
            current_low = candles[i].low

            # 1. Check Swing High
            is_high = True
            for k in range(1, L + 1):
                if candles[i - k].high >= current_high or candles[i + k].high > current_high:
                    is_high = False
                    break

            if is_high:
                if last_high is None:
                    swing_type = 'H'  # Initial swing high without predecessor
                elif current_high > last_high:
                    swing_type = 'HH'
                else:
                    swing_type = 'LH'
                last_high = current_high
                swings.append(SwingPoint(
                    time=candles[i].time,
                    price=current_high,
                    type=swing_type,
                    index=i
                ))
                continue

            # 2. Check Swing Low
            is_low = True
            for k in range(1, L + 1):
                if candles[i - k].low <= current_low or candles[i + k].low < current_low:
                    is_low = False
                    break

            if is_low:
                if last_low is None:
                    swing_type = 'L'  # Initial swing low without predecessor
                elif current_low > last_low:
                    swing_type = 'HL'
                else:
                    swing_type = 'LL'
                last_low = current_low
                swings.append(SwingPoint(
                    time=candles[i].time,
                    price=current_low,
                    type=swing_type,
                    index=i
                ))

        return swings

    def _detect_structure_events_chronological(
        self, candles: List[Candle], swings: List[SwingPoint]
    ) -> Tuple[List[StructureEvent], str]:
        """
        Processes candles strictly forward in chronological order using a state machine.
        A swing level only becomes active when its right-bars confirmation index is reached.
        Prevents repainting, look-ahead bias, and duplicate break events.
        """
        events: List[StructureEvent] = []
        if not swings or not candles:
            return events, "RANGING"

        current_trend = "RANGING"

        # Organize swings by the bar index at which they become fully confirmed
        # Confirmation occurs at swing.index + swing_length
        swings_by_confirm_bar: Dict[int, List[SwingPoint]] = {}
        for s in swings:
            confirm_bar = s.index + self.swing_length
            if confirm_bar not in swings_by_confirm_bar:
                swings_by_confirm_bar[confirm_bar] = []
            swings_by_confirm_bar[confirm_bar].append(s)

        active_swing_high: Optional[SwingPoint] = None
        active_swing_low: Optional[SwingPoint] = None
        broken_levels: Set[str] = set()

        # Step through every candle chronologically
        for c_idx, candle in enumerate(candles):
            # 1. Activate any swings that are newly confirmed at this candle
            if c_idx in swings_by_confirm_bar:
                for new_s in swings_by_confirm_bar[c_idx]:
                    if new_s.type in ['H', 'HH', 'LH']:
                        active_swing_high = new_s
                    elif new_s.type in ['L', 'HL', 'LL']:
                        active_swing_low = new_s

            # 2. Evaluate break of active swing high
            if active_swing_high is not None:
                high_id = f"HIGH_{active_swing_high.time}_{active_swing_high.price}"
                if high_id not in broken_levels:
                    # Break evaluation: Close break or Wick break
                    is_broken = candle.close > active_swing_high.price if self.break_mode == "close" else candle.high > active_swing_high.price
                    if is_broken:
                        broken_levels.add(high_id)
                        if current_trend == "BULLISH":
                            event_type = "BOS"
                        else:
                            event_type = "CHoCH"
                            current_trend = "BULLISH"

                        events.append(StructureEvent(
                            id=f"{event_type}_{active_swing_high.time}_{candle.time}",
                            type=event_type,
                            direction="BULLISH",
                            break_time=candle.time,
                            break_price=candle.close,
                            level_price=active_swing_high.price,
                            level_time=active_swing_high.time
                        ))

            # 3. Evaluate break of active swing low
            if active_swing_low is not None:
                low_id = f"LOW_{active_swing_low.time}_{active_swing_low.price}"
                if low_id not in broken_levels:
                    is_broken = candle.close < active_swing_low.price if self.break_mode == "close" else candle.low < active_swing_low.price
                    if is_broken:
                        broken_levels.add(low_id)
                        if current_trend == "BEARISH":
                            event_type = "BOS"
                        else:
                            event_type = "CHoCH"
                            current_trend = "BEARISH"

                        events.append(StructureEvent(
                            id=f"{event_type}_{active_swing_low.time}_{candle.time}",
                            type=event_type,
                            direction="BEARISH",
                            break_time=candle.time,
                            break_price=candle.close,
                            level_price=active_swing_low.price,
                            level_time=active_swing_low.time
                        ))

        return events, current_trend

    def _detect_order_blocks(
        self, candles: List[Candle], events: List[StructureEvent]
    ) -> List[OrderBlock]:
        """
        Detects Order Blocks associated with confirmed BOS/CHoCH events.
        Applies strict zone range overlap [candle_low <= top and candle_high >= bottom],
        and differentiates ACTIVE, MITIGATED, and INVALIDATED states.
        """
        order_blocks: List[OrderBlock] = []
        n = len(candles)
        candle_map = {c.time: idx for idx, c in enumerate(candles)}

        for ev in events:
            break_idx = candle_map.get(ev.break_time)
            level_idx = candle_map.get(ev.level_time)
            if break_idx is None or level_idx is None or break_idx <= level_idx:
                continue

            if ev.direction == "BULLISH":
                # Bullish OB: Last down/bearish candle before the impulsive rally
                ob_idx = None
                for idx in range(break_idx - 1, max(0, level_idx - 5), -1):
                    if candles[idx].close < candles[idx].open:
                        ob_idx = idx
                        break
                if ob_idx is not None:
                    ob_candle = candles[ob_idx]
                    top = max(ob_candle.open, ob_candle.close)
                    bottom = ob_candle.low

                    status = "ACTIVE"
                    mitigated = False
                    mitigated_time = None
                    invalidation_time = None

                    # Check subsequent candles for zone overlap and invalidation
                    for m_idx in range(break_idx + 1, n):
                        c = candles[m_idx]
                        # 1. Invalidation rule: candle close strictly below zone bottom
                        if c.close < bottom:
                            status = "INVALIDATED"
                            invalidation_time = c.time
                            break

                        # 2. Mitigation rule: candle range intersects the zone [bottom, top]
                        if not mitigated and (c.low <= top and c.high >= bottom):
                            status = "MITIGATED"
                            mitigated = True
                            mitigated_time = c.time

                    order_blocks.append(OrderBlock(
                        id=f"OB_BULL_{ob_candle.time}",
                        direction="BULLISH",
                        start_time=ob_candle.time,
                        top=top,
                        bottom=bottom,
                        status=status,
                        mitigated=mitigated,
                        mitigated_time=mitigated_time,
                        invalidation_time=invalidation_time
                    ))

            elif ev.direction == "BEARISH":
                # Bearish OB: Last up/bullish candle before the impulsive drop
                ob_idx = None
                for idx in range(break_idx - 1, max(0, level_idx - 5), -1):
                    if candles[idx].close > candles[idx].open:
                        ob_idx = idx
                        break
                if ob_idx is not None:
                    ob_candle = candles[ob_idx]
                    top = ob_candle.high
                    bottom = min(ob_candle.open, ob_candle.close)

                    status = "ACTIVE"
                    mitigated = False
                    mitigated_time = None
                    invalidation_time = None

                    for m_idx in range(break_idx + 1, n):
                        c = candles[m_idx]
                        # 1. Invalidation rule: candle close strictly above zone top
                        if c.close > top:
                            status = "INVALIDATED"
                            invalidation_time = c.time
                            break

                        # 2. Mitigation rule: candle range intersects the zone [bottom, top]
                        if not mitigated and (c.high >= bottom and c.low <= top):
                            status = "MITIGATED"
                            mitigated = True
                            mitigated_time = c.time

                    order_blocks.append(OrderBlock(
                        id=f"OB_BEAR_{ob_candle.time}",
                        direction="BEARISH",
                        start_time=ob_candle.time,
                        top=top,
                        bottom=bottom,
                        status=status,
                        mitigated=mitigated,
                        mitigated_time=mitigated_time,
                        invalidation_time=invalidation_time
                    ))

        # Deduplicate order blocks by start_time and limit to recent 15
        unique_obs: Dict[int, OrderBlock] = {}
        for ob in reversed(order_blocks):
            if ob.start_time not in unique_obs:
                unique_obs[ob.start_time] = ob
        return list(reversed(list(unique_obs.values())))[-15:]

    def _detect_fvgs(self, candles: List[Candle]) -> List[FairValueGap]:
        """
        Detects Fair Value Gaps across 3 consecutive candles.
        Calculates penetration percentage, full fill, and close-based invalidation.
        """
        fvgs: List[FairValueGap] = []
        n = len(candles)
        if n < 3:
            return fvgs

        for i in range(2, n):
            c1 = candles[i - 2]
            c2 = candles[i - 1]
            c3 = candles[i]

            # Bullish FVG: Low of candle 3 is strictly higher than High of candle 1
            if c3.low > c1.high:
                gap = c3.low - c1.high
                mid_price = (c3.low + c1.high) / 2
                pct = (gap / mid_price) * 100
                if pct >= self.fvg_min_pct:
                    top = c3.low
                    bottom = c1.high
                    status = "UNFILLED"
                    fill_pct = 0.0
                    mitigated = False
                    mitigated_time = None

                    for k in range(i + 1, n):
                        ck = candles[k]
                        # Invalidation check: close below gap bottom
                        if ck.close < bottom:
                            status = "INVALIDATED"
                            fill_pct = 100.0
                            mitigated = True
                            mitigated_time = ck.time
                            break

                        # Penetration calculation
                        if ck.low < top:
                            penetration = min(gap, top - ck.low)
                            cur_fill = (penetration / gap) * 100
                            if cur_fill > fill_pct:
                                fill_pct = round(cur_fill, 1)

                            if ck.low <= bottom:
                                status = "FILLED"
                                fill_pct = 100.0
                                mitigated = True
                                mitigated_time = ck.time
                                break
                            else:
                                status = "PARTIALLY_FILLED"

                    fvgs.append(FairValueGap(
                        id=f"FVG_BULL_{c2.time}",
                        direction="BULLISH",
                        time=c2.time,
                        top=top,
                        bottom=bottom,
                        status=status,
                        fill_pct=fill_pct,
                        mitigated=mitigated,
                        mitigated_time=mitigated_time
                    ))

            # Bearish FVG: High of candle 3 is strictly lower than Low of candle 1
            elif c3.high < c1.low:
                gap = c1.low - c3.high
                mid_price = (c3.high + c1.low) / 2
                pct = (gap / mid_price) * 100
                if pct >= self.fvg_min_pct:
                    top = c1.low
                    bottom = c3.high
                    status = "UNFILLED"
                    fill_pct = 0.0
                    mitigated = False
                    mitigated_time = None

                    for k in range(i + 1, n):
                        ck = candles[k]
                        # Invalidation check: close above gap top
                        if ck.close > top:
                            status = "INVALIDATED"
                            fill_pct = 100.0
                            mitigated = True
                            mitigated_time = ck.time
                            break

                        # Penetration calculation
                        if ck.high > bottom:
                            penetration = min(gap, ck.high - bottom)
                            cur_fill = (penetration / gap) * 100
                            if cur_fill > fill_pct:
                                fill_pct = round(cur_fill, 1)

                            if ck.high >= top:
                                status = "FILLED"
                                fill_pct = 100.0
                                mitigated = True
                                mitigated_time = ck.time
                                break
                            else:
                                status = "PARTIALLY_FILLED"

                    fvgs.append(FairValueGap(
                        id=f"FVG_BEAR_{c2.time}",
                        direction="BEARISH",
                        time=c2.time,
                        top=top,
                        bottom=bottom,
                        status=status,
                        fill_pct=fill_pct,
                        mitigated=mitigated,
                        mitigated_time=mitigated_time
                    ))

        return fvgs[-25:]

    def _detect_liquidity_pools(
        self, candles: List[Candle], swings: List[SwingPoint]
    ) -> List[LiquidityPool]:
        """
        Clusters swing highs and lows into Equal Highs (EQH) and Equal Lows (EQL).
        Tracks liquidity sweep status deterministically.
        """
        pools: List[LiquidityPool] = []
        highs = [s for s in swings if s.type in ['H', 'HH', 'LH']]
        lows = [s for s in swings if s.type in ['L', 'HL', 'LL']]

        tolerance = 0.0015  # 0.15% threshold for equal levels

        # 1. Cluster Highs (EQH)
        high_clusters: List[List[SwingPoint]] = []
        for h in highs:
            placed = False
            for cluster in high_clusters:
                avg_p = sum(s.price for s in cluster) / len(cluster)
                if abs(h.price - avg_p) / avg_p <= tolerance:
                    cluster.append(h)
                    placed = True
                    break
            if not placed:
                high_clusters.append([h])

        candle_map = {c.time: idx for idx, c in enumerate(candles)}
        n = len(candles)

        for cluster in high_clusters:
            if len(cluster) >= 2:
                avg_price = sum(s.price for s in cluster) / len(cluster)
                times = [s.time for s in cluster]
                last_time = max(times)
                last_idx = candle_map.get(last_time, 0)

                swept = False
                sweep_time = None
                for c_idx in range(last_idx + 1, n):
                    c = candles[c_idx]
                    # Liquidity sweep: wick pierced above level, but close stayed at or below level
                    if c.high > avg_price and c.close <= avg_price:
                        swept = True
                        sweep_time = c.time
                        break

                pools.append(LiquidityPool(
                    id=f"EQH_{times[0]}_{times[-1]}",
                    type="EQH",
                    price=avg_price,
                    times=times,
                    touches=len(cluster),
                    swept=swept,
                    sweep_time=sweep_time
                ))

        # 2. Cluster Lows (EQL)
        low_clusters: List[List[SwingPoint]] = []
        for l in lows:
            placed = False
            for cluster in low_clusters:
                avg_p = sum(s.price for s in cluster) / len(cluster)
                if abs(l.price - avg_p) / avg_p <= tolerance:
                    cluster.append(l)
                    placed = True
                    break
            if not placed:
                low_clusters.append([l])

        for cluster in low_clusters:
            if len(cluster) >= 2:
                avg_price = sum(s.price for s in cluster) / len(cluster)
                times = [s.time for s in cluster]
                last_time = max(times)
                last_idx = candle_map.get(last_time, 0)

                swept = False
                sweep_time = None
                for c_idx in range(last_idx + 1, n):
                    c = candles[c_idx]
                    # Liquidity sweep: wick pierced below level, but close stayed at or above level
                    if c.low < avg_price and c.close >= avg_price:
                        swept = True
                        sweep_time = c.time
                        break

                pools.append(LiquidityPool(
                    id=f"EQL_{times[0]}_{times[-1]}",
                    type="EQL",
                    price=avg_price,
                    times=times,
                    touches=len(cluster),
                    swept=swept,
                    sweep_time=sweep_time
                ))

        return pools[-10:]
