import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.services.trade_service import trade_service

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
    test_symbol = "TEST_BTC_MOCK"
    payload = {
        "symbol": test_symbol,
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
    assert data["symbol"] == test_symbol
    assert data["side"] == "BUY"
    assert data["status"] == "FILLED"
    assert data["bracket_orders"]["stop_loss"] == 93500.0
    assert data["bracket_orders"]["take_profit"] == 98000.0

def test_trade_get_positions_and_close():
    test_symbol = "TEST_BTC_MOCK"
    # 1. Fetch positions
    resp = client.post("/api/trade/positions", json={"market": "futures", "mode": "demo", "symbol": test_symbol})
    assert resp.status_code == 200
    data = resp.json()
    assert data["success"] is True
    assert "positions" in data

    # 2. Fetch open orders
    resp_orders = client.post("/api/trade/open-orders", json={"market": "futures", "mode": "demo", "symbol": test_symbol})
    assert resp_orders.status_code == 200
    orders_data = resp_orders.json()
    assert orders_data["success"] is True

    # 3. Update SL/TP bracket
    resp_bracket = client.post("/api/trade/set-brackets", json={
        "symbol": test_symbol,
        "market": "futures",
        "mode": "demo",
        "stop_loss": 94000.0,
        "take_profit": 99000.0
    })
    assert resp_bracket.status_code == 200
    assert resp_bracket.json()["success"] is True
    assert resp_bracket.json()["stop_loss"] == 94000.0

    # 4. Close mock test position
    resp_close = client.post("/api/trade/close-position", json={"symbol": test_symbol, "market": "futures", "mode": "demo"})
    assert resp_close.status_code == 200
    assert resp_close.json()["success"] is True

def test_trade_credentials_sync():
    original_creds = trade_service.get_stored_credentials()
    try:
        post_res = client.post("/api/trade/credentials", json={
            "demoApiKey": "demo_key_test",
            "demoApiSecret": "demo_secret_test",
            "liveApiKey": "live_key_test",
            "liveApiSecret": "live_secret_test",
            "mode": "live",
            "useSimulatedDemo": False
        })
        assert post_res.status_code == 200
        assert post_res.json()["success"] is True

        get_res = client.get("/api/trade/credentials")
        assert get_res.status_code == 200
        data = get_res.json()
        assert data["demoApiKey"] == "demo_key_test"
        assert data["liveApiKey"] == "live_key_test"
        assert data["mode"] == "live"
    finally:
        trade_service.save_stored_credentials(original_creds)


def test_trade_history_simulated_demo():
    # 1. Execute paper order
    sym = "TEST_HIST_SYM"
    client.post("/api/trade/order", json={
        "symbol": sym,
        "market": "futures",
        "mode": "demo",
        "api_key": "",
        "api_secret": "",
        "side": "BUY",
        "order_type": "MARKET",
        "quantity": 1.0,
        "price": 100.0,
        "leverage": 10
    })

    # 2. Close paper order
    close_res = client.post("/api/trade/close-position", json={
        "symbol": sym,
        "market": "futures",
        "mode": "demo",
        "api_key": "",
        "api_secret": ""
    })
    assert close_res.status_code == 200
    assert close_res.json()["success"] is True

    # 3. Fetch trade history
    hist_res = client.post("/api/trade/history", json={
        "market": "futures",
        "mode": "demo",
        "api_key": "",
        "api_secret": "",
        "symbol": sym
    })
    assert hist_res.status_code == 200
    hist_data = hist_res.json()
    assert hist_data["success"] is True
    assert hist_data["total_trades"] >= 1
    assert "total_realized_pnl" in hist_data
    assert "win_rate_pct" in hist_data

    # 4. Clear history
    clear_res = client.post("/api/trade/history/clear")
    assert clear_res.status_code == 200
    assert clear_res.json()["success"] is True
