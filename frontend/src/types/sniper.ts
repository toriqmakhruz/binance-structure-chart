export type SniperSide = 'LONG' | 'SHORT'
export type SniperTriggerStatus = 'TRIGGERED' | 'STANDBY' | 'DANGER_BREAK'

export interface SniperEntryTarget {
  id: string
  side: SniperSide
  entryPrice: number
  stopLossPrice: number
  takeProfitPrice: number
  riskPct: number
  rewardPct: number
  rrRatio: number
  distancePct: number // % away from current price
  confluenceCount: number
  confluenceLayers: string[] // e.g. ['Whale Wall $1.1M', 'Bullish OB', '50x SL Cascade']
  triggerStatus: SniperTriggerStatus
  triggerReason: string
  isPrimary: boolean
}
