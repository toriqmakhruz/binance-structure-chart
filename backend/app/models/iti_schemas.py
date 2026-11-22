from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field

class ITIGateDetail(BaseModel):
    name: str
    status: str  # 'PASS' | 'FAIL' | 'CHECKING'
    reason: str
    value: float
    threshold: float

class ITIHardGates(BaseModel):
    spread_gate: ITIGateDetail
    data_freshness_gate: ITIGateDetail
    volatility_gate: ITIGateDetail
    whale_counter_gate: ITIGateDetail
    all_passed: bool

class ITISmcFeatures(BaseModel):
    current_structure: str = "RANGING"  # 'BULLISH_MSS', 'BEARISH_MSS', 'BULLISH_CONTINUATION', 'BEARISH_CONTINUATION', 'RANGING'
    swing_high: float = 0.0
    swing_low: float = 0.0
    last_bos: Optional[Dict[str, Any]] = None
    last_choch: Optional[Dict[str, Any]] = None
    active_ob: Optional[Dict[str, Any]] = None
    active_fvg: Optional[Dict[str, Any]] = None
    premium_discount: str = "EQUILIBRIUM"  # 'PREMIUM', 'DISCOUNT', 'EQUILIBRIUM'
    displacement_score: float = 0.0

class ITILiquidityFeatures(BaseModel):
    nearest_bsl: Dict[str, Any] = Field(default_factory=dict)
    nearest_ssl: Dict[str, Any] = Field(default_factory=dict)
    eqh_detected: bool = False
    eqh_price: float = 0.0
    eql_detected: bool = False
    eql_price: float = 0.0
    pdh: float = 0.0
    pdl: float = 0.0
    pwh: float = 0.0
    pwl: float = 0.0

class ITISLHunterFeatures(BaseModel):
    last_sweep_type: str = "NONE"  # 'BEAR_TRAP_SWEEP', 'BULL_TRAP_SWEEP', 'NONE'
    sweep_price: float = 0.0
    reclaim_confirmed: bool = False
    reclaim_price: float = 0.0
    absorption_confirmed: bool = False
    false_breakout_score: float = 0.0

class ITIDomFeatures(BaseModel):
    bid_depth_usd: float = 0.0
    ask_depth_usd: float = 0.0
    obi: float = 0.0
    weighted_obi: float = 0.0
    microprice: float = 0.0
    spread_pct: float = 0.0
    whale_bid_wall: Dict[str, Any] = Field(default_factory=dict)
    whale_ask_wall: Dict[str, Any] = Field(default_factory=dict)
    wall_pulling_detected: bool = False
    iceberg_warning: bool = False

class ITIFootprintFeatures(BaseModel):
    current_bar_delta: float = 0.0
    cvd_value: float = 0.0
    cvd_divergence: str = "NONE"  # 'BULLISH_ABSORPTION', 'BEARISH_EXHAUSTION', 'NONE'
    stacked_buy_imbalance: bool = False
    stacked_sell_imbalance: bool = False
    taker_aggression_ratio: float = 50.0

class ITIVolumeProfileFeatures(BaseModel):
    poc: float = 0.0
    vah: float = 0.0
    val: float = 0.0
    avwap: float = 0.0
    avwap_upper_1s: float = 0.0
    avwap_lower_1s: float = 0.0
    avwap_upper_2s: float = 0.0
    avwap_lower_2s: float = 0.0
    price_vs_value_area: str = "INSIDE_VA"

class ITIDerivativesFeatures(BaseModel):
    open_interest_usd: float = 0.0
    oi_delta_15m_pct: float = 0.0
    funding_rate: float = 0.0
    funding_zscore: float = 0.0
    top_trader_long_pct: float = 50.0
    global_account_long_pct: float = 50.0
    taker_buy_pct: float = 50.0
    recent_liquidations_usd: Dict[str, float] = Field(default_factory=dict)

class ITITradePlan(BaseModel):
    direction: str  # 'LONG' | 'SHORT' | 'NEUTRAL'
    entry_type: str = "SL_HUNT_LIMIT"  # 'SL_HUNT_LIMIT_BUY' | 'SL_HUNT_LIMIT_SELL' | 'SL_SWEEP_RECLAIM'
    entry_price: float = 0.0
    entry_zone_high: float = 0.0
    entry_zone_low: float = 0.0
    invalidation_stop_loss: float = 0.0
    tp1_price: float = 0.0
    tp2_price: float = 0.0
    tp3_price: float = 0.0
    risk_reward_ratio: float = 0.0
    recommended_leverage: int = 15
    suggested_risk_pct: float = 1.5
    sl_pool_name: str = ""
    sl_pool_price: float = 0.0
    sl_pool_distance_pct: float = 0.0
    sl_hunt_rationale: str = ""

class ITIDataHealth(BaseModel):
    feed_status: str = "ONLINE"  # 'ONLINE' | 'CONNECTING' | 'STALE' | 'OFFLINE'
    latency_ms: float = 0.0
    last_update_age_s: float = 0.0
    local_book_synced: bool = True
    generation_id: int = 1

class ITITelemetryResponse(BaseModel):
    symbol: str
    generation_id: int
    market: str = "futures"
    current_price: float
    timestamp: int
    lifecycle_state: str  # 'WATCH' | 'PREPARE' | 'CONFIRMED' | 'INVALIDATED' | 'EXPIRED'
    direction: str        # 'LONG' | 'SHORT' | 'NEUTRAL'
    confidence_score: float
    long_score: float
    short_score: float
    hard_gates: ITIHardGates
    trade_plan: Optional[ITITradePlan] = None
    smc: ITISmcFeatures
    liquidity: ITILiquidityFeatures
    sl_hunter: ITISLHunterFeatures
    dom: ITIDomFeatures
    footprint: ITIFootprintFeatures
    volume_profile: ITIVolumeProfileFeatures
    derivatives: ITIDerivativesFeatures
    data_health: ITIDataHealth
