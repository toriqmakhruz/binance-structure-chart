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

/**
 * Format Funding Rate percentage with 4 decimals (e.g. +0.0100%, -0.0050%).
 */
export function formatFundingRate(ratePct?: number | null): string {
  if (ratePct === undefined || ratePct === null || isNaN(ratePct)) return '0.0000%'
  const sign = ratePct > 0 ? '+' : ''
  return `${sign}${ratePct.toFixed(4)}%`
}

/**
 * Format settlement countdown remaining time (e.g. 02:45:10).
 */
export function formatFundingCountdown(nextFundingMs?: number | null): string {
  if (!nextFundingMs || nextFundingMs <= 0) return '--:--:--'
  const diffSec = Math.max(0, Math.floor((nextFundingMs - Date.now()) / 1000))
  const hours = Math.floor(diffSec / 3600)
  const minutes = Math.floor((diffSec % 3600) / 60)
  const seconds = diffSec % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}

/**
 * Returns timeframe duration in seconds.
 */
export function getTimeframeDurationSeconds(tf?: string): number {
  const norm = (tf || '').toLowerCase().trim()
  if (norm.endsWith('m') && !norm.includes('mo')) {
    const mins = parseInt(norm.replace('m', ''), 10)
    return (isNaN(mins) || mins <= 0 ? 15 : mins) * 60
  }
  if (norm.endsWith('h')) {
    const hrs = parseInt(norm.replace('h', ''), 10)
    return (isNaN(hrs) || hrs <= 0 ? 1 : hrs) * 3600
  }
  if (norm.endsWith('d')) {
    const days = parseInt(norm.replace('d', ''), 10)
    return (isNaN(days) || days <= 0 ? 1 : days) * 86400
  }
  if (norm.endsWith('w')) {
    const wks = parseInt(norm.replace('w', ''), 10)
    return (isNaN(wks) || wks <= 0 ? 1 : wks) * 604800
  }
  if (norm === '1month' || norm.includes('mo')) {
    return 30 * 86400
  }
  return 900 // default 15m
}

export interface BarCountdownResult {
  formatted: string // e.g. "04:12" or "01:23:45"
  secondsLeft: number
  isClosingSoon: boolean // <= 10s (alert / pulse warning)
  progressPct: number // 0 to 100% of candle elapsed
}

/**
 * Calculates remaining time until current bar closes (TradingView style).
 * Handles UTC boundaries and candle open timestamps.
 */
export function calculateBarCountdown(
  timeframe: string,
  lastCandleOpenTimeSec?: number | null,
  nowSec?: number
): BarCountdownResult {
  const now = nowSec ?? Math.floor(Date.now() / 1000)
  const duration = getTimeframeDurationSeconds(timeframe)

  let closeTimeSec: number

  if (lastCandleOpenTimeSec && lastCandleOpenTimeSec > 0) {
    const expectedClose = lastCandleOpenTimeSec + duration
    if (expectedClose > now) {
      closeTimeSec = expectedClose
    } else {
      // If candle timestamp is slightly in the past (waiting for websocket tick),
      // align to the current interval epoch boundary
      closeTimeSec = (Math.floor(now / duration) + 1) * duration
    }
  } else {
    closeTimeSec = (Math.floor(now / duration) + 1) * duration
  }

  const secondsLeft = Math.max(0, closeTimeSec - now)
  const elapsed = duration - secondsLeft
  const progressPct = Math.min(100, Math.max(0, (elapsed / duration) * 100))

  const pad = (n: number) => String(n).padStart(2, '0')

  let formatted: string
  if (duration >= 86400) {
    // 1d, 3d, 1w: Show HH:MM:SS or Dd HH:MM:SS
    const days = Math.floor(secondsLeft / 86400)
    const hours = Math.floor((secondsLeft % 86400) / 3600)
    const mins = Math.floor((secondsLeft % 3600) / 60)
    const secs = secondsLeft % 60
    if (days > 0) {
      formatted = `${days}d ${pad(hours)}:${pad(mins)}:${pad(secs)}`
    } else {
      formatted = `${pad(hours)}:${pad(mins)}:${pad(secs)}`
    }
  } else if (duration >= 3600) {
    // 1h, 2h, 4h: Show HH:MM:SS
    const hours = Math.floor(secondsLeft / 3600)
    const mins = Math.floor((secondsLeft % 3600) / 60)
    const secs = secondsLeft % 60
    formatted = `${pad(hours)}:${pad(mins)}:${pad(secs)}`
  } else {
    // 1m, 3m, 5m, 15m, 30m: Show MM:SS
    const mins = Math.floor(secondsLeft / 60)
    const secs = secondsLeft % 60
    formatted = `${pad(mins)}:${pad(secs)}`
  }

  return {
    formatted,
    secondsLeft,
    isClosingSoon: secondsLeft <= 10 && secondsLeft > 0,
    progressPct
  }
}
