import React, { useState, useEffect, useRef } from 'react'
import {
  X,
  RefreshCw,
  Sliders,
  ShieldAlert,
  Flame,
  ArrowUpRight,
  ArrowDownRight,
  Activity,
  Layers,
  Database,
  CheckCircle2,
  AlertTriangle
} from 'lucide-react'
import { LiquidityMatrixResponse, LiquidityMatrixRow } from '../../types/liquidityMatrix'
import { fetchLiquidityMatrix } from '../../services/api'
import { formatPrice } from '../../utils/formatters'

interface LiquidityMatrixModalProps {
  isOpen: boolean
  onClose: () => void
  symbol: string
  market?: 'spot' | 'futures'
}

type FilterMode = 'ALL' | 'INST_ONLY' | 'SL_ONLY'

export const LiquidityMatrixModal: React.FC<LiquidityMatrixModalProps> = ({
  isOpen,
  onClose,
  symbol,
  market = 'futures'
}) => {
  const [data, setData] = useState<LiquidityMatrixResponse | null>(null)
  const [loading, setLoading] = useState<boolean>(false)
  const [autoRefresh, setAutoRefresh] = useState<boolean>(true)
  const [filterMode, setFilterMode] = useState<FilterMode>('ALL')
  const [lastUpdated, setLastUpdated] = useState<string>('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const refreshTimerRef = useRef<any>(null)

  const loadData = async (isBackground = false) => {
    if (!isBackground) setLoading(true)
    setErrorMsg(null)
    try {
      const res = await fetchLiquidityMatrix(symbol, market, 24)
      setData(res)
      const d = new Date()
      setLastUpdated(d.toLocaleTimeString())
    } catch (err: any) {
      console.error('Failed to load liquidity matrix:', err)
      setErrorMsg(err.message || 'Gagal memuat data buku order Binance')
    } finally {
      if (!isBackground) setLoading(false)
    }
  }

  // Initial load when modal opens
  useEffect(() => {
    if (isOpen) {
      loadData(false)
    } else {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current)
    }
  }, [isOpen, symbol, market])

  // Auto-refresh timer every 3.5 seconds
  useEffect(() => {
    if (isOpen && autoRefresh) {
      refreshTimerRef.current = setInterval(() => {
        loadData(true)
      }, 3500)
    } else {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current)
    }
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current)
    }
  }, [isOpen, autoRefresh, symbol, market])

  if (!isOpen) return null

  const formatMillions = (val: number): string => {
    if (!val || isNaN(val)) return '$0'
    if (val >= 1e9) return `$${(val / 1e9).toFixed(2)}B`
    if (val >= 1e6) return `$${(val / 1e6).toFixed(2)}M`
    if (val >= 1e3) return `$${(val / 1e3).toFixed(1)}K`
    return `$${val.toFixed(0)}`
  }

  const currentPrice = data?.current_price || 0
  const summary = data?.summary
  const rows = data?.matrix_rows || []

  // Max value calculation for bar fill scaling
  const maxTotalUsd = Math.max(1, ...rows.map((r) => r.total_usd))

  // Filter rows based on user selection
  const filteredRows = rows.filter((r) => {
    if (filterMode === 'INST_ONLY') return r.inst_usd >= 100000 || r.whale_count > 0
    if (filterMode === 'SL_ONLY') return r.has_stop_loss && r.sl_usd > 0
    return true
  })

  // Separate into Asks (above price) and Bids (below price)
  const askRows = filteredRows.filter((r) => r.side === 'ASK')
  const bidRows = filteredRows.filter((r) => r.side === 'BID')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-150">
      <div
        className="w-full max-w-5xl max-h-[92vh] bg-[#0d1117] border border-[#30363d] rounded-2xl shadow-2xl flex flex-col overflow-hidden text-slate-100 font-sans"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ========================================================================= */}
        {/* Header */}
        {/* ========================================================================= */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#161b22] border-b border-[#21262d] shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="p-1.5 rounded-lg bg-amber-500/10 border border-amber-500/30 text-[#f0b90b]">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-extrabold text-sm sm:text-base text-white font-mono tracking-wide">
                  REAL-TIME ORDER & STOP LOSS MATRIX (DOM)
                </span>
                <span className="px-2 py-0.5 rounded bg-amber-500/20 text-[#f0b90b] border border-amber-500/40 text-[10px] font-mono font-bold">
                  {symbol}
                </span>
                <span className="px-1.5 py-0.5 rounded bg-sky-950 text-sky-400 border border-sky-800 text-[10px] uppercase font-mono">
                  {market}
                </span>
              </div>
              <div className="text-[11px] text-slate-400 flex items-center space-x-2 mt-0.5">
                <span>100% Data Mentah Buku Order Binance L2</span>
                <span>•</span>
                <span>Whale Orders (≥$50k) vs Ritel</span>
                <span>•</span>
                <span>Titik Likuidasi Margin Riil</span>
              </div>
            </div>
          </div>

          <div className="flex items-center space-x-2 shrink-0">
            {/* Auto Refresh Toggle */}
            <button
              type="button"
              onClick={() => setAutoRefresh((prev) => !prev)}
              className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold border transition-all cursor-pointer ${
                autoRefresh
                  ? 'bg-emerald-950/60 text-emerald-300 border-emerald-700/60 shadow-sm'
                  : 'bg-[#18202d] text-slate-400 border-[#2b3548] hover:text-white'
              }`}
              title="Refresh otomatis data buku order setiap 3.5 detik"
            >
              <span className={`w-2 h-2 rounded-full ${autoRefresh ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
              <span>{autoRefresh ? 'Live Feed (3.5s)' : 'Paused'}</span>
            </button>

            {/* Manual Refresh */}
            <button
              type="button"
              onClick={() => loadData(false)}
              disabled={loading}
              className="p-1.5 rounded-md bg-[#18202d] hover:bg-[#222d3d] text-slate-300 hover:text-white border border-[#2b3548] transition-all cursor-pointer disabled:opacity-50"
              title="Muat ulang data buku order"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-[#f0b90b]' : ''}`} />
            </button>

            {/* Close Button */}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-md bg-[#18202d] hover:bg-rose-950/50 text-slate-400 hover:text-rose-300 border border-[#2b3548] hover:border-rose-800/50 transition-all cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* Top Summary Cards (Whale Walls, Imbalance, Major SL Clusters) */}
        {/* ========================================================================= */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5 p-3 bg-[#0e131b] border-b border-[#21262d] shrink-0 text-xs">
          {/* Card 1: Top Whale Ask Wall */}
          <div className="p-2.5 rounded-xl bg-[#131924] border border-rose-900/30 flex flex-col justify-between">
            <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center justify-between">
              <span>🐋 Dinding Jual Paus (Asks)</span>
              <span className="text-rose-400 font-mono">+{summary?.top_whale_ask.distance_pct || 0}%</span>
            </div>
            <div className="mt-1">
              <div className="text-base font-extrabold text-rose-400 font-mono">
                ${formatPrice(summary?.top_whale_ask.price || 0)}
              </div>
              <div className="text-[11px] text-slate-300 font-mono mt-0.5 font-bold">
                {formatMillions(summary?.top_whale_ask.usd_value || 0)} antre jual
              </div>
            </div>
            <div className="text-[9.5px] text-slate-500 mt-1">Benteng resistensi uang nyata</div>
          </div>

          {/* Card 2: Top Whale Bid Wall */}
          <div className="p-2.5 rounded-xl bg-[#131924] border border-emerald-900/30 flex flex-col justify-between">
            <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center justify-between">
              <span>🐋 Dinding Beli Paus (Bids)</span>
              <span className="text-emerald-400 font-mono">{summary?.top_whale_bid.distance_pct || 0}%</span>
            </div>
            <div className="mt-1">
              <div className="text-base font-extrabold text-emerald-400 font-mono">
                ${formatPrice(summary?.top_whale_bid.price || 0)}
              </div>
              <div className="text-[11px] text-slate-300 font-mono mt-0.5 font-bold">
                {formatMillions(summary?.top_whale_bid.usd_value || 0)} antre beli
              </div>
            </div>
            <div className="text-[9.5px] text-slate-500 mt-1">Benteng pertahanan beli nyata</div>
          </div>

          {/* Card 3: Imbalance & Volume Breakdown */}
          <div className="p-2.5 rounded-xl bg-[#131924] border border-[#2b3548] flex flex-col justify-between">
            <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center justify-between">
              <span>Dominasi Buku Order</span>
              <span className="text-amber-400 font-mono font-bold">
                {summary?.imbalance_ratio ? `${summary.imbalance_ratio}x` : '1.0x'}
              </span>
            </div>
            <div className="mt-1">
              <div className="text-sm font-extrabold font-mono flex items-center space-x-1.5">
                <span className="text-emerald-400">{formatMillions(summary?.total_inst_bids_usd || 0)}</span>
                <span className="text-slate-500">vs</span>
                <span className="text-rose-400">{formatMillions(summary?.total_inst_asks_usd || 0)}</span>
              </div>
              <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                Ritel: {formatMillions(summary?.total_retail_bids_usd || 0)} (B) / {formatMillions(summary?.total_retail_asks_usd || 0)} (S)
              </div>
            </div>
            <div className="text-[9.5px] text-amber-300 font-mono mt-1 font-bold">
              {summary?.dominant_pressure.replace(/_/g, ' ') || 'NEUTRAL'}
            </div>
          </div>

          {/* Card 4: Major Stop Loss & Squeeze Target */}
          <div className="p-2.5 rounded-xl bg-[#131924] border border-amber-900/30 flex flex-col justify-between">
            <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider flex items-center space-x-1">
              <Flame className="w-3.5 h-3.5 text-amber-400" />
              <span>Target Squeeze Likuidasi (SL)</span>
            </div>
            <div className="mt-1 space-y-1">
              {data?.major_stop_loss_clusters && data.major_stop_loss_clusters.length > 0 ? (
                data.major_stop_loss_clusters.slice(0, 2).map((c, idx) => (
                  <div key={idx} className="flex items-center justify-between text-[10.5px] font-mono">
                    <span className={c.side === 'SHORT_LIQ' ? 'text-rose-400' : 'text-emerald-400'}>
                      ${formatPrice(c.price)} ({c.tier})
                    </span>
                    <span className="font-bold text-slate-200">{formatMillions(c.est_usd)}</span>
                  </div>
                ))
              ) : (
                <div className="text-[11px] text-slate-500 italic">Menghitung titik likuidasi...</div>
              )}
            </div>
            <div className="text-[9.5px] text-slate-500 mt-1">Dihitung dari margin resmi Binance MMR</div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* Filter Bar */}
        {/* ========================================================================= */}
        <div className="flex items-center justify-between px-4 py-2 bg-[#111620] border-b border-[#21262d] shrink-0 text-xs">
          <div className="flex items-center space-x-1.5 font-bold text-[11px]">
            <span className="text-slate-400 mr-1">Filter Tampilan:</span>
            <button
              type="button"
              onClick={() => setFilterMode('ALL')}
              className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                filterMode === 'ALL'
                  ? 'bg-[#222b3d] text-white border border-[#3b475e]'
                  : 'text-slate-400 hover:text-white hover:bg-[#18202d]'
              }`}
            >
              Semua Baris ({rows.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('INST_ONLY')}
              className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                filterMode === 'INST_ONLY'
                  ? 'bg-amber-950/60 text-amber-300 border border-amber-600/50'
                  : 'text-slate-400 hover:text-amber-200 hover:bg-[#18202d]'
              }`}
            >
              🐋 Hanya Order Institusi (≥ $50k)
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('SL_ONLY')}
              className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                filterMode === 'SL_ONLY'
                  ? 'bg-rose-950/60 text-rose-300 border border-rose-600/50'
                  : 'text-slate-400 hover:text-rose-200 hover:bg-[#18202d]'
              }`}
            >
              🟥/🟩 Hanya Titik Stop Loss / Likuidasi
            </button>
          </div>

          <div className="text-[10px] text-slate-400 font-mono">
            {lastUpdated && <span>Pembaruan: {lastUpdated}</span>}
          </div>
        </div>

        {/* ========================================================================= */}
        {/* DOM Table Matrix (Non-Chart Ladder) */}
        {/* ========================================================================= */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
          {errorMsg ? (
            <div className="p-8 text-center text-rose-400 text-sm font-mono space-y-2">
              <AlertTriangle className="w-8 h-8 mx-auto text-rose-400" />
              <div>{errorMsg}</div>
              <button
                type="button"
                onClick={() => loadData(false)}
                className="px-3 py-1 bg-[#1e2533] hover:bg-[#283244] text-white rounded border border-[#344055] text-xs cursor-pointer font-sans"
              >
                Coba Lagi
              </button>
            </div>
          ) : (
            <div className="w-full text-xs font-mono">
              {/* Table Column Headers */}
              <div className="grid grid-cols-12 gap-2 px-3 py-2 bg-[#161c28] text-slate-400 font-bold uppercase text-[10px] tracking-wider rounded-t-lg border border-[#21262d]">
                <div className="col-span-2">HARGA ($)</div>
                <div className="col-span-1 text-right">JARAK</div>
                <div className="col-span-3 text-right">ORDER INSTITUSI (WHALES)</div>
                <div className="col-span-2 text-right">ORDER RITEL</div>
                <div className="col-span-2 text-right">TOTAL KEDALAMAN</div>
                <div className="col-span-2 text-center">TITIK STOP LOSS / LIKUIDASI</div>
              </div>

              {/* ASKS (Above current price, highest first) */}
              <div className="divide-y divide-[#1e2533]/50">
                {askRows.map((row, idx) => {
                  const barPct = Math.min(100, (row.total_usd / maxTotalUsd) * 100)
                  return (
                    <div
                      key={`ask-${idx}`}
                      className="grid grid-cols-12 gap-2 px-3 py-1.5 items-center hover:bg-[#1a2232] transition-colors relative"
                    >
                      {/* Depth Bar Background (Red for Asks) */}
                      <div
                        className="absolute inset-y-0 right-0 bg-rose-950/20 pointer-events-none"
                        style={{ width: `${barPct}%` }}
                      />

                      <div className="col-span-2 font-bold text-rose-400 font-mono relative z-10">
                        ${formatPrice(row.price)}
                      </div>
                      <div className="col-span-1 text-right text-slate-400 text-[10.5px] font-mono relative z-10">
                        +{row.distance_pct}%
                      </div>
                      <div className="col-span-3 text-right font-mono relative z-10">
                        {row.inst_usd >= 50000 ? (
                          <span className="font-extrabold text-amber-300 bg-amber-950/50 px-1.5 py-0.5 rounded border border-amber-800/40">
                            🐋 {formatMillions(row.inst_usd)} ({row.whale_count})
                          </span>
                        ) : (
                          <span className="text-slate-500">-</span>
                        )}
                      </div>
                      <div className="col-span-2 text-right text-slate-300 font-mono relative z-10">
                        {row.retail_usd > 0 ? (
                          <span>👥 {formatMillions(row.retail_usd)}</span>
                        ) : (
                          <span className="text-slate-600">-</span>
                        )}
                      </div>
                      <div className="col-span-2 text-right font-bold text-slate-200 font-mono relative z-10">
                        {formatMillions(row.total_usd)}
                      </div>
                      <div className="col-span-2 text-center relative z-10">
                        {row.has_stop_loss && row.sl_usd > 0 ? (
                          <span className="px-1.5 py-0.5 rounded bg-rose-950 text-rose-300 border border-rose-700/60 font-bold text-[9.5px] shadow-sm animate-pulse">
                            🟥 {formatMillions(row.sl_usd)} ({row.sl_tier} SL)
                          </span>
                        ) : (
                          <span className="text-slate-700">-</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* CURRENT PRICE DIVIDER BAR */}
              <div className="my-1.5 px-4 py-2 bg-gradient-to-r from-amber-500/20 via-[#f0b90b]/30 to-amber-500/20 border-y border-[#f0b90b]/60 flex items-center justify-between text-xs font-mono font-extrabold shadow-lg">
                <div className="flex items-center space-x-2 text-[#f0b90b]">
                  <Activity className="w-4 h-4 animate-pulse" />
                  <span>HARGA PASAR TERKINI (BINANCE FUTURES)</span>
                </div>
                <div className="text-sm sm:text-base text-white tracking-wider">
                  ${formatPrice(currentPrice)}
                </div>
                <div className="text-[11px] text-slate-300 font-normal">
                  Mid Spread Level
                </div>
              </div>

              {/* BIDS (Below current price, descending down) */}
              <div className="divide-y divide-[#1e2533]/50">
                {bidRows.map((row, idx) => {
                  const barPct = Math.min(100, (row.total_usd / maxTotalUsd) * 100)
                  return (
                    <div
                      key={`bid-${idx}`}
                      className="grid grid-cols-12 gap-2 px-3 py-1.5 items-center hover:bg-[#16231c] transition-colors relative"
                    >
                      {/* Depth Bar Background (Green for Bids) */}
                      <div
                        className="absolute inset-y-0 right-0 bg-emerald-950/20 pointer-events-none"
                        style={{ width: `${barPct}%` }}
                      />

                      <div className="col-span-2 font-bold text-emerald-400 font-mono relative z-10">
                        ${formatPrice(row.price)}
                      </div>
                      <div className="col-span-1 text-right text-slate-400 text-[10.5px] font-mono relative z-10">
                        {row.distance_pct}%
                      </div>
                      <div className="col-span-3 text-right font-mono relative z-10">
                        {row.inst_usd >= 50000 ? (
                          <span className="font-extrabold text-amber-300 bg-amber-950/50 px-1.5 py-0.5 rounded border border-amber-800/40">
                            🐋 {formatMillions(row.inst_usd)} ({row.whale_count})
                          </span>
                        ) : (
                          <span className="text-slate-500">-</span>
                        )}
                      </div>
                      <div className="col-span-2 text-right text-slate-300 font-mono relative z-10">
                        {row.retail_usd > 0 ? (
                          <span>👥 {formatMillions(row.retail_usd)}</span>
                        ) : (
                          <span className="text-slate-600">-</span>
                        )}
                      </div>
                      <div className="col-span-2 text-right font-bold text-slate-200 font-mono relative z-10">
                        {formatMillions(row.total_usd)}
                      </div>
                      <div className="col-span-2 text-center relative z-10">
                        {row.has_stop_loss && row.sl_usd > 0 ? (
                          <span className="px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-700/60 font-bold text-[9.5px] shadow-sm animate-pulse">
                            🟩 {formatMillions(row.sl_usd)} ({row.sl_tier} SL)
                          </span>
                        ) : (
                          <span className="text-slate-700">-</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* ========================================================================= */}
        {/* Footer info */}
        {/* ========================================================================= */}
        <div className="px-4 py-2 bg-[#0e131b] border-t border-[#21262d] flex items-center justify-between text-[10px] text-slate-500 font-mono shrink-0">
          <div className="flex items-center space-x-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>
              100% Data Mentah Buku Order L2 Binance. Bukan tebakan pola chart lilin.
            </span>
          </div>
          <div>
            Whales: ≥ $50,000 • Ritel: &lt; $10,000 • SL dihitung dari Binance MMR
          </div>
        </div>
      </div>
    </div>
  )
}
