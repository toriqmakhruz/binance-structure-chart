import pytest
from app.services.autobot_service import AutoBotService, BotConfig


@pytest.mark.asyncio
async def test_autobot_initial_state_disabled():
    bot = AutoBotService(data_file="")
    status = bot.get_status()
    # Bot MUST be disabled by default
    assert status["config"]["enabled"] is False
    assert status["state"]["enabled"] is False
    assert status["config"]["risk_per_trade_usd"] == 4.0
    assert status["config"]["max_daily_loss_usd"] == 16.0
    assert status["config"]["max_concurrent_positions"] == 4


@pytest.mark.asyncio
async def test_autobot_config_update():
    bot = AutoBotService(data_file="")
    updated = bot.update_config({
        "enabled": False,
        "mode": "demo",
        "risk_per_trade_usd": 10.0,
        "max_daily_loss_usd": 40.0,
        "max_concurrent_positions": 3,
        "leverage": 20,
        "timeframe": "1h"
    })
    assert updated["config"]["risk_per_trade_usd"] == 10.0
    assert updated["config"]["max_daily_loss_usd"] == 40.0
    assert updated["config"]["max_concurrent_positions"] == 3
    assert updated["config"]["leverage"] == 20
    assert updated["config"]["timeframe"] == "1h"


@pytest.mark.asyncio
async def test_autobot_start_and_stop():
    bot = AutoBotService(data_file="")
    # In demo mode, start should succeed without live keys
    res = await bot.start()
    assert res["success"] is True
    assert bot.config.enabled is True

    # Stop should put it back to dormant/disabled
    res_stop = bot.stop()
    assert res_stop["success"] is True
    assert bot.config.enabled is False


@pytest.mark.asyncio
async def test_autobot_circuit_breaker_and_reset():
    bot = AutoBotService(data_file="")
    bot.config.enabled = True
    bot.config.max_daily_loss_usd = 16.0

    # Simulate accumulated daily loss of $16
    bot.daily_realized_pnl = -16.0
    await bot.run_cycle()

    assert bot.circuit_breaker_triggered is True

    # Reset circuit breaker
    res = bot.reset_circuit_breaker()
    assert res["success"] is True
    assert bot.circuit_breaker_triggered is False
    assert bot.daily_realized_pnl == 0.0


@pytest.mark.asyncio
async def test_autobot_live_mode_preflight_check():
    bot = AutoBotService(data_file="")
    bot.config.mode = "live"
    bot.config.api_key = ""
    bot.config.api_secret = ""

    # Starting without API keys in live mode MUST fail
    res = await bot.start()
    assert res["success"] is False
    assert "diperlukan" in res["message"].lower()
    assert bot.config.enabled is False
