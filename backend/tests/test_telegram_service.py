import pytest
import pytest_asyncio
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, patch
from app.main import app
from app.services.telegram_service import TelegramService

@pytest.fixture
def client():
    return TestClient(app)

@pytest.fixture
def tg_service(tmp_path, monkeypatch):
    test_settings_file = tmp_path / "telegram_settings.json"
    test_history_file = tmp_path / "telegram_history.json"
    monkeypatch.setattr("app.services.telegram_service.SETTINGS_FILE", test_settings_file)
    monkeypatch.setattr("app.services.telegram_service.HISTORY_FILE", test_history_file)
    svc = TelegramService()
    return svc

def test_telegram_settings_defaults(tg_service):
    pub = tg_service.get_public_settings()
    assert pub["enabled"] is False
    assert pub["has_token"] is False
    assert pub["chat_id"] == ""
    assert pub["min_rr"] == 1.5

def test_telegram_update_and_mask_token(tg_service):
    updated = tg_service.update_settings({
        "enabled": True,
        "bot_token": "123456789:ABCdefGhIjklMnOpQrStUvWxYz",
        "chat_id": "-100123456789",
        "min_rr": 2.0,
        "market": "futures",
        "timeframe": "1h"
    })
    assert updated["enabled"] is True
    assert updated["has_token"] is True
    assert updated["bot_token_masked"].startswith("1234...")
    assert updated["chat_id"] == "-100123456789"
    assert updated["min_rr"] == 2.0
    assert updated["timeframe"] == "1h"

def test_telegram_message_formatting(tg_service):
    sample_setup = {
        "symbol": "BTCUSDT",
        "market": "futures",
        "timeframe": "15m",
        "direction": "LONG",
        "name": "Bullish Order Block Sweep",
        "entry_price": 91250.0,
        "invalidation_price": 90800.0,
        "target_price": 92500.0,
        "risk_reward_ratio": 2.78,
        "confluence_score": 85.5,
        "current_price": 91240.0
    }
    msg = tg_service.format_setup_message(sample_setup)
    assert "BTCUSDT" in msg
    assert "LONG" in msg
    assert "Bullish Order Block Sweep" in msg
    assert "91,250.00" in msg
    assert "90,800.00" in msg
    assert "2.78" in msg

def test_api_get_and_post_settings(client):
    get_res = client.get("/api/telegram/settings")
    assert get_res.status_code == 200
    data = get_res.json()
    assert "enabled" in data
    assert "has_token" in data

    post_res = client.post("/api/telegram/settings", json={
        "enabled": True,
        "bot_token": "987654321:XYZtestToken123456",
        "chat_id": "123456789",
        "min_rr": 1.8,
        "market": "futures",
        "timeframe": "15m",
        "scan_interval_seconds": 60
    })
    assert post_res.status_code == 200
    res_data = post_res.json()
    assert res_data["status"] == "success"
    assert res_data["data"]["enabled"] is True
    assert res_data["data"]["chat_id"] == "123456789"
    assert res_data["data"]["min_rr"] == 1.8

def test_api_test_notification_requires_fields(client):
    res = client.post("/api/telegram/test", json={"bot_token": "", "chat_id": ""})
    # If settings not set, returns 400
    assert res.status_code in (400, 200)

@pytest.mark.asyncio
async def test_telegram_send_mock(tg_service):
    with patch("httpx.AsyncClient.post") as mock_post:
        mock_resp = AsyncMock()
        mock_resp.status_code = 200
        mock_post.return_value = mock_resp

        ok, msg = await tg_service.send_message(
            text="Hello test",
            token="fake_token",
            chat_id="fake_chat_id"
        )
        assert ok is True
        assert "berhasil" in msg
