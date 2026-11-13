import asyncio
import json
import time
import random
import logging
import websockets
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from ..config import settings
from ..services.binance_service import binance_service

logger = logging.getLogger("websocket_router")
ws_router = APIRouter()
_STALLED_TICKER_WS_UNTIL: dict[str, float] = {}


def _resolve_market_ws(market: str):
    """Strict isolation: Futures endpoints only for Futures, Spot endpoints only for Spot."""
    market_clean = market.lower().strip()
    if market_clean == "spot":
        return market_clean, settings.BINANCE_SPOT_WS_ENDPOINTS, "BINANCE_SPOT"
    if market_clean == "futures":
        return market_clean, settings.BINANCE_FUTURES_WS_ENDPOINTS, "BINANCE_FUTURES"
    return market_clean, None, None


@ws_router.websocket("/ws/tickers/{market}")
async def websocket_tickers_relay(
    websocket: WebSocket,
    market: str = "futures"
):
    """Relay real-time Binance !ticker@arr updates for all USDT pairs in the selected market."""
    await websocket.accept()
    market_clean, ws_endpoints, source_name = _resolve_market_ws(market)
    if not ws_endpoints or not source_name:
        await websocket.send_text(json.dumps({
            "type": "UPSTREAM_STATUS",
            "status": "ERROR",
            "message": f"Unsupported market: {market}"
        }))
        await websocket.close()
        return

    stop_event = asyncio.Event()
    stream_name = "!miniTicker@arr"

    async def send_status(status_label: str, message: str = ""):
        try:
            await websocket.send_text(json.dumps({
                "type": "UPSTREAM_STATUS",
                "status": status_label,
                "source": source_name,
                "market": market_clean,
                "timestamp": int(time.time()),
                "message": message
            }))
        except Exception:
            pass

    async def poll_live_rest_tickers():
        """Shared-cache REST fallback (~2.5s) when upstream WS silently drops frames."""
        await send_status("CONNECTED", f"Connected to {source_name} live feed")
        while not stop_event.is_set():
            try:
                updates = await binance_service.get_live_ticker_batch(market_clean)
                if updates:
                    await websocket.send_text(json.dumps({
                        "type": "TICKER_BATCH",
                        "market": market_clean,
                        "source": source_name,
                        "tickers": updates
                    }))
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.warning(f"REST ticker feed error ({market_clean}): {exc}")
            await asyncio.sleep(2.5)

    async def forward_tickers():
        backoff = 1.0
        active_url_idx = 0

        if time.time() < _STALLED_TICKER_WS_UNTIL.get(market_clean, 0):
            await poll_live_rest_tickers()
            return

        # If WS endpoints silently drop frames from this VPS, switch fast after 1 attempt
        while not stop_event.is_set():
            base_url = ws_endpoints[active_url_idx % len(ws_endpoints)]
            target_url = f"{base_url.rstrip('/')}/{stream_name}"

            try:
                await send_status("CONNECTING", f"Connecting to {source_name} tickers...")
                async with websockets.connect(
                    target_url,
                    ping_interval=20,
                    ping_timeout=20,
                    open_timeout=5,
                    close_timeout=1,
                    max_size=4 * 1024 * 1024
                ) as b_ws:
                    connected_announced = False
                    backoff = 1.0

                    while not stop_event.is_set():
                        # Enforce strict frame timeout so stalled WS handshakes fall back immediately
                        msg_str = await asyncio.wait_for(b_ws.recv(), timeout=2.5)
                        raw_list = json.loads(msg_str)
                        if not isinstance(raw_list, list):
                            continue

                        if not connected_announced:
                            await send_status("CONNECTED", f"Connected to {source_name} tickers")
                            connected_announced = True

                        updates = []
                        for t in raw_list:
                            if not isinstance(t, dict):
                                continue
                            sym = t.get("s", "")
                            if not sym.endswith("USDT"):
                                continue
                            try:
                                price = float(t.get("c", 0))
                                if price <= 0:
                                    continue
                                if "P" in t:
                                    pct = float(t["P"])
                                else:
                                    open_price = float(t.get("o", 0))
                                    pct = ((price - open_price) / open_price * 100.0) if open_price > 0 else 0.0
                                updates.append({
                                    "s": sym,
                                    "c": price,
                                    "P": pct,
                                    "q": float(t.get("q", 0)),
                                })
                            except (ValueError, TypeError):
                                continue

                        if updates:
                            await websocket.send_text(json.dumps({
                                "type": "TICKER_BATCH",
                                "market": market_clean,
                                "source": source_name,
                                "tickers": updates
                            }))
            except asyncio.CancelledError:
                break
            except Exception as exc:
                logger.warning(f"Ticker WS relay stalled/failed on {target_url}: {exc}; falling back to live 2.5s feed")
                _STALLED_TICKER_WS_UNTIL[market_clean] = time.time() + 3600.0
                await poll_live_rest_tickers()
                return

            if not stop_event.is_set():
                wait_time = min(backoff + random.uniform(0.1, 0.75), 10.0)
                await send_status("RECONNECTING", f"Ticker stream disconnected. Reconnecting in {wait_time:.1f}s...")
                active_url_idx += 1
                await asyncio.sleep(wait_time)
                backoff = min(backoff * 2.0, 10.0)

    forward_task = asyncio.create_task(forward_tickers())
    try:
        while True:
            client_msg = await websocket.receive_text()
            if client_msg == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        logger.info(f"Browser client disconnected from ticker stream ({market_clean})")
    finally:
        stop_event.set()
        forward_task.cancel()
        await asyncio.gather(forward_task, return_exceptions=True)


@ws_router.websocket("/ws/{symbol}/{timeframe}/{market}")
async def websocket_kline_relay(
    websocket: WebSocket,
    symbol: str,
    timeframe: str,
    market: str = "futures"
):
    await websocket.accept()
    symbol_clean = symbol.lower().strip()
    market_clean, ws_endpoints, source_name = _resolve_market_ws(market)
    stream_name = f"{symbol_clean}@kline_{timeframe}"

    if not ws_endpoints or not source_name:
        await websocket.send_text(json.dumps({
            "type": "UPSTREAM_STATUS",
            "status": "ERROR",
            "message": f"Unsupported market: {market}"
        }))
        await websocket.close()
        return

    stop_event = asyncio.Event()
    last_message_at = time.time()

    async def send_status(status_label: str, message: str = "", extra: dict = None):
        payload = {
            "type": "UPSTREAM_STATUS",
            "status": status_label,
            "source": source_name,
            "symbol": symbol.upper(),
            "timeframe": timeframe,
            "timestamp": int(time.time()),
            "message": message
        }
        if extra:
            payload.update(extra)
        try:
            await websocket.send_text(json.dumps(payload))
        except Exception:
            pass

    async def monitor_stale_data():
        """Periodically checks if live ticks have ceased, marking upstream as STALE."""
        stale_alerted = False
        while not stop_event.is_set():
            await asyncio.sleep(5)
            elapsed = time.time() - last_message_at
            if elapsed > 45.0 and not stale_alerted:
                logger.warning(f"No ticks for {stream_name} in {elapsed:.1f}s. Marking DATA_STALE.")
                await send_status("DATA_STALE", f"No ticks received in {elapsed:.1f}s", {"age_seconds": round(elapsed, 1)})
                stale_alerted = True
            elif elapsed <= 45.0 and stale_alerted:
                stale_alerted = False
                await send_status("CONNECTED", "Live stream resumed")

    async def forward_from_binance():
        nonlocal last_message_at
        backoff = 1.0
        active_url_idx = 0

        while not stop_event.is_set():
            base_url = ws_endpoints[active_url_idx % len(ws_endpoints)]
            target_url = f"{base_url.rstrip('/')}/{stream_name}"

            try:
                await send_status("CONNECTING", f"Connecting to {source_name} mirror...")
                logger.info(f"Connecting to Binance upstream: {target_url}")

                async with websockets.connect(
                    target_url,
                    ping_interval=20,
                    ping_timeout=20,
                    open_timeout=8
                ) as b_ws:
                    logger.info(f"Binance upstream connected for {stream_name}")
                    last_message_at = time.time()
                    await send_status("CONNECTED", f"Connected to {source_name}")
                    backoff = 1.0  # Reset backoff on success

                    while not stop_event.is_set():
                        msg_str = await b_ws.recv()
                        last_message_at = time.time()
                        data = json.loads(msg_str)
                        if "k" in data:
                            k = data["k"]
                            candle_payload = {
                                "type": "CANDLE_TICK",
                                "symbol": symbol.upper(),
                                "timeframe": timeframe,
                                "source": source_name,
                                "is_closed": k.get("x", False),
                                "candle": {
                                    "time": int(k["t"] // 1000),
                                    "open": float(k["o"]),
                                    "high": float(k["h"]),
                                    "low": float(k["l"]),
                                    "close": float(k["c"]),
                                    "volume": float(k["v"]),
                                    "taker_buy_volume": float(k.get("V", 0)),
                                    "is_closed": k.get("x", False)
                                }
                            }
                            await websocket.send_text(json.dumps(candle_payload))

            except asyncio.CancelledError:
                logger.info(f"Relay task cancelled cleanly for {stream_name}")
                break
            except websockets.exceptions.ConnectionClosed as cc:
                logger.warning(f"Upstream closed connection for {stream_name} ({cc}). Reconnecting...")
            except Exception as e:
                logger.warning(f"Upstream error on {target_url} ({e}). Reconnecting...")

            if not stop_event.is_set():
                # Exponential backoff with random jitter
                jitter = random.uniform(0.1, 0.75)
                wait_time = min(backoff + jitter, 25.0)
                await send_status("RECONNECTING", f"Upstream disconnected. Reconnecting in {wait_time:.1f}s...")
                active_url_idx += 1
                await asyncio.sleep(wait_time)
                backoff = min(backoff * 2.0, 20.0)

    forward_task = asyncio.create_task(forward_from_binance())
    stale_task = asyncio.create_task(monitor_stale_data())

    try:
        while True:
            client_msg = await websocket.receive_text()
            if client_msg == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        logger.info(f"Browser client disconnected from {stream_name}")
    finally:
        stop_event.set()
        forward_task.cancel()
        stale_task.cancel()
        await asyncio.gather(forward_task, stale_task, return_exceptions=True)
