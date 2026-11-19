export interface OrderflowSettings {
  // 1. Liquidation Heatmap Settings
  liqLookbackBars: number // Default 160
  enable100x: boolean // ~1% distance
  enable50x: boolean // ~2% distance
  enable25x: boolean // ~4% distance
  enable10x: boolean // ~9.5% distance
  liqTheme: 'coinglass' | 'cyber' | 'fire'
  liqOpacity: number // 0.25 to 0.85, default 0.55
  showLiqMagnets: boolean // Highlight Top 2 Short Liq & Top 2 Long Liq Magnet Lines
  showLiqLabels: boolean // Show price & leverage tier badges
  minIntensityThreshold: number // 0.15 to 0.60 (filter weak noise pools), default 0.25

  // 2. CVD & Orderflow Divergence Settings
  showCvdRibbon: boolean // Render CVD cumulative line & delta histogram at bottom of chart
  cvdRibbonHeightPct: number // 12 to 24% of chart height, default 16
  showCvdDivergence: boolean // Auto-detect Bullish Absorption & Bearish Exhaustion divergences
  showDeltaImbalance: boolean // Highlight institutional aggressor imbalance candles
  deltaImbalanceMultiplier: number // Default 2.2x average delta
  cvdBullColor: string // Default '#00c087'
  cvdBearColor: string // Default '#f6465d'
  cvdLineColor: string // Default '#38bdf8'
}

export const DEFAULT_ORDERFLOW_SETTINGS: OrderflowSettings = {
  liqLookbackBars: 160,
  enable100x: true,
  enable50x: true,
  enable25x: true,
  enable10x: false,
  liqTheme: 'coinglass',
  liqOpacity: 0.55,
  showLiqMagnets: true,
  showLiqLabels: true,
  minIntensityThreshold: 0.25,

  showCvdRibbon: true,
  cvdRibbonHeightPct: 16,
  showCvdDivergence: true,
  showDeltaImbalance: true,
  deltaImbalanceMultiplier: 2.2,
  cvdBullColor: '#00c087',
  cvdBearColor: '#f6465d',
  cvdLineColor: '#38bdf8'
}
