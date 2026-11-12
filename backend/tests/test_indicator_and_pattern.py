import pytest
import numpy as np
from app.models.schemas import Candle, SwingPoint
from app.analysis.movement_engine import MovementEngine
from app.analysis.pattern_engine import PatternEngine

def create_candle(idx: int, open_: float, high: float, low: float, close: float) -> Candle:
    return Candle(
        time=1700000000 + idx * 900,
        open=open_,
        high=high,
        low=low,
        close=close,
        volume=100.0,
        taker_buy_volume=50.0,
        is_closed=True
    )

def test_rsi_zero_loss_strictly_rising():
    """
    Kriteria P1-A (4.2): Ketika harga terus naik tanpa penurunan harga (zero loss),
    RSI harus 100.0 (BUKAN 50.0).
    """
    engine = MovementEngine(rsi_period=14)
    # 25 candle terus naik monoton
    closes = np.array([100.0 + i * 2.0 for i in range(25)])
    rsi, cond = engine._calculate_rsi(closes)
    assert rsi == 100.0
    assert cond == "OVERBOUGHT"

def test_rsi_zero_gain_strictly_falling():
    """
    Kriteria P1-A (4.2): Ketika harga terus turun tanpa kenaikan (zero gain),
    RSI harus 0.0.
    """
    engine = MovementEngine(rsi_period=14)
    closes = np.array([200.0 - i * 2.0 for i in range(25)])
    rsi, cond = engine._calculate_rsi(closes)
    assert rsi == 0.0
    assert cond == "OVERSOLD"

def test_rsi_constant_flat_prices():
    """
    Kriteria P1-A (4.2): Harga konstan (flat / zero gain and zero loss),
    RSI harus 50.0 (Netral).
    """
    engine = MovementEngine(rsi_period=14)
    closes = np.array([150.0 for _ in range(25)])
    rsi, cond = engine._calculate_rsi(closes)
    assert rsi == 50.0
    assert cond == "NEUTRAL"

def test_rsi_insufficient_length():
    """
    Kriteria P1-A: Data terlalu pendek (< 15 bars) menghasilkan nilai netral yang aman.
    """
    engine = MovementEngine(rsi_period=14)
    closes = np.array([100.0, 102.0, 104.0])
    rsi, cond = engine._calculate_rsi(closes)
    assert rsi == 50.0

def test_double_top_forming_vs_confirmed():
    """
    Kriteria P1-A (4.3): Double Top berstatus FORMING sampai breakout neckline terkonfirmasi.
    """
    engine = PatternEngine(pattern_tolerance_pct=1.0)
    # Peak 1 = 100 at idx 5, Neckline = 85 at idx 10, Peak 2 = 100 at idx 15
    swings = [
        SwingPoint(time=1700000000, price=80, type='L', index=0),
        SwingPoint(time=1700000000 + 5*900, price=100, type='H', index=5),
        SwingPoint(time=1700000000 + 10*900, price=85, type='L', index=10),
        SwingPoint(time=1700000000 + 15*900, price=100, type='HH', index=15),
    ]
    # Candle sequence: setelah peak 2 (idx 15), harga berkisar di 90 (belum tembus neckline 85)
    candles_forming = [create_candle(i, 90, 92, 88, 90) for i in range(25)]
    patterns_forming = engine._detect_double_tops_bottoms(swings, candles_forming)
    assert len(patterns_forming) == 1
    assert patterns_forming[0].status == "FORMING"
    assert patterns_forming[0].neckline == 85

    # Candle sequence: candle 20 close di 82 (< 85) -> CONFIRMED
    candles_confirmed = [create_candle(i, 90, 92, 88, 90) for i in range(25)]
    candles_confirmed[20] = create_candle(20, 86, 86, 80, 82)
    patterns_confirmed = engine._detect_double_tops_bottoms(swings, candles_confirmed)
    assert patterns_confirmed[0].status == "CONFIRMED"
    assert patterns_confirmed[0].breakout_price == 82

def test_descending_triangle_implementation():
    """
    Kriteria P1-A (4.4): Verifikasi dan implementasi Descending Triangle
    (Support datar, resistance menurun).
    """
    engine = PatternEngine()
    # Highs falling: 100 -> 95. Lows flat: 80 -> 80
    swings = [
        SwingPoint(time=1700000000, price=100, type='H', index=2),
        SwingPoint(time=1700000000 + 4*900, price=80, type='L', index=4),
        SwingPoint(time=1700000000 + 8*900, price=95, type='LH', index=8),
        SwingPoint(time=1700000000 + 12*900, price=80, type='LL', index=12),
    ]
    # Candle 15 close tembus support 80 -> close di 76
    candles = [create_candle(i, 85, 87, 83, 85) for i in range(20)]
    candles[15] = create_candle(15, 81, 81, 75, 76)

    patterns = engine._detect_triangles(swings, candles)
    desc_tri = [p for p in patterns if p.name == "Descending Triangle"]
    assert len(desc_tri) == 1
    assert desc_tri[0].type == "BEARISH"
    assert desc_tri[0].status == "CONFIRMED"
    assert desc_tri[0].neckline == 80
    assert desc_tri[0].breakout_price == 76
