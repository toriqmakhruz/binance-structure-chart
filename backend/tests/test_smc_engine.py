import pytest
from app.models.schemas import Candle, SwingPoint
from app.analysis.smc_engine import SmcEngine

def create_candle(idx: int, open_: float, high: float, low: float, close: float, volume: float = 100.0) -> Candle:
    return Candle(
        time=1700000000 + idx * 900,
        open=open_,
        high=high,
        low=low,
        close=close,
        volume=volume,
        taker_buy_volume=volume * 0.5,
        is_closed=True
    )

def test_initial_swing_no_fake_comparison():
    """
    Kriteria P0-B (3.2): Swing pertama yang tidak memiliki pembanding tidak boleh langsung
    diberi label HH/HL/LH/LL. Harus berlabel 'H' atau 'L'.
    """
    engine = SmcEngine(swing_length=2)
    # Candle pattern: Low, High, Low, Higher High, Low
    candles = [
        create_candle(0, 100, 102, 99, 101),
        create_candle(1, 101, 103, 100, 102),
        create_candle(2, 102, 115, 101, 114), # Swing High 1 (idx 2)
        create_candle(3, 114, 114, 103, 105),
        create_candle(4, 105, 106, 95, 96),   # Swing Low 1 (idx 4)
        create_candle(5, 96, 110, 96, 108),
        create_candle(6, 108, 125, 107, 124), # Swing High 2 (idx 6)
        create_candle(7, 124, 124, 118, 119),
        create_candle(8, 119, 120, 117, 118),
    ]
    swings = engine._detect_swings(candles)
    assert len(swings) >= 2
    # High pertama harus berlabel 'H' (bukan LH atau HH)
    assert swings[0].type == 'H'
    assert swings[0].price == 115
    # Low pertama harus berlabel 'L' (bukan LL atau HL)
    assert swings[1].type == 'L'
    assert swings[1].price == 95
    # High kedua lebih tinggi dari 115 -> 'HH'
    if len(swings) >= 3:
        assert swings[2].type == 'HH'
        assert swings[2].price == 125

def test_bos_and_choch_chronological():
    """
    Kriteria P0-B (3.1): State machine kronologis untuk BOS dan CHoCH.
    BOS = kelanjutan arah tren, CHoCH = pembalikan tren.
    """
    engine = SmcEngine(swing_length=2, break_mode="close")
    # Buat sekuens harga yang membentuk trend naik -> BOS -> berbalik turun -> CHoCH
    # 0..4: pembentukan swing high 100
    # 5..9: break di atas 100 -> CHoCH/BOS bullish
    candles = [
        create_candle(0, 50, 52, 49, 51),
        create_candle(1, 51, 53, 50, 52),
        create_candle(2, 52, 70, 51, 68),  # Swing High 1 = 70 (idx 2)
        create_candle(3, 68, 69, 58, 60),
        create_candle(4, 60, 61, 55, 56),  # Swing Low 1 = 55 (idx 4) (konfirmasi H di idx 4)
        create_candle(5, 56, 65, 55, 64),
        create_candle(6, 64, 85, 63, 84),  # Close break 70 (idx 6) -> Bullish CHoCH (dari Ranging)
        create_candle(7, 84, 88, 80, 82),
        create_candle(8, 82, 83, 75, 76),
        create_candle(9, 76, 95, 75, 94),  # Close break lanjutan -> BOS
        create_candle(10, 94, 95, 90, 91),
        create_candle(11, 91, 92, 88, 89),
    ]

    res = engine.analyze(candles)
    assert len(res.events) >= 1
    first_ev = res.events[0]
    assert first_ev.direction == "BULLISH"
    assert first_ev.break_price > 70

def test_false_break_wick_only():
    """
    Kriteria P0-B: Candle yang hanya wick menembus level tetapi close di bawah level
    TIDAK boleh memicu break jika break_mode='close'.
    """
    engine = SmcEngine(swing_length=2, break_mode="close")
    candles = [
        create_candle(0, 50, 52, 49, 51),
        create_candle(1, 51, 53, 50, 52),
        create_candle(2, 52, 70, 51, 68),  # Swing High = 70
        create_candle(3, 68, 69, 58, 60),
        create_candle(4, 60, 61, 55, 56),  # Confirmed at idx 4
        create_candle(5, 56, 75, 55, 68),  # High = 75 (wick pierce!), tapi Close = 68 (< 70)
        create_candle(6, 68, 69, 62, 63),
        create_candle(7, 63, 64, 60, 61),
    ]

    res = engine.analyze(candles)
    # Karena close tidak menembus 70, tidak boleh ada event break terpicu
    assert len(res.events) == 0

def test_no_duplicate_break_events_on_same_level():
    """
    Kriteria P0-B: Cegah event duplikat pada level yang sama.
    """
    engine = SmcEngine(swing_length=2, break_mode="close")
    candles = [
        create_candle(0, 50, 52, 49, 51),
        create_candle(1, 51, 53, 50, 52),
        create_candle(2, 52, 70, 51, 68),  # Swing High = 70
        create_candle(3, 68, 69, 58, 60),
        create_candle(4, 60, 61, 55, 56),  # Confirmed at idx 4
        create_candle(5, 56, 75, 55, 72),  # Candle 1 close > 70 (Break #1)
        create_candle(6, 72, 78, 71, 75),  # Candle 2 close > 70 (Tetap di atas, tidak boleh duplikat event)
        create_candle(7, 75, 79, 74, 76),  # Candle 3 close > 70
        create_candle(8, 76, 77, 73, 74),
    ]

    res = engine.analyze(candles)
    # Hanya boleh 1 event break pada level 70
    high_breaks = [e for e in res.events if e.level_price == 70]
    assert len(high_breaks) == 1

def test_order_block_mitigation_and_invalidation():
    """
    Kriteria P0-B (3.3): Order Block harus mendeteksi overlap zona [bottom, top],
    membedakan status ACTIVE, MITIGATED, dan INVALIDATED.
    """
    engine = SmcEngine(swing_length=2, break_mode="close")
    # Rangkaian:
    # idx 2: Swing High di 80
    # idx 4: Down candle bearish (OB candidate) Open 65, High 66, Low 60, Close 61
    # idx 5: Impulsive rally menembus 80 -> memicu OB Bullish [60, 65]
    # idx 6: Retest ke zona 62 -> status MITIGATED
    candles_mitigated = [
        create_candle(0, 50, 52, 49, 51),
        create_candle(1, 51, 53, 50, 52),
        create_candle(2, 52, 80, 51, 78),  # Swing High = 80
        create_candle(3, 78, 79, 68, 70),
        create_candle(4, 65, 66, 60, 61),  # Bearish origin candle: top=65, bottom=60
        create_candle(5, 61, 85, 61, 84),  # Breakout candle menembus 80
        create_candle(6, 84, 84, 62, 66),  # Retest: low=62 masuk zona [60, 65] -> MITIGATED
        create_candle(7, 66, 70, 65, 69),
    ]

    res = engine.analyze(candles_mitigated)
    assert len(res.order_blocks) > 0
    ob = res.order_blocks[0]
    assert ob.direction == "BULLISH"
    assert ob.top == 65
    assert ob.bottom == 60
    assert ob.status == "MITIGATED"
    assert ob.mitigated is True

    # Kasus invalidasi: candle berikutnya close di bawah bottom (< 60)
    candles_invalidated = candles_mitigated + [
        create_candle(8, 65, 65, 55, 58),  # Close 58 < bottom 60 -> INVALIDATED
    ]
    res_inv = engine.analyze(candles_invalidated)
    ob_inv = res_inv.order_blocks[0]
    assert ob_inv.status == "INVALIDATED"

def test_fvg_partial_fill_and_full_fill():
    """
    Kriteria P0-B (3.4): FVG mendeteksi status UNFILLED, PARTIALLY_FILLED, FILLED.
    """
    engine = SmcEngine(swing_length=2, fvg_min_pct=0.01)
    # Candle 0: High = 100
    # Candle 1: Big green candle
    # Candle 2: Low = 110 -> FVG Bullish [100, 110], gap = 10
    # Candle 3: Retest low = 105 (penetrasi 5 / 10 = 50%) -> PARTIALLY_FILLED
    # Candle 4: Retest low = 98 (penetrasi 100%) -> FILLED
    candles = [
        create_candle(0, 95, 100, 94, 99),
        create_candle(1, 99, 112, 99, 111),
        create_candle(2, 111, 120, 110, 118),
        create_candle(3, 118, 119, 105, 112),  # Partial fill
    ]

    res = engine.analyze(candles)
    assert len(res.fvgs) > 0
    fvg = res.fvgs[0]
    assert fvg.direction == "BULLISH"
    assert fvg.top == 110
    assert fvg.bottom == 100
    assert fvg.status == "PARTIALLY_FILLED"
    assert fvg.fill_pct == 50.0

    # Tambah candle 4 yang menembus penuh
    candles_full = candles + [create_candle(4, 112, 113, 98, 102)]
    res_full = engine.analyze(candles_full)
    fvg_full = res_full.fvgs[0]
    assert fvg_full.status == "FILLED"
    assert fvg_full.fill_pct == 100.0
    assert fvg_full.mitigated is True

def test_liquidity_pool_clustering_and_sweep():
    """
    Kriteria P0-B: Liquidity pool mendeteksi clustering multi-touch dan deteksi sweep.
    """
    engine = SmcEngine(swing_length=2)
    # High 1 di 100, High 2 di 100.1 (dalam batas 0.15% -> Equal Highs / EQH)
    candles = [
        create_candle(0, 80, 82, 79, 81),
        create_candle(1, 81, 83, 80, 82),
        create_candle(2, 82, 100.0, 81, 98),  # Swing High 1 = 100.0 (idx 2)
        create_candle(3, 98, 98, 88, 90),
        create_candle(4, 90, 91, 85, 86),
        create_candle(5, 86, 92, 86, 90),
        create_candle(6, 90, 100.1, 89, 97),  # Swing High 2 = 100.1 (idx 6)
        create_candle(7, 97, 97, 91, 92),
        create_candle(8, 92, 93, 89, 90),
        # Candle 9: Sweep wick 100.5 > 100.05, tapi close 99.5 <= 100.05
        create_candle(9, 90, 100.5, 90, 99.5),
        create_candle(10, 99.5, 99.6, 94, 95),
    ]

    res = engine.analyze(candles)
    eqh_pools = [p for p in res.liquidity_pools if p.type == "EQH"]
    assert len(eqh_pools) >= 1
    pool = eqh_pools[0]
    assert pool.touches >= 2
    assert pool.swept is True
    assert pool.sweep_time == candles[9].time
