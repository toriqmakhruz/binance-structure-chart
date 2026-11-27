export type NewsSentiment = 'BULLISH' | 'BEARISH' | 'NEUTRAL'
export type NewsImpact = 'HIGH' | 'MEDIUM' | 'LOW'
export type NewsCategory = 'MACRO' | 'REGULATION' | 'ONCHAIN_WHALE' | 'CRYPTO'

export interface NewsArticle {
  id: string
  title: string
  summary: string
  url: string
  source: string
  source_tier: 'TIER_1' | 'TIER_2' | 'OFFICIAL' | string
  image_url?: string | null
  published_at: number
  sentiment: NewsSentiment
  sentiment_score: number
  impact: NewsImpact
  category: NewsCategory | string
  coins: string[]
}

export interface NewsSourceStatus {
  name: string
  ok: boolean
  count: number
  tier: string
}

export interface FearGreedData {
  value: number
  classification: string
  yesterday_value: number
  delta: number
  timestamp: number
  history: { value: number; label: string }[]
}

export interface GlobalMarketData {
  total_market_cap_usd: number
  total_volume_24h_usd: number
  market_cap_change_24h_pct: number
  btc_dominance_pct: number
  eth_dominance_pct: number
  active_cryptocurrencies: number
}

export interface MacroEvent {
  id: string
  title: string
  country: string
  impact: 'HIGH' | 'MEDIUM' | 'LOW' | string
  timestamp: number
  date_iso: string
  forecast: string
  previous: string
  actual: string
  is_released: boolean
  seconds_until: number
}

export interface NewsHubResponse {
  updated_at: number
  active_sources_count: number
  total_sources_count: number
  sources_status: NewsSourceStatus[]
  fear_greed: FearGreedData
  global_market: GlobalMarketData
  news_sentiment: {
    score: number
    bullish_count: number
    bearish_count: number
    neutral_count: number
    bias: NewsSentiment
  }
  trending_coins: { coin: string; mentions: number }[]
  next_high_impact_macro: MacroEvent | null
  macro_calendar: MacroEvent[]
  total_filtered: number
  articles: NewsArticle[]
}
