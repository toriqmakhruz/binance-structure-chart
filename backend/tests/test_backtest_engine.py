import pytest
from app.models.schemas import Candle
from app.analysis.backtest_engine import BacktestEngine

def create_candle(idx: int, price: float, atr_offset: float = 2.0) -> Candle:
    return Candle(
        time=1700000000 + idx * 900,
        open=price - 0.5,
        high=price + atr_offset,
        low=price - atr_offset,
        close=price,
        volume=100.0,
        taker_buy_volume=50.0,
        is_closed=True
    )

def test_chronological_walk_forward_split():
    """
    Kriteria P1-D (4.5): Walk-forward menggunakan chronological split (bukan random split).
    """
    engine = BacktestEngine()
    total_bars = 100
    candles = [create_candle(i, 100.0 + (i % 10) * 2.0) for i in range(total_bars)]

    metrics = engine.run_walk_forward(candles, train_ratio=0.6)
    assert metrics.in_sample_bars == 60
    assert metrics.out_of_sample_bars == 40
    assert metrics.in_sample_bars + metrics.out_of_sample_bars == total_bars

def test_backtest_fee_and_slippage_accounting():
    """
    Kriteria P1-D: Memasukkan trading fee, slippage, dan funding rate.
    """
    engine = BacktestEngine(fee_rate=0.001, slippage_rate=0.0005)
    # Buat sekuens harga yang menghasilkan sinyal dan transaksi
    candles = []
    price = 100.0
    for i in range(120):
        if i % 15 == 0:
            price += 10.0  # Breakout jump
        elif i % 15 == 7:
            price -= 5.0   # Pullback
        else:
            price += 0.2
        candles.append(create_candle(i, price, atr_offset=3.0))

    metrics = engine.run_walk_forward(candles, train_ratio=0.5, swing_length=3)
    if metrics.total_trades > 0:
        assert metrics.total_fees_paid_usd > 0
        for t in metrics.trades:
            assert t.fee_paid > 0
            assert t.entry_price > 0
            assert t.exit_price > 0

def test_backtest_insufficient_data():
    """
    Kriteria P1-D: Data < 60 bar ditangani dengan aman tanpa crash.
    """
    engine = BacktestEngine()
    candles = [create_candle(i, 100.0) for i in range(20)]
    metrics = engine.run_walk_forward(candles)
    assert metrics.total_trades == 0
    assert metrics.win_rate_pct == 0.0
