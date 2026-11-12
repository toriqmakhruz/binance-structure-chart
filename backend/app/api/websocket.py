import asyncio
import json
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
    symbol = symbol.lower()
    stream_name = f"{symbol}@kline_{timeframe}"

    # Target URLs to try
    ws_candidates = [
        f"{settings.BINANCE_SPOT_WS}/{stream_name}",
        f"{settings.BINANCE_WS_FALLBACK}/{stream_name}"
    ]
    if market.lower() == "futures":
        ws_candidates.insert(0, f"{settings.BINANCE_FUTURES_WS}/{stream_name}")

    stop_event = asyncio.Event()

    async def forward_from_binance():
        backoff = 1
        active_url_idx = 0
        while not stop_event.is_set():
            target_url = ws_candidates[active_url_idx % len(ws_candidates)]
            try:
                logger.info(f"Connecting to Binance stream: {target_url}")
                async with websockets.connect(target_url, ping_interval=20, ping_timeout=20, open_timeout=6) as b_ws:
                    logger.info(f"Binance WS connected for {stream_name}")
                    backoff = 1
                    while not stop_event.is_set():
                        msg_str = await b_ws.recv()
                        data = json.loads(msg_str)
                        if "k" in data:
                            k = data["k"]
                            candle_payload = {
                                "type": "CANDLE_TICK",
                                "symbol": symbol.upper(),
                                "timeframe": timeframe,
                                "is_closed": k.get("x", False),
                                "candle": {
                                    "time": int(k["t"] // 1000),
                                    "open": float(k["o"]),
                                    "high": float(k["h"]),
                                    "low": float(k["l"]),
                                    "close": float(k["c"]),
                                    "volume": float(k["v"]),
                                    "taker_buy_volume": float(k.get("V", 0))
                                }
                            }
                            await websocket.send_text(json.dumps(candle_payload))
            except (websockets.exceptions.ConnectionClosed, asyncio.CancelledError):
                break
            except Exception as e:
                logger.warning(f"Binance WS error on {target_url} ({e}), switching mirror in {backoff}s...")
                active_url_idx += 1
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 8)

    forward_task = asyncio.create_task(forward_from_binance())

    try:
        while True:
            client_msg = await websocket.receive_text()
            if client_msg == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        logger.info(f"Client disconnected from {stream_name}")
    finally:
        stop_event.set()
        forward_task.cancel()
        try:
            await forward_task
        except asyncio.CancelledError:
            pass
