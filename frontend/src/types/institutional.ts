import { Candle } from './analysis'

export interface AnchoredVwapPoint {
  time: number
  avwap: number
  upper1: number
  upper2: number
  lower1: number
  lower2: number
  sigma: number
}

export interface AnchoredVwapResult {
  anchorTime: number
  anchorLabel: string
  anchorPrice: number
  points: AnchoredVwapPoint[]
  latestAvwap?: number
  latestUpper1?: number
  latestUpper2?: number
  latestLower1?: number
  latestLower2?: number
}

export interface DeltaAbsorptionMarker {
  time: number
  price: number
  type: 'ABSORB_BUY' | 'ABSORB_SELL' | 'EXHAUSTION_HIGH' | 'EXHAUSTION_LOW'
  title: string
  subtitle: string
  volume: number
  relVolume: number
  deltaRatio: number
}

export interface JudasSwingEvent {
  trapTime: number
  confirmTime: number
  session: 'LONDON' | 'NEW_YORK'
  direction: 'BULLISH_EXPANSION' | 'BEARISH_EXPANSION' // direction after the trap
  trapType: 'BEAR_TRAP' | 'BULL_TRAP'
  sweepPrice: number
  reclaimPrice: number
  asiaHigh: number
  asiaLow: number
  label: string
}
