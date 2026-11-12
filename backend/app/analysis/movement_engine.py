import numpy as np
from typing import List, Dict, Any, Optional, Tuple
from ..models.schemas import Candle, MovementMetrics, SmcAnalysisResult, PatternAnalysisResult
from .utils import dynamic_round

class MovementEngine:
    def __init__(self, atr_period: int = 14, rsi_period: int = 14):
        self.atr_period = atr_period
        self.rsi_period = rsi_period

    def analyze(
        self,
        candles: List[Candle],
        smc: Optional[SmcAnalysisResult] = None,
        patterns: Optional[PatternAnalysisResult] = None
    ) -> MovementMetrics:
        n = len(candles)
        if n < self.rsi_period + 1:
            return MovementMetrics(
                volatility_atr=0.0,
                volatility_atr_pct=0.0,
                volatility_status="NORMAL",
                trend_direction="NEUTRAL",
                rsi=50.0,
                rsi_condition="NEUTRAL",
                volume_delta=0.0,
                volume_delta_ratio=0.5,
                confluence_score=50.0,
                confluence_bias="NEUTRAL",
                summary="Data tidak mencukupi untuk analisa lengkap"
            )

        closes = np.array([c.close for c in candles], dtype=float)
        highs = np.array([c.high for c in candles], dtype=float)
        lows = np.array([c.low for c in candles], dtype=float)
        volumes = np.array([c.volume for c in candles], dtype=float)
        buy_volumes = np.array([c.taker_buy_volume for c in candles], dtype=float)

        # 1. ATR & Volatility Status
        atr, atr_pct, vol_status = self._calculate_atr_and_volatility(highs, lows, closes)

        # 2. RSI & Divergence with Edge Case Safety
        rsi, rsi_cond = self._calculate_rsi(closes)

        # 3. Trend Direction from EMAs
        trend_dir = self._calculate_trend_direction(closes)

        # 4. Volume Delta & Pressure
        vol_delta, vol_ratio = self._calculate_volume_delta(volumes, buy_volumes)

        # 5. Confluence Index
        confluence_score, confluence_bias, summary = self._calculate_confluence(
            trend_dir=trend_dir,
            rsi=rsi,
            rsi_cond=rsi_cond,
            vol_ratio=vol_ratio,
            smc=smc,
            patterns=patterns
        )

        return MovementMetrics(
            volatility_atr=dynamic_round(atr),
            volatility_atr_pct=round(atr_pct, 2),
            volatility_status=vol_status,
            trend_direction=trend_dir,
            rsi=round(rsi, 2),
            rsi_condition=rsi_cond,
            volume_delta=round(vol_delta, 2),
            volume_delta_ratio=round(vol_ratio, 3),
            confluence_score=round(confluence_score, 1),
            confluence_bias=confluence_bias,
            summary=summary
        )

    def _calculate_atr_and_volatility(
        self, highs: np.ndarray, lows: np.ndarray, closes: np.ndarray
    ) -> Tuple[float, float, str]:
        n = len(closes)
        tr = np.zeros(n)
        tr[0] = highs[0] - lows[0]
        for i in range(1, n):
            tr[i] = max(
                highs[i] - lows[i],
                abs(highs[i] - closes[i - 1]),
                abs(lows[i] - closes[i - 1])
            )

        period = min(self.atr_period, n)
        atr = float(np.mean(tr[-period:])) if period > 0 else 0.0
        atr_pct = float((atr / closes[-1]) * 100) if closes[-1] > 0 else 0.0

        # Bollinger Bandwidth for Squeeze detection
        period_bb = min(20, n)
        recent_closes = closes[-period_bb:]
        sma = np.mean(recent_closes)
        std = np.std(recent_closes)
        bandwidth = (4 * std) / sma if sma > 0 else 0

        if bandwidth < 0.015:
            vol_status = "SQUEEZE"
        elif bandwidth > 0.045:
            vol_status = "EXPANDING"
        else:
            vol_status = "NORMAL"

        return atr, atr_pct, vol_status

    def _calculate_rsi(self, closes: np.ndarray) -> Tuple[float, str]:
        """
        RSI calculation with strict edge case handling (Audit Section 4.2):
        - When all price changes are positive (down == 0): RSI is 100.0 (NOT 50.0).
        - When all price changes are negative (up == 0): RSI is 0.0.
        - When price is strictly flat (up == 0 and down == 0): RSI is 50.0 (Neutral).
        """
        if len(closes) < self.rsi_period + 1:
            return 50.0, "NEUTRAL"

        deltas = np.diff(closes)
        seed = deltas[:self.rsi_period]
        up = float(seed[seed > 0].sum() / self.rsi_period)
        down = float(-seed[seed < 0].sum() / self.rsi_period)

        def compute_rsi_point(u: float, d: float) -> float:
            if d == 0.0 and u == 0.0:
                return 50.0
            if d == 0.0:
                return 100.0
            if u == 0.0:
                return 0.0
            rs = u / d
            return 100.0 - (100.0 / (1.0 + rs))

        rsi_series = np.zeros_like(closes)
        rsi_series[:self.rsi_period] = compute_rsi_point(up, down)

        up_val = up
        down_val = down
        for i in range(self.rsi_period, len(deltas)):
            delta = deltas[i]
            if delta > 0:
                up_val = (up_val * (self.rsi_period - 1) + delta) / self.rsi_period
                down_val = (down_val * (self.rsi_period - 1)) / self.rsi_period
            elif delta < 0:
                up_val = (up_val * (self.rsi_period - 1)) / self.rsi_period
                down_val = (down_val * (self.rsi_period - 1) - delta) / self.rsi_period
            else:
                up_val = (up_val * (self.rsi_period - 1)) / self.rsi_period
                down_val = (down_val * (self.rsi_period - 1)) / self.rsi_period

            rsi_series[i + 1] = compute_rsi_point(up_val, down_val)

        current_rsi = float(rsi_series[-1])

        if current_rsi >= 70:
            cond = "OVERBOUGHT"
        elif current_rsi <= 30:
            cond = "OVERSOLD"
        else:
            if len(closes) >= 11 and closes[-1] < closes[-10] and rsi_series[-1] > rsi_series[-10]:
                cond = "BULLISH_DIV"
            elif len(closes) >= 11 and closes[-1] > closes[-10] and rsi_series[-1] < rsi_series[-10]:
                cond = "BEARISH_DIV"
            else:
                cond = "NEUTRAL"

        return current_rsi, cond

    def _calculate_trend_direction(self, closes: np.ndarray) -> str:
        n = len(closes)
        if n < 2:
            return "NEUTRAL"

        def calc_ema(arr, span):
            alpha = 2 / (span + 1)
            ema = [arr[0]]
            for val in arr[1:]:
                ema.append(val * alpha + ema[-1] * (1 - alpha))
            return np.array(ema)

        ema20 = calc_ema(closes, min(20, n))
        ema50 = calc_ema(closes, min(50, n))

        curr_close = closes[-1]
        c_ema20 = ema20[-1]
        c_ema50 = ema50[-1]

        if curr_close > c_ema20 > c_ema50:
            return "STRONG_BULLISH"
        elif curr_close > c_ema20:
            return "BULLISH"
        elif curr_close < c_ema20 < c_ema50:
            return "STRONG_BEARISH"
        elif curr_close < c_ema20:
            return "BEARISH"
        else:
            return "NEUTRAL"

    def _calculate_volume_delta(
        self, volumes: np.ndarray, buy_volumes: np.ndarray
    ) -> Tuple[float, float]:
        recent_v = np.sum(volumes[-5:]) if len(volumes) >= 5 else np.sum(volumes)
        recent_buy = np.sum(buy_volumes[-5:]) if len(buy_volumes) >= 5 else np.sum(buy_volumes)
        recent_sell = recent_v - recent_buy

        delta = float(recent_buy - recent_sell)
        ratio = float(recent_buy / recent_v) if recent_v > 0 else 0.5
        return delta, ratio

    def _calculate_confluence(
        self,
        trend_dir: str,
        rsi: float,
        rsi_cond: str,
        vol_ratio: float,
        smc: Optional[SmcAnalysisResult],
        patterns: Optional[PatternAnalysisResult]
    ) -> Tuple[float, str, str]:
        score = 50.0
        reasons = []

        if trend_dir == "STRONG_BULLISH":
            score += 25
            reasons.append("Tren kuat di atas EMA 20 & 50")
        elif trend_dir == "BULLISH":
            score += 15
            reasons.append("Harga di atas EMA 20")
        elif trend_dir == "STRONG_BEARISH":
            score -= 25
            reasons.append("Tren turun kuat di bawah EMA 20 & 50")
        elif trend_dir == "BEARISH":
            score -= 15
            reasons.append("Harga di bawah EMA 20")

        if smc:
            if smc.current_trend == "BULLISH":
                score += 20
                reasons.append("Struktur pasar SMC membentuk higher high/low")
            elif smc.current_trend == "BEARISH":
                score -= 20
                reasons.append("Struktur pasar SMC membentuk lower high/low")

            if smc.events:
                last_event = smc.events[-1]
                if last_event.direction == "BULLISH":
                    score += 5
                    reasons.append(f"Terjadi Bullish {last_event.type}")
                else:
                    score -= 5
                    reasons.append(f"Terjadi Bearish {last_event.type}")

        if vol_ratio > 0.60:
            score += 15
            reasons.append("Dominasi volume beli agresif (>60%)")
        elif vol_ratio > 0.52:
            score += 8
        elif vol_ratio < 0.40:
            score -= 15
            reasons.append("Dominasi volume jual agresif (>60%)")
        elif vol_ratio < 0.48:
            score -= 8

        if rsi_cond == "BULLISH_DIV":
            score += 15
            reasons.append("Terdeteksi Bullish Divergence pada RSI")
        elif rsi_cond == "BEARISH_DIV":
            score -= 15
            reasons.append("Terdeteksi Bearish Divergence pada RSI")
        elif rsi < 30:
            score += 10
            reasons.append("RSI Oversold (potensi pullback naik)")
        elif rsi > 70:
            score -= 10
            reasons.append("RSI Overbought (potensi koreksi turun)")

        if patterns and patterns.patterns:
            last_p = patterns.patterns[-1]
            if last_p.type == "BULLISH":
                score += 10
                reasons.append(f"Pola {last_p.name} aktif (Bullish)")
            elif last_p.type == "BEARISH":
                score -= 10
                reasons.append(f"Pola {last_p.name} aktif (Bearish)")

        final_score = max(5.0, min(95.0, score))

        if final_score >= 75:
            bias = "STRONG BULLISH"
        elif final_score >= 60:
            bias = "BULLISH"
        elif final_score <= 25:
            bias = "STRONG BEARISH"
        elif final_score <= 40:
            bias = "BEARISH"
        else:
            bias = "NEUTRAL"

        summary = " • ".join(reasons[:3]) if reasons else "Pasar dalam fase konsolidasi netral"
        return final_score, bias, summary
