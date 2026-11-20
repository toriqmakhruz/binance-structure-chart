import math
import numpy as np
from typing import List, Dict, Any, Optional, Tuple
from ..models.schemas import (
    Candle,
    TrendStrengthMetrics,
    MtfTrendItem,
    RibbonLinePoint
)
from .utils import dynamic_round


class TrendStrengthEngine:
    """
    Comprehensive Quantitative Trend Strength Engine (TSI).
    
    Menggabungkan 4 Pilar Analisis Terukur Institusional:
    1. Daya Dorong Tren: Wilder's ADX (14) + DI+ / DI- (Directional Movement Index).
    2. Keselarasan & Akselerasi: EMA Ribbon Stack (8, 21, 55, 200) + Ribbon Dispersion + Normalized Slope Angle.
    3. Konfirmasi Volume Institusional: Relative Volume (RVOL) + Taker Buy/Sell Volume Pressure.
    4. Multi-Timeframe Consensus: Konsensus keselarasan tren lintas timeframe (5m, 15m, 1h, 4h).
    """

    def __init__(self, adx_period: int = 14, atr_period: int = 14):
        self.adx_period = adx_period
        self.atr_period = atr_period

    def analyze(
        self,
        candles: List[Candle],
        htf_overlay: Optional[Dict[str, Any]] = None,
        timeframe: str = "15m"
    ) -> TrendStrengthMetrics:
        n = len(candles)
        if n < self.adx_period + 5:
            # Fallback for insufficient data
            return self._build_empty_fallback()

        closes = np.array([c.close for c in candles], dtype=float)
        highs = np.array([c.high for c in candles], dtype=float)
        lows = np.array([c.low for c in candles], dtype=float)
        volumes = np.array([c.volume for c in candles], dtype=float)
        buy_volumes = np.array([c.taker_buy_volume for c in candles], dtype=float)
        times = [c.time for c in candles]

        # 1. Calculate True Range and ATR
        atr = self._calculate_atr(highs, lows, closes, period=self.atr_period)

        # 2. Pilar 1: Directional Force (ADX & DMI)
        adx, pdi, mdi = self._calculate_adx_dmi(highs, lows, closes, period=self.adx_period)
        adx_trend_power, adx_score = self._evaluate_adx(adx)

        # 3. Pilar 2: EMA Ribbon & Slope
        (
            ribbon_align,
            ribbon_score,
            dispersion_pct,
            disp_status,
            slope_deg,
            slope_status,
            current_ribbon,
            ribbon_series
        ) = self._calculate_ribbon_and_slope(closes, highs, lows, times, atr)

        # 4. Pilar 3: Volume & Institutional Flow (RVOL & Taker Pressure)
        rvol, rvol_status, taker_pressure, buy_ratio_pct, volume_score = self._calculate_volume_flow(
            volumes, buy_volumes
        )

        # 5. Determine Primary Direction from Multiple Indicators
        direction = self._determine_direction(pdi, mdi, ribbon_align, slope_deg, buy_ratio_pct)

        # 6. Pilar 4: Multi-Timeframe Alignment
        mtf_consensus, mtf_alignment_score, mtf_details = self._evaluate_mtf(
            candles, htf_overlay, timeframe, direction
        )

        # 7. Calculate Composite Trend Strength Score (0 - 100)
        composite_score = self._compute_composite_score(
            adx_score=adx_score,
            ribbon_score=ribbon_score,
            volume_score=volume_score,
            mtf_score=mtf_alignment_score,
            direction=direction,
            adx=adx
        )

        # 8. Status & Actionable Advice
        status, label, action_advice = self._classify_status_and_advice(
            score=composite_score,
            direction=direction,
            adx=adx,
            rvol=rvol,
            dispersion_pct=dispersion_pct
        )

        return TrendStrengthMetrics(
            score=round(composite_score, 1),
            direction=direction,
            status=status,
            label=label,
            action_advice=action_advice,
            adx=round(adx, 2),
            plus_di=round(pdi, 2),
            minus_di=round(mdi, 2),
            adx_trend_power=adx_trend_power,
            ribbon_alignment=ribbon_align,
            ribbon_dispersion_pct=round(dispersion_pct, 2),
            dispersion_status=disp_status,
            ema_slope_deg=round(slope_deg, 1),
            ema_slope_status=slope_status,
            rvol=round(rvol, 2),
            rvol_status=rvol_status,
            taker_pressure=taker_pressure,
            buy_ratio_pct=round(buy_ratio_pct, 1),
            mtf_consensus=mtf_consensus,
            mtf_alignment_score=round(mtf_alignment_score, 1),
            mtf_details=mtf_details,
            current_ribbon=current_ribbon,
            ribbon_series=ribbon_series
        )

    def _calculate_atr(self, highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, period: int = 14) -> float:
        n = len(closes)
        if n < 2:
            return 1.0
        tr = np.zeros(n)
        tr[0] = highs[0] - lows[0]
        for i in range(1, n):
            tr[i] = max(
                highs[i] - lows[i],
                abs(highs[i] - closes[i - 1]),
                abs(lows[i] - closes[i - 1])
            )
        p = min(period, n)
        return float(np.mean(tr[-p:])) if p > 0 else 1.0

    def _calculate_adx_dmi(
        self, highs: np.ndarray, lows: np.ndarray, closes: np.ndarray, period: int = 14
    ) -> Tuple[float, float, float]:
        """
        Wilder's Standard DMI / ADX Implementation.
        """
        n = len(closes)
        if n < period * 2:
            return 15.0, 20.0, 20.0

        tr = np.zeros(n)
        plus_dm = np.zeros(n)
        minus_dm = np.zeros(n)

        tr[0] = highs[0] - lows[0]
        for i in range(1, n):
            h_diff = highs[i] - highs[i - 1]
            l_diff = lows[i - 1] - lows[i]

            plus_dm[i] = h_diff if (h_diff > l_diff and h_diff > 0) else 0.0
            minus_dm[i] = l_diff if (l_diff > h_diff and l_diff > 0) else 0.0

            tr[i] = max(
                highs[i] - lows[i],
                abs(highs[i] - closes[i - 1]),
                abs(lows[i] - closes[i - 1])
            )

        # Wilder's Smoothing
        atr_smooth = np.zeros(n)
        pdm_smooth = np.zeros(n)
        mdm_smooth = np.zeros(n)

        atr_smooth[period] = np.sum(tr[1:period + 1])
        pdm_smooth[period] = np.sum(plus_dm[1:period + 1])
        mdm_smooth[period] = np.sum(minus_dm[1:period + 1])

        for i in range(period + 1, n):
            atr_smooth[i] = atr_smooth[i - 1] - (atr_smooth[i - 1] / period) + tr[i]
            pdm_smooth[i] = pdm_smooth[i - 1] - (pdm_smooth[i - 1] / period) + plus_dm[i]
            mdm_smooth[i] = mdm_smooth[i - 1] - (mdm_smooth[i - 1] / period) + minus_dm[i]

        pdi = np.zeros(n)
        mdi = np.zeros(n)
        dx = np.zeros(n)

        for i in range(period, n):
            denom = atr_smooth[i]
            if denom > 0:
                pdi[i] = 100.0 * (pdm_smooth[i] / denom)
                mdi[i] = 100.0 * (mdm_smooth[i] / denom)

            di_sum = pdi[i] + mdi[i]
            if di_sum > 0:
                dx[i] = 100.0 * abs(pdi[i] - mdi[i]) / di_sum

        adx = np.zeros(n)
        start_adx = 2 * period
        if n > start_adx:
            adx[start_adx] = np.mean(dx[period:start_adx + 1])
            for i in range(start_adx + 1, n):
                adx[i] = (adx[i - 1] * (period - 1) + dx[i]) / period
            current_adx = float(adx[-1])
        else:
            current_adx = float(np.mean(dx[period:])) if period < n else 15.0

        return current_adx, float(pdi[-1]), float(mdi[-1])

    def _evaluate_adx(self, adx: float) -> Tuple[str, float]:
        """Convert raw ADX into standardized power status & 0-100 score."""
        if adx < 20.0:
            status = "WEAK_OR_NO_TREND"
            score = max(5.0, (adx / 20.0) * 35.0)
        elif adx < 25.0:
            status = "EMERGING_TREND"
            score = 35.0 + ((adx - 20.0) / 5.0) * 25.0
        elif adx < 50.0:
            status = "STRONG_TREND"
            score = 60.0 + ((adx - 25.0) / 25.0) * 30.0
        else:
            status = "VERY_STRONG_PARABOLIC"
            score = min(100.0, 90.0 + ((adx - 50.0) / 50.0) * 10.0)
        return status, score

    def _calc_ema_series(self, arr: np.ndarray, span: int) -> np.ndarray:
        alpha = 2.0 / (span + 1.0)
        ema = np.zeros_like(arr)
        ema[0] = arr[0]
        for i in range(1, len(arr)):
            ema[i] = arr[i] * alpha + ema[i - 1] * (1.0 - alpha)
        return ema

    def _calculate_ribbon_and_slope(
        self,
        closes: np.ndarray,
        highs: np.ndarray,
        lows: np.ndarray,
        times: List[int],
        atr: float
    ) -> Tuple[str, float, float, str, float, str, Dict[str, float], List[RibbonLinePoint]]:
        n = len(closes)
        ema8 = self._calc_ema_series(closes, min(8, n))
        ema21 = self._calc_ema_series(closes, min(21, n))
        ema55 = self._calc_ema_series(closes, min(55, n))
        ema200 = self._calc_ema_series(closes, min(200, n)) if n >= 60 else None

        c_close = closes[-1]
        c8 = ema8[-1]
        c21 = ema21[-1]
        c55 = ema55[-1]
        c200 = ema200[-1] if ema200 is not None else c55

        # Ribbon Stack Alignment
        if c200 is not None and c_close > c8 > c21 > c55 > c200:
            ribbon_align = "FULL_BULLISH_STACK"
            ribbon_score = 100.0
        elif c_close > c8 > c21 > c55:
            ribbon_align = "BULLISH_STACK"
            ribbon_score = 80.0
        elif c_close > c21 and c8 > c21:
            ribbon_align = "WEAK_BULLISH"
            ribbon_score = 55.0
        elif c200 is not None and c_close < c8 < c21 < c55 < c200:
            ribbon_align = "FULL_BEARISH_STACK"
            ribbon_score = 100.0
        elif c_close < c8 < c21 < c55:
            ribbon_align = "BEARISH_STACK"
            ribbon_score = 80.0
        elif c_close < c21 and c8 < c21:
            ribbon_align = "WEAK_BEARISH"
            ribbon_score = 55.0
        else:
            ribbon_align = "NEUTRAL_COMPRESSED"
            ribbon_score = 25.0

        # Dispersion (Spread antara EMA 8 & EMA 55)
        dispersion_pct = float(abs(c8 - c55) / c55 * 100.0) if c55 > 0 else 0.0

        # Bandwidth status vs 20-bar rolling dispersion
        if n >= 25:
            hist_disp = np.abs(ema8[-20:] - ema55[-20:]) / ema55[-20:] * 100.0
            avg_disp = float(np.mean(hist_disp))
            if dispersion_pct > avg_disp * 1.25:
                disp_status = "EXPANDING"
            elif dispersion_pct < avg_disp * 0.75:
                disp_status = "CONTRACTING"
            else:
                disp_status = "STABLE"
        else:
            disp_status = "STABLE"

        # EMA 21 Normalized Slope Angle
        lookback = min(5, n - 1)
        if lookback > 0 and atr > 0:
            delta_ema = ema21[-1] - ema21[-1 - lookback]
            # Normalize delta price against ATR step
            normalized_slope = delta_ema / (lookback * (atr * 0.5))
            slope_deg = float(math.degrees(math.atan(normalized_slope)))
            slope_deg = max(-85.0, min(85.0, slope_deg))
        else:
            slope_deg = 0.0

        if slope_deg > 25.0:
            slope_status = "ACCELERATING_UP"
        elif slope_deg > 10.0:
            slope_status = "STEADY_UP"
        elif slope_deg < -25.0:
            slope_status = "ACCELERATING_DOWN"
        elif slope_deg < -10.0:
            slope_status = "STEADY_DOWN"
        else:
            slope_status = "FLAT"

        # Current snapshot values
        current_ribbon = {
            "ema8": dynamic_round(c8),
            "ema21": dynamic_round(c21),
            "ema55": dynamic_round(c55),
            "ema200": dynamic_round(c200) if ema200 is not None else None
        }

        # Build ribbon points for chart rendering (last 150 bars max for light payload)
        start_idx = max(0, n - 150)
        ribbon_series: List[RibbonLinePoint] = []
        for i in range(start_idx, n):
            ribbon_series.append(
                RibbonLinePoint(
                    time=times[i],
                    ema8=dynamic_round(ema8[i]),
                    ema21=dynamic_round(ema21[i]),
                    ema55=dynamic_round(ema55[i]),
                    ema200=dynamic_round(ema200[i]) if ema200 is not None else None
                )
            )

        return (
            ribbon_align,
            ribbon_score,
            dispersion_pct,
            disp_status,
            slope_deg,
            slope_status,
            current_ribbon,
            ribbon_series
        )

    def _calculate_volume_flow(
        self, volumes: np.ndarray, buy_volumes: np.ndarray
    ) -> Tuple[float, str, str, float, float]:
        n = len(volumes)
        if n < 5:
            return 1.0, "NORMAL_VOLUME", "BALANCED_PRESSURE", 50.0, 50.0

        # RVOL (Current bar volume vs 20-bar avg)
        avg_len = min(20, n)
        recent_avg_vol = float(np.mean(volumes[-avg_len:]))
        cur_vol = volumes[-1]
        rvol = float(cur_vol / recent_avg_vol) if recent_avg_vol > 0 else 1.0

        if rvol >= 1.5:
            rvol_status = "HIGH_INSTITUTIONAL_VOLUME"
            rvol_score = 95.0
        elif rvol < 0.8:
            rvol_status = "LOW_VOLUME_CHOP"
            rvol_score = 30.0
        else:
            rvol_status = "NORMAL_VOLUME"
            rvol_score = 65.0

        # Taker Pressure
        recent_n = min(5, n)
        sum_vol = float(np.sum(volumes[-recent_n:]))
        sum_buy = float(np.sum(buy_volumes[-recent_n:]))
        buy_ratio_pct = (sum_buy / sum_vol * 100.0) if sum_vol > 0 else 50.0

        if buy_ratio_pct >= 58.0:
            taker_pressure = "STRONG_BUY_PRESSURE"
        elif buy_ratio_pct <= 42.0:
            taker_pressure = "STRONG_SELL_PRESSURE"
        else:
            taker_pressure = "BALANCED_PRESSURE"

        vol_score = (rvol_score * 0.6) + (abs(buy_ratio_pct - 50.0) * 2.0 * 0.4)
        vol_score = max(10.0, min(100.0, vol_score))

        return rvol, rvol_status, taker_pressure, buy_ratio_pct, vol_score

    def _determine_direction(
        self, pdi: float, mdi: float, ribbon_align: str, slope_deg: float, buy_ratio_pct: float
    ) -> str:
        bull_votes = 0
        bear_votes = 0

        # Vote 1: DMI
        if pdi > mdi * 1.08:
            bull_votes += 2
        elif mdi > pdi * 1.08:
            bear_votes += 2

        # Vote 2: Ribbon Alignment
        if "BULLISH" in ribbon_align:
            bull_votes += 2
        elif "BEARISH" in ribbon_align:
            bear_votes += 2

        # Vote 3: EMA Slope
        if slope_deg > 8.0:
            bull_votes += 1
        elif slope_deg < -8.0:
            bear_votes += 1

        # Vote 4: Taker Volume Pressure
        if buy_ratio_pct > 53.0:
            bull_votes += 1
        elif buy_ratio_pct < 47.0:
            bear_votes += 1

        if bull_votes >= bear_votes + 2:
            return "BULLISH"
        elif bear_votes >= bull_votes + 2:
            return "BEARISH"
        else:
            return "NEUTRAL"

    def _evaluate_mtf(
        self,
        candles: List[Candle],
        htf_overlay: Optional[Dict[str, Any]],
        active_tf: str,
        current_dir: str
    ) -> Tuple[str, float, List[MtfTrendItem]]:
        details: List[MtfTrendItem] = []
        aligned_count = 0
        total_count = 0

        # 1. Active Timeframe
        details.append(
            MtfTrendItem(
                timeframe=active_tf,
                direction=current_dir,
                adx=25.0,
                is_aligned=True
            )
        )
        aligned_count += 1
        total_count += 1

        # 2. HTF Overlay if provided
        if htf_overlay and isinstance(htf_overlay, dict):
            htf_tf = htf_overlay.get("timeframe", "4h")
            htf_trend = htf_overlay.get("current_trend", "NEUTRAL")
            is_align = (htf_trend == current_dir) and (current_dir != "NEUTRAL")
            details.append(
                MtfTrendItem(
                    timeframe=htf_tf,
                    direction=htf_trend,
                    adx=30.0,
                    is_aligned=is_align
                )
            )
            total_count += 1
            if is_align:
                aligned_count += 1

        # 3. Synthetic Resampled Check if sufficient candles exist (resample 4x)
        if len(candles) >= 80:
            synthetic_closes = [c.close for c in candles[::4]]
            if len(synthetic_closes) >= 10:
                s_e20 = float(np.mean(synthetic_closes[-5:]))
                s_dir = "BULLISH" if synthetic_closes[-1] > s_e20 else "BEARISH"
                is_align = (s_dir == current_dir) and (current_dir != "NEUTRAL")
                details.append(
                    MtfTrendItem(
                        timeframe="HTF-2",
                        direction=s_dir,
                        adx=25.0,
                        is_aligned=is_align
                    )
                )
                total_count += 1
                if is_align:
                    aligned_count += 1

        pct_aligned = (aligned_count / total_count * 100.0) if total_count > 0 else 50.0
        consensus_str = f"{aligned_count}/{total_count} {current_dir.capitalize() if current_dir != 'NEUTRAL' else 'Netral'}"

        return consensus_str, pct_aligned, details

    def _compute_composite_score(
        self,
        adx_score: float,
        ribbon_score: float,
        volume_score: float,
        mtf_score: float,
        direction: str,
        adx: float
    ) -> float:
        """
        Synthesize all 4 pillars into a robust 0-100 composite score.
        If ADX is < 18 (flat chop), penalize heavily to prevent fakeouts.
        """
        raw_score = (
            adx_score * 0.35 +
            ribbon_score * 0.30 +
            volume_score * 0.20 +
            mtf_score * 0.15
        )

        if direction == "NEUTRAL" or adx < 18.0:
            # Squeeze / chop penalty
            raw_score = min(raw_score, 32.0)

        return float(max(5.0, min(100.0, raw_score)))

    def _classify_status_and_advice(
        self,
        score: float,
        direction: str,
        adx: float,
        rvol: float,
        dispersion_pct: float
    ) -> Tuple[str, str, str]:
        dir_label = "Bullish" if direction == "BULLISH" else ("Bearish" if direction == "BEARISH" else "Netral")

        if score < 35.0 or adx < 20.0:
            status = "CHOPPY_RANGING"
            label = "Pasar Ranging / Choppy (Tanpa Tren)"
            advice = (
                "Kekuatan tren rendah (ADX < 20). Hindari membuka posisi trend-following atau breakout. "
                "Tunggu ekspansi volume dan pelebaran moving average, atau mainkan batas Support/Resistance."
            )
        elif score < 60.0:
            status = "DEVELOPING_TREND"
            label = f"Tren Mulai Terbentuk ({dir_label})"
            advice = (
                f"Momentum {dir_label} baru mulai terbangun. Disarankan menunggu konfirmasi penembusan struktur (BOS) "
                f"sebelum menambah ukuran posisi penuh."
            )
        elif score < 85.0:
            status = "STRONG_TREND"
            label = f"Tren Kuat & Sehat ({dir_label})"
            advice = (
                f"Zona ideal trend-following! Tren {dir_label} didukung volume dan keselarasan MA. "
                f"Prioritaskan entri saat harga retest ke EMA 21 atau zona Order Block/FVG terdekat. Hindari counter-trend."
            )
        else:
            status = "EXHAUSTION_OVEREXTENDED"
            label = f"Tren Sangat Kuat / Rawan Koreksi ({dir_label})"
            advice = (
                f"Tren {dir_label} bergerak parabolik dan sudah overextended dari basis moving average. "
                f"Rawan koreksi tajam (mean-reversion). Sangat disarankan mengunci profit parsial dan memperketat Trailing Stop."
            )

        return status, label, advice

    def _build_empty_fallback(self) -> TrendStrengthMetrics:
        return TrendStrengthMetrics(
            score=25.0,
            direction="NEUTRAL",
            status="CHOPPY_RANGING",
            label="Data Candlestick Belum Cukup",
            action_advice="Data candle belum mencukupi untuk menghitung kekuatan tren secara komprehensif.",
            adx=10.0,
            plus_di=10.0,
            minus_di=10.0,
            adx_trend_power="WEAK_OR_NO_TREND",
            ribbon_alignment="NEUTRAL_COMPRESSED",
            ribbon_dispersion_pct=0.0,
            dispersion_status="STABLE",
            ema_slope_deg=0.0,
            ema_slope_status="FLAT",
            rvol=1.0,
            rvol_status="NORMAL_VOLUME",
            taker_pressure="BALANCED_PRESSURE",
            buy_ratio_pct=50.0,
            mtf_consensus="1/1 Netral",
            mtf_alignment_score=50.0,
            mtf_details=[],
            current_ribbon={},
            ribbon_series=[]
        )
