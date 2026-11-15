import { Candle } from '../types/analysis'

/**
 * Format price dynamically based on magnitude.
 * High prices (BTC/ETH): 2 decimals with commas ($91,240.50).
 * Medium prices (SOL/SUI): 2-4 decimals ($215.40, $3.1250).
 * Micro prices (DOGE/PEPE/SHIB): 5-8 decimals ($0.38420, $0.00002135).
 */
export function formatPrice(price?: number | null): string {
  if (price === undefined || price === null || isNaN(price)) return '0.00'
  const abs = Math.abs(price)
  if (abs === 0) return '0.00'
  if (abs >= 1000) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  if (abs >= 1) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 4 })
  }
  if (abs >= 0.01) {
    return price.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 })
  }
  if (abs >= 0.0001) {
    return price.toFixed(6)
  }
  return price.toFixed(8)
}

/**
 * Returns optimal price format options for TradingView Lightweight Charts
 * depending on candle price scale.
 */
export function getPricePrecision(candles: Candle[]): { precision: number; minMove: number } {
  if (!candles || candles.length === 0) {
    return { precision: 2, minMove: 0.01 }
  }
  const sample = candles[candles.length - 1].close || 1
  const abs = Math.abs(sample)

  if (abs >= 1000) return { precision: 2, minMove: 0.01 }
  if (abs >= 1) return { precision: 2, minMove: 0.01 }
  if (abs >= 0.1) return { precision: 4, minMove: 0.0001 }
  if (abs >= 0.01) return { precision: 5, minMove: 0.00001 }
  if (abs >= 0.0001) return { precision: 6, minMove: 0.000001 }
  return { precision: 8, minMove: 0.00000001 }
}

/**
 * Format Open Interest USD value into clean compact notation ($6.24B, $850.5M, $120.4K).
 */
export function formatOpenInterestValue(val?: number | null): string {
  if (val === undefined || val === null || isNaN(val) || val <= 0) return '$0.00'
  if (val >= 1e9) {
    return `$${(val / 1e9).toFixed(2)}B`
  }
  if (val >= 1e6) {
    return `$${(val / 1e6).toFixed(2)}M`
  }
  if (val >= 1e3) {
    return `$${(val / 1e3).toFixed(1)}K`
  }
  return `$${val.toFixed(2)}`
}

/**
 * Format Open Interest contract/coin quantity (e.g. 95.35K, 1.2M).
 */
export function formatOpenInterest(qty?: number | null): string {
  if (qty === undefined || qty === null || isNaN(qty) || qty <= 0) return '0'
  if (qty >= 1e6) {
    return `${(qty / 1e6).toFixed(2)}M`
  }
  if (qty >= 1e3) {
    return `${(qty / 1e3).toFixed(2)}K`
  }
  return qty.toLocaleString('en-US', { maximumFractionDigits: 2 })
}
