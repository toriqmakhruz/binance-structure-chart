import { Candle, SmcAnalysisResult } from '../types/analysis'
import { SmartDivergenceSignal, DivergenceGrade } from '../types/divergence'

function calcRsiSeries(closes: number[], period = 14): number[] {
  const n = closes.length
  const rsi = new Array<number>(n).fill(50)
  if (n <= period) return rsi

  let gainSum = 0
  let lossSum = 0
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff >= 0) gainSum += diff
    else lossSum += Math.abs(diff)
  }

  let avgGain = gainSum / period
  let avgLoss = lossSum / period
  rsi[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss)

  for (let i = period + 1; i < n; i++) {
    const diff = closes[i] - closes[i - 1]
    const gain = diff >= 0 ? diff : 0
    const loss = diff < 0 ? Math.abs(diff) : 0
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    if (avgLoss === 0) {
      rsi[i] = 100
    } else {
      const rs = avgGain / avgLoss
      rsi[i] = 100 - 100 / (1 + rs)
    }
  }
  return rsi
}

function calcEma(values: number[], period: number): number[] {
  const n = values.length
  const ema = new Array<number>(n).fill(values[0] || 0)
  if (n === 0) return ema
  const k = 2 / (period + 1)
  ema[0] = values[0]
  for (let i = 1; i < n; i++) {
    ema[i] = values[i] * k + ema[i - 1] * (1 - k)
  }
  return ema
}

function calcMacdHistogram(closes: number[]): number[] {
  const n = closes.length
  if (n === 0) return []
  const ema12 = calcEma(closes, 12)
  const ema26 = calcEma(closes, 26)
  const macdLine = closes.map((_, i) => ema12[i] - ema26[i])
  const signalLine = calcEma(macdLine, 9)
  return macdLine.map((m, i) => m - signalLine[i])
}

function calcMfiAndCvd(candles: Candle[], period = 14): { mfi: number[]; cvd: number[] } {
  const n = candles.length
  const mfi = new Array<number>(n).fill(50)
  const cvd = new Array<number>(n).fill(0)
  if (n === 0) return { mfi, cvd }

  const posMf = new Array<number>(n).fill(0)
  const negMf = new Array<number>(n).fill(0)

  let prevTp = (candles[0].high + candles[0].low + candles[0].close) / 3
  let cumCvd = 0

  for (let i = 0; i < n; i++) {
    const c = candles[i]
    const vol = Math.max(0, Number(c.volume) || 0)
    const range = Math.max(1e-9, c.high - c.low)
    let buyVol = 0
    let sellVol = 0

    if (c.taker_buy_volume && c.taker_buy_volume > 0 && c.taker_buy_volume <= vol) {
      buyVol = c.taker_buy_volume
      sellVol = Math.max(0, vol - c.taker_buy_volume)
    } else {
      const buyRatio = (c.close - c.low) / range
      buyVol = vol * buyRatio
      sellVol = vol * (1 - buyRatio)
    }
    cumCvd += buyVol - sellVol
    cvd[i] = cumCvd

    const tp = (c.high + c.low + c.close) / 3
    const rawMf = tp * vol
    if (i > 0) {
      if (tp > prevTp) posMf[i] = rawMf
      else if (tp < prevTp) negMf[i] = rawMf
    }
    prevTp = tp

    if (i >= period) {
      let sumPos = 0
      let sumNeg = 0
      for (let j = i - period + 1; j <= i; j++) {
        sumPos += posMf[j]
        sumNeg += negMf[j]
      }
      if (sumNeg <= 1e-9) {
        mfi[i] = sumPos > 0 ? 100 : 50
      } else {
        const mr = sumPos / sumNeg
        mfi[i] = 100 - 100 / (1 + mr)
      }
    }
  }

  return { mfi, cvd }
}

/**
 * Apex Smart Multi-Divergence Engine
 * Combines 5 institutional filters:
 *  1. Multi-Indicator Consensus (RSI + MACD Histogram + CVD/MFI) -> minimum 2 agreeing
 *  2. Overbought/Oversold Extreme Boundaries
 *  3. Price Action Rejection Wick & Confirmation Break (Anti-Repaint on closed bars)
 *  4. Liquidity Sweep / Smart Money Zone Proximity (OB, FVG, EQH/EQL)
 *  5. Auto-Invalidation & Minimalist Anti-Clutter Filtering (max 1 active Bull + 1 Bear)
 */
export function detectSmartDivergences(
  candles: Candle[],
  smc?: SmcAnalysisResult | null
): SmartDivergenceSignal[] {
  if (!candles || candles.length < 40) return []

  const n = candles.length
  const closes = candles.map((c) => c.close)
  const rsi = calcRsiSeries(closes, 14)
  const macdHist = calcMacdHistogram(closes)
  const { mfi, cvd } = calcMfiAndCvd(candles, 14)

  // Scan recent 140 candles for clean, actionable pivots (anti-repaint: stop at n - 3)
  const scanStart = Math.max(10, n - 140)
  const maxPivotIdx = n - 3 // requires at least 2 closed confirmation bars after pivot

  const pivotHighs: number[] = []
  const pivotLows: number[] = []

  const leftBars = 4
  const rightBars = 2

  for (let i = scanStart; i <= maxPivotIdx; i++) {
    const ch = candles[i].high
    const cl = candles[i].low

    let isHigh = true
    let isLow = true

    for (let j = i - leftBars; j <= Math.min(n - 1, i + rightBars); j++) {
      if (j === i || j < 0) continue
      if (candles[j].high > ch) isHigh = false
      if (candles[j].low < cl) isLow = false
    }

    if (isHigh) pivotHighs.push(i)
    if (isLow) pivotLows.push(i)
  }

  const bullCandidates: SmartDivergenceSignal[] = []
  const bearCandidates: SmartDivergenceSignal[] = []

  // Helper to check SMC structure zone proximity
  const findStructureSupport = (
    price: number,
    direction: 'BULLISH' | 'BEARISH'
  ): { found: boolean; label?: string } => {
    if (!smc) return { found: false }
    const tol = price * 0.0045 // 0.45% zone tolerance

    if (smc.order_blocks) {
      for (const ob of smc.order_blocks) {
        if (ob.direction === direction && !ob.mitigated) {
          if (price >= ob.bottom - tol && price <= ob.top + tol) {
            return { found: true, label: direction === 'BULLISH' ? 'Bullish OB' : 'Bearish OB' }
          }
        }
      }
    }

    if (smc.liquidity_pools) {
      const targetType = direction === 'BULLISH' ? 'EQL' : 'EQH'
      for (const lp of smc.liquidity_pools) {
        if (lp.type === targetType && Math.abs(price - lp.price) <= tol) {
          return { found: true, label: `${targetType} Liquidity` }
        }
      }
    }

    if (smc.fvgs) {
      for (const fvg of smc.fvgs) {
        if (fvg.direction === direction && !fvg.mitigated) {
          if (price >= fvg.bottom - tol && price <= fvg.top + tol) {
            return { found: true, label: `${direction === 'BULLISH' ? 'Bull' : 'Bear'} FVG` }
          }
        }
      }
    }

    return { found: false }
  }

  // 1. Evaluate Bullish Divergences on Swing Lows
  for (let b = pivotLows.length - 1; b >= 1; b--) {
    const i2 = pivotLows[b]
    // Only evaluate fresh/recent second pivots (last 90 bars)
    if (n - 1 - i2 > 90) break

    const c2 = candles[i2]
    for (let a = b - 1; a >= 0; a--) {
      const i1 = pivotLows[a]
      const span = i2 - i1
      if (span < 5) continue
      if (span > 55) break

      const c1 = candles[i1]
      // Price must form Lower Low or Liquidity Sweep double-bottom
      if (c2.low > c1.low * 1.0002) continue

      // Line-of-sight integrity: no candle strictly between broke far below c2.low
      let obstructed = false
      for (let m = i1 + 1; m < i2; m++) {
        if (candles[m].low < c2.low * 0.9985) {
          obstructed = true
          break
        }
      }
      if (obstructed) continue

      // Check Oscillator Consensus (min 2 metrics)
      const metrics: string[] = []
      const rsiMin = Math.min(rsi[i1], rsi[i2])
      const rsiDiv = rsi[i2] > rsi[i1] + 1.5 && rsiMin <= 40
      const macdDiv = macdHist[i2] > macdHist[i1] && macdHist[i1] < 0
      const cvdDiv = cvd[i2] > cvd[i1] || (mfi[i2] > mfi[i1] + 2.5 && Math.min(mfi[i1], mfi[i2]) <= 42)

      if (rsiDiv) metrics.push('RSI')
      if (cvdDiv) metrics.push('CVD')
      if (macdDiv) metrics.push('MACD')

      if (metrics.length < 2) continue

      // Boundary Oversold check
      const isExtreme = rsiMin <= 34 || Math.min(mfi[i1], mfi[i2]) <= 30

      // Price Action Rejection Wick check around i2 (i2 or i2+1)
      let bestWickPct = 0
      let hasRejection = false
      let confirmIdx = Math.min(n - 1, i2 + 1)

      for (let k = i2; k <= Math.min(n - 2, i2 + 2); k++) {
        const ck = candles[k]
        const rng = Math.max(1e-9, ck.high - ck.low)
        const lowerWick = Math.min(ck.open, ck.close) - ck.low
        const wPct = (lowerWick / rng) * 100
        if (wPct > bestWickPct) bestWickPct = wPct
        if (wPct >= 30 && ck.close > ck.low + 0.4 * rng) {
          hasRejection = true
        }
      }

      // Micro Trigger Break check (candle closes above pivot bar high or bullish body)
      let isConfirmedBreak = false
      for (let k = i2 + 1; k <= Math.min(n - 1, i2 + 4); k++) {
        if (candles[k].close > c2.high || (candles[k].close > candles[k].open && candles[k].close > (c2.high + c2.low) / 2)) {
          isConfirmedBreak = true
          confirmIdx = k
          break
        }
      }

      // Liquidity Sweep check: dipped below c1.low and closed back above c1.low
      const hasSweep =
        (c2.low < c1.low && c2.close > c1.low) ||
        (candles[Math.min(n - 1, i2 + 1)].low < c1.low && candles[Math.min(n - 1, i2 + 1)].close > c1.low)

      // Structure Zone check
      const struct = findStructureSupport(c2.low, 'BULLISH')

      // Validation Gate: reject weak Grade C noise
      if (!hasRejection && !isConfirmedBreak && !hasSweep && !struct.found) continue
      if (!isExtreme && metrics.length < 3 && !hasSweep && !struct.found) continue

      // Invalidation check: closed below c2.low after confirmation
      let isInvalidated = false
      for (let k = confirmIdx + 1; k < n; k++) {
        if (candles[k].close < c2.low * 0.9985) {
          isInvalidated = true
          break
        }
      }
      if (isInvalidated) continue

      // Grading logic
      let score = 0
      if (metrics.length >= 3) score += 2
      else score += 1
      if (isExtreme) score += 1
      if (hasRejection || isConfirmedBreak) score += 1
      if (hasSweep || struct.found) score += 1

      const grade: DivergenceGrade = score >= 3 && (hasRejection || isConfirmedBreak) ? 'A' : 'B'

      const reasons: string[] = []
      if (hasSweep) reasons.push('Sweep Low')
      if (struct.found && struct.label) reasons.push(struct.label)
      if (hasRejection) reasons.push(`Pinbar ${Math.round(bestWickPct)}%`)
      if (isExtreme) reasons.push(`RSI ${rsi[i2].toFixed(0)}`)
      if (reasons.length === 0 && isConfirmedBreak) reasons.push('Confirmed Break')

      const entryPrice = candles[confirmIdx].close
      const stopLossPrice = c2.low * 0.9985
      const risk = Math.max(entryPrice * 0.002, entryPrice - stopLossPrice)
      const takeProfitPrice = entryPrice + risk * 2.5

      bullCandidates.push({
        id: `bull_div_${c1.time}_${c2.time}`,
        direction: 'BULLISH',
        grade,
        startTime: c1.time,
        startPrice: c1.low,
        endTime: c2.time,
        endPrice: c2.low,
        confirmTime: candles[confirmIdx].time,
        confirmPrice: candles[confirmIdx].close,
        confirmingMetrics: metrics,
        rsiStart: Number(rsi[i1].toFixed(1)),
        rsiEnd: Number(rsi[i2].toFixed(1)),
        hasRejectionWick: hasRejection,
        wickRatioPct: Math.round(bestWickPct),
        hasLiquiditySweep: hasSweep,
        hasStructureZone: struct.found,
        structureZoneLabel: struct.label,
        isConfirmedBreak,
        reasons: reasons.slice(0, 3),
        entryPrice,
        stopLossPrice,
        takeProfitPrice,
        rrRatio: 2.5,
        isInvalidated: false,
        isActive: true
      })
      break // Take the cleanest pair for this i2 pivot
    }
  }

  // 2. Evaluate Bearish Divergences on Swing Highs
  for (let b = pivotHighs.length - 1; b >= 1; b--) {
    const i2 = pivotHighs[b]
    if (n - 1 - i2 > 90) break

    const c2 = candles[i2]
    for (let a = b - 1; a >= 0; a--) {
      const i1 = pivotHighs[a]
      const span = i2 - i1
      if (span < 5) continue
      if (span > 55) break

      const c1 = candles[i1]
      // Price must form Higher High or Liquidity Sweep double-top
      if (c2.high < c1.high * 0.9998) continue

      // Line-of-sight integrity
      let obstructed = false
      for (let m = i1 + 1; m < i2; m++) {
        if (candles[m].high > c2.high * 1.0015) {
          obstructed = true
          break
        }
      }
      if (obstructed) continue

      // Oscillator Consensus (min 2 metrics)
      const metrics: string[] = []
      const rsiMax = Math.max(rsi[i1], rsi[i2])
      const rsiDiv = rsi[i2] < rsi[i1] - 1.5 && rsiMax >= 60
      const macdDiv = macdHist[i2] < macdHist[i1] && macdHist[i1] > 0
      const cvdDiv = cvd[i2] < cvd[i1] || (mfi[i2] < mfi[i1] - 2.5 && Math.max(mfi[i1], mfi[i2]) >= 58)

      if (rsiDiv) metrics.push('RSI')
      if (cvdDiv) metrics.push('CVD')
      if (macdDiv) metrics.push('MACD')

      if (metrics.length < 2) continue

      const isExtreme = rsiMax >= 66 || Math.max(mfi[i1], mfi[i2]) >= 70

      // Price Action Upper Wick Rejection check
      let bestWickPct = 0
      let hasRejection = false
      let confirmIdx = Math.min(n - 1, i2 + 1)

      for (let k = i2; k <= Math.min(n - 2, i2 + 2); k++) {
        const ck = candles[k]
        const rng = Math.max(1e-9, ck.high - ck.low)
        const upperWick = ck.high - Math.max(ck.open, ck.close)
        const wPct = (upperWick / rng) * 100
        if (wPct > bestWickPct) bestWickPct = wPct
        if (wPct >= 30 && ck.close < ck.high - 0.4 * rng) {
          hasRejection = true
        }
      }

      // Micro Trigger Break check
      let isConfirmedBreak = false
      for (let k = i2 + 1; k <= Math.min(n - 1, i2 + 4); k++) {
        if (candles[k].close < c2.low || (candles[k].close < candles[k].open && candles[k].close < (c2.high + c2.low) / 2)) {
          isConfirmedBreak = true
          confirmIdx = k
          break
        }
      }

      // Liquidity Sweep check: spiked above c1.high and closed back below c1.high
      const hasSweep =
        (c2.high > c1.high && c2.close < c1.high) ||
        (candles[Math.min(n - 1, i2 + 1)].high > c1.high && candles[Math.min(n - 1, i2 + 1)].close < c1.high)

      const struct = findStructureSupport(c2.high, 'BEARISH')

      if (!hasRejection && !isConfirmedBreak && !hasSweep && !struct.found) continue
      if (!isExtreme && metrics.length < 3 && !hasSweep && !struct.found) continue

      // Invalidation check: closed above c2.high
      let isInvalidated = false
      for (let k = confirmIdx + 1; k < n; k++) {
        if (candles[k].close > c2.high * 1.0015) {
          isInvalidated = true
          break
        }
      }
      if (isInvalidated) continue

      let score = 0
      if (metrics.length >= 3) score += 2
      else score += 1
      if (isExtreme) score += 1
      if (hasRejection || isConfirmedBreak) score += 1
      if (hasSweep || struct.found) score += 1

      const grade: DivergenceGrade = score >= 3 && (hasRejection || isConfirmedBreak) ? 'A' : 'B'

      const reasons: string[] = []
      if (hasSweep) reasons.push('Sweep High')
      if (struct.found && struct.label) reasons.push(struct.label)
      if (hasRejection) reasons.push(`Reject ${Math.round(bestWickPct)}%`)
      if (isExtreme) reasons.push(`RSI ${rsi[i2].toFixed(0)}`)
      if (reasons.length === 0 && isConfirmedBreak) reasons.push('Confirmed Break')

      const entryPrice = candles[confirmIdx].close
      const stopLossPrice = c2.high * 1.0015
      const risk = Math.max(entryPrice * 0.002, stopLossPrice - entryPrice)
      const takeProfitPrice = Math.max(0.000001, entryPrice - risk * 2.5)

      bearCandidates.push({
        id: `bear_div_${c1.time}_${c2.time}`,
        direction: 'BEARISH',
        grade,
        startTime: c1.time,
        startPrice: c1.high,
        endTime: c2.time,
        endPrice: c2.high,
        confirmTime: candles[confirmIdx].time,
        confirmPrice: candles[confirmIdx].close,
        confirmingMetrics: metrics,
        rsiStart: Number(rsi[i1].toFixed(1)),
        rsiEnd: Number(rsi[i2].toFixed(1)),
        hasRejectionWick: hasRejection,
        wickRatioPct: Math.round(bestWickPct),
        hasLiquiditySweep: hasSweep,
        hasStructureZone: struct.found,
        structureZoneLabel: struct.label,
        isConfirmedBreak,
        reasons: reasons.slice(0, 3),
        entryPrice,
        stopLossPrice,
        takeProfitPrice,
        rrRatio: 2.5,
        isInvalidated: false,
        isActive: true
      })
      break
    }
  }

  // Minimalist Anti-Clutter Policy: return at most the latest 1 active Bullish & 1 active Bearish signal
  const result: SmartDivergenceSignal[] = []
  if (bullCandidates.length > 0) result.push(bullCandidates[0])
  if (bearCandidates.length > 0) result.push(bearCandidates[0])

  return result
}
