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

def test_paper_trading_tp_execution_and_order_cleanup():
    sym = "TEST_TP_CLEANUP"
    # 1. Open simulated position with SL and TP
    order_res = client.post("/api/trade/order", json={
        "symbol": sym,
        "market": "futures",
        "mode": "demo",
        "side": "BUY",
        "order_type": "MARKET",
        "quantity": 2.0,
        "price": 100.0,
        "leverage": 10,
        "stop_loss": 95.0,
        "take_profit": 110.0
    })
    assert order_res.status_code == 200
    assert order_res.json()["success"] is True

    # 2. Check open orders: both SL and TP should be present
    ord_res1 = client.post("/api/trade/open-orders", json={"market": "futures", "mode": "demo", "symbol": sym})
    assert ord_res1.status_code == 200
    orders1 = ord_res1.json().get("orders", [])
    assert len(orders1) == 2
    order_types = {o["type"] for o in orders1}
    assert "STOP_MARKET" in order_types
    assert "TAKE_PROFIT_MARKET" in order_types

    # 3. Simulate TP execution (Price hits 110.0)
    matched = [p for p in trade_service._paper_positions if p.get("symbol") == sym and p.get("status") == "FILLED"]
    assert len(matched) == 1
    p = matched[0]
    trade_service._close_single_paper_position(p, close_price=110.0, reason="Take Profit Hit")
    trade_service._save_paper_data()
    trade_service._positions_cache.clear()
    trade_service._orders_cache.clear()

    # 4. Check positions: position is now closed
    pos_res = client.post("/api/trade/positions", json={"market": "futures", "mode": "demo", "symbol": sym})
    assert pos_res.status_code == 200
    assert len(pos_res.json().get("positions", [])) == 0

    # 5. Check open orders: ALL bracket orders (including hanging SL) MUST BE GONE!
    ord_res2 = client.post("/api/trade/open-orders", json={"market": "futures", "mode": "demo", "symbol": sym})
    assert ord_res2.status_code == 200
    orders2 = ord_res2.json().get("orders", [])
    assert len(orders2) == 0, f"Expected 0 lingering orders, but found: {orders2}"

def test_paper_trading_cancel_single_bracket_order():
    sym = "TEST_CANCEL_BRACKET"
    # 1. Open simulated position with SL and TP
    order_res = client.post("/api/trade/order", json={
        "symbol": sym,
        "market": "futures",
        "mode": "demo",
        "side": "BUY",
        "order_type": "MARKET",
        "quantity": 1.5,
        "price": 200.0,
        "leverage": 5,
        "stop_loss": 190.0,
        "take_profit": 220.0
    })
    assert order_res.status_code == 200
    assert order_res.json()["success"] is True

    # 2. Get open orders
    ord_res1 = client.post("/api/trade/open-orders", json={"market": "futures", "mode": "demo", "symbol": sym})
    orders1 = ord_res1.json().get("orders", [])
    assert len(orders1) == 2

    # Find the STOP_MARKET order
    sl_order = next((o for o in orders1 if o["type"] == "STOP_MARKET"), None)
    assert sl_order is not None

    # 3. Cancel the SL order
    cancel_res = client.post("/api/trade/cancel-order", json={
        "symbol": sym,
        "order_id": sl_order["orderId"],
        "market": "futures",
        "mode": "demo"
    })
    assert cancel_res.status_code == 200
    assert cancel_res.json()["success"] is True

    # 4. Open orders should now only have TAKE_PROFIT_MARKET
    ord_res2 = client.post("/api/trade/open-orders", json={"market": "futures", "mode": "demo", "symbol": sym})
    orders2 = ord_res2.json().get("orders", [])
    assert len(orders2) == 1
    assert orders2[0]["type"] == "TAKE_PROFIT_MARKET"

    # Clean up position
    client.post("/api/trade/close-position", json={"symbol": sym, "market": "futures", "mode": "demo"})
