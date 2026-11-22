import math
from typing import List
from ...models.schemas import Candle
from ...models.iti_schemas import ITIVolumeProfileFeatures

class ITIVolumeProfileEngine:
    """
    Engine 6: Volume Profile & Anchored VWAP (AVWAP) Engine.
    Calculates:
      - Point of Control (POC)
      - Value Area High (VAH) & Value Area Low (VAL) - 70% rule
      - Institutional Anchored VWAP
      - Standard Deviation Bands (+-1 sigma, +-2 sigma)
    """
    def analyze(self, candles: List[Candle]) -> ITIVolumeProfileFeatures:
        if not candles or len(candles) < 15:
            return ITIVolumeProfileFeatures()

        current_price = candles[-1].close
        lookback = min(len(candles), 96)  # Approx 24 hours of 15m bars
        active_candles = candles[-lookback:]

        # 1. Calculate Anchored VWAP & Variance
        cum_vol = 0.0
        cum_vp = 0.0
        for c in active_candles:
            typical_price = (c.high + c.low + c.close) / 3.0
            cum_vol += c.volume
            cum_vp += typical_price * c.volume

        avwap = cum_vp / max(1e-6, cum_vol) if cum_vol > 0 else current_price

        # Standard Deviation Bands
        cum_dev_sq = 0.0
        for c in active_candles:
            typical_price = (c.high + c.low + c.close) / 3.0
            cum_dev_sq += c.volume * ((typical_price - avwap) ** 2)

        variance = cum_dev_sq / max(1e-6, cum_vol) if cum_vol > 0 else 0.0
        stdev = math.sqrt(variance)

        avwap_upper_1s = avwap + stdev
        avwap_lower_1s = avwap - stdev
        avwap_upper_2s = avwap + (2.0 * stdev)
        avwap_lower_2s = avwap - (2.0 * stdev)

        # 2. Volume Profile (Binning into 24 brackets)
        min_p = min(c.low for c in active_candles)
        max_p = max(c.high for c in active_candles)
        span = max(1e-6, max_p - min_p)
        num_bins = 24
        bin_size = span / num_bins

        bin_volumes = [0.0] * num_bins
        for c in active_candles:
            mid = (c.high + c.low) / 2.0
            idx = min(num_bins - 1, max(0, int((mid - min_p) / bin_size)))
            bin_volumes[idx] += c.volume

        poc_idx = bin_volumes.index(max(bin_volumes)) if bin_volumes else 0
        poc = min_p + (poc_idx + 0.5) * bin_size

        # 70% Value Area
        total_vol = sum(bin_volumes)
        target_va_vol = total_vol * 0.70
        accum_vol = bin_volumes[poc_idx]
        va_low_idx = poc_idx
        va_high_idx = poc_idx

        while accum_vol < target_va_vol and (va_low_idx > 0 or va_high_idx < num_bins - 1):
            next_low_vol = bin_volumes[va_low_idx - 1] if va_low_idx > 0 else -1.0
            next_high_vol = bin_volumes[va_high_idx + 1] if va_high_idx < num_bins - 1 else -1.0

            if next_low_vol >= next_high_vol and va_low_idx > 0:
                va_low_idx -= 1
                accum_vol += next_low_vol
            elif va_high_idx < num_bins - 1:
                va_high_idx += 1
                accum_vol += next_high_vol
            else:
                break

        val = min_p + va_low_idx * bin_size
        vah = min_p + (va_high_idx + 1) * bin_size

        if current_price > vah:
            va_status = "ABOVE_VAH"
        elif current_price < val:
            va_status = "BELOW_VAL"
        else:
            va_status = "INSIDE_VA"

        return ITIVolumeProfileFeatures(
            poc=round(poc, 2),
            vah=round(vah, 2),
            val=round(val, 2),
            avwap=round(avwap, 2),
            avwap_upper_1s=round(avwap_upper_1s, 2),
            avwap_lower_1s=round(avwap_lower_1s, 2),
            avwap_upper_2s=round(avwap_upper_2s, 2),
            avwap_lower_2s=round(avwap_lower_2s, 2),
            price_vs_value_area=va_status
        )

volume_profile_engine = ITIVolumeProfileEngine()
