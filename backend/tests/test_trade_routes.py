import pytest
from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)

def test_trade_balance_simulated_demo():
    payload = {
        "market": "futures",
        "mode": "demo",
        "api_key": "",
        "api_secret": ""
    }
    resp = client.post("/api/trade/balance", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["mode"] == "demo"
    assert data["is_simulated"] is True
    assert data["availableBalance"] >= 0

def test_trade_test_connection_simulated_demo():
    payload = {
        "market": "futures",
        "mode": "demo",
        "api_key": "",
        "api_secret": ""
    }
    resp = client.post("/api/trade/test-connection", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["is_simulated"] is True

def test_trade_test_connection_live_missing_keys():
    payload = {
        "market": "futures",
        "mode": "live",
        "api_key": "",
        "api_secret": ""
    }
    resp = client.post("/api/trade/test-connection", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is False

def test_trade_execute_simulated_demo_order():
    payload = {
        "symbol": "BTCUSDT",
        "market": "futures",
        "mode": "demo",
        "api_key": "",
        "api_secret": "",
        "side": "BUY",
        "order_type": "MARKET",
        "quantity": 0.05,
        "price": 95000.0,
        "leverage": 10,
        "stop_loss": 93500.0,
        "take_profit": 98000.0
    }
    resp = client.post("/api/trade/order", json=payload)
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert data["is_simulated"] is True
    assert data["symbol"] == "BTCUSDT"
    assert data["side"] == "BUY"
    assert data["status"] == "FILLED"
    assert data["bracket_orders"]["stop_loss"] == 93500.0
    assert data["bracket_orders"]["take_profit"] == 98000.0
