export type ITILifecycleState = 'WATCH' | 'PREPARE' | 'CONFIRMED' | 'INVALIDATED' | 'EXPIRED'
export type ITIDirection = 'LONG' | 'SHORT' | 'NEUTRAL'
export type ITIGateStatus = 'PASS' | 'FAIL' | 'CHECKING'

export interface ITIGateDetail {
  name: string
  status: ITIGateStatus
  reason: string
  value: number
  threshold: number
}

export interface ITIHardGates {
  spread_gate: ITIGateDetail
  data_freshness_gate: ITIGateDetail
  volatility_gate: ITIGateDetail
  whale_counter_gate: ITIGateDetail
  all_passed: boolean
}

export interface ITISmcFeatures {
  current_structure: string
  swing_high: number
  swing_low: number
  last_bos?: { price: number; type: string; time: number } | null
  last_choch?: { price: number; type: string; time: number } | null
  active_ob?: { type: string; high: number; low: number; time: number; mitigated: boolean } | null
  active_fvg?: { type: string; top: number; bottom: number; time: number; mitigated: boolean } | null
  premium_discount: 'PREMIUM' | 'DISCOUNT' | 'EQUILIBRIUM'
  displacement_score: number
}

export interface ITILiquidityFeatures {
  nearest_bsl: { price: number; distance_pct: number; label: string }
  nearest_ssl: { price: number; distance_pct: number; label: string }
  eqh_detected: boolean
  eqh_price: number
  eql_detected: boolean
  eql_price: number
  pdh: number
  pdl: number
  pwh: number
  pwl: number
}

export interface ITISLHunterFeatures {
  last_sweep_type: string
  sweep_price: number
  reclaim_confirmed: boolean
  reclaim_price: number
  absorption_confirmed: boolean
  false_breakout_score: number
}

export interface ITIDomFeatures {
  bid_depth_usd: number
  ask_depth_usd: number
  obi: number
  weighted_obi: number
  microprice: number
  spread_pct: number
  whale_bid_wall: { price: number; usd_value: number; distance_pct: number; label: string }
  whale_ask_wall: { price: number; usd_value: number; distance_pct: number; label: string }
  wall_pulling_detected: boolean
  iceberg_warning: boolean
  average_limit_orders?: {
    whale_avg_long: { price: number; usd_value: number; distance_pct: number; label: string }
    whale_avg_short: { price: number; usd_value: number; distance_pct: number; label: string }
    retail_avg_long: { price: number; usd_value: number; distance_pct: number; label: string }
    retail_avg_short: { price: number; usd_value: number; distance_pct: number; label: string }
  }
}

export interface ITIFootprintFeatures {
  current_bar_delta: number
  cvd_value: number
  cvd_divergence: string
  stacked_buy_imbalance: boolean
  stacked_sell_imbalance: boolean
  taker_aggression_ratio: number
}

export interface ITIVolumeProfileFeatures {
  poc: number
  vah: number
  val: number
  avwap: number
  avwap_upper_1s: number
  avwap_lower_1s: number
  avwap_upper_2s: number
  avwap_lower_2s: number
  price_vs_value_area: 'INSIDE_VA' | 'ABOVE_VAH' | 'BELOW_VAL'
}

export interface ITIDerivativesFeatures {
  open_interest_usd: number
  oi_delta_15m_pct: number
  funding_rate: number
  funding_zscore: number
  top_trader_long_pct: number
  global_account_long_pct: number
  taker_buy_pct: number
  recent_liquidations_usd: { [key: string]: number }
}

export interface ITITradePlan {
  direction: ITIDirection
  entry_type: string
  entry_price: number
  entry_zone_high: number
  entry_zone_low: number
  invalidation_stop_loss: number
  tp1_price: number
  tp2_price: number
  tp3_price: number
  risk_reward_ratio: number
  recommended_leverage: number
  suggested_risk_pct: number
  sl_pool_name?: string
  sl_pool_price?: number
  sl_pool_distance_pct?: number
  sl_hunt_rationale?: string
}

export interface ITIDataHealth {
  feed_status: 'ONLINE' | 'CONNECTING' | 'STALE' | 'OFFLINE'
  latency_ms: number
  last_update_age_s: number
  local_book_synced: boolean
  generation_id: number
  active_symbol?: string
}

export interface ITITelemetryResponse {
  symbol: string
  generation_id: number
  market: string
  current_price: number
  timestamp: number
  lifecycle_state: ITILifecycleState
  direction: ITIDirection
  confidence_score: number
  long_score: number
  short_score: number
  hard_gates: ITIHardGates
  trade_plan?: ITITradePlan | null
  smc: ITISmcFeatures
  liquidity: ITILiquidityFeatures
  sl_hunter: ITISLHunterFeatures
  dom: ITIDomFeatures
  footprint: ITIFootprintFeatures
  volume_profile: ITIVolumeProfileFeatures
  derivatives: ITIDerivativesFeatures
  data_health: ITIDataHealth
}
