/**
 * Schema & Tipe Data untuk Jurnal Trading & Analitik Performa Lengkap.
 * Sesuai kurikulum institusional trade-journal & portfolio-analytics.
 */

export type TradeExecutionSource = 'bot' | 'manual'
export type TradeOutcome = 'WIN' | 'LOSS' | 'BREAKEVEN'
export type TradeDirection = 'LONG' | 'SHORT'

export interface JournalTradeRecord {
  id: string
  symbol: string
  market: 'spot' | 'futures'
  direction: TradeDirection
  source: TradeExecutionSource       // 'bot' | 'manual'
  strategy: string                   // e.g. 'Smart Risk SMC', 'Craig 10x', 'Apex Quant', 'Pro Shield', 'Manual Discretionary'
  mode: 'demo' | 'live'
  
  // Waktu & Durasi
  entryTime: number                  // Unix timestamp in ms
  exitTime?: number                  // Unix timestamp in ms
  holdDurationMinutes?: number       // Menit posisi terbuka
  
  // Eksekusi Harga & Ukuran
  entryPrice: number
  exitPrice?: number
  stopLoss?: number
  takeProfit?: number
  plannedRiskUsd?: number
  plannedRewardUsd?: number
  plannedRr?: number                 // e.g. 2.5
  realizedRr?: number                // e.g. 2.8
  
  quantity: number
  margin?: number
  leverage?: number
  
  // Hasil Finansial
  grossPnl: number
  fee: number
  netPnl: number
  roePct?: number
  outcome: TradeOutcome              // 'WIN' | 'LOSS' | 'BREAKEVEN'
  
  // Jurnal Psikologis & Refleksi Trader
  rationale?: string                 // Alasan teknikal masuk posisi
  lessons?: string                   // Pelajaran setelah trade ditutup
  disciplineRating?: number          // 1 - 10 (Skor kepatuhan pada aturan)
  emotionalState?: 'calm' | 'fomo' | 'hesitant' | 'greedy' | 'fearful' | 'revenge'
  tags?: string[]                    // e.g. ['high-conviction', 'clean-ob', '50%-eq']
  
  // Status Deteksi Pola Buruk (Behavioral Flag)
  isRevengeTrade?: boolean           // Masuk tergesa < 15 menit setelah loss
  isTiltTrade?: boolean              // Memperbesar margin > 1.5x setelah loss
  isChasingFomo?: boolean            // Masuk setelah harga lari jauh tanpa pullback
}

export interface PerformanceKpi {
  totalTrades: number
  winningTrades: number
  losingTrades: number
  breakevenTrades: number
  winRatePct: number
  
  totalGrossProfit: number
  totalGrossLoss: number
  totalFee: number
  netRealizedPnl: number
  profitFactor: number               // grossProfit / grossLoss
  
  avgWinUsd: number
  avgLossUsd: number
  winLossRatio: number               // avgWin / avgLoss
  expectancyUsd: number              // (WinRate * AvgWin) - (LossRate * AvgLoss)
  
  avgRealizedRr: number
  avgPlannedRr: number
  
  maxProfitTradeUsd: number
  maxLossTradeUsd: number
  maxDrawdownUsd: number
  maxDrawdownPct: number
  
  avgHoldWinMinutes: number
  avgHoldLossMinutes: number
  holdTimeRatio: number              // avgHoldWin / avgHoldLoss
}

export interface BotVsManualComparison {
  bot: PerformanceKpi
  manual: PerformanceKpi
  verdict: string                    // Analisis komparasi keunggulan
  recommendation: string             // Saran berbasis data
}

export interface StrategyPerformanceItem {
  strategyName: string
  tradesCount: number
  winRatePct: number
  netPnlUsd: number
  profitFactor: number
  avgRr: number
}

export interface BehavioralHealthReport {
  disciplineScore: number            // 0 - 100%
  revengeTradesCount: number
  tiltTradesCount: number
  cuttingWinnersRisk: boolean        // True jika avg hold loss > avg hold win
  summaryNotes: string[]
}
