import pytest
import numpy as np
from app.models.schemas import Candle
from app.analysis.trend_strength_engine import TrendStrengthEngine


def _make_candles(n: int = 100, trend_type: str = "bullish") -> list:
    np.random.seed(42)
    base_time = 1700000000
    candles = []
    
    if trend_type == "bullish":
        drift = np.linspace(0, 50, n)
    elif trend_type == "bearish":
        drift = np.linspace(0, -50, n)
    else:
        # Choppy / ranging
        drift = np.sin(np.linspace(0, 4 * np.pi, n)) * 2

    cur_price = 100.0
    for i in range(n):
        p = cur_price + drift[i] + np.random.randn() * 0.3
        h = p + abs(np.random.randn() * 0.5) + 0.2
        l = p - abs(np.random.randn() * 0.5) - 0.2
        o = (h + l) / 2.0
        c = p
        v = 1000.0 + abs(np.random.randn() * 200.0)
        tbv = v * (0.65 if trend_type == "bullish" else (0.35 if trend_type == "bearish" else 0.5))

        candles.append(
            Candle(
                time=base_time + i * 900,
                open=round(o, 2),
                high=round(h, 2),
                low=round(l, 2),
                close=round(c, 2),
                volume=round(v, 2),
                taker_buy_volume=round(tbv, 2)
            )
        )
    return candles


def test_trend_strength_insufficient_candles():
    engine = TrendStrengthEngine()
    short_candles = _make_candles(10)
    res = engine.analyze(short_candles)
    assert res.score == 25.0
    assert res.status == "CHOPPY_RANGING"
    assert "belum mencukupi" in res.action_advice.lower()


def test_trend_strength_strong_bullish():
    engine = TrendStrengthEngine()
    bull_candles = _make_candles(120, trend_type="bullish")
    res = engine.analyze(bull_candles)

    assert res.direction == "BULLISH"
    assert res.score >= 50.0
    assert res.adx > 20.0
    assert res.plus_di > res.minus_di
    assert "BULLISH" in res.ribbon_alignment
    assert res.ema_slope_deg > 0
    assert len(res.ribbon_series) > 0
    assert "Bullish" in res.label


def test_trend_strength_strong_bearish():
    engine = TrendStrengthEngine()
    bear_candles = _make_candles(120, trend_type="bearish")
    res = engine.analyze(bear_candles)

    assert res.direction == "BEARISH"
    assert res.score >= 50.0
    assert res.adx > 20.0
    assert res.minus_di > res.plus_di
    assert "BEARISH" in res.ribbon_alignment
    assert res.ema_slope_deg < 0
    assert "Bearish" in res.label


def test_trend_strength_choppy_ranging():
    engine = TrendStrengthEngine()
    chop_candles = _make_candles(120, trend_type="ranging")
    res = engine.analyze(chop_candles)

    assert res.score < 60.0
    assert res.status in ("CHOPPY_RANGING", "DEVELOPING_TREND")
    assert res.adx < 30.0
