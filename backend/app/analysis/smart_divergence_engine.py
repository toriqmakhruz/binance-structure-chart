import logging
from typing import Optional, Dict, Any, List
import numpy as np
from ..models.schemas import Candle

logger = logging.getLogger("smart_divergence_engine")


def detect_smart_divergence(
    candles: List[Candle],
    sym_info: Dict[str, Any],
    timeframe: str = "15m"
) -> Optional[Dict[str, Any]]:
    """
    Apex Smart Multi-Divergence Scanner Engine (Python Backend implementation)
    Detects actionable Bullish / Bearish Divergences with:
      1. Multi-Oscillator Consensus: At least 2 agreeing among RSI, MACD Histogram, CVD/MFI.
      2. Price Action Rejection: Long wick / pinbar (>= 30% of range) or confirmed trigger break.
      3. Liquidity Sweep Validation: Low/High sweep beyond previous swing.
      4. Auto-Invalidation Safety: Discarded if price subsequently closed beyond the pivot level.
    """
    n = len(candles)
    if n < 40:
        return None

    closes = np.array([float(c.close) for c in candles], dtype=np.float64)
    highs = np.array([float(c.high) for c in candles], dtype=np.float64)
    lows = np.array([float(c.low) for c in candles], dtype=np.float64)
    volumes = np.array([float(c.volume or 0.0) for c in candles], dtype=np.float64)
    taker_buys = np.array([float(c.taker_buy_volume or 0.0) for c in candles], dtype=np.float64)

    # 1. Wilder's RSI (14)
    period = 14
    deltas = np.diff(closes)
    gains = np.where(deltas > 0, deltas, 0.0)
    losses = np.where(deltas < 0, -deltas, 0.0)

    rsi = np.full(n, 50.0, dtype=np.float64)
    if len(deltas) >= period:
        avg_gain = float(np.mean(gains[:period]))
        avg_loss = float(np.mean(losses[:period]))
        rsi[period] = 100.0 if avg_loss == 0 else 100.0 - (100.0 / (1.0 + avg_gain / avg_loss))

        for i in range(period + 1, n):
            d = deltas[i - 1]
            g = d if d > 0 else 0.0
            l = -d if d < 0 else 0.0
            avg_gain = (avg_gain * (period - 1) + g) / period
            avg_loss = (avg_loss * (period - 1) + l) / period
            if avg_loss <= 1e-9:
                rsi[i] = 100.0
            else:
                rs = avg_gain / avg_loss
                rsi[i] = 100.0 - (100.0 / (1.0 + rs))

    # 2. MACD Histogram (12, 26, 9)
    def calc_ema(arr: np.ndarray, span: int) -> np.ndarray:
        ema = np.empty_like(arr)
        alpha = 2.0 / (span + 1.0)
        ema[0] = arr[0]
        for t in range(1, len(arr)):
            ema[t] = alpha * arr[t] + (1.0 - alpha) * ema[t - 1]
        return ema

    ema12 = calc_ema(closes, 12)
    ema26 = calc_ema(closes, 26)
    macd_line = ema12 - ema26
    signal_line = calc_ema(macd_line, 9)
    macd_hist = macd_line - signal_line

    # 3. CVD & MFI (14)
    cvd = np.zeros(n, dtype=np.float64)
    mfi = np.full(n, 50.0, dtype=np.float64)
    cum_cvd = 0.0
    typical_prices = (highs + lows + closes) / 3.0
    pos_mf = np.zeros(n, dtype=np.float64)
    neg_mf = np.zeros(n, dtype=np.float64)

    for i in range(n):
        v = volumes[i]
        rng = max(1e-9, highs[i] - lows[i])
        tb = taker_buys[i]
        if 0 < tb <= v:
            b_vol = tb
            s_vol = max(0.0, v - tb)
        else:
            b_ratio = (closes[i] - lows[i]) / rng
            b_vol = v * b_ratio
            s_vol = v * (1.0 - b_ratio)
        cum_cvd += (b_vol - s_vol)
        cvd[i] = cum_cvd

        raw_mf = typical_prices[i] * v
        if i > 0:
            if typical_prices[i] > typical_prices[i - 1]:
                pos_mf[i] = raw_mf
            elif typical_prices[i] < typical_prices[i - 1]:
                neg_mf[i] = raw_mf

        if i >= period:
            s_pos = float(np.sum(pos_mf[i - period + 1 : i + 1]))
            s_neg = float(np.sum(neg_mf[i - period + 1 : i + 1]))
            if s_neg <= 1e-9:
                mfi[i] = 100.0 if s_pos > 0 else 50.0
            else:
                mr = s_pos / s_neg
                mfi[i] = 100.0 - (100.0 / (1.0 + mr))

    # 4. Detect Pivots (window left 4, right 2, lookback last 100 candles)
    scan_start = max(10, n - 100)
    max_pivot_idx = n - 3  # requires confirmed closed bars after pivot
    pivot_lows: List[int] = []
    pivot_highs: List[int] = []
    left_bars, right_bars = 4, 2

    for i in range(scan_start, max_pivot_idx + 1):
        ch = highs[i]
        cl = lows[i]
        is_h = True
        is_l = True
        for j in range(i - left_bars, min(n, i + right_bars + 1)):
            if j == i or j < 0:
                continue
            if highs[j] > ch:
                is_h = False
            if lows[j] < cl:
                is_l = False
        if is_h:
            pivot_highs.append(i)
        if is_l:
            pivot_lows.append(i)

    # 5. Evaluate Bullish Divergences
    bull_signal: Optional[Dict[str, Any]] = None
    for b_idx in range(len(pivot_lows) - 1, 0, -1):
        i2 = pivot_lows[b_idx]
        if n - 1 - i2 > 80:
            break
        c2_low = lows[i2]

        for a_idx in range(b_idx - 1, -1, -1):
            i1 = pivot_lows[a_idx]
            span = i2 - i1
            if span < 5:
                continue
            if span > 55:
                break
            c1_low = lows[i1]
            if c2_low > c1_low * 1.0002:
                continue

            # Line of sight
            obstructed = any(lows[m] < c2_low * 0.9985 for m in range(i1 + 1, i2))
            if obstructed:
                continue

            metrics: List[str] = []
            rsi_min = min(rsi[i1], rsi[i2])
            if rsi[i2] > rsi[i1] + 1.5 and rsi_min <= 42:
                metrics.append("RSI")
            if macd_hist[i2] > macd_hist[i1] and macd_hist[i1] < 0:
                metrics.append("MACD")
            if cvd[i2] > cvd[i1] or (mfi[i2] > mfi[i1] + 2.5 and min(mfi[i1], mfi[i2]) <= 42):
                metrics.append("CVD")

            if len(metrics) < 2:
                continue

            is_extreme = rsi_min <= 34 or min(mfi[i1], mfi[i2]) <= 30

            # Rejection wick on i2 or subsequent 2 bars
            best_wick_pct = 0.0
            has_rejection = False
            confirm_idx = min(n - 1, i2 + 1)

            for k in range(i2, min(n - 1, i2 + 3)):
                rng = max(1e-9, highs[k] - lows[k])
                lower_wick = min(candles[k].open, candles[k].close) - lows[k]
                w_pct = (lower_wick / rng) * 100.0
                if w_pct > best_wick_pct:
                    best_wick_pct = w_pct
                if w_pct >= 30.0 and candles[k].close > lows[k] + 0.4 * rng:
                    has_rejection = True

            is_confirmed_break = False
            for k in range(i2 + 1, min(n, i2 + 5)):
                if candles[k].close > highs[i2] or (candles[k].close > candles[k].open and candles[k].close > (highs[i2] + lows[i2]) / 2.0):
                    is_confirmed_break = True
                    confirm_idx = k
                    break

            has_sweep = (c2_low < c1_low and candles[i2].close > c1_low) or (lows[min(n - 1, i2 + 1)] < c1_low and candles[min(n - 1, i2 + 1)].close > c1_low)

            if not has_rejection and not is_confirmed_break and not has_sweep:
                continue

            # Invalidation check: closed below pivot low?
            is_inv = any(candles[k].close < c2_low * 0.9985 for k in range(confirm_idx + 1, n))
            if is_inv:
                continue

            score = (2 if len(metrics) >= 3 else 1) + (1 if is_extreme else 0) + (1 if (has_rejection or is_confirmed_break) else 0) + (1 if has_sweep else 0)
            grade = "A" if score >= 3 and (has_rejection or is_confirmed_break) else "B"

            reasons: List[str] = []
            if has_sweep:
                reasons.append("Sweep Low")
            if has_rejection:
                reasons.append(f"Pinbar {round(best_wick_pct)}%")
            if is_extreme:
                reasons.append(f"RSI {round(rsi[i2])}")
            if not reasons and is_confirmed_break:
                reasons.append("Confirmed Break")

            entry_p = float(candles[confirm_idx].close)
            sl_p = float(c2_low * 0.9985)
            risk = max(entry_p * 0.002, entry_p - sl_p)
            tp_p = entry_p + risk * 2.5

            live_price = float(sym_info.get("lastPrice") or closes[-1])
            # Filter if already triggered SL or TP
            if live_price <= sl_p or live_price >= tp_p:
                continue

            bull_signal = {
                "symbol": sym_info["symbol"],
                "baseAsset": sym_info.get("baseAsset") or sym_info["symbol"][:-4],
                "direction": "BULLISH",
                "grade": grade,
                "timeframe": timeframe,
                "current_price": live_price,
                "price_change_pct": float(sym_info.get("priceChangePercent", 0.0)),
                "quote_volume": float(sym_info.get("quoteVolume", 0.0)),
                "entry_price": round(entry_p, 4),
                "stop_loss_price": round(sl_p, 4),
                "take_profit_price": round(tp_p, 4),
                "rr_ratio": 2.5,
                "confirming_metrics": metrics,
                "reasons": reasons[:3],
                "rsi_value": round(float(rsi[i2]), 1),
                "wick_ratio_pct": round(best_wick_pct),
                "has_liquidity_sweep": bool(has_sweep),
                "has_rejection_wick": bool(has_rejection),
                "confirm_time": int(candles[confirm_idx].time),
                "is_active": True
            }
            break
        if bull_signal:
            break

    # 6. Evaluate Bearish Divergences
    bear_signal: Optional[Dict[str, Any]] = None
    for b_idx in range(len(pivot_highs) - 1, 0, -1):
        i2 = pivot_highs[b_idx]
        if n - 1 - i2 > 80:
            break
        c2_high = highs[i2]

        for a_idx in range(b_idx - 1, -1, -1):
            i1 = pivot_highs[a_idx]
            span = i2 - i1
            if span < 5:
                continue
            if span > 55:
                break
            c1_high = highs[i1]
            if c2_high < c1_high * 0.9998:
                continue

            # Line of sight
            obstructed = any(highs[m] > c2_high * 1.0015 for m in range(i1 + 1, i2))
            if obstructed:
                continue

            metrics: List[str] = []
            rsi_max = max(rsi[i1], rsi[i2])
            if rsi[i2] < rsi[i1] - 1.5 and rsi_max >= 58:
                metrics.append("RSI")
            if macd_hist[i2] < macd_hist[i1] and macd_hist[i1] > 0:
                metrics.append("MACD")
            if cvd[i2] < cvd[i1] or (mfi[i2] < mfi[i1] - 2.5 and max(mfi[i1], mfi[i2]) >= 58):
                metrics.append("CVD")

            if len(metrics) < 2:
                continue

            is_extreme = rsi_max >= 66 or max(mfi[i1], mfi[i2]) >= 70

            best_wick_pct = 0.0
            has_rejection = False
            confirm_idx = min(n - 1, i2 + 1)

            for k in range(i2, min(n - 1, i2 + 3)):
                rng = max(1e-9, highs[k] - lows[k])
                upper_wick = highs[k] - max(candles[k].open, candles[k].close)
                w_pct = (upper_wick / rng) * 100.0
                if w_pct > best_wick_pct:
                    best_wick_pct = w_pct
                if w_pct >= 30.0 and candles[k].close < highs[k] - 0.4 * rng:
                    has_rejection = True

            is_confirmed_break = False
            for k in range(i2 + 1, min(n, i2 + 5)):
                if candles[k].close < lows[i2] or (candles[k].close < candles[k].open and candles[k].close < (highs[i2] + lows[i2]) / 2.0):
                    is_confirmed_break = True
                    confirm_idx = k
                    break

            has_sweep = (c2_high > c1_high and candles[i2].close < c1_high) or (highs[min(n - 1, i2 + 1)] > c1_high and candles[min(n - 1, i2 + 1)].close < c1_high)

            if not has_rejection and not is_confirmed_break and not has_sweep:
                continue

            is_inv = any(candles[k].close > c2_high * 1.0015 for k in range(confirm_idx + 1, n))
            if is_inv:
                continue

            score = (2 if len(metrics) >= 3 else 1) + (1 if is_extreme else 0) + (1 if (has_rejection or is_confirmed_break) else 0) + (1 if has_sweep else 0)
            grade = "A" if score >= 3 and (has_rejection or is_confirmed_break) else "B"

            reasons: List[str] = []
            if has_sweep:
                reasons.append("Sweep High")
            if has_rejection:
                reasons.append(f"Pinbar {round(best_wick_pct)}%")
            if is_extreme:
                reasons.append(f"RSI {round(rsi[i2])}")
            if not reasons and is_confirmed_break:
                reasons.append("Confirmed Break")

            entry_p = float(candles[confirm_idx].close)
            sl_p = float(c2_high * 1.0015)
            risk = max(entry_p * 0.002, sl_p - entry_p)
            tp_p = entry_p - risk * 2.5

            live_price = float(sym_info.get("lastPrice") or closes[-1])
            if live_price >= sl_p or live_price <= tp_p:
                continue

            bear_signal = {
                "symbol": sym_info["symbol"],
                "baseAsset": sym_info.get("baseAsset") or sym_info["symbol"][:-4],
                "direction": "BEARISH",
                "grade": grade,
                "timeframe": timeframe,
                "current_price": live_price,
                "price_change_pct": float(sym_info.get("priceChangePercent", 0.0)),
                "quote_volume": float(sym_info.get("quoteVolume", 0.0)),
                "entry_price": round(entry_p, 4),
                "stop_loss_price": round(sl_p, 4),
                "take_profit_price": round(tp_p, 4),
                "rr_ratio": 2.5,
                "confirming_metrics": metrics,
                "reasons": reasons[:3],
                "rsi_value": round(float(rsi[i2]), 1),
                "wick_ratio_pct": round(best_wick_pct),
                "has_liquidity_sweep": bool(has_sweep),
                "has_rejection_wick": bool(has_rejection),
                "confirm_time": int(candles[confirm_idx].time),
                "is_active": True
            }
            break
        if bear_signal:
            break

    # Return the freshest signal
    if bull_signal and bear_signal:
        return bull_signal if bull_signal["confirm_time"] >= bear_signal["confirm_time"] else bear_signal
    return bull_signal or bear_signal
