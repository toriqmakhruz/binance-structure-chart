import pytest
import math
from app.models.schemas import Candle, MovementMetrics
from app.analysis.forecast_engine import ForecastEngine

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

def test_confluence_separated_from_probability():
    """
    Kriteria P0-C (4.1): Skor konfluensi TIDAK boleh dijadikan probabilitas statistik.
    forecast_probability harus None jika model belum terkalibrasi out-of-sample.
    """
    engine = ForecastEngine(default_horizon=20)
    candles = [create_candle(i, 100.0 + i * 0.5) for i in range(40)]
    movement = MovementMetrics(
        volatility_atr=2.0,
        volatility_atr_pct=1.5,
        volatility_status="NORMAL",
        trend_direction="BULLISH",
        rsi=65.0,
        rsi_condition="NEUTRAL",
        volume_delta=500.0,
        volume_delta_ratio=0.6,
        confluence_score=75.0,
        confluence_bias="BULLISH",
        summary="Testing confluence metrics"
    )

    res = engine.analyze(candles, movement=movement)

    # Confluence score terpisah dan akurat
    assert res.confluence_score == 75.0
    assert res.confluence_bias == "BULLISH"
    # Probabilitas model belum terkalibrasi -> None
    assert res.forecast_probability is None
    assert res.model_calibration_status == "UNCALIBRATED_HEURISTIC"

    # Setiap skenario membawa confluence_weight, bukan probabilitas palsu
    for sc in res.scenarios:
        assert sc.confluence_weight is not None
        assert sc.probability is None

def test_prediction_cone_expanding_bounds():
    """
    Kriteria P0-C: Kerucut prediksi membentuk pita probabilitas expanding:
    upper_95 >= upper_80 >= expected_price >= lower_80 >= lower_95 >= 0
    """
    engine = ForecastEngine(default_horizon=15)
    candles = [create_candle(i, 50.0 + i * 0.2) for i in range(35)]
    res = engine.analyze(candles)

    assert len(res.cone_points) == 15
    for pt in res.cone_points:
        assert pt.upper_bound_95 >= pt.upper_bound_80
        assert pt.upper_bound_80 >= pt.expected_price
        assert pt.expected_price >= pt.lower_bound_80
        assert pt.lower_bound_80 >= pt.lower_bound_95
        assert pt.lower_bound_95 >= 0.0

    # Lebar cone pada langkah akhir (k=15) harus lebih lebar dari langkah pertama (k=1)
    width_first = res.cone_points[0].upper_bound_95 - res.cone_points[0].lower_bound_95
    width_last = res.cone_points[-1].upper_bound_95 - res.cone_points[-1].lower_bound_95
    assert width_last > width_first

def test_flat_and_extreme_prices():
    """
    Kriteria P0-C: Penanganan harga konstan (flat / zero vol) dan nilai ekstrim
    tanpa error division by zero atau NaN.
    """
    engine = ForecastEngine(default_horizon=10)
    # Harga flat sempurna (100.0)
    candles = [create_candle(i, 100.0, atr_offset=0.0) for i in range(30)]
    res = engine.analyze(candles)

    assert res.predicted_trend == "NEUTRAL"
    assert len(res.cone_points) == 10
    for pt in res.cone_points:
        assert math.isfinite(pt.expected_price)
        assert math.isfinite(pt.upper_bound_95)
        assert math.isfinite(pt.lower_bound_95)

def test_insufficient_data():
    """
    Kriteria P0-C: Data terlalu sedikit (< 10 candle) harus ditangani dengan aman tanpa crash.
    """
    engine = ForecastEngine(default_horizon=20)
    candles = [create_candle(i, 100.0) for i in range(5)]
    res = engine.analyze(candles)

    assert res.predicted_trend == "NEUTRAL"
    assert res.cone_points == []
    assert res.scenarios == []

def test_valid_entry_box_parameters():
    """
    Test validasi titik entry, take profit, stop loss, dan atribut Entry Box
    untuk Long & Short positions.
    """
    engine = ForecastEngine(default_horizon=20)
    candles = [create_candle(i, 100.0 + i * 0.5) for i in range(40)]
    movement = MovementMetrics(
        volatility_atr=2.0,
        volatility_atr_pct=1.5,
        volatility_status="NORMAL",
        trend_direction="BULLISH",
        rsi=60.0,
        rsi_condition="NEUTRAL",
        volume_delta=400.0,
        volume_delta_ratio=0.65,
        confluence_score=70.0,
        confluence_bias="BULLISH",
        summary="Bullish setup with strong confluence"
    )

    res = engine.analyze(candles, movement=movement)
    assert len(res.scenarios) >= 2

    # Temukan skenario bullish (LONG)
    long_sc = next((s for s in res.scenarios if s.direction == "LONG"), None)
    assert long_sc is not None
    assert long_sc.entry_price > 0
    assert long_sc.entry_time is not None
    assert long_sc.target_price > long_sc.entry_price  # TP di atas entry
    assert long_sc.invalidation_price < long_sc.entry_price  # SL di bawah entry
    assert long_sc.risk_reward_ratio >= 1.5
    assert long_sc.is_valid is True
    assert long_sc.status == "VALID_ENTRY"
    assert long_sc.entry_zone_high is not None
    assert long_sc.entry_zone_low is not None
    assert long_sc.entry_zone_high >= long_sc.entry_zone_low

    # Temukan skenario bearish (SHORT)
    short_sc = next((s for s in res.scenarios if s.direction == "SHORT"), None)
    assert short_sc is not None
    assert short_sc.target_price < short_sc.entry_price  # TP di bawah entry
    assert short_sc.invalidation_price > short_sc.entry_price  # SL di atas entry
    assert short_sc.entry_zone_high >= short_sc.entry_zone_low


def test_bearish_bos_invalidates_long_setup():
    """
    Kriteria validitas: Jika baru saja terjadi Bearish BOS (breakdown ke bawah),
    setup LONG TIDAK boleh diberi status VALID_ENTRY (harus COUNTER_TREND / is_valid=False).
    """
    from app.models.schemas import SmcAnalysisResult, StructureEvent
    engine = ForecastEngine(default_horizon=20)
    candles = [create_candle(i, 100.0 - i * 0.5) for i in range(40)]
    
    smc = SmcAnalysisResult(
        swings=[],
        events=[
            StructureEvent(
                id="bos_1",
                type="BOS",
                direction="BEARISH",
                break_time=1700000000 + 38 * 900,
                break_price=82.0,
                level_price=85.0,
                level_time=1700000000 + 20 * 900
            )
        ],
        order_blocks=[],
        fvgs=[],
        liquidity_pools=[],
        current_trend="BEARISH"
    )
    movement = MovementMetrics(
        volatility_atr=2.0,
        volatility_atr_pct=2.0,
        volatility_status="NORMAL",
        trend_direction="BEARISH",
        rsi=35.0,
        rsi_condition="NEUTRAL",
        volume_delta=-500.0,
        volume_delta_ratio=0.35,
        confluence_score=30.0,
        confluence_bias="BEARISH",
        summary="Downtrend with bearish BOS"
    )

    res = engine.analyze(candles, smc=smc, movement=movement)
    long_sc = next((s for s in res.scenarios if s.direction == "LONG"), None)
    assert long_sc is not None
    # Long wajib TIDAK valid karena market sedang Bearish BOS breakdown!
    assert long_sc.is_valid is False
    assert long_sc.status == "COUNTER_TREND"
