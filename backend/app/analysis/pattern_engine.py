import numpy as np
from typing import List, Dict, Any, Optional
from ..models.schemas import (
    Candle, SwingPoint, ChartPattern, SupportResistance, PatternAnalysisResult
)
from .utils import dynamic_round

class PatternEngine:
    def __init__(self, sr_tolerance_pct: float = 0.5, pattern_tolerance_pct: float = 1.0):
        self.sr_tolerance = sr_tolerance_pct / 100.0
        self.pattern_tolerance = pattern_tolerance_pct / 100.0

    def analyze(self, candles: List[Candle], swings: List[SwingPoint]) -> PatternAnalysisResult:
        if len(candles) < 20 or len(swings) < 3:
            return PatternAnalysisResult(patterns=[], support_resistance=[], trendlines=[])

        current_price = candles[-1].close

        # 1. Support & Resistance Clustering
        sr_levels = self._calculate_sr_levels(swings, current_price)

        # 2. Geometric Patterns (Double Top/Bottom, H&S, Triangles)
        patterns = []
        patterns.extend(self._detect_double_tops_bottoms(swings, candles))
        patterns.extend(self._detect_head_and_shoulders(swings, candles))
        patterns.extend(self._detect_triangles(swings, candles))

        # 3. Dynamic Trendlines
        trendlines = self._calculate_trendlines(swings, candles)

        return PatternAnalysisResult(
            patterns=patterns[-10:],
            support_resistance=sr_levels,
            trendlines=trendlines
        )

    def _calculate_sr_levels(self, swings: List[SwingPoint], current_price: float) -> List[SupportResistance]:
        if not swings:
            return []

        prices = [s.price for s in swings]
        # Cluster nearby prices
        clusters: List[List[float]] = []
        for p in prices:
            placed = False
            for c in clusters:
                avg = sum(c) / len(c)
                if avg > 0 and abs(p - avg) / avg <= self.sr_tolerance:
                    c.append(p)
                    placed = True
                    break
            if not placed:
                clusters.append([p])

        sr_list: List[SupportResistance] = []
        for c in clusters:
            if len(c) >= 2: # At least 2 touches
                avg_price = dynamic_round(sum(c) / len(c))
                level_type = "RESISTANCE" if avg_price > current_price else "SUPPORT"
                sr_list.append(SupportResistance(
                    price=avg_price,
                    strength=len(c),
                    type=level_type
                ))

        # Sort by strength descending, then proximity to current price
        sr_list.sort(key=lambda x: (x.strength, -abs(x.price - current_price)), reverse=True)
        return sr_list[:8]

    def _detect_double_tops_bottoms(
        self, swings: List[SwingPoint], candles: List[Candle]
    ) -> List[ChartPattern]:
        patterns: List[ChartPattern] = []
        sorted_swings = sorted(swings, key=lambda s: s.index)

        # Highs (Double Top)
        highs = [s for s in sorted_swings if s.type in ['HH', 'LH']]
        for i in range(len(highs) - 1):
            h1 = highs[i]
            h2 = highs[i + 1]

            if h1.price > 0 and abs(h1.price - h2.price) / h1.price <= self.pattern_tolerance:
                intermediate_lows = [s for s in sorted_swings if h1.index < s.index < h2.index and s.type in ['HL', 'LL']]
                if intermediate_lows:
                    neckline_swing = min(intermediate_lows, key=lambda s: s.price)
                    neckline = neckline_swing.price
                    pattern_height = max(h1.price, h2.price) - neckline

                    if pattern_height > 0:
                        patterns.append(ChartPattern(
                            id=f"DT_{h1.time}_{h2.time}",
                            name="Double Top",
                            type="BEARISH",
                            start_time=h1.time,
                            end_time=h2.time,
                            key_points=[
                                {"name": "Peak 1", "time": h1.time, "price": h1.price},
                                {"name": "Neckline", "time": neckline_swing.time, "price": neckline},
                                {"name": "Peak 2", "time": h2.time, "price": h2.price}
                            ],
                            neckline=dynamic_round(neckline),
                            target_price=dynamic_round(neckline - pattern_height),
                            stop_loss=dynamic_round(max(h1.price, h2.price) * 1.002)
                        ))

        # Lows (Double Bottom)
        lows = [s for s in sorted_swings if s.type in ['HL', 'LL']]
        for i in range(len(lows) - 1):
            l1 = lows[i]
            l2 = lows[i + 1]

            if l1.price > 0 and abs(l1.price - l2.price) / l1.price <= self.pattern_tolerance:
                intermediate_highs = [s for s in sorted_swings if l1.index < s.index < l2.index and s.type in ['HH', 'LH']]
                if intermediate_highs:
                    neckline_swing = max(intermediate_highs, key=lambda s: s.price)
                    neckline = neckline_swing.price
                    pattern_height = neckline - min(l1.price, l2.price)

                    if pattern_height > 0:
                        patterns.append(ChartPattern(
                            id=f"DB_{l1.time}_{l2.time}",
                            name="Double Bottom",
                            type="BULLISH",
                            start_time=l1.time,
                            end_time=l2.time,
                            key_points=[
                                {"name": "Trough 1", "time": l1.time, "price": l1.price},
                                {"name": "Neckline", "time": neckline_swing.time, "price": neckline},
                                {"name": "Trough 2", "time": l2.time, "price": l2.price}
                            ],
                            neckline=dynamic_round(neckline),
                            target_price=dynamic_round(neckline + pattern_height),
                            stop_loss=dynamic_round(min(l1.price, l2.price) * 0.998)
                        ))

        return patterns

    def _detect_head_and_shoulders(
        self, swings: List[SwingPoint], candles: List[Candle]
    ) -> List[ChartPattern]:
        patterns: List[ChartPattern] = []
        highs = [s for s in swings if s.type in ['HH', 'LH']]
        if len(highs) < 3:
            return patterns

        for i in range(len(highs) - 2):
            ls, h, rs = highs[i], highs[i + 1], highs[i + 2]

            # Head must be higher than both shoulders
            if h.price > ls.price and h.price > rs.price and ls.price > 0:
                if abs(ls.price - rs.price) / ls.price <= 0.03:
                    # Find troughs between LS-H and H-RS
                    t1_candidates = [s for s in swings if ls.index < s.index < h.index and s.type in ['HL', 'LL']]
                    t2_candidates = [s for s in swings if h.index < s.index < rs.index and s.type in ['HL', 'LL']]
                    if t1_candidates and t2_candidates:
                        t1 = min(t1_candidates, key=lambda s: s.price)
                        t2 = min(t2_candidates, key=lambda s: s.price)
                        neckline = (t1.price + t2.price) / 2
                        height = h.price - neckline
                        patterns.append(ChartPattern(
                            id=f"HS_{ls.time}_{rs.time}",
                            name="Head and Shoulders",
                            type="BEARISH",
                            start_time=ls.time,
                            end_time=rs.time,
                            key_points=[
                                {"name": "Left Shoulder", "time": ls.time, "price": ls.price},
                                {"name": "Neckline Left", "time": t1.time, "price": t1.price},
                                {"name": "Head", "time": h.time, "price": h.price},
                                {"name": "Neckline Right", "time": t2.time, "price": t2.price},
                                {"name": "Right Shoulder", "time": rs.time, "price": rs.price}
                            ],
                            neckline=dynamic_round(neckline),
                            target_price=dynamic_round(neckline - height),
                            stop_loss=dynamic_round(rs.price * 1.002)
                        ))

        return patterns

    def _detect_triangles(
        self, swings: List[SwingPoint], candles: List[Candle]
    ) -> List[ChartPattern]:
        patterns: List[ChartPattern] = []
        recent_swings = sorted(swings, key=lambda s: s.index)[-8:]
        highs = [s for s in recent_swings if s.type in ['HH', 'LH']]
        lows = [s for s in recent_swings if s.type in ['HL', 'LL']]

        if len(highs) >= 2 and len(lows) >= 2:
            high_slope = (highs[-1].price - highs[0].price) / max(1, (highs[-1].index - highs[0].index))
            low_slope = (lows[-1].price - lows[0].price) / max(1, (lows[-1].index - lows[0].index))

            start_t = min(highs[0].time, lows[0].time)
            end_t = max(highs[-1].time, lows[-1].time)
            max_height = max(highs[0].price, highs[-1].price) - min(lows[0].price, lows[-1].price)

            if high_slope < 0 and low_slope > 0 and max_height > 0:
                # Symmetrical Triangle
                patterns.append(ChartPattern(
                    id=f"SYM_TRI_{start_t}_{end_t}",
                    name="Symmetrical Triangle",
                    type="NEUTRAL",
                    start_time=start_t,
                    end_time=end_t,
                    key_points=[
                        {"name": "H1", "time": highs[0].time, "price": highs[0].price},
                        {"name": "H2", "time": highs[-1].time, "price": highs[-1].price},
                        {"name": "L1", "time": lows[0].time, "price": lows[0].price},
                        {"name": "L2", "time": lows[-1].time, "price": lows[-1].price}
                    ],
                    target_price=dynamic_round(highs[-1].price + max_height * 0.7),
                    stop_loss=dynamic_round(lows[-1].price - max_height * 0.3)
                ))
            elif abs(high_slope) < abs(low_slope) * 0.35 and low_slope > 0 and max_height > 0:
                # Ascending Triangle (Bullish bias)
                patterns.append(ChartPattern(
                    id=f"ASC_TRI_{start_t}_{end_t}",
                    name="Ascending Triangle",
                    type="BULLISH",
                    start_time=start_t,
                    end_time=end_t,
                    key_points=[
                        {"name": "H1", "time": highs[0].time, "price": highs[0].price},
                        {"name": "H2", "time": highs[-1].time, "price": highs[-1].price},
                        {"name": "L1", "time": lows[0].time, "price": lows[0].price},
                        {"name": "L2", "time": lows[-1].time, "price": lows[-1].price}
                    ],
                    neckline=dynamic_round(highs[-1].price),
                    target_price=dynamic_round(highs[-1].price + max_height),
                    stop_loss=dynamic_round(lows[-1].price)
                ))

        return patterns

    def _calculate_trendlines(
        self, swings: List[SwingPoint], candles: List[Candle]
    ) -> List[Dict[str, Any]]:
        trendlines = []
        highs = [s for s in swings if s.type in ['HH', 'LH']][-3:]
        lows = [s for s in swings if s.type in ['HL', 'LL']][-3:]

        if len(highs) >= 2:
            trendlines.append({
                "type": "RESISTANCE_TRENDLINE",
                "point1": {"time": highs[0].time, "price": highs[0].price},
                "point2": {"time": highs[-1].time, "price": highs[-1].price},
                "slope": (highs[-1].price - highs[0].price) / max(1, highs[-1].index - highs[0].index)
            })

        if len(lows) >= 2:
            trendlines.append({
                "type": "SUPPORT_TRENDLINE",
                "point1": {"time": lows[0].time, "price": lows[0].price},
                "point2": {"time": lows[-1].time, "price": lows[-1].price},
                "slope": (lows[-1].price - lows[0].price) / max(1, lows[-1].index - lows[0].index)
            })

        return trendlines
