import { Candle } from '../types/analysis'
import {
  AnchoredVwapResult,
  AnchoredVwapPoint,
  DeltaAbsorptionMarker,
  JudasSwingEvent
} from '../types/institutional'

/**
 * 1. Anchored VWAP (AVWAP) with Institutional Standard Deviation Bands (±1σ, ±2σ)
 * Smart Auto-Anchor: Anchors to the most prominent recent swing high/low,
 * or beginning of the current week (WTD) if available.
 */
export function calculateAnchoredVwap(candles: Candle[], anchorTimeOverride?: number): AnchoredVwapResult | null {
  if (!candles || candles.length < 5) return null

  const n = candles.length
  let anchorIdx = -1
  let anchorLabel = 'Major Swing'

  if (anchorTimeOverride) {
    anchorIdx = candles.findIndex((c) => c.time >= anchorTimeOverride)
    anchorLabel = 'Custom Anchor'
  }

  // Auto-anchor selection: Look back up to 180 bars
  if (anchorIdx < 0) {
    const lookback = Math.min(n, 160)
    const startScan = n - lookback

    // Option A: Check start of current week (Monday 00:00 UTC)
    for (let i = startScan; i < n; i++) {
      const d = new Date(candles[i].time * 1000)
      if (d.getUTCDay() === 1 && d.getUTCHours() === 0) {
        anchorIdx = i
        anchorLabel = 'WTD (Week-to-Date)'
        break
      }
    }

    // Option B: If no WTD found in range or too recent, find the most extreme swing pivot
    if (anchorIdx < 0 || anchorIdx > n - 15) {
      let maxHigh = -Infinity
      let maxHighIdx = startScan
      let minLow = Infinity
      let minLowIdx = startScan

      for (let i = startScan; i < n - 5; i++) {
        if (candles[i].high > maxHigh) {
          maxHigh = candles[i].high
          maxHighIdx = i
        }
        if (candles[i].low < minLow) {
          minLow = candles[i].low
          minLowIdx = i
        }
      }

      const currentClose = candles[n - 1].close
      // If current price is near the highs, anchor from major swing low (support)
      // If current price is near the lows, anchor from major swing high (resistance)
      const distToHigh = Math.abs(currentClose - maxHigh)
      const distToLow = Math.abs(currentClose - minLow)

      if (distToLow < distToHigh) {
        anchorIdx = maxHighIdx
        anchorLabel = `Major Swing High ($${maxHigh.toLocaleString()})`
      } else {
        anchorIdx = minLowIdx
        anchorLabel = `Major Swing Low ($${minLow.toLocaleString()})`
      }
    }
  }

  if (anchorIdx < 0 || anchorIdx >= n) {
    anchorIdx = Math.max(0, n - 80)
    anchorLabel = 'Recent Base'
  }

  const anchorCandle = candles[anchorIdx]
  const anchorTime = anchorCandle.time
  const anchorPrice = (anchorCandle.high + anchorCandle.low + anchorCandle.close) / 3

  let cumVol = 0
  let cumVolPrice = 0
  const points: AnchoredVwapPoint[] = []

  // Pre-calculate running sums for fast standard deviation
  for (let i = anchorIdx; i < n; i++) {
    const c = candles[i]
    const vol = Math.max(1e-6, Number(c.volume) || 1)
    const tp = (c.high + c.low + c.close) / 3

    cumVol += vol
    cumVolPrice += tp * vol
    const avwap = cumVolPrice / cumVol

    // Variance calculation over the anchored window up to bar i
    let sumSquaredDiff = 0
    let subVol = 0
    for (let k = anchorIdx; k <= i; k++) {
      const ck = candles[k]
      const vk = Math.max(1e-6, Number(ck.volume) || 1)
      const tpk = (ck.high + ck.low + ck.close) / 3
      sumSquaredDiff += vk * Math.pow(tpk - avwap, 2)
      subVol += vk
    }
    const sigma = Math.sqrt(sumSquaredDiff / Math.max(1e-6, subVol))

    points.push({
      time: c.time,
      avwap,
      upper1: avwap + sigma,
      upper2: avwap + 2 * sigma,
      lower1: avwap - sigma,
      lower2: avwap - 2 * sigma,
      sigma
    })
  }

  const latest = points[points.length - 1]

  return {
    anchorTime,
    anchorLabel,
    anchorPrice,
    points,
    latestAvwap: latest?.avwap,
    latestUpper1: latest?.upper1,
    latestUpper2: latest?.upper2,
    latestLower1: latest?.lower1,
    latestLower2: latest?.lower2
  }
}

/**
 * 2. Institutional Delta Absorption & Exhaustion Detector
 * Detects candles where aggressive market participants are absorbed by passive limit orders,
 * or where volume climaxes but delta rapidly exhausts.
 */
export function calculateDeltaAbsorption(candles: Candle[]): DeltaAbsorptionMarker[] {
  if (!candles || candles.length < 15) return []

  const markers: DeltaAbsorptionMarker[] = []
  const n = candles.length

  // Calculate 20-period simple moving average of volume
  const volSma: number[] = new Array(n).fill(0)
  let volSum = 0
  const period = 20

  for (let i = 0; i < n; i++) {
    const v = Number(candles[i].volume) || 0
    volSum += v
    if (i >= period) {
      volSum -= Number(candles[i - period].volume) || 0
      volSma[i] = volSum / period
    } else {
      volSma[i] = volSum / (i + 1)
    }
  }

  // Scan for absorption in recent candles (up to 120 candles lookback)
  const scanStart = Math.max(2, n - 120)

  for (let i = scanStart; i < n; i++) {
    const c = candles[i]
    const vol = Number(c.volume) || 0
    const avgVol = volSma[i] || 1
    const relVol = vol / Math.max(1e-6, avgVol)

    const range = c.high - c.low
    if (range <= 0 || relVol < 1.20) continue

    const body = Math.abs(c.close - c.open)
    const upperWick = c.high - Math.max(c.open, c.close)
    const lowerWick = Math.min(c.open, c.close) - c.low

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

    const delta = buyVol - sellVol
    const deltaRatio = delta / Math.max(1e-6, vol)

    // A. Bullish Absorption: High sell delta, but price rejects downwards and leaves long lower wick
    // Smart money placed massive limit buys absorbing retail panic sellers
    if (sellVol > buyVol * 1.35 && lowerWick >= 0.35 * range && c.close > c.low + 0.30 * range) {
      markers.push({
        time: c.time,
        price: c.low,
        type: 'ABSORB_BUY',
        title: '🛡️ ABSORB BUY',
        subtitle: `Passive Whale Absorption (${(relVol).toFixed(1)}x Vol)`,
        volume: vol,
        relVolume: relVol,
        deltaRatio
      })
      continue
    }

    // B. Bearish Absorption: High buy delta, but price rejects upwards and leaves long upper wick
    // Smart money placed massive limit sells absorbing retail FOMO buyers
    if (buyVol > sellVol * 1.35 && upperWick >= 0.35 * range && c.close < c.high - 0.30 * range) {
      markers.push({
        time: c.time,
        price: c.high,
        type: 'ABSORB_SELL',
        title: '🛡️ ABSORB SELL',
        subtitle: `Passive Whale Absorption (${(relVol).toFixed(1)}x Vol)`,
        volume: vol,
        relVolume: relVol,
        deltaRatio
      })
      continue
    }

    // C. Delta Exhaustion: Candle makes new 10-bar extreme with high volume but tiny body (< 25% range)
    if (relVol >= 1.6 && body <= 0.25 * range) {
      const isHighExtreme = i >= 10 && c.high >= Math.max(...candles.slice(i - 10, i).map((x) => x.high))
      const isLowExtreme = i >= 10 && c.low <= Math.min(...candles.slice(i - 10, i).map((x) => x.low))

      if (isHighExtreme) {
        markers.push({
          time: c.time,
          price: c.high,
          type: 'EXHAUSTION_HIGH',
          title: '⚠️ EXHAUSTION HIGH',
          subtitle: `Buyer Exhaustion at Top (${(relVol).toFixed(1)}x Vol)`,
          volume: vol,
          relVolume: relVol,
          deltaRatio
        })
      } else if (isLowExtreme) {
        markers.push({
          time: c.time,
          price: c.low,
          type: 'EXHAUSTION_LOW',
          title: '⚠️ EXHAUSTION LOW',
          subtitle: `Seller Exhaustion at Bottom (${(relVol).toFixed(1)}x Vol)`,
          volume: vol,
          relVolume: relVol,
          deltaRatio
        })
      }
    }
  }

  return markers
}

/**
 * 3. ICT Judas Swing / Institutional Fakeout Trap Detector
 * Monitors the Asian session consolidation range (00:00 - 08:00 UTC).
 * Detects false breakouts during London Open (07:00 - 11:00 UTC) or NY Open (12:00 - 16:00 UTC)
 * engineered by algorithms to trap breakout traders before initiating real institutional expansion.
 */
export function calculateJudasSwing(candles: Candle[], timeframe: string): JudasSwingEvent[] {
  if (!candles || candles.length < 24) return []
  const tf = (timeframe || '').toLowerCase()
  if (['1d', '3d', '1w', '1M'].includes(tf)) return []

  const events: JudasSwingEvent[] = []
  const dayBuckets: Map<string, Candle[]> = new Map()

  for (const c of candles) {
    const d = new Date(c.time * 1000)
    const dayKey = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`
    if (!dayBuckets.has(dayKey)) {
      dayBuckets.set(dayKey, [])
    }
    dayBuckets.get(dayKey)!.push(c)
  }

  // Only scan the last 4 days to keep performance lightning fast
  const allDays = Array.from(dayBuckets.keys()).slice(-4)

  for (const dayKey of allDays) {
    const dayCandles = dayBuckets.get(dayKey) || []
    if (dayCandles.length < 8) continue

    // 1. Identify Asian session candles (00:00 to 08:00 UTC)
    const asiaCandles = dayCandles.filter((c) => {
      const d = new Date(c.time * 1000)
      const h = d.getUTCHours() + d.getUTCMinutes() / 60
      return h >= 0 && h < 8
    })

    if (asiaCandles.length < 3) continue

    let asiaHigh = -Infinity
    let asiaLow = Infinity
    for (const c of asiaCandles) {
      if (c.high > asiaHigh) asiaHigh = c.high
      if (c.low < asiaLow) asiaLow = c.low
    }

    const asiaRange = asiaHigh - asiaLow
    if (asiaRange <= 0) continue

    // 2. Identify London (07:00 - 11:00 UTC) and NY (12:00 - 16:00 UTC) candles
    const killzoneCandles = dayCandles.filter((c) => {
      const d = new Date(c.time * 1000)
      const h = d.getUTCHours() + d.getUTCMinutes() / 60
      return (h >= 7 && h <= 11) || (h >= 12 && h <= 16)
    })

    for (let i = 0; i < killzoneCandles.length; i++) {
      const c = killzoneCandles[i]
      const d = new Date(c.time * 1000)
      const h = d.getUTCHours() + d.getUTCMinutes() / 60
      const session: 'LONDON' | 'NEW_YORK' = h < 12 ? 'LONDON' : 'NEW_YORK'

      // Bear Trap (Judas Swing Low): Price sweeps below Asia Low, but closes back inside/above Asia Low
      if (c.low < asiaLow && c.low >= asiaLow - 0.02 * asiaLow) {
        // Confirmation: within next 1-3 bars, closes firmly above asiaLow
        const futureBars = killzoneCandles.slice(i, i + 3)
        const confirmed = futureBars.some((fb) => fb.close > asiaLow + 0.1 * asiaRange)
        if (confirmed) {
          const alreadyExists = events.some((e) => Math.abs(e.trapTime - c.time) < 14400)
          if (!alreadyExists) {
            events.push({
              trapTime: c.time,
              confirmTime: futureBars[futureBars.length - 1].time,
              session,
              direction: 'BULLISH_EXPANSION',
              trapType: 'BEAR_TRAP',
              sweepPrice: c.low,
              reclaimPrice: futureBars[futureBars.length - 1].close,
              asiaHigh,
              asiaLow,
              label: `⚡ JUDAS SWING (BEAR TRAP) ➔ TARGET: EXPANSION UP`
            })
          }
        }
      }

      // Bull Trap (Judas Swing High): Price sweeps above Asia High, but closes back inside/below Asia High
      if (c.high > asiaHigh && c.high <= asiaHigh + 0.02 * asiaHigh) {
        const futureBars = killzoneCandles.slice(i, i + 3)
        const confirmed = futureBars.some((fb) => fb.close < asiaHigh - 0.1 * asiaRange)
        if (confirmed) {
          const alreadyExists = events.some((e) => Math.abs(e.trapTime - c.time) < 14400)
          if (!alreadyExists) {
            events.push({
              trapTime: c.time,
              confirmTime: futureBars[futureBars.length - 1].time,
              session,
              direction: 'BEARISH_EXPANSION',
              trapType: 'BULL_TRAP',
              sweepPrice: c.high,
              reclaimPrice: futureBars[futureBars.length - 1].close,
              asiaHigh,
              asiaLow,
              label: `⚡ JUDAS SWING (BULL TRAP) ➔ TARGET: EXPANSION DOWN`
            })
          }
        }
      }
    }
  }

  return events
}
