export interface FibLevelConfig {
  level: number
  enabled: boolean
  color: string
  label?: string
}

export interface AutoFibSettings {
  // Calculation & Anti-Repaint Parameters
  source: 'smc_swings' | 'zigzag_pivots'
  pivotLegs: number // Number of confirmation bars to the right (Anti-Repaint)
  trendDirection: 'auto' | 'up' | 'down'
  reverse: boolean

  // Fibonacci Levels
  levels: FibLevelConfig[]

  // Display & Style Options
  extendRight: boolean
  extendLeft: boolean
  showPrices: boolean
  showLevels: 'values' | 'percent' | 'both'
  labelPosition: 'left' | 'center' | 'right'
  backgroundShading: boolean
  backgroundOpacity: number // 0.05 to 0.40
  lineWidth: number
  lineStyle: 'solid' | 'dashed' | 'dotted'
}

export const DEFAULT_FIB_LEVELS: FibLevelConfig[] = [
  { level: 0.0, enabled: true, color: '#787b86', label: '0.0 (Extreme)' },
  { level: 0.236, enabled: true, color: '#f44336', label: '0.236' },
  { level: 0.382, enabled: true, color: '#ff9800', label: '0.382' },
  { level: 0.5, enabled: true, color: '#4caf50', label: '0.50 (Equilibrium)' },
  { level: 0.618, enabled: true, color: '#00897b', label: '0.618 (Golden Ratio)' },
  { level: 0.65, enabled: true, color: '#00bcd4', label: '0.65 (Golden Pocket)' },
  { level: 0.705, enabled: true, color: '#26a69a', label: '0.705 (OTE Sweet Spot)' },
  { level: 0.786, enabled: true, color: '#673ab7', label: '0.786 (Deep Retracement)' },
  { level: 0.886, enabled: false, color: '#ab47bc', label: '0.886' },
  { level: 1.0, enabled: true, color: '#787b86', label: '1.0 (Origin)' },
  { level: 1.272, enabled: false, color: '#e91e63', label: '1.272 (Target)' },
  { level: 1.414, enabled: false, color: '#9c27b0', label: '1.414' },
  { level: 1.618, enabled: true, color: '#2196f3', label: '1.618 (Extension 1)' },
  { level: 2.618, enabled: false, color: '#3f51b5', label: '2.618 (Extension 2)' },
  { level: -0.27, enabled: false, color: '#00c087', label: '-0.27 (OTE Target 1)' },
  { level: -0.618, enabled: false, color: '#00e676', label: '-0.618 (OTE Target 2)' }
]

export const DEFAULT_AUTO_FIB_SETTINGS: AutoFibSettings = {
  source: 'smc_swings',
  pivotLegs: 10,
  trendDirection: 'auto',
  reverse: false,
  levels: DEFAULT_FIB_LEVELS,
  extendRight: true,
  extendLeft: false,
  showPrices: true,
  showLevels: 'both',
  labelPosition: 'right',
  backgroundShading: true,
  backgroundOpacity: 0.12,
  lineWidth: 1.2,
  lineStyle: 'solid'
}

