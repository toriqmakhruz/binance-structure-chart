export type DivergenceDirection = 'BULLISH' | 'BEARISH'
export type DivergenceGrade = 'A' | 'B'

export interface SmartDivergenceSignal {
  id: string
  direction: DivergenceDirection
  grade: DivergenceGrade

  // Swing points for plotting the divergence trendline on chart
  startTime: number
  startPrice: number
  endTime: number
  endPrice: number
  confirmTime: number
  confirmPrice: number

  // Agreeing indicators/oscillators (Minimum 2 required for validity)
  confirmingMetrics: string[] // e.g., ['RSI', 'CVD', 'MACD']

  // Quantitative validation metadata
  rsiStart: number
  rsiEnd: number
  hasRejectionWick: boolean
  wickRatioPct: number
  hasLiquiditySweep: boolean
  hasStructureZone: boolean
  structureZoneLabel?: string
  isConfirmedBreak: boolean

  // Concise Indonesian rationale badges
  reasons: string[]

  // Entry, SL & TP guide levels
  entryPrice: number
  stopLossPrice: number
  takeProfitPrice: number
  rrRatio: number

  // Lifecycle state
  isInvalidated: boolean
  isActive: boolean
}
