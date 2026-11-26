import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Candle,
  TrendStrengthMetrics,
  TradeAccountMode,
  TradePositionItem
} from '../../types/analysis'
import { MarketXrayData } from '../../types/marketXray'
import {
  fetchOpenPositions,
  fetchMarketXray,
  setPositionBrackets,
  closeTradePosition
} from '../../services/api'
import { getStoredCredentials } from '../Settings/ApiCredentialsModal'
import { formatPrice, formatOpenInterestValue, formatCompactDeltaUsd } from '../../utils/formatters'
import {
  Shield,
  ShieldAlert,
  TrendingUp,
  TrendingDown,
  Eye,
  Minimize2,
  Maximize2,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle
} from 'lucide-react'

interface InTradeCopilotHUDProps {
  symbol: string
  market: 'spot' | 'futures'
  candles: Candle[]
  trendStrength?: TrendStrengthMetrics | null
  isVisible?: boolean
}

type OpacityLevel = 'low' | 'medium' | 'high'

const OPACITY_CLASSES: Record<OpacityLevel, { panel: string; label: string; pct: string }> = {
  low: {
    panel: 'bg-[#0a0e17]/40 backdrop-blur-[3px] border-slate-700/30 text-slate-200',
    label: '40%',
    pct: 'Low'
  },
  medium: {
    panel: 'bg-[#0a0e17]/75 backdrop-blur-md border-slate-700/50 text-slate-100 shadow-2xl shadow-black/50',
    label: '70%',
    pct: 'Med'
  },
  high: {
    panel: 'bg-[#0d111a]/95 backdrop-blur-lg border-slate-700/80 text-white shadow-2xl shadow-black/80',
    label: '95%',
    pct: 'Solid'
  }
}

export const InTradeCopilotHUD: React.FC<InTradeCopilotHUDProps> = ({
  symbol,
  market = 'futures',
  candles,
  trendStrength,
  isVisible = true
}) => {
  const [mode, setMode] = useState<TradeAccountMode>(() => {
    try {
      const saved = localStorage.getItem('cp_trade_active_mode')
      return saved === 'live' ? 'live' : 'demo'
    } catch {
      return 'demo'
    }
  })

  const [activePos, setActivePos] = useState<TradePositionItem | null>(null)
  const [xray, setXray] = useState<MarketXrayData | null>(null)
  const [isMinimized, setIsMinimized] = useState<boolean>(false)
  const [opacity, setOpacity] = useState<OpacityLevel>('medium')
  const [actionBusy, setActionBusy] = useState<boolean>(false)
  const [confirmClose, setConfirmClose] = useState<boolean>(false)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    const handleModeSync = (e: any) => {
      const nextMode = e?.detail === 'live' ? 'live' : 'demo'
      setMode(nextMode)
    }
    window.addEventListener('cp_trade_mode_change', handleModeSync)
    return () => window.removeEventListener('cp_trade_mode_change', handleModeSync)
  }, [])

  const loadPositionAndXray = useCallback(async () => {
    if (!isVisible) return
    const creds = getStoredCredentials()
    const apiKey = mode === 'demo' ? creds.demoApiKey : creds.liveApiKey
    const apiSecret = mode === 'demo' ? creds.demoApiSecret : creds.liveApiSecret

    try {
      const posRes = await fetchOpenPositions(market, mode, apiKey, apiSecret, symbol)
      if (posRes && posRes.success && Array.isArray(posRes.positions)) {
        const match = posRes.positions.find(
          (p: TradePositionItem) =>
            p.symbol?.toUpperCase() === symbol.toUpperCase() && Math.abs(p.positionAmt || 0) > 0
        )
        setActivePos(match || null)

        if (match) {
          try {
            const xrayRes = await fetchMarketXray(symbol, market)
            setXray(xrayRes)
          } catch {
            // Keep previous xray if transient error
          }
        }
      } else {
        setActivePos(null)
      }
    } catch {
      // Silent fail on background poll
    }
  }, [symbol, market, mode, isVisible])

  useEffect(() => {
    setConfirmClose(false)
    setNotice(null)
    loadPositionAndXray()
    const timer = setInterval(loadPositionAndXray, 12000)
    return () => clearInterval(timer)
  }, [loadPositionAndXray])

  // Compute live Candle Net-Delta & Absorption on latest bar
  const liveCandleStats = useMemo(() => {
    if (!candles || candles.length === 0) return null
    const c = candles[candles.length - 1]
    const vol = c.volume || 0
    const hasTaker = typeof c.taker_buy_volume === 'number' && c.taker_buy_volume >= 0 && c.taker_buy_volume <= vol
    const buyVol = hasTaker ? c.taker_buy_volume : (c.close >= c.open ? vol * 0.55 : vol * 0.45)
    const sellVol = Math.max(0, vol - buyVol)
    const netDeltaUsd = (buyVol - sellVol) * (c.close || 1)
    const buyPct = vol > 0 ? (buyVol / vol) * 100 : 50
    const isBullCandle = c.close >= c.open
    const isBearishAbsorption = isBullCandle && netDeltaUsd < 0 && 100 - buyPct >= 54
    const isBullishAbsorption = !isBullCandle && netDeltaUsd > 0 && buyPct >= 54
    return {
      netDeltaUsd,
      buyPct,
      isBullishAbsorption,
      isBearishAbsorption
    }
  }, [candles])

  // Tactical Decision Engine
  const tactical = useMemo(() => {
    if (!activePos) return null

    const isLong = activePos.side === 'LONG'
    const entry = activePos.entryPrice
    const mark = activePos.markPrice || (candles.length > 0 ? candles[candles.length - 1].close : entry)
    // True breakeven includes ~0.10% round-trip taker fee buffer
    const bePrice = isLong ? entry * 1.001 : entry * 0.999

    const isSlSecured = isLong
      ? activePos.stopLoss != null && activePos.stopLoss >= bePrice * 0.9995
      : activePos.stopLoss != null && activePos.stopLoss <= bePrice * 1.0005

    const cvdRegime = xray?.spot_vs_futures?.regime || 'NEUTRAL'
    const oiRegime = xray?.oi_regime?.regime || 'NEUTRAL'
    const trendDir = trendStrength?.direction || 'NEUTRAL'
    const trendScore = trendStrength?.score ?? 50

    // Nearest opposing whale wall & liquidation magnet
    const opposingWalls = isLong
      ? (xray?.whale_fortress?.ask_walls || []).filter((w) => w.price > mark).sort((a, b) => a.price - b.price)
      : (xray?.whale_fortress?.bid_walls || []).filter((w) => w.price < mark).sort((a, b) => b.price - a.price)

    const nearestWall = opposingWalls[0] || null
    const wallDistPct = nearestWall ? Math.abs(((nearestWall.price - mark) / mark) * 100) : null

    const magnet = isLong ? xray?.stop_loss_pools?.short_sl_magnet : xray?.stop_loss_pools?.long_sl_cascade
    const magnetDistPct = magnet ? Math.abs(((magnet.price - mark) / mark) * 100) : null

    // Evaluate Verdict
    let status: 'HOLD' | 'SECURE' | 'WARNING' = 'HOLD'
    let badgeText = '🟢 AMAN HOLD'
    const reasons: string[] = []

    const dangerByFlow = isLong
      ? cvdRegime === 'SPOT_DISTRIBUTION_BEARISH' || oiRegime === 'LONG_LIQUIDATION_FLUSH' || liveCandleStats?.isBearishAbsorption
      : cvdRegime === 'SPOT_ABSORPTION_BULLISH' || oiRegime === 'SHORT_COVERING_SQUEEZE' || liveCandleStats?.isBullishAbsorption

    const dangerByTrend =
      (isLong && trendDir === 'BEARISH' && activePos.roePct < 0) ||
      (!isLong && trendDir === 'BULLISH' && activePos.roePct < 0)

    if (dangerByFlow || dangerByTrend) {
      status = 'WARNING'
      badgeText = '🔴 AWAS REVERSAL'
      if (liveCandleStats?.isBearishAbsorption && isLong) {
        reasons.push(`⚡ Bearish Absorption pada candle berjalan (Δ ${formatCompactDeltaUsd(liveCandleStats.netDeltaUsd)})`)
      } else if (liveCandleStats?.isBullishAbsorption && !isLong) {
        reasons.push(`⚡ Bullish Absorption pada candle berjalan (Δ ${formatCompactDeltaUsd(liveCandleStats.netDeltaUsd)})`)
      }
      if (cvdRegime === 'SPOT_DISTRIBUTION_BEARISH' && isLong) {
        reasons.push('Spot vs Futures CVD masuk mode Distribusi Bearish')
      } else if (oiRegime === 'LONG_LIQUIDATION_FLUSH' && isLong) {
        reasons.push('Terdeteksi Long Liquidation Flush pada Open Interest')
      }
      if (dangerByTrend) {
        reasons.push(`Tren utama berbalik ${trendDir} (${trendScore.toFixed(0)}%)`)
      }
    } else if (
      (activePos.roePct >= 10 && !isSlSecured) ||
      (wallDistPct !== null && wallDistPct <= 0.85) ||
      (magnetDistPct !== null && magnetDistPct <= 0.6)
    ) {
      status = 'SECURE'
      badgeText = activePos.roePct >= 10 && !isSlSecured ? '🟡 AMANKAN BE+' : '🟡 DEKAT TARGET / WALL'
      if (activePos.roePct >= 10 && !isSlSecured) {
        reasons.push(`Profit +${activePos.roePct.toFixed(1)}% tanpa SL aman. Geser SL ke BE+ ($${formatPrice(bePrice)})`)
      }
      if (nearestWall && wallDistPct !== null && wallDistPct <= 1.5) {
        reasons.push(
          `Tembok ${isLong ? 'Ask' : 'Bid'} Paus $${formatPrice(nearestWall.price)} (${formatOpenInterestValue(nearestWall.usd_value)})`
        )
      }
    } else {
      status = 'HOLD'
      badgeText = '🟢 AMAN HOLD'
      reasons.push(`Tren ${trendDir} (${trendScore.toFixed(0)}%) • CVD: ${cvdRegime.replace(/_/g, ' ')}`)
      if (nearestWall) {
        reasons.push(
          `Target Wall: $${formatPrice(nearestWall.price)} (${formatOpenInterestValue(nearestWall.usd_value)})`
        )
      }
    }

    if (magnet && reasons.length < 3) {
      reasons.push(`Magnet Liq: $${formatPrice(magnet.price)} (${isLong ? '+' : '-'}${Math.abs(magnet.distance_pct)}%)`)
    }

    if (!activePos.stopLoss && status !== 'WARNING') {
      reasons.push(`⚠️ SL belum terpasang! True BE: $${formatPrice(bePrice)}`)
    }

    return {
      isLong,
      bePrice,
      isSlSecured,
      status,
      badgeText,
      reasons: reasons.slice(0, 3)
    }
  }, [activePos, xray, trendStrength, liveCandleStats, candles])

  // Auto-hide completely when user has NO active position on this symbol
  if (!isVisible || !activePos || !tactical) return null

  const opacityConfig = OPACITY_CLASSES[opacity]
  const cycleOpacity = () => {
    setOpacity((prev) => (prev === 'low' ? 'medium' : prev === 'medium' ? 'high' : 'low'))
  }

  const handleMoveSlToBe = async () => {
    if (actionBusy) return
    setActionBusy(true)
    setNotice(null)
    try {
      const creds = getStoredCredentials()
      const apiKey = mode === 'demo' ? creds.demoApiKey : creds.liveApiKey
      const apiSecret = mode === 'demo' ? creds.demoApiSecret : creds.liveApiSecret
      const precision = tactical.bePrice >= 100 ? 2 : tactical.bePrice >= 1 ? 3 : 5
      const cleanBe = Number(tactical.bePrice.toFixed(precision))
      const res = await setPositionBrackets(
        activePos.symbol,
        cleanBe,
        activePos.takeProfit ?? null,
        market,
        mode,
        apiKey,
        apiSecret
      )
      if (res.success) {
        setNotice(`SL aman dipasang di $${cleanBe}`)
        await loadPositionAndXray()
      } else {
        setNotice(res.message || 'Gagal memasang SL BE+')
      }
    } catch (e: any) {
      setNotice(e?.message || 'Error memasang SL BE+')
    } finally {
      setActionBusy(false)
    }
  }

  const handleClosePosition = async () => {
    if (!confirmClose) {
      setConfirmClose(true)
      return
    }
    if (actionBusy) return
    setActionBusy(true)
    setNotice(null)
    try {
      const creds = getStoredCredentials()
      const apiKey = mode === 'demo' ? creds.demoApiKey : creds.liveApiKey
      const apiSecret = mode === 'demo' ? creds.demoApiSecret : creds.liveApiSecret
      const res = await closeTradePosition(activePos.symbol, market, mode, apiKey, apiSecret)
      if (res.success) {
        setActivePos(null)
        setConfirmClose(false)
      } else {
        setNotice(res.message || 'Gagal menutup posisi')
      }
    } catch (e: any) {
      setNotice(e?.message || 'Error menutup posisi')
    } finally {
      setActionBusy(false)
    }
  }

  const isProfit = activePos.unrealizedProfit >= 0

  // Minimized Compact Pill
  if (isMinimized) {
    return (
      <div
        onClick={() => setIsMinimized(false)}
        className={`absolute top-12 left-3 z-30 flex items-center gap-2 px-3 py-1.5 rounded-xl border select-none transition-all cursor-pointer ${opacityConfig.panel}`}
        title="Klik untuk membuka Tactical Copilot"
      >
        <Shield className="w-3.5 h-3.5 text-amber-400" />
        <div className="flex items-center gap-1.5 text-[10px] font-mono font-bold">
          <span className={tactical.isLong ? 'text-emerald-400' : 'text-rose-400'}>
            {activePos.side} {activePos.leverage}x
          </span>
          <span className="text-slate-500">|</span>
          <span className={isProfit ? 'text-emerald-400' : 'text-rose-400'}>
            {isProfit ? '+' : ''}${activePos.unrealizedProfit.toFixed(2)} ({activePos.roePct.toFixed(1)}%)
          </span>
          <span className="text-slate-500">|</span>
          <span>{tactical.badgeText}</span>
        </div>
        <Maximize2 className="w-3 h-3 text-slate-400" />
      </div>
    )
  }

  return (
    <div
      className={`absolute top-12 left-3 z-30 w-72 rounded-xl border select-none transition-all duration-200 flex flex-col overflow-hidden text-xs ${opacityConfig.panel}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700/40 bg-black/25">
        <div className="flex items-center gap-1.5 min-w-0">
          {tactical.status === 'WARNING' ? (
            <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0 animate-pulse" />
          ) : (
            <Shield className="w-4 h-4 text-amber-400 shrink-0" />
          )}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 font-bold text-white text-[11px] leading-tight">
              <span className="truncate">Tactical Copilot</span>
              <span
                className={`text-[9px] px-1 rounded font-mono ${
                  mode === 'live'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                    : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                }`}
              >
                {mode.toUpperCase()}
              </span>
            </div>
            <div className="text-[9px] font-mono text-slate-400 flex items-center gap-1">
              <span className={tactical.isLong ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                {activePos.symbol} {activePos.side} {activePos.leverage}x
              </span>
              <span>•</span>
              <span>Entry ${formatPrice(activePos.entryPrice)}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 text-slate-400">
          <button
            type="button"
            onClick={cycleOpacity}
            title={`Ganti Opacity (${opacityConfig.pct})`}
            className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-slate-800/60 hover:bg-slate-700/80 text-slate-300 border border-slate-700/50 flex items-center gap-0.5"
          >
            <Eye className="w-2.5 h-2.5 text-cyan-400" />
            <span>{opacityConfig.label}</span>
          </button>
          <button
            type="button"
            onClick={loadPositionAndXray}
            title="Refresh Status Copilot"
            className="p-1 hover:text-white rounded hover:bg-slate-800/50"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={() => setIsMinimized(true)}
            title="Perkecil"
            className="p-1 hover:text-white rounded hover:bg-slate-800/50"
          >
            <Minimize2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="p-2.5 space-y-2 text-[10.5px]">
        {/* PnL & Status Badge Row */}
        <div className="flex items-center justify-between bg-black/30 px-2.5 py-1.5 rounded-lg border border-slate-800/70">
          <div>
            <div className="text-[9px] text-slate-400 font-mono">Unrealized PnL</div>
            <div className={`font-mono font-extrabold text-xs ${isProfit ? 'text-emerald-400' : 'text-rose-400'}`}>
              {isProfit ? '+' : ''}${activePos.unrealizedProfit.toFixed(2)}{' '}
              <span className="text-[10px]">({isProfit ? '+' : ''}{activePos.roePct.toFixed(1)}%)</span>
            </div>
          </div>
          <span
            className={`px-2 py-0.5 rounded text-[9.5px] font-mono font-bold border ${
              tactical.status === 'WARNING'
                ? 'bg-rose-950/70 text-rose-300 border-rose-500/60 animate-pulse'
                : tactical.status === 'SECURE'
                  ? 'bg-amber-950/70 text-amber-300 border-amber-500/50'
                  : 'bg-emerald-950/60 text-emerald-300 border-emerald-500/40'
            }`}
          >
            {tactical.badgeText}
          </span>
        </div>

        {/* Tactical Reasons */}
        <div className="space-y-1 bg-black/20 p-2 rounded-lg border border-slate-800/50">
          {tactical.reasons.map((r, idx) => (
            <div key={idx} className="flex items-start gap-1.5 text-[9.5px] text-slate-300 leading-snug">
              {tactical.status === 'WARNING' ? (
                <AlertTriangle className="w-3 h-3 text-rose-400 shrink-0 mt-0.5" />
              ) : tactical.status === 'SECURE' ? (
                <CheckCircle2 className="w-3 h-3 text-amber-400 shrink-0 mt-0.5" />
              ) : tactical.isLong ? (
                <TrendingUp className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <TrendingDown className="w-3 h-3 text-rose-400 shrink-0 mt-0.5" />
              )}
              <span>{r}</span>
            </div>
          ))}
        </div>

        {/* Quick 1-Click Actions */}
        <div className="flex items-center gap-1.5 pt-0.5">
          {activePos.unrealizedProfit > 0 && !tactical.isSlSecured && (
            <button
              type="button"
              disabled={actionBusy}
              onClick={handleMoveSlToBe}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 text-amber-300 font-mono font-bold text-[10px] transition-colors cursor-pointer disabled:opacity-50"
              title="Pasang Stop Loss otomatis di titik Breakeven + Fee (0.10%)"
            >
              <Shield className="w-3 h-3" />
              <span>SL ke BE+ (${formatPrice(tactical.bePrice)})</span>
            </button>
          )}

          {tactical.isSlSecured && (
            <div className="flex-1 flex items-center justify-center gap-1 py-1.5 px-2 rounded-lg bg-emerald-950/40 border border-emerald-700/40 text-emerald-300 font-mono font-bold text-[9.5px]">
              <CheckCircle2 className="w-3 h-3" />
              <span>SL Aman (${formatPrice(activePos.stopLoss)})</span>
            </div>
          )}

          <button
            type="button"
            disabled={actionBusy}
            onClick={handleClosePosition}
            onMouseLeave={() => setConfirmClose(false)}
            className={`px-2.5 py-1.5 rounded-lg border font-mono font-bold text-[10px] transition-colors cursor-pointer flex items-center gap-1 disabled:opacity-50 ${
              confirmClose
                ? 'bg-rose-600 hover:bg-rose-500 border-rose-400 text-white animate-pulse'
                : 'bg-rose-950/50 hover:bg-rose-900/60 border-rose-700/50 text-rose-300'
            }`}
            title="Tutup posisi penuh di harga Market sekarang"
          >
            <XCircle className="w-3 h-3" />
            <span>{confirmClose ? 'Konfirmasi?' : 'Close'}</span>
          </button>
        </div>

        {notice && (
          <div className="text-[9.5px] font-mono text-cyan-300 bg-cyan-950/40 border border-cyan-800/40 px-2 py-1 rounded text-center">
            {notice}
          </div>
        )}
      </div>
    </div>
  )
}
