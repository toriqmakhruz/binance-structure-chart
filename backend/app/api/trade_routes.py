from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any
from ..services.trade_service import trade_service

trade_router = APIRouter(prefix="/api/trade", tags=["Trade Execution"])

class TestConnectionRequest(BaseModel):
    market: str = Field("futures", pattern="^(spot|futures)$")
    mode: str = Field("demo", pattern="^(demo|live)$")
    api_key: Optional[str] = ""
    api_secret: Optional[str] = ""

class BalanceRequest(BaseModel):
    market: str = Field("futures", pattern="^(spot|futures)$")
    mode: str = Field("demo", pattern="^(demo|live)$")
    api_key: Optional[str] = ""
    api_secret: Optional[str] = ""

class SymbolRulesRequest(BaseModel):
    symbol: str
    market: str = Field("futures", pattern="^(spot|futures)$")
    mode: str = Field("demo", pattern="^(demo|live)$")

class OrderExecuteRequest(BaseModel):
    symbol: str
    market: str = Field("futures", pattern="^(spot|futures)$")
    mode: str = Field("demo", pattern="^(demo|live)$")
    api_key: Optional[str] = ""
    api_secret: Optional[str] = ""
    side: str = Field("BUY", pattern="^(BUY|SELL)$")
    order_type: str = Field("MARKET", pattern="^(MARKET|LIMIT)$")
    quantity: float = Field(..., gt=0)
    price: Optional[float] = None
    leverage: int = Field(10, ge=1, le=125)
    stop_loss: Optional[float] = None
    take_profit: Optional[float] = None
    reduce_only: bool = False

@trade_router.post("/test-connection")
async def test_connection(req: TestConnectionRequest):
    """
    Test Binance API Key & Secret validity for Demo (Testnet) or Live (Production).
    """
    result = await trade_service.test_connection(
        market=req.market,
        mode=req.mode,
        api_key=req.api_key or "",
        api_secret=req.api_secret or ""
    )
    return result

@trade_router.post("/balance")
async def get_balance(req: BalanceRequest):
    """
    Fetch live account balance (USDT) from Binance Demo Testnet or Live Production.
    Falls back to simulated paper trading wallet if demo mode without keys.
    """
    result = await trade_service.get_balance(
        market=req.market,
        mode=req.mode,
        api_key=req.api_key or "",
        api_secret=req.api_secret or ""
    )
    return result

@trade_router.get("/rules")
async def get_rules(symbol: str, market: str = "futures", mode: str = "demo"):
    """
    Get precision, minQty, stepSize, and tickSize rules for order sizing.
    """
    return await trade_service.get_symbol_rules(symbol=symbol, market=market, mode=mode)

@trade_router.post("/order")
async def execute_order(req: OrderExecuteRequest):
    """
    Open a position on Binance (Demo or Live) with optional leverage & bracket SL/TP orders.
    """
    result = await trade_service.execute_order(
        symbol=req.symbol,
        market=req.market,
        mode=req.mode,
        api_key=req.api_key or "",
        api_secret=req.api_secret or "",
        side=req.side,
        order_type=req.order_type,
        quantity=req.quantity,
        price=req.price,
        leverage=req.leverage,
        stop_loss=req.stop_loss,
        take_profit=req.take_profit,
        reduce_only=req.reduce_only
    )
    return result
