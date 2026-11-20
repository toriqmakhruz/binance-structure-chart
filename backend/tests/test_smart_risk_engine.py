import pytest
from app.models.schemas import Candle
from app.analysis.smart_risk_engine import (
    SmartRiskEngine,
    SmartRiskOrderBlock,
    SmartRiskEntryBracket,
    InducementZone,
    MarketControlState,
    SniperSetup,
    SmartRiskAnalysisResult
)

def make_candle(idx: int, o: float, h: float, l: float, c: float, v: float = 1000.0) -> Candle:
    return Candle(
        time=1700000000 + idx * 300,
        open=o,
        high=h,
        low=l,
        close=c,
        volume=v,
        taker_buy_volume=v * 0.55,
        is_closed=True
    )

class TestSmartRiskEngine:
    """
    Test suite komprehensif untuk Smart Risk Institutional Engine.
    Menguji seluruh aturan kuantitatif yang dipelajari dari 5 video Smart Risk.
    """

    def test_candlestick_bullish_ob_with_sweep_and_fvg(self):
        """
        Video 1 & 3: Bullish OB wajib menyapu low candle sebelumnya (sweep),
        diikuti ketidakseimbangan FVG (c3.low > c1.high).
        """
        engine = SmartRiskEngine()
        candles = [
            make_candle(0, 100.0, 101.0, 99.0, 99.5),   # Baseline candle
            make_candle(1, 99.5, 100.0, 97.0, 97.5),    # OB Candle: sweeps low 99.0 -> 97.0
            make_candle(2, 97.5, 106.0, 97.5, 105.0),   # Impulsive expansion candle 2
            make_candle(3, 105.0, 110.0, 102.0, 108.0), # Candle 3: low 102.0 > c1.high 100.0 (FVG!)
            make_candle(4, 108.0, 112.0, 106.0, 111.0), # Continued up
        ]

        obs = engine.detect_order_blocks(candles)
        bullish_obs = [ob for ob in obs if ob.direction == "BULLISH"]

        assert len(bullish_obs) >= 1
        ob = bullish_obs[0]
        assert ob.has_previous_candle_sweep is True
        assert ob.has_fvg is True
        assert ob.bottom == 97.0
        assert ob.top == 100.0
        assert ob.mean_threshold == (100.0 + 97.0) / 2.0  # 98.5
        assert ob.status == "UNMITIGATED"

    def test_candlestick_bearish_ob_with_sweep_and_fvg(self):
        """
        Video 1 & 3: Bearish OB wajib menyapu high candle sebelumnya (sweep),
        diikuti FVG (c3.high < c1.low).
        """
        engine = SmartRiskEngine()
        candles = [
            make_candle(0, 100.0, 102.0, 99.0, 101.0),  # Baseline candle
            make_candle(1, 101.0, 105.0, 100.5, 104.0), # OB Candle: sweeps high 102.0 -> 105.0
            make_candle(2, 104.0, 104.0, 95.0, 96.0),   # Impulsive drop
            make_candle(3, 96.0, 98.0, 94.0, 95.0),     # Candle 3: high 98.0 < c1.low 100.5 (FVG!)
            make_candle(4, 95.0, 96.0, 92.0, 93.0),
        ]

        obs = engine.detect_order_blocks(candles)
        bearish_obs = [ob for ob in obs if ob.direction == "BEARISH"]

        assert len(bearish_obs) >= 1
        ob = bearish_obs[0]
        assert ob.has_previous_candle_sweep is True
        assert ob.has_fvg is True
        assert ob.top == 105.0
        assert ob.bottom == 100.5
        assert ob.mean_threshold == (105.0 + 100.5) / 2.0
        assert ob.status == "UNMITIGATED"

    def test_wick_as_order_block_rule(self):
        """
        Video 4: Jika rejection wick > 50% dari total candle range,
        OB didefinisikan murni oleh panjang ekor (wick) tersebut.
        """
        engine = SmartRiskEngine()
        # Bullish pinbar: Range 10.0 (100 - 90), Lower wick 8.0 (98 - 90 = 80% wick)
        candles = [
            make_candle(0, 99.0, 100.0, 95.0, 98.0),
            make_candle(1, 98.0, 100.0, 90.0, 98.5),   # Lower wick dari 98.0 ke 90.0 (8 / 10 = 80%)
            make_candle(2, 98.5, 110.0, 98.5, 108.0),
            make_candle(3, 108.0, 115.0, 103.0, 114.0),
            make_candle(4, 114.0, 116.0, 112.0, 115.0),
        ]

        obs = engine.detect_order_blocks(candles)
        assert len(obs) >= 1
        ob = obs[0]
        assert ob.is_wick_ob is True
        assert ob.bottom == 90.0

    def test_four_entry_models_calculation(self):
        """
        Video 3: Menguji 4 model eksekusi: Wick, Body, 50% Midpoint, dan Aggressive Body.
        """
        engine = SmartRiskEngine()
        candles = [
            make_candle(0, 100.0, 101.0, 99.0, 100.0),
            make_candle(1, 100.0, 102.0, 96.0, 97.0),    # OB Bullish: range 96 - 102, body 97 - 100
            make_candle(2, 97.0, 112.0, 97.0, 110.0),
            make_candle(3, 110.0, 115.0, 104.0, 114.0),  # FVG 104 > 102
            make_candle(4, 114.0, 116.0, 112.0, 115.0),
        ]

        obs = engine.detect_order_blocks(candles)
        ob = obs[0]
        brackets = ob.brackets

        assert "WICK" in brackets
        assert "BODY" in brackets
        assert "MIDPOINT" in brackets
        assert "AGGRESSIVE" in brackets

        # Entry Wick berada di top OB (102.0)
        assert brackets["WICK"].entry_price == ob.top
        # Entry Body berada di body_top (100.0)
        assert brackets["BODY"].entry_price == ob.body_top
        # Entry Midpoint berada di 50% (99.0)
        assert brackets["MIDPOINT"].entry_price == ob.mean_threshold
        # Aggressive entry berada di body_bottom (97.0)
        assert brackets["AGGRESSIVE"].entry_price == ob.body_bottom

        # R:R Midpoint harus lebih besar daripada Wick karena SL lebih dekat ke entry
        assert brackets["MIDPOINT"].risk_reward_ratio > brackets["WICK"].risk_reward_ratio

    def test_inducement_trap_and_scoring_matrix(self):
        """
        Video 1 & 5: Intermediate OB di depan Extreme OB diberi penalti -1 (Trap),
        dan diidentifikasi sebagai Inducement Zone.
        """
        engine = SmartRiskEngine()
        candles = [
            make_candle(0, 100.0, 101.0, 99.0, 100.0),
            # Extreme Bullish OB (paling bawah, low 90.0)
            make_candle(1, 100.0, 101.0, 90.0, 92.0),
            make_candle(2, 92.0, 105.0, 92.0, 104.0),
            make_candle(3, 104.0, 110.0, 102.0, 109.0),
            make_candle(4, 109.0, 112.0, 108.0, 111.0),
            # Intermediate Bullish OB (tengah jalan, low 105.0)
            make_candle(5, 111.0, 113.0, 105.0, 106.0),
            make_candle(6, 106.0, 120.0, 106.0, 118.0),
            make_candle(7, 118.0, 125.0, 115.0, 124.0),
            make_candle(8, 124.0, 126.0, 122.0, 125.0),
        ]

        obs = engine.detect_order_blocks(candles)
        scored_obs, extreme_obs, inducements = engine.evaluate_inducements_and_scoring(candles, obs)

        # Harus ada 2 OB unmitigated
        assert len(scored_obs) >= 2

        extreme_ob = next(o for o in scored_obs if o.bottom == 90.0)
        intermediate_ob = next(o for o in scored_obs if o.bottom == 105.0)

        # Extreme OB tidak boleh dianggap trap
        assert extreme_ob.is_extreme is True
        assert extreme_ob.is_trap is False

        # Intermediate OB harus ditandai sebagai trap (-1 skor) dan masuk ke daftar Inducement
        assert intermediate_ob.is_extreme is False
        assert intermediate_ob.is_trap is True
        assert intermediate_ob.score < 0

        assert len(inducements) >= 1
        assert inducements[0].type == "INTERMEDIATE_OB"

    def test_market_control_evaluation(self):
        """
        Video 4: Menentukan 'Demand in Control' vs 'Supply in Control' berdasarkan mitigasi zona.
        """
        engine = SmartRiskEngine()
        # Buat candle di mana harga turun memitigasi zona Demand, lalu mantul ke atas
        candles = [
            make_candle(0, 100.0, 101.0, 99.0, 100.0),
            make_candle(1, 100.0, 101.0, 90.0, 92.0),   # OB Demand (90 - 101)
            make_candle(2, 92.0, 106.0, 92.0, 105.0),
            make_candle(3, 105.0, 110.0, 103.0, 109.0), # FVG
            make_candle(4, 109.0, 110.0, 100.0, 102.0), # Mitigasi! Low 100.0 menyentuh top OB 101.0
            make_candle(5, 102.0, 115.0, 101.0, 114.0), # Mantul kuat ke atas
        ]

        obs = engine.detect_order_blocks(candles)
        mitigated_obs = [o for o in obs if o.mitigated]
        assert len(mitigated_obs) >= 1

        state = engine.evaluate_market_control(candles, obs)
        assert state.control == "DEMAND_IN_CONTROL"
        assert state.bias == "BULLISH"

    def test_full_smart_risk_pipeline(self):
        """
        Uji end-to-end pipeline SmartRiskEngine.analyze()
        """
        engine = SmartRiskEngine()
        candles = [
            make_candle(i, 100.0 + i, 102.0 + i, 99.0 + i, 101.0 + i)
            for i in range(20)
        ]
        # Sisipkan impulsive pattern
        candles[5] = make_candle(5, 105.0, 106.0, 95.0, 97.0)
        candles[6] = make_candle(6, 97.0, 115.0, 97.0, 114.0)
        candles[7] = make_candle(7, 114.0, 120.0, 108.0, 118.0)

        result = engine.analyze(candles)

        assert isinstance(result, SmartRiskAnalysisResult)
        assert isinstance(result.market_control, MarketControlState)
        assert isinstance(result.order_blocks, list)
        assert isinstance(result.sniper_setups, list)
        assert len(result.summary) > 0
