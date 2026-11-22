import { Candle, SmcAnalysisResult } from '../types/analysis'
import { MarketXrayData } from '../types/marketXray'
import { SniperEntryTarget, SniperSide, SniperTriggerStatus } from '../types/sniper'

interface AnchorPoint {
  category: 'WHALE_WALL' | 'SL_POOL' | 'ORDER_BLOCK' | 'FVG' | 'LIQ_POOL' | 'HEATMAP_SWEEP'
  price: number
  slBoundary?: number
  weight: number
  label: string
}

/**
 * Apex Sniper Entry Crosshair Engine
 * Combines:
 *  1. 3-in-1 Structural Confluence (DOM L2 Whale Limit Walls + Retail SL Pools + SMC OB/FVG/EQH-EQL)
 *  2. Spot vs Futures CVD Absorption Validation
 *  3. 4-Quadrant OI Liquidation Flush Trigger (Avoids Catching Falling Knives)
 */
export function calculateSniperEntryTargets(
  candles: Candle[],
  smc?: SmcAnalysisResult | null,
  xrayData?: MarketXrayData | null
): SniperEntryTarget[] {
  if (!candles || candles.length < 20) return []

  const n = candles.length
  const currentPrice = candles[n - 1].close
  if (!currentPrice || currentPrice <= 0) return []

  // Estimate ATR % over last 14 candles for adaptive tight Sniper SL
  const atrPeriod = Math.min(14, n - 1)
  let sumRange = 0
  for (let i = n - atrPeriod; i < n; i++) {
    sumRange += Math.max(0, candles[i].high - candles[i].low)
  }
  const atrPct = Math.max(0.002, Math.min(0.015, (sumRange / atrPeriod) / currentPrice))
  const tolPct = Math.max(0.0038, atrPct * 0.9) // Clustering tolerance

  // Gather candidate anchors for LONG (below/near price) and SHORT (above/near price)
  const longAnchors: AnchorPoint[] = []
  const shortAnchors: AnchorPoint[] = []

  // A. Whale Limit Order Walls (DOM L2 Real Liquidity >= $50k)
  if (xrayData?.whale_fortress) {
    const bidWalls = xrayData.whale_fortress.bid_walls?.length
      ? xrayData.whale_fortress.bid_walls
      : xrayData.whale_fortress.top_bid_wall?.price > 0
      ? [xrayData.whale_fortress.top_bid_wall]
      : []

    bidWalls.forEach((w) => {
      if (w.price > 0 && w.price <= currentPrice * 1.002 && w.usd_value > 0) {
        longAnchors.push({
          category: 'WHALE_WALL',
          price: w.price,
          weight: 2.6,
          label: `Whale Bid ($${(w.usd_value / 1e6).toFixed(1)}M)`
        })
      }
    })

    const askWalls = xrayData.whale_fortress.ask_walls?.length
      ? xrayData.whale_fortress.ask_walls
      : xrayData.whale_fortress.top_ask_wall?.price > 0
      ? [xrayData.whale_fortress.top_ask_wall]
      : []

    askWalls.forEach((w) => {
      if (w.price > 0 && w.price >= currentPrice * 0.998 && w.usd_value > 0) {
        shortAnchors.push({
          category: 'WHALE_WALL',
          price: w.price,
          weight: 2.6,
          label: `Whale Ask ($${(w.usd_value / 1e6).toFixed(1)}M)`
        })
      }
    })
  }

  // B. Retail Stop-Loss Cascade / Squeeze Pools (50x / 25x)
  if (xrayData?.stop_loss_pools) {
    const longSl = xrayData.stop_loss_pools.long_sl_cascade
    if (longSl && longSl.price > 0 && longSl.price <= currentPrice * 1.002) {
      longAnchors.push({
        category: 'SL_POOL',
        price: longSl.price,
        weight: 2.2,
        label: `Long SL Pool (~$${(longSl.est_usd / 1e6).toFixed(1)}M)`
      })
    }

    const shortSl = xrayData.stop_loss_pools.short_sl_magnet
    if (shortSl && shortSl.price > 0 && shortSl.price >= currentPrice * 0.998) {
      shortAnchors.push({
        category: 'SL_POOL',
        price: shortSl.price,
        weight: 2.2,
        label: `Short SL Pool (~$${(shortSl.est_usd / 1e6).toFixed(1)}M)`
      })
    }
  }

  // C. SMC Order Blocks, Fair Value Gaps & Equal High/Low Liquidity
  if (smc) {
    if (smc.order_blocks) {
      smc.order_blocks.forEach((ob) => {
        if (ob.mitigated) return
        if (ob.direction === 'BULLISH' && ob.top <= currentPrice * 1.0025) {
          longAnchors.push({
            category: 'ORDER_BLOCK',
            price: ob.top,
            slBoundary: ob.bottom,
            weight: 2.1,
            label: 'Fresh Bull OB'
          })
        } else if (ob.direction === 'BEARISH' && ob.bottom >= currentPrice * 0.9975) {
          shortAnchors.push({
            category: 'ORDER_BLOCK',
            price: ob.bottom,
            slBoundary: ob.top,
            weight: 2.1,
            label: 'Fresh Bear OB'
          })
        }
      })
    }

    if (smc.fvgs) {
      smc.fvgs.forEach((fvg) => {
        if (fvg.mitigated) return
        const mid = (fvg.top + fvg.bottom) / 2
        if (fvg.direction === 'BULLISH' && fvg.top <= currentPrice * 1.002) {
          longAnchors.push({
            category: 'FVG',
            price: mid,
            slBoundary: fvg.bottom,
            weight: 1.4,
            label: 'Bullish FVG'
          })
        } else if (fvg.direction === 'BEARISH' && fvg.bottom >= currentPrice * 0.998) {
          shortAnchors.push({
            category: 'FVG',
            price: mid,
            slBoundary: fvg.top,
            weight: 1.4,
            label: 'Bearish FVG'
          })
        }
      })
    }

    if (smc.liquidity_pools) {
      smc.liquidity_pools.forEach((lp) => {
        if (lp.swept) return
        if (lp.type === 'EQL' && lp.price <= currentPrice * 1.001) {
          longAnchors.push({
            category: 'LIQ_POOL',
            price: lp.price,
            weight: 1.8,
            label: 'EQL Sweep Pool'
          })
        } else if (lp.type === 'EQH' && lp.price >= currentPrice * 0.999) {
          shortAnchors.push({
            category: 'LIQ_POOL',
            price: lp.price,
            weight: 1.8,
            label: 'EQH Sweep Pool'
          })
        }
      })
    }
  }

  // D. Recent 50x Swing Liquidation Pool Fallback (from Candlestick Pivots)
  const lookbackStart = Math.max(0, n - 80)
  let lowestLow = Infinity
  let highestHigh = -Infinity
  for (let i = lookbackStart; i < n - 2; i++) {
    if (candles[i].low < lowestLow) lowestLow = candles[i].low
    if (candles[i].high > highestHigh) highestHigh = candles[i].high
  }
  if (Number.isFinite(lowestLow) && lowestLow <= currentPrice) {
    const liq50Long = lowestLow * 0.985
    if (liq50Long < currentPrice * 0.997 && liq50Long > currentPrice * 0.92) {
      longAnchors.push({
        category: 'HEATMAP_SWEEP',
        price: liq50Long,
        weight: 1.1,
        label: '50x Liq Magnet'
      })
    }
  }
  if (Number.isFinite(highestHigh) && highestHigh >= currentPrice) {
    const liq50Short = highestHigh * 1.015
    if (liq50Short > currentPrice * 1.003 && liq50Short < currentPrice * 1.08) {
      shortAnchors.push({
        category: 'HEATMAP_SWEEP',
        price: liq50Short,
        weight: 1.1,
        label: '50x Liq Magnet'
      })
    }
  }

  // Helper: Pick Best Multi-Confluence Cluster for a Given Side
  const pickBestCluster = (anchors: AnchorPoint[], side: SniperSide): SniperEntryTarget | null => {
    const validAnchors = anchors.filter((a) => {
      const dist = Math.abs(a.price - currentPrice) / currentPrice
      return dist <= 0.085 // Max 8.5% away so it remains actionable
    })
    if (validAnchors.length === 0) return null

    let bestScore = -1
    let bestCluster: AnchorPoint[] = []

    for (const seed of validAnchors) {
      const seenCats = new Set<string>([seed.category])
      const members: AnchorPoint[] = [seed]
      let score = seed.weight

      for (const other of validAnchors) {
        if (other === seed || seenCats.has(other.category)) continue
        const relDiff = Math.abs(other.price - seed.price) / seed.price
        if (relDiff <= tolPct) {
          seenCats.add(other.category)
          members.push(other)
          score += other.weight
        }
      }

      // Bonus for closer actionable setups (0.1% - 3.5% away)
      const distPct = Math.abs(seed.price - currentPrice) / currentPrice
      if (distPct <= 0.035) score += 0.75

      if (score > bestScore) {
        bestScore = score
        bestCluster = members
      }
    }

    if (bestCluster.length === 0) return null

    // Determine exact Sniper Entry Price:
    // Priority: Whale Wall -> SL Pool -> Order Block edge -> Average
    const whaleMember = bestCluster.find((m) => m.category === 'WHALE_WALL')
    const slMember = bestCluster.find((m) => m.category === 'SL_POOL')
    const obMember = bestCluster.find((m) => m.category === 'ORDER_BLOCK')

    let entryPrice = bestCluster[0].price
    if (whaleMember && slMember) {
      // Front-run whale protection slightly ahead of SL sweep
      entryPrice = side === 'LONG' ? Math.max(whaleMember.price, (whaleMember.price + slMember.price) / 2) : Math.min(whaleMember.price, (whaleMember.price + slMember.price) / 2)
    } else if (whaleMember) {
      entryPrice = whaleMember.price
    } else if (obMember && slMember) {
      entryPrice = (obMember.price + slMember.price) / 2
    } else if (obMember) {
      entryPrice = obMember.price
    }

    // Ensure tight Sniper Stop Loss
    const baseSlFrac = Math.max(0.0024, Math.min(0.0075, atrPct * 0.75))
    let stopLossPrice = side === 'LONG' ? entryPrice * (1 - baseSlFrac) : entryPrice * (1 + baseSlFrac)
    if (obMember?.slBoundary) {
      if (side === 'LONG') {
        stopLossPrice = Math.min(stopLossPrice, obMember.slBoundary * 0.9985)
        // Guard SL so it doesn't exceed 1.5% for Sniper mode
        stopLossPrice = Math.max(stopLossPrice, entryPrice * 0.985)
      } else {
        stopLossPrice = Math.max(stopLossPrice, obMember.slBoundary * 1.0015)
        stopLossPrice = Math.min(stopLossPrice, entryPrice * 1.015)
      }
    }

    const riskAbs = Math.max(entryPrice * 0.0015, Math.abs(entryPrice - stopLossPrice))
    let takeProfitPrice = side === 'LONG' ? entryPrice + riskAbs * 3.5 : entryPrice - riskAbs * 3.5

    // Snap TP to nearest major opposing pool if RR >= 2.5
    if (side === 'LONG') {
      const oppTarget =
        xrayData?.stop_loss_pools?.short_sl_magnet?.price ||
        xrayData?.whale_fortress?.top_ask_wall?.price ||
        0
      if (oppTarget > entryPrice + riskAbs * 2.5) {
        takeProfitPrice = oppTarget
      }
    } else {
      const oppTarget =
        xrayData?.stop_loss_pools?.long_sl_cascade?.price ||
        xrayData?.whale_fortress?.top_bid_wall?.price ||
        0
      if (oppTarget > 0 && oppTarget < entryPrice - riskAbs * 2.5) {
        takeProfitPrice = oppTarget
      }
    }

    const rewardAbs = Math.abs(takeProfitPrice - entryPrice)
    const rrRatio = Number((rewardAbs / Math.max(1e-9, riskAbs)).toFixed(1))
    const riskPct = Number(((riskAbs / entryPrice) * 100).toFixed(2))
    const rewardPct = Number(((rewardAbs / entryPrice) * 100).toFixed(2))
    const distancePct = Number((((entryPrice - currentPrice) / currentPrice) * 100).toFixed(2))

    // Evaluate Real-Time Trigger Status (Spot vs Futures CVD + OI Flush + Rejection Wick)
    const lastCandles = candles.slice(-3)
    const inZone = Math.abs(currentPrice - entryPrice) / entryPrice <= 0.0022
    const wickedIntoZone = lastCandles.some((c) =>
      side === 'LONG'
        ? c.low <= entryPrice * 1.0018 && c.close >= entryPrice * 0.997
        : c.high >= entryPrice * 0.9982 && c.close <= entryPrice * 1.003
    )
    const latestC = candles[n - 1]
    const rng = Math.max(1e-9, latestC.high - latestC.low)
    const hasLowerRejection = (Math.min(latestC.open, latestC.close) - latestC.low) / rng >= 0.32
    const hasUpperRejection = (latestC.high - Math.max(latestC.open, latestC.close)) / rng >= 0.32

    const spotVsFut = xrayData?.spot_vs_futures?.regime || 'NEUTRAL'
    const oiRegime = xrayData?.oi_regime?.regime || 'NEUTRAL'
    const whaleBias = xrayData?.telemetry?.whale_bias_pct ?? 50

    let triggerStatus: SniperTriggerStatus = 'STANDBY'
    let triggerReason = `Menunggu harga masuk zona bidik (${distancePct > 0 ? '+' : ''}${distancePct}%)`

    if (side === 'LONG') {
      if (spotVsFut === 'SPOT_DISTRIBUTION_BEARISH' || (spotVsFut === 'ALIGNED_BEARISH' && oiRegime === 'SHORT_BUILD_UP')) {
        triggerStatus = 'DANGER_BREAK'
        triggerReason = 'Waspada Jebol: Spot Distribusi + OI Short Bertambah'
      } else if (
        (inZone || wickedIntoZone) &&
        (spotVsFut === 'SPOT_ABSORPTION_BULLISH' || oiRegime === 'LONG_LIQUIDATION_FLUSH' || whaleBias >= 55 || hasLowerRejection)
      ) {
        triggerStatus = 'TRIGGERED'
        const parts: string[] = []
        if (spotVsFut === 'SPOT_ABSORPTION_BULLISH') parts.push('Spot Serap')
        if (oiRegime === 'LONG_LIQUIDATION_FLUSH') parts.push('Long SL Flush')
        if (whaleBias >= 55) parts.push(`Paus ${whaleBias}% Beli`)
        if (hasLowerRejection) parts.push('Pinbar Reject')
        triggerReason = `PELATUK AKTIF: ${parts.join(' + ') || 'Zona Tersentuh'}`
      } else if (spotVsFut === 'SPOT_ABSORPTION_BULLISH' || oiRegime === 'LONG_LIQUIDATION_FLUSH') {
        triggerReason = `Standby (${spotVsFut === 'SPOT_ABSORPTION_BULLISH' ? 'Spot Akumulasi' : 'Long Flush Siap'})`
      }
    } else {
      if (spotVsFut === 'SPOT_ABSORPTION_BULLISH' || (spotVsFut === 'ALIGNED_BULLISH' && oiRegime === 'LONG_BUILD_UP')) {
        triggerStatus = 'DANGER_BREAK'
        triggerReason = 'Waspada Short Squeeze: Spot Borong + OI Long Naik'
      } else if (
        (inZone || wickedIntoZone) &&
        (spotVsFut === 'SPOT_DISTRIBUTION_BEARISH' || oiRegime === 'SHORT_COVERING_SQUEEZE' || whaleBias <= 45 || hasUpperRejection)
      ) {
        triggerStatus = 'TRIGGERED'
        const parts: string[] = []
        if (spotVsFut === 'SPOT_DISTRIBUTION_BEARISH') parts.push('Spot Buang')
        if (oiRegime === 'SHORT_COVERING_SQUEEZE') parts.push('Short Squeeze Flush')
        if (whaleBias <= 45) parts.push(`Paus ${100 - whaleBias}% Jual`)
        if (hasUpperRejection) parts.push('Reject Atas')
        triggerReason = `PELATUK AKTIF: ${parts.join(' + ') || 'Zona Tersentuh'}`
      } else if (spotVsFut === 'SPOT_DISTRIBUTION_BEARISH' || oiRegime === 'SHORT_COVERING_SQUEEZE') {
        triggerReason = `Standby (${spotVsFut === 'SPOT_DISTRIBUTION_BEARISH' ? 'Spot Distribusi' : 'Short Flush Siap'})`
      }
    }

    return {
      id: `sniper_${side.toLowerCase()}_${Math.round(entryPrice * 100)}`,
      side,
      entryPrice,
      stopLossPrice,
      takeProfitPrice,
      riskPct,
      rewardPct,
      rrRatio,
      distancePct,
      confluenceCount: bestCluster.length,
      confluenceLayers: bestCluster.map((m) => m.label),
      triggerStatus,
      triggerReason,
      isPrimary: false
    }
  }

  const longTarget = pickBestCluster(longAnchors, 'LONG')
  const shortTarget = pickBestCluster(shortAnchors, 'SHORT')

  const targets: SniperEntryTarget[] = []
  if (longTarget) targets.push(longTarget)
  if (shortTarget) targets.push(shortTarget)

  if (targets.length === 1) {
    targets[0].isPrimary = true
  } else if (targets.length === 2) {
    // Pick primary based on Triggered state, Whale Bias, or Confluence Count
    const [l, s] = targets
    const whaleBias = xrayData?.telemetry?.whale_bias_pct ?? 50
    if (l.triggerStatus === 'TRIGGERED' && s.triggerStatus !== 'TRIGGERED') {
      l.isPrimary = true
    } else if (s.triggerStatus === 'TRIGGERED' && l.triggerStatus !== 'TRIGGERED') {
      s.isPrimary = true
    } else if (whaleBias >= 55) {
      l.isPrimary = true
    } else if (whaleBias <= 45) {
      s.isPrimary = true
    } else if (Math.abs(l.distancePct) <= Math.abs(s.distancePct)) {
      l.isPrimary = true
    } else {
      s.isPrimary = true
    }
  }

  return targets
}
