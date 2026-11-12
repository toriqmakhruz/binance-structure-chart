from typing import List, Optional, Dict, Any
from pydantic import BaseModel

class Candle(BaseModel):
    time: int              # Unix timestamp in seconds
    open: float
    high: float
    low: float
    close: float
    volume: float
    taker_buy_volume: float = 0.0
    is_closed: bool = True # Differentiates closed candle from in-progress ticking candle

class SwingPoint(BaseModel):
    time: int
    price: float
    type: str              # 'H', 'L', 'HH', 'HL', 'LH', 'LL'
    index: int

class StructureEvent(BaseModel):
    id: str
    type: str              # 'BOS' or 'CHoCH'
    direction: str         # 'BULLISH' or 'BEARISH'
    break_time: int
    break_price: float
    level_price: float
    level_time: int

class OrderBlock(BaseModel):
    id: str
    direction: str         # 'BULLISH' or 'BEARISH'
    start_time: int
    end_time: Optional[int] = None
    top: float
    bottom: float
    status: str = "ACTIVE" # 'ACTIVE', 'MITIGATED', 'INVALIDATED'
    mitigated: bool = False
    mitigated_time: Optional[int] = None
    invalidation_time: Optional[int] = None

class FairValueGap(BaseModel):
    id: str
    direction: str         # 'BULLISH' or 'BEARISH'
    time: int
    top: float
    bottom: float
    status: str = "UNFILLED" # 'UNFILLED', 'PARTIALLY_FILLED', 'FILLED', 'INVALIDATED'
    fill_pct: float = 0.0
    mitigated: bool = False
    mitigated_time: Optional[int] = None

class LiquidityPool(BaseModel):
    id: str
    type: str              # 'EQH' or 'EQL'
    price: float
    times: List[int]
    touches: int = 2
    swept: bool = False
    sweep_time: Optional[int] = None

class SmcAnalysisResult(BaseModel):
    swings: List[SwingPoint]
    events: List[StructureEvent]
    order_blocks: List[OrderBlock]
    fvgs: List[FairValueGap]
    liquidity_pools: List[LiquidityPool]
    current_trend: str     # 'BULLISH', 'BEARISH', 'RANGING'

class ChartPattern(BaseModel):
    id: str
    name: str              # 'Double Top', 'Double Bottom', 'Head and Shoulders', 'Triangle', etc.
    type: str              # 'BULLISH' or 'BEARISH' or 'NEUTRAL'
    status: str = "FORMING"# 'FORMING', 'CONFIRMED', 'INVALIDATED'
    start_time: int
    end_time: int
    key_points: List[Dict[str, Any]]
    neckline: Optional[float] = None
    target_price: Optional[float] = None
    stop_loss: Optional[float] = None
    breakout_time: Optional[int] = None
    breakout_price: Optional[float] = None

class SupportResistance(BaseModel):
    price: float
    strength: int          # number of touches
    type: str              # 'SUPPORT' or 'RESISTANCE'

class PatternAnalysisResult(BaseModel):
    patterns: List[ChartPattern]
    support_resistance: List[SupportResistance]
    trendlines: List[Dict[str, Any]]

class MovementMetrics(BaseModel):
    volatility_atr: float
    volatility_atr_pct: float
    volatility_status: str       # 'SQUEEZE', 'EXPANDING', 'NORMAL'
    trend_direction: str         # 'STRONG_BULLISH', 'BULLISH', 'NEUTRAL', 'BEARISH', 'STRONG_BEARISH'
    rsi: float
    rsi_condition: str           # 'OVERBOUGHT', 'OVERSOLD', 'NEUTRAL', 'BULLISH_DIV', 'BEARISH_DIV'
    volume_delta: float          # Buyer - Seller volume
    volume_delta_ratio: float    # Buy / Total ratio
    confluence_score: float      # 0 to 100
    confluence_bias: str         # 'STRONG BULLISH', 'BULLISH', 'NEUTRAL', 'BEARISH', 'STRONG BEARISH'
    summary: str

class ForecastPoint(BaseModel):
    time: int
    expected_price: float
    upper_bound_80: float
    lower_bound_80: float
    upper_bound_95: float
    lower_bound_95: float

class ForecastScenario(BaseModel):
    name: str                    # 'Bullish Breakout', 'Bearish Breakdown', 'Mean Reversion'
    direction: str = "LONG"      # 'LONG' or 'SHORT'
    entry_price: float = 0.0     # Recommended Entry level
    entry_time: Optional[int] = None
    entry_zone_high: Optional[float] = None
    entry_zone_low: Optional[float] = None
    is_valid: bool = True
    status: str = "VALID_ENTRY"  # 'VALID_ENTRY', 'PENDING_CONFLUENCE', 'LOW_RR'
    confluence_weight: float = 50.0 # Heuristic alignment weight 0-100
    probability: Optional[float] = None # None until statistically calibrated
    target_price: float
    invalidation_price: float
    risk_reward_ratio: float
    path: List[Dict[str, Any]]   # [{time, price}]

class ForecastResult(BaseModel):
    horizon_candles: int
    predicted_trend: str
    confluence_score: float
    confluence_bias: str = "NEUTRAL"
    confidence_pct: float        # Legacy alias for backward compatibility
    forecast_probability: Optional[float] = None
    historical_win_rate: Optional[float] = None
    model_calibration_status: str = "UNCALIBRATED_HEURISTIC"
    model_assumptions: str = "Drift-adjusted ATR cone. Probabilities omitted until out-of-sample calibration."
    cone_points: List[ForecastPoint]
    scenarios: List[ForecastScenario]
    structural_target: Optional[float] = None

class AnalysisMetadata(BaseModel):
    symbol: str
    market_type: str             # 'spot' or 'futures'
    interval: str
    source: str                  # 'BINANCE_SPOT' or 'BINANCE_FUTURES'
    server_time: Optional[int] = None
    received_at: int
    total_candles: int
    is_stale: bool = False

class FullAnalysisResponse(BaseModel):
    symbol: str
    market: str
    timeframe: str
    candles: List[Candle]
    smc: SmcAnalysisResult
    patterns: PatternAnalysisResult
    movement: MovementMetrics
    forecast: ForecastResult
    htf_overlay: Optional[Dict[str, Any]] = None
    metadata: Optional[AnalysisMetadata] = None
