export interface RatioDetail {
  long_pct: number
  short_pct: number
  ratio: number
  delta_30m?: number
}

export interface TakerDetail {
  buy_pct: number
  sell_pct: number
  ratio: number
}

export interface WhaleSentimentMatrixResponse {
  symbol: string
  market: string
  period: string
  updated_at: number
  regime: string
  badge_label: string
  bias: string
  confidence: number
  divergence_delta: number
  action_advice: string
  whale_position: RatioDetail
  whale_accounts: RatioDetail
  retail_accounts: RatioDetail
  taker_aggression: TakerDetail
}
