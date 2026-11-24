import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  fetchWhaleSentimentMatrix,
  WhaleSentimentMatrixResponse
} from '../../services/api'
import {
  TrendingUp,
  TrendingDown,
  RefreshCw,
  X,
  Minimize2,
  Maximize2,
  Eye,
  Flame,
  AlertTriangle,
  Layers,
  Zap,
  Info
} from 'lucide-react'

interface WhaleSentimentHUDProps {
  symbol: string
  market: 'spot' | 'futures'
  isVisible?: boolean
  onClose?: () => void
}

type OpacityLevel = 'low' | 'medium' | 'high'

const OPACITY_CLASSES: Record<OpacityLevel, { panel: string; label: string; pct: string }> = {
  low: {
    panel: 'bg-[#0a0e17]/40 backdrop-blur-[3px] border-slate-700/30 text-slate-200',
    label: '40%',
    pct: 'Low'
  },
  medium: {
    panel: 'bg-[#0a0e17]/70 backdrop-blur-md border-slate-700/50 text-slate-100 shadow-2xl shadow-black/50',
    label: '70%',
    pct: 'Med'
  },
  high: {
    panel: 'bg-[#0d111a]/95 backdrop-blur-lg border-slate-700/80 text-white shadow-2xl shadow-black/80',
    label: '95%',
    pct: 'Solid'
  }
}

export const WhaleSentimentHUD: React.FC<WhaleSentimentHUDProps> = ({
  symbol,
  market = 'futures',
  isVisible = true,
  onClose
}) => {
  const [data, setData] = useState<WhaleSentimentMatrixResponse | null>(null)
  const [loading, setLoading] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [isMinimized, setIsMinimized] = useState<boolean>(false)
  const [opacity, setOpacity] = useState<OpacityLevel>('medium')
  const [showAdvice, setShowAdvice] = useState<boolean>(true)
  const [lastUpdate, setLastUpdate] = useState<string>('')

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    setError(null)
    try {
      const res = await fetchWhaleSentimentMatrix(symbol, market, '5m')
      setData(res)
      const d = new Date()
      setLastUpdate(
        `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`
      )
    } catch (err: any) {
      if (!silent) setError(err?.message || 'Gagal memuat data sentiment')
    } finally {
      if (!silent) setLoading(false)
    }
  }, [symbol, market])

  // Initial fetch and auto-refresh every 12 seconds
  useEffect(() => {
    loadData(false)
    const timer = setInterval(() => {
      loadData(true)
    }, 12000)
    return () => clearInterval(timer)
  }, [loadData])

  if (!isVisible) return null

  const cycleOpacity = () => {
    setOpacity((prev) => (prev === 'low' ? 'medium' : prev === 'medium' ? 'high' : 'low'))
  }

  const opacityConfig = OPACITY_CLASSES[opacity]

  // Render Dual Micro-Bar (% Long vs % Short)
  const renderDualBar = (longPct: number, shortPct: number) => {
    const lPct = Math.min(100, Math.max(0, longPct))
    const sPct = 100 - lPct

    return (
      <div className="w-full flex items-center space-x-1">
        <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden flex">
          <div
            style={{ width: `${lPct}%` }}
            className="h-full bg-emerald-500 transition-all duration-300"
          />
          <div
            style={{ width: `${sPct}%` }}
            className="h-full bg-rose-500 transition-all duration-300"
          />
        </div>
      </div>
    )
  }

  // Minimized Mode (Floating Compact Pill)
  if (isMinimized) {
    const whaleLong = data?.whale_position?.long_pct ?? 50
    const retailLong = data?.retail_accounts?.long_pct ?? 50
    const delta = data?.divergence_delta ?? 0
    const isBull = delta > 0

    return (
      <div
        className={`absolute top-12 right-3 z-30 flex items-center gap-2 px-3 py-1.5 rounded-xl border select-none transition-all duration-200 cursor-pointer ${opacityConfig.panel}`}
        onClick={() => setIsMinimized(false)}
        title="Klik untuk membuka tabel Whale Sentiment lengkap"
      >
        <span className="text-xs">🐋</span>
        <div className="flex items-center gap-1.5 text-[10px] font-mono font-semibold">
          <span className="text-slate-300">Paus: <b className="text-emerald-400">{whaleLong}% L</b></span>
          <span className="text-slate-500">|</span>
          <span className="text-slate-300">Ritel: <b className="text-rose-400">{retailLong}% L</b></span>
          <span className="text-slate-500">|</span>
          <span className={`px-1 py-0.2 rounded text-[9px] font-bold ${
            isBull ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
          }`}>
            {isBull ? '+' : ''}{delta}% Bias
          </span>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setIsMinimized(false)
          }}
          className="p-0.5 hover:text-white text-slate-400 transition-colors"
        >
          <Maximize2 className="w-3 h-3" />
        </button>
      </div>
    )
  }

  // Full Table Mode
  const isBullishDivergence = data?.regime === 'WHALE_LONG_DIVERGENCE'
  const isBearishDivergence = data?.regime === 'WHALE_SHORT_DIVERGENCE'
  const delta = data?.divergence_delta ?? 0

  return (
    <div
      className={`absolute top-12 right-3 z-30 w-72 rounded-xl border select-none transition-all duration-200 flex flex-col overflow-hidden text-xs ${opacityConfig.panel}`}
    >
      {/* 1. Header Bar with Controls */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-700/40 bg-black/20">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-sm">🐋</span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 font-bold text-white text-[11px] leading-tight">
              <span className="truncate">Whale vs Retail Matrix</span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse flex-shrink-0" />
            </div>
            <div className="text-[9px] font-mono text-slate-400 flex items-center gap-1.5">
              <span>{symbol} • {market.toUpperCase()}</span>
              {lastUpdate && <span className="text-emerald-400 font-semibold">• {lastUpdate}</span>}
            </div>
          </div>
        </div>

        {/* Control Icons: Opacity, Refresh, Minimize, Close */}
        <div className="flex items-center gap-1 text-slate-400">
          <button
            type="button"
            onClick={cycleOpacity}
            title={`Ganti Opacity Transparansi (Saat ini: ${opacityConfig.pct})`}
            className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-slate-800/60 hover:bg-slate-700/80 text-slate-300 border border-slate-700/50 transition-colors flex items-center gap-0.5"
          >
            <Eye className="w-2.5 h-2.5 text-cyan-400" />
            <span>{opacityConfig.label}</span>
          </button>

          <button
            type="button"
            onClick={() => loadData(false)}
            disabled={loading}
            title="Refresh Data Live"
            className="p-1 hover:text-white rounded hover:bg-slate-800/50 transition-colors"
          >
            <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin text-amber-400' : ''}`} />
          </button>

          <button
            type="button"
            onClick={() => setIsMinimized(true)}
            title="Perkecil ke Bar Sederhana"
            className="p-1 hover:text-white rounded hover:bg-slate-800/50 transition-colors"
          >
            <Minimize2 className="w-3 h-3" />
          </button>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              title="Tutup Panel"
              className="p-1 hover:text-rose-400 rounded hover:bg-slate-800/50 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>

      {/* 2. Sentiment Matrix Table */}
      <div className="p-2.5 space-y-2.5 text-[11px]">
        {/* Status / Regime Pill */}
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">
            Rezim Smart Money:
          </span>
          <span
            className={`px-2 py-0.5 rounded text-[9.5px] font-mono font-bold border ${
              isBullishDivergence
                ? 'bg-emerald-950/70 text-emerald-300 border-emerald-500/50 animate-pulse'
                : isBearishDivergence
                ? 'bg-rose-950/70 text-rose-300 border-rose-500/50 animate-pulse'
                : delta > 0
                ? 'bg-emerald-950/40 text-emerald-400 border-emerald-700/40'
                : 'bg-slate-800/60 text-slate-300 border-slate-700/50'
            }`}
          >
            {data?.badge_label || 'MEMUAT...'}
          </span>
        </div>

        {/* Mini Table Rows */}
        <div className="space-y-2 bg-black/25 p-2 rounded-lg border border-slate-700/30 text-[10.5px]">
          {/* Row 1: Paus Posisi (Whale Contract Volume) */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-slate-300">
              <span className="font-semibold flex items-center gap-1">
                <b className="text-white">Paus Posisi</b> (Kontrak):
              </span>
              <div className="flex items-center gap-1.5 font-mono">
                <span className="text-emerald-400 font-bold">
                  {data?.whale_position?.long_pct ?? 50}% L
                </span>
                <span className="text-slate-500">/</span>
                <span className="text-rose-400 font-bold">
                  {data?.whale_position?.short_pct ?? 50}% S
                </span>
                <span className="text-[9px] text-slate-400">
                  ({data?.whale_position?.ratio ?? 1.0}x)
                </span>
                {data?.whale_position?.delta_30m !== undefined && data.whale_position.delta_30m !== 0 && (
                  <span
                    className={`text-[9px] font-bold ${
                      data.whale_position.delta_30m > 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {data.whale_position.delta_30m > 0 ? '▲' : '▼'}
                    {Math.abs(data.whale_position.delta_30m)}%
                  </span>
                )}
              </div>
            </div>
            {renderDualBar(data?.whale_position?.long_pct ?? 50, data?.whale_position?.short_pct ?? 50)}
          </div>

          {/* Row 2: Paus Akun (Top Trader Accounts) */}
          <div className="space-y-1 pt-1 border-t border-slate-800/60">
            <div className="flex items-center justify-between text-slate-300">
              <span className="font-semibold flex items-center gap-1">
                <b className="text-white">Paus Akun</b> (Traders):
              </span>
              <div className="flex items-center gap-1.5 font-mono">
                <span className="text-emerald-400 font-semibold">
                  {data?.whale_accounts?.long_pct ?? 50}% L
                </span>
                <span className="text-slate-500">/</span>
                <span className="text-rose-400 font-semibold">
                  {data?.whale_accounts?.short_pct ?? 50}% S
                </span>
                <span className="text-[9px] text-slate-400">
                  ({data?.whale_accounts?.ratio ?? 1.0}x)
                </span>
              </div>
            </div>
            {renderDualBar(data?.whale_accounts?.long_pct ?? 50, data?.whale_accounts?.short_pct ?? 50)}
          </div>

          {/* Row 3: Retail Publik (Global Accounts) */}
          <div className="space-y-1 pt-1 border-t border-slate-800/60">
            <div className="flex items-center justify-between text-slate-300">
              <span className="font-semibold flex items-center gap-1">
                <b className="text-white">Ritel Publik</b> (Global):
              </span>
              <div className="flex items-center gap-1.5 font-mono">
                <span className="text-emerald-400 font-semibold">
                  {data?.retail_accounts?.long_pct ?? 50}% L
                </span>
                <span className="text-slate-500">/</span>
                <span className="text-rose-400 font-semibold">
                  {data?.retail_accounts?.short_pct ?? 50}% S
                </span>
                <span className="text-[9px] text-slate-400">
                  ({data?.retail_accounts?.ratio ?? 1.0}x)
                </span>
                {data?.retail_accounts?.delta_30m !== undefined && data.retail_accounts.delta_30m !== 0 && (
                  <span
                    className={`text-[9px] font-bold ${
                      data.retail_accounts.delta_30m > 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {data.retail_accounts.delta_30m > 0 ? '▲' : '▼'}
                    {Math.abs(data.retail_accounts.delta_30m)}%
                  </span>
                )}
              </div>
            </div>
            {renderDualBar(data?.retail_accounts?.long_pct ?? 50, data?.retail_accounts?.short_pct ?? 50)}
          </div>

          {/* Row 4: Taker Volume (Market Order Aggression) */}
          <div className="space-y-1 pt-1 border-t border-slate-800/60">
            <div className="flex items-center justify-between text-slate-300">
              <span className="font-semibold flex items-center gap-1">
                <b className="text-white">Taker Order</b> (Agresi):
                <span className="text-[8px] px-1 py-0.2 rounded bg-amber-500/15 text-amber-300 font-bold border border-amber-500/30">
                  Realtime
                </span>
              </span>
              <div className="flex items-center gap-1.5 font-mono">
                <span className="text-emerald-400 font-semibold">
                  {data?.taker_aggression?.buy_pct ?? 50}% Beli
                </span>
                <span className="text-slate-500">/</span>
                <span className="text-rose-400 font-semibold">
                  {data?.taker_aggression?.sell_pct ?? 50}% Jual
                </span>
                <span className="text-[9px] text-slate-400">
                  ({data?.taker_aggression?.ratio ?? 1.0}x)
                </span>
              </div>
            </div>
            {renderDualBar(data?.taker_aggression?.buy_pct ?? 50, data?.taker_aggression?.sell_pct ?? 50)}
          </div>
        </div>

        {/* 3. Actionable Advice / Insight Callout */}
        {showAdvice && data?.action_advice && (
          <div className="p-2 rounded-lg bg-black/30 border border-slate-700/30 text-[10px] leading-relaxed text-slate-300">
            <div className="flex items-center justify-between text-amber-400 font-bold mb-0.5">
              <span className="flex items-center gap-1">
                <Zap className="w-3 h-3 text-amber-400" />
                <span>Insight Smart Money:</span>
              </span>
              <span className="font-mono text-[9px] text-slate-400">
                Akurasi: <b className="text-amber-400">{data.confidence}%</b>
              </span>
            </div>
            <p className="text-slate-300 text-[9.5px]">
              {data.action_advice}
            </p>
          </div>
        )}

        {/* 4. Footer: Live Sync Status & Binance 5m Snapshot info */}
        <div className="flex items-center justify-between text-[8.5px] font-mono text-slate-500 pt-1 border-t border-slate-800/60">
          <div className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block" />
            <span className="text-slate-400">Snapshot 5m Binance</span>
          </div>
          <span title="Data rasio posisi Binance diperbarui per interval 5 menit. Auto-poll setiap 12 detik.">
            Auto-Sync 12s
          </span>
        </div>
      </div>
    </div>
  )
}
