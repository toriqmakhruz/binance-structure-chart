export interface Candle {
  time: number // Unix timestamp in seconds
  open: number
  high: number
  low: number
  close: number
  volume: number
  taker_buy_volume: number
  is_closed?: boolean
}

export interface SwingPoint {
  time: number
  price: number
  type: 'H' | 'L' | 'HH' | 'HL' | 'LH' | 'LL'
  index: number
}

export interface StructureEvent {
  id: string
  type: 'BOS' | 'CHoCH'
  direction: 'BULLISH' | 'BEARISH'
  break_time: number
  break_price: number
  level_price: number
  level_time: number
}

export interface OrderBlock {
  id: string
  direction: 'BULLISH' | 'BEARISH'
  start_time: number
  end_time?: number
  top: number
  bottom: number
  status?: 'ACTIVE' | 'MITIGATED' | 'INVALIDATED'
  mitigated: boolean
  mitigated_time?: number
  invalidation_time?: number
}

export interface FairValueGap {
  id: string
  direction: 'BULLISH' | 'BEARISH'
  time: number
  top: number
  bottom: number
  status?: 'UNFILLED' | 'PARTIALLY_FILLED' | 'FILLED' | 'INVALIDATED'
  fill_pct?: number
  mitigated: boolean
  mitigated_time?: number
}

export interface LiquidityPool {
  id: string
  type: 'EQH' | 'EQL'
  price: number
  times: number[]
  touches?: number
  swept?: boolean
  sweep_time?: number
}

export interface SmcAnalysisResult {
  swings: SwingPoint[]
  events: StructureEvent[]
  order_blocks: OrderBlock[]
  fvgs: FairValueGap[]
  liquidity_pools: LiquidityPool[]
  current_trend: string // 'BULLISH', 'BEARISH', 'RANGING'
}

export interface ChartPattern {
  id: string
  name: string
  type: 'BULLISH' | 'BEARISH' | 'NEUTRAL'
  status?: 'FORMING' | 'CONFIRMED' | 'INVALIDATED'
  start_time: number
  end_time: number
  key_points: { name: string; time: number; price: number }[]
  neckline?: number
  target_price?: number
  stop_loss?: number
  breakout_time?: number
  breakout_price?: number
}

export interface SupportResistance {
  price: number
  strength: number
  type: 'SUPPORT' | 'RESISTANCE'
}

export interface PatternAnalysisResult {
  patterns: ChartPattern[]
  support_resistance: SupportResistance[]
  trendlines: any[]
}

export interface MovementMetrics {
  volatility_atr: number
  volatility_atr_pct: number
  volatility_status: 'SQUEEZE' | 'EXPANDING' | 'NORMAL'
  trend_direction: string
  rsi: number
  rsi_condition: string
  volume_delta: number
  volume_delta_ratio: number
  confluence_score: number
  confluence_bias: string
  summary: string
}

export interface ForecastPoint {
  time: number
  expected_price: number
  upper_bound_80: number
  lower_bound_80: number
  upper_bound_95: number
  lower_bound_95: number
}

export interface ForecastScenario {
  name: string
  direction?: 'LONG' | 'SHORT'
  entry_price?: number
  entry_time?: number
  entry_zone_high?: number
  entry_zone_low?: number
  is_valid?: boolean
  status?: string
  confluence_weight: number
  probability?: number | null
  target_price: number
  invalidation_price: number
  risk_reward_ratio: number
  path: { time: number; price: number }[]
}

export interface ForecastResult {
  horizon_candles: number
  predicted_trend: string
  confluence_score: number
  confluence_bias?: string
  confidence_pct?: number
  forecast_probability?: number | null
  historical_win_rate?: number | null
  model_calibration_status?: string
  model_assumptions?: string
  cone_points: ForecastPoint[]
  scenarios: ForecastScenario[]
  structural_target?: number
}

export interface AnalysisMetadata {
  symbol: string
  market_type: string
  interval: string
  source: string
  server_time?: number
  received_at: number
  total_candles: number
  is_stale?: boolean
}

export interface FullAnalysisResponse {
  symbol: string
  market: string
  timeframe: string
  candles: Candle[]
  smc: SmcAnalysisResult
  patterns: PatternAnalysisResult
  movement: MovementMetrics
  forecast: ForecastResult
  htf_overlay?: any
  metadata?: AnalysisMetadata
}

export interface LayerVisibility {
  smcSwings: boolean
  smcEvents: boolean
  orderBlocks: boolean
  fvgs: boolean
  patterns: boolean
  srLevels: boolean
  forecastCone: boolean
  forecastScenarios: boolean
  entryBoxes: boolean
  htfOverlay: boolean
  volume: boolean
}

export type DrawingToolType = 
  | 'cursor' 
  | 'trendline' 
  | 'horizontal_line' 
  | 'rectangle' 
  | 'fibonacci' 
  | 'measure' 
  | 'eraser'

export interface DrawingItem {
  id: string
  type: DrawingToolType
  points: { time: number; price: number }[]
  color?: string
  text?: string
}

export interface AppSettings {
  swingLength: number
  fvgMinPct: number
  forecastHorizon: number
  htf: string
}

export interface ValidSetupItem {
  symbol: string
  baseAsset: string
  market: 'spot' | 'futures'
  timeframe: string
  direction: 'LONG' | 'SHORT'
  name: string
  entry_price: number
  entry_time: number
  entry_zone_high: number
  entry_zone_low: number
  invalidation_price: number
  target_price: number
  risk_reward_ratio: number
  confluence_weight: number
  confluence_score: number
  current_price: number
  price_change_pct: number
  quote_volume: number
}

export interface ValidSetupsResponse {
  market: 'spot' | 'futures'
  timeframe: string
  scanned_count: number
  valid_count: number
  updated_at: number
  setups: ValidSetupItem[]
}

export type TradeAccountMode = 'demo' | 'live'

export interface TradeCredentials {
  demoApiKey: string
  demoApiSecret: string
  liveApiKey: string
  liveApiSecret: string
  useSimulatedDemo: boolean
}

export interface TradeBalanceResponse {
  success: boolean
  mode: TradeAccountMode
  market: 'spot' | 'futures'
  is_simulated?: boolean
  asset: string
  availableBalance: number
  walletBalance: number
  unrealizedPnl?: number
  message?: string
}

export interface TradeOrderRequest {
  symbol: string
  market: 'spot' | 'futures'
  mode: TradeAccountMode
  api_key?: string
  api_secret?: string
  side: 'BUY' | 'SELL'
  order_type: 'MARKET' | 'LIMIT'
  quantity: number
  price?: number
  leverage: number
  stop_loss?: number
  take_profit?: number
  reduce_only?: boolean
}

export interface TradeOrderResponse {
  success: boolean
  mode?: TradeAccountMode
  market?: 'spot' | 'futures'
  is_simulated?: boolean
  order_id?: number | string
  symbol?: string
  side?: 'BUY' | 'SELL'
  type?: 'MARKET' | 'LIMIT'
  executed_qty?: number
  avg_price?: number
  status?: string
  leverage?: number
  bracket_orders?: any
  code?: number
  message: string
}

export interface TradePositionItem {
  id?: string
  symbol: string
  side: 'LONG' | 'SHORT'
  positionAmt: number
  entryPrice: number
  markPrice: number
  unrealizedProfit: number
  roePct: number
  liquidationPrice?: number
  leverage: number
  margin: number
  notional?: number
  stopLoss?: number
  takeProfit?: number
  time?: number
  is_simulated?: boolean
}

export interface TradeOrderItem {
  orderId: number | string
  symbol: string
  status: string
  clientOrderId?: string
  type: string
  side: 'BUY' | 'SELL'
  price: number
  stopPrice?: number
  origQty: number
  executedQty?: number
  time: number
  is_simulated?: boolean
}


