import os
from typing import List
from pydantic import BaseModel

class Settings(BaseModel):
    # Binance Spot Endpoints (Isolated strictly for Spot market)
    BINANCE_SPOT_REST: str = "https://data-api.binance.vision"
    BINANCE_SPOT_REST_ENDPOINTS: List[str] = [
        "https://data-api.binance.vision",
        "https://api.binance.com",
        "https://api1.binance.com",
        "https://api3.binance.com"
    ]
    BINANCE_SPOT_WS_ENDPOINTS: List[str] = [
        "wss://stream.binance.com:9443/ws",
        "wss://data-stream.binance.vision/ws"
    ]

    # Binance USD-M Futures Endpoints (Isolated strictly for Futures market - NEVER cross-fallback to Spot)
    BINANCE_FUTURES_REST: str = "https://fapi.binance.com"
    BINANCE_FUTURES_REST_ENDPOINTS: List[str] = [
        "https://fapi.binance.com"
    ]
    BINANCE_FUTURES_WS_ENDPOINTS: List[str] = [
        "wss://fstream.binance.com/ws",
        "wss://fstream-auth.binance.com/ws"
    ]

    # Legacy attributes for backward compatibility
    BINANCE_SPOT_WS: str = "wss://data-stream.binance.vision/ws"
    BINANCE_FUTURES_WS: str = "wss://fstream.binance.com/ws"
    BINANCE_FUTURES_FALLBACK: str = "https://fapi1.binance.com"
    BINANCE_WS_FALLBACK: str = "wss://fstream-auth.binance.com/ws"
    
    # Supported Intervals
    TIMEFRAMES: List[str] = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "8h", "12h", "1d"]
    DEFAULT_SYMBOL: str = "BTCUSDT"
    DEFAULT_TIMEFRAME: str = "15m"
    DEFAULT_MARKET: str = "spot"
    
    # HTTP and TLS settings
    HTTP_TIMEOUT_SECONDS: float = 10.0
    TLS_VERIFY: bool = True

settings = Settings()
