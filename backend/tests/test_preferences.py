import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.services.preferences_service import preferences_service

client = TestClient(app)

def test_preferences_get_and_post():
    # 1. Post test preferences
    test_payload = {
        "layout": "split-vertical",
        "market": "futures",
        "symbol": "SOLUSDT",
        "timeframe": "15m",
        "setupMode": "craig_10x",
        "marketSessionSettings": {
            "timezone": "WIB",
            "showVerticalLines": True,
            "showZoneBackground": True
        }
    }
    resp = client.post("/api/user-preferences", json=test_payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert "updated_at" in data

    # 2. Get preferences back
    get_resp = client.get("/api/user-preferences")
    assert get_resp.status_code == 200
    saved = get_resp.json()
    assert saved.get("layout") == "split-vertical"
    assert saved.get("symbol") == "SOLUSDT"
    assert saved.get("marketSessionSettings", {}).get("timezone") == "WIB"
