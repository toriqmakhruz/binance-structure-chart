import asyncio
import json
import time
import random
import logging
import websockets
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from ..config import settings

logger = logging.getLogger("websocket_router")
ws_router = APIRouter()

@ws_router.websocket("/ws/{symbol}/{timeframe}/{market}")
async def websocket_kline_relay(
    websocket: WebSocket,
    symbol: str,
    timeframe: str,
    market: str = "futures"
):
    await websocket.accept()
    symbol_clean = symbol.lower().strip()
    market_clean = market.lower().strip()
    stream_name = f"{symbol_clean}@kline_{timeframe}"

    # Strict isolation: Futures endpoints only for Futures, Spot endpoints only for Spot
    if market_clean == "spot":
        ws_endpoints = settings.BINANCE_SPOT_WS_ENDPOINTS
        source_name = "BINANCE_SPOT"
    elif market_clean == "futures":
        ws_endpoints = settings.BINANCE_FUTURES_WS_ENDPOINTS
        source_name = "BINANCE_FUTURES"
    else:
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
