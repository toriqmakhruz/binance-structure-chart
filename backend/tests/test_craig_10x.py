import pytest
from app.models.schemas import Candle, OrderBlock, SmcAnalysisResult, LiquidityPool, FairValueGap
from app.analysis.craig_10x_engine import Craig10xEngine
from app.analysis.forecast_engine import ForecastEngine


def test_craig_10x_rejection_candle():
    # Long rejection (hammer): low 90, open 96, close 98, high 100
    hammer = Candle(time=1000, open=96.0, high=100.0, low=90.0, close=98.0, volume=100.0)
    assert Craig10xEngine.is_rejection_candle(hammer, "LONG") is True

    # Short rejection (shooting star): low 90, open 92, close 91, high 100
    shooting_star = Candle(time=1000, open=92.0, high=100.0, low=90.0, close=91.0, volume=100.0)
    assert Craig10xEngine.is_rejection_candle(shooting_star, "SHORT") is True


def test_craig_10x_session_info():
    # 14:30 UTC = NY Session Prime Open (9:30 AM EST)
    # 2026-10-28 14:30:00 UTC = 1793197800
    session_ny = Craig10xEngine.get_session_info(1793197800)
    assert session_ny["in_prime_session"] is True

    # 08:00 UTC = London Session Open
    session_lon = Craig10xEngine.get_session_info(1793174400)
    assert session_lon["in_prime_session"] is True


def test_craig_10x_ema_lineup():
    # Construct 60 ascending candles -> EMA 20 > EMA 50
    candles_up = [
        Candle(time=i*60, open=100.0 + i, high=101.0 + i, low=99.5 + i, close=100.8 + i, volume=100.0)
        for i in range(60)
    ]
    ema_res = Craig10xEngine.check_ema_lineup(candles_up)
    assert ema_res["bias"] == "BULLISH"

    # Construct 60 descending candles -> EMA 20 < EMA 50
    candles_down = [
        Candle(time=i*60, open=200.0 - i, high=200.5 - i, low=198.5 - i, close=199.0 - i, volume=100.0)
        for i in range(60)
    ]
    ema_down = Craig10xEngine.check_ema_lineup(candles_down)
    assert ema_down["bias"] == "BEARISH"


def test_craig_10x_setup_generation():
    # Generate candles with an EQL sweep and upward bounce
    candles = [
        Candle(time=i*60, open=100.0 + i*0.2, high=101.0 + i*0.2, low=99.0 + i*0.2, close=100.5 + i*0.2, volume=100.0)
        for i in range(50)
    ]
    # Sweep candle: drops to 95.0, sweeps liquidity, bounces to 101.0
    candles[-1] = Candle(time=50*60, open=99.0, high=101.5, low=95.0, close=101.0, volume=500.0)

    lp = LiquidityPool(
        id="LP-EQL-1",
        price=98.0,
        type="EQL",
        times=[40*60, 45*60],
        swept=True,
        sweep_time=50*60
    )
    smc = SmcAnalysisResult(
        order_blocks=[],
        fvgs=[],
        liquidity_pools=[lp],
        swings=[],
        events=[],
        current_trend="BULLISH"
    )

    engine = ForecastEngine(default_horizon=20)
    res_10x = engine.analyze(candles=candles, smc=smc, setup_mode="craig_10x", horizon=20)

    valid_10x = [s for s in res_10x.scenarios if s.status == "VALID_ENTRY"]
    assert len(valid_10x) > 0
    sc = valid_10x[0]
    assert "Craig 10x" in sc.name
    assert sc.risk_reward_ratio >= 3.0
    assert "BE @" in sc.name
    # Micro SL should be tight around the sweep low (95.0)
    assert sc.invalidation_price < sc.entry_price


def test_api_craig_10x_mode_allowed():
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    # Test invalid setup mode returns 422
    resp_bad = client.get("/api/analysis?symbol=BTCUSDT&setup_mode=invalid_mode")
    assert resp_bad.status_code == 422

    resp_bad_setups = client.get("/api/setups?setup_mode=invalid_mode")
    assert resp_bad_setups.status_code == 422
