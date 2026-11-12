import os
from pydantic import BaseModel

class Settings(BaseModel):
    # Binance Endpoints (Uses Binance Vision public mirror for zero-block global accessibility)
    BINANCE_SPOT_REST: str = "https://data-api.binance.vision"
    BINANCE_FUTURES_REST: str = "https://fapi.binance.com"
    BINANCE_FUTURES_FALLBACK: str = "https://data-api.binance.vision" # Fallback to live data
    
    BINANCE_SPOT_WS: str = "wss://data-stream.binance.vision/ws"
    BINANCE_FUTURES_WS: str = "wss://fstream.binance.com/ws"
    BINANCE_WS_FALLBACK: str = "wss://data-stream.binance.vision/ws"
    
    # Supported Intervals
    TIMEFRAMES: list[str] = ["1m", "3m", "5m", "15m", "30m", "1h", "2h", "4h", "1d"]
    DEFAULT_SYMBOL: str = "BTCUSDT"
    DEFAULT_TIMEFRAME: str = "15m"
    DEFAULT_MARKET: str = "spot"

settings = Settings()
