import pytest
from app.models.schemas import Candle, OrderBlock, SmcAnalysisResult
from app.analysis.pro_shield_engine import ProShieldEngine
from app.analysis.forecast_engine import ForecastEngine

def test_is_rejection_candle():
    # Hammer candle for LONG: low 90, open 96, close 98, high 100
    # total_range = 10, lower_wick = 96 - 90 = 6 (60% wick)
    hammer = Candle(time=1000, open=96.0, high=100.0, low=90.0, close=98.0, volume=100.0)
    assert ProShieldEngine.is_rejection_candle(hammer, "LONG") is True

    # Marubozu dumping candle for LONG (falling knife): open 100, close 90.1, low 90.0, high 100
    # lower_wick = 90.1 - 90 = 0.1 (1% wick), close < open
    knife = Candle(time=1000, open=100.0, high=100.0, low=90.0, close=90.1, volume=100.0)
    assert ProShieldEngine.is_rejection_candle(knife, "LONG") is False

    # Shooting star candle for SHORT: low 90, open 92, close 91, high 100
    # upper_wick = 100 - 92 = 8 (80% wick)
    shooting_star = Candle(time=1000, open=92.0, high=100.0, low=90.0, close=91.0, volume=100.0)
    assert ProShieldEngine.is_rejection_candle(shooting_star, "SHORT") is True

def test_pro_shield_expanded_buffer_vs_standard():
    # Setup test candles and a demand Order Block
    candles = [
        Candle(time=i*60, open=100.0 + i*0.1, high=101.0 + i*0.1, low=99.0 + i*0.1, close=100.5 + i*0.1, volume=100.0)
        for i in range(50)
    ]
    # Add a bounce candle at the end with a nice rejection wick
    candles[-1] = Candle(time=50*60, open=100.0, high=102.0, low=98.0, close=101.5, volume=200.0)

    ob = OrderBlock(
        id="OB-BULL-1",
        start_time=10*60,
        direction="BULLISH",
        top=100.0,
        bottom=98.0,
        volume=500.0,
        mitigated=False
    )
    smc = SmcAnalysisResult(
        order_blocks=[ob],
        fvgs=[],
        liquidity_pools=[],
        swings=[],
        events=[],
        current_trend="BULLISH"
    )

    engine = ForecastEngine(default_horizon=20)
    
    # 1. Standard mode
    res_std = engine.analyze(candles=candles, smc=smc, setup_mode="standard", horizon=20)
    valid_std = [s for s in res_std.scenarios if s.status == "VALID_ENTRY"]

    # 2. Pro Shield mode
    res_pro = engine.analyze(candles=candles, smc=smc, setup_mode="pro_shield", horizon=20)
    valid_pro = [s for s in res_pro.scenarios if s.status == "VALID_ENTRY"]

    if valid_std and valid_pro:
        # In Pro Shield mode, SL should be strictly lower than in Standard mode (wider buffer for protection)
        assert valid_pro[0].invalidation_price < valid_std[0].invalidation_price
        assert "Pro Shield" in valid_pro[0].name

def test_api_endpoints_setup_mode():
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    # Test invalid setup mode returns 422
    resp_bad = client.get("/api/analysis?symbol=BTCUSDT&setup_mode=invalid_mode")
    assert resp_bad.status_code == 422

    # Test invalid setup mode on setups returns 422
    resp_bad_setups = client.get("/api/setups?setup_mode=invalid_mode")
    assert resp_bad_setups.status_code == 422
