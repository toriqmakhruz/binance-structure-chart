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

class ClosePositionRequest(BaseModel):
    symbol: str
    market: str = Field("futures", pattern="^(spot|futures)$")
    mode: str = Field("demo", pattern="^(demo|live)$")
    api_key: Optional[str] = ""
    api_secret: Optional[str] = ""

class SetBracketsRequest(BaseModel):
    symbol: str
    market: str = Field("futures", pattern="^(spot|futures)$")
    mode: str = Field("demo", pattern="^(demo|live)$")
    api_key: Optional[str] = ""
    api_secret: Optional[str] = ""
    stop_loss: Optional[float] = None
    take_profit: Optional[float] = None

class CancelOrderRequest(BaseModel):
    symbol: str
    order_id: int
    market: str = Field("futures", pattern="^(spot|futures)$")
    mode: str = Field("demo", pattern="^(demo|live)$")
    api_key: Optional[str] = ""
    api_secret: Optional[str] = ""

class PositionsRequest(BaseModel):
    market: str = Field("futures", pattern="^(spot|futures)$")
    mode: str = Field("demo", pattern="^(demo|live)$")
    api_key: Optional[str] = ""
    api_secret: Optional[str] = ""
    symbol: Optional[str] = None

class OpenOrdersRequest(BaseModel):
    market: str = Field("futures", pattern="^(spot|futures)$")
    mode: str = Field("demo", pattern="^(demo|live)$")
    api_key: Optional[str] = ""
    api_secret: Optional[str] = ""
    symbol: Optional[str] = None

@trade_router.post("/positions")
async def get_positions(req: PositionsRequest):
    """
    Fetch active open positions with live Mark Price, Unrealized PnL, and ROE%.
    """
    return await trade_service.get_positions(
        market=req.market,
        mode=req.mode,
        api_key=req.api_key or "",
        api_secret=req.api_secret or "",
        symbol=req.symbol
    )

@trade_router.post("/open-orders")
async def get_open_orders(req: OpenOrdersRequest):
    """
    Fetch pending open orders (Limits, Stop Loss, Take Profit bracket orders).
    """
    return await trade_service.get_open_orders(
        market=req.market,
        mode=req.mode,
        api_key=req.api_key or "",
        api_secret=req.api_secret or "",
        symbol=req.symbol
    )

@trade_router.post("/close-position")
async def close_position(req: ClosePositionRequest):
    """
    Instantly close an open position at MARKET and cancel remaining SL/TP bracket orders.
    """
    return await trade_service.close_position(
        symbol=req.symbol,
        market=req.market,
        mode=req.mode,
        api_key=req.api_key or "",
        api_secret=req.api_secret or ""
    )

@trade_router.post("/cancel-order")
async def cancel_order(req: CancelOrderRequest):
    """
    Cancel an individual open order.
    """
    return await trade_service.cancel_order(
        symbol=req.symbol,
        order_id=req.order_id,
        market=req.market,
        mode=req.mode,
        api_key=req.api_key or "",
        api_secret=req.api_secret or ""
    )

@trade_router.post("/set-brackets")
async def set_brackets(req: SetBracketsRequest):
    """
    Add or update Stop Loss & Take Profit orders on an active open position.
    """
    return await trade_service.set_position_brackets(
        symbol=req.symbol,
        market=req.market,
        mode=req.mode,
        api_key=req.api_key or "",
        api_secret=req.api_secret or "",
        stop_loss=req.stop_loss,
        take_profit=req.take_profit
    )

class CredentialsSyncPayload(BaseModel):
    demoApiKey: Optional[str] = ""
    demoApiSecret: Optional[str] = ""
    liveApiKey: Optional[str] = ""
    liveApiSecret: Optional[str] = ""
    mode: Optional[str] = "demo"
    useSimulatedDemo: Optional[bool] = True

@trade_router.get("/credentials")
async def get_credentials():
    """
    Get server-stored trade credentials and mode for cross-device synchronization (Desktop & Tablet).
    """
    return trade_service.get_stored_credentials()

@trade_router.post("/credentials")
async def set_credentials(payload: CredentialsSyncPayload):
    """
    Persist trade credentials and mode on the server so all devices (Desktop & Tablet) stay 100% in sync.
    """
    return trade_service.save_stored_credentials(payload.model_dump())


class TradeHistoryRequest(BaseModel):
    market: str = Field("futures", pattern="^(spot|futures)$")
    mode: str = Field("demo", pattern="^(demo|live)$")
    api_key: Optional[str] = ""
    api_secret: Optional[str] = ""
    symbol: Optional[str] = None
    limit: int = Field(50, ge=1, le=500)

@trade_router.post("/history")
async def get_trade_history(req: TradeHistoryRequest):
    """
    Fetch closed trade history and realized PnL.
    """
    return await trade_service.get_trade_history(
        market=req.market,
        mode=req.mode,
        api_key=req.api_key or "",
        api_secret=req.api_secret or "",
        symbol=req.symbol,
        limit=req.limit
    )

@trade_router.post("/history/clear")
async def clear_trade_history():
    """
    Clear paper trading trade history.
    """
    return trade_service.clear_paper_history()
