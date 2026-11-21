export interface WhaleLevelInfo {
  price: number
  usd_value: number
  distance_pct: number
}

export interface StopLossClusterInfo {
  price: number
  side: 'SHORT_LIQ' | 'LONG_LIQ'
  tier: string
  est_usd: number
  distance_pct: number
  label: string
}

export interface LiquidityMatrixSummary {
  top_whale_bid: WhaleLevelInfo
  top_whale_ask: WhaleLevelInfo
  total_inst_bids_usd: number
  total_inst_asks_usd: number
  total_retail_bids_usd: number
  total_retail_asks_usd: number
  imbalance_ratio: number
  dominant_pressure: 'INSTITUTIONAL_BUY_WALL' | 'INSTITUTIONAL_SELL_WALL' | 'NEUTRAL'
}

export interface LiquidityMatrixRow {
  price: number
  side: 'BID' | 'ASK'
  distance_pct: number
  total_usd: number
  inst_usd: number
  retail_usd: number
  whale_count: number
  retail_count: number
  has_stop_loss: boolean
  sl_usd: number
  sl_tier: string
}

export interface LiquidityMatrixResponse {
  symbol: string
  market: string
  current_price: number
  timestamp: number
  summary: LiquidityMatrixSummary
  major_stop_loss_clusters: StopLossClusterInfo[]
  matrix_rows: LiquidityMatrixRow[]
}
