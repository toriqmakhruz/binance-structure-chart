import React, { useState, useEffect, useCallback } from 'react'
import { TradeAccountMode, TradePositionItem, TradeOrderItem } from '../../types/analysis'
import { fetchOpenPositions, fetchOpenOrders, closeTradePosition, cancelTradeOrder } from '../../services/api'
import { formatPrice } from '../../utils/formatters'
import {
  Activity,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Trash2,
  ExternalLink,
  ShieldCheck,
  FileText,
  Key,
  AlertTriangle
} from 'lucide-react'
import { ApiCredentialsModal } from '../Settings/ApiCredentialsModal'

interface PositionsSidebarPanelProps {
  currentSymbol: string
  market: 'spot' | 'futures'
  onSelectSymbol: (symbol: string) => void
  onOpenTradeModal?: () => void
  onPositionClosed?: (symbol: string) => void
}

function getStoredCredentials() {
  try {
    const raw = localStorage.getItem('cp_trade_credentials')
    if (raw) return JSON.parse(raw)
  } catch {}
  return { demoApiKey: '', demoApiSecret: '', liveApiKey: '', liveApiSecret: '', useSimulatedDemo: true }
}

export const PositionsSidebarPanel: React.FC<PositionsSidebarPanelProps> = ({
  currentSymbol,
  market,
  onSelectSymbol,
  onOpenTradeModal,
  onPositionClosed
}) => {
  const [mode, setMode] = useState<TradeAccountMode>(() => {
    try {
      const saved = localStorage.getItem('cp_trade_active_mode')
      return saved === 'live' ? 'live' : 'demo'
    } catch {
      return 'demo'
    }
  })

  const [positions, setPositions] = useState<TradePositionItem[]>([])
  const [orders, setOrders] = useState<TradeOrderItem[]>([])
  const [totalUnPnl, setTotalUnPnl] = useState<number>(0)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [isApiModalOpen, setIsApiModalOpen] = useState(false)

  const handleSetMode = (m: TradeAccountMode) => {
    setMode(m)
    try {
      localStorage.setItem('cp_trade_active_mode', m)
      window.dispatchEvent(new CustomEvent('cp_trade_mode_change', { detail: m }))
    } catch {}
  }

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true)
    const creds = getStoredCredentials()
    const apiKey = mode === 'demo' ? creds.demoApiKey : creds.liveApiKey
    const apiSecret = mode === 'demo' ? creds.demoApiSecret : creds.liveApiSecret

    try {
      const [posRes, ordRes] = await Promise.all([
        fetchOpenPositions(market, mode, apiKey, apiSecret),
        fetchOpenOrders(market, mode, apiKey, apiSecret)
      ])

      if (posRes && posRes.success && Array.isArray(posRes.positions)) {
        setPositions(posRes.positions)
        setTotalUnPnl(posRes.total_unrealized_pnl ?? 0)
      } else if (!posRes || !posRes.success) {
        console.warn('Gagal memuat posisi di sidebar (koneksi terganggu), mempertahankan data sebelumnya:', posRes?.message)
      }

      if (ordRes && ordRes.success && Array.isArray(ordRes.orders)) {
        setOrders(ordRes.orders)
      } else if (!ordRes || !ordRes.success) {
        console.warn('Gagal memuat order di sidebar (koneksi terganggu), mempertahankan data sebelumnya:', ordRes?.message)
      }
    } catch (err) {
      console.warn('Error loading positions sidebar:', err)
    } finally {
      if (!silent) setIsLoading(false)
    }
  }, [market, mode])

  useEffect(() => {
    loadData(false)
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      loadData(true)
    }, 12000)

    const handleSync = () => {
      try {
        const saved = localStorage.getItem('cp_trade_active_mode')
        if (saved === 'live' || saved === 'demo') {
          setMode(saved)
        }
      } catch {}
      loadData(true)
    }

    window.addEventListener('cp_trade_mode_change', handleSync)
    window.addEventListener('cp_position_closed', handleSync)
    window.addEventListener('cp_credentials_updated', handleSync)
    window.addEventListener('cp_user_data_update', handleSync)
    window.addEventListener('storage', handleSync)

    return () => {
      clearInterval(timer)
      window.removeEventListener('cp_trade_mode_change', handleSync)
      window.removeEventListener('cp_position_closed', handleSync)
      window.removeEventListener('cp_credentials_updated', handleSync)
      window.removeEventListener('cp_user_data_update', handleSync)
      window.removeEventListener('storage', handleSync)
    }
  }, [loadData])

  const handleClosePosition = async (sym: string) => {
    if (!confirm(`Tutup posisi ${sym} sekarang di harga pasar?`)) return
    setActionLoading(sym)
    const creds = getStoredCredentials()
    const apiKey = mode === 'demo' ? creds.demoApiKey : creds.liveApiKey
    const apiSecret = mode === 'demo' ? creds.demoApiSecret : creds.liveApiSecret

    try {
      const res = await closeTradePosition(sym, market, mode, apiKey, apiSecret)
      if (res.success) {
        onPositionClosed?.(sym)
        loadData(true)
      } else {
        alert(res.message || 'Gagal menutup posisi')
      }
    } catch (err: any) {
      alert(err?.message || 'Error saat menutup posisi')
    } finally {
      setActionLoading(null)
    }
  }

  const handleCancelOrder = async (sym: string, orderId: number) => {
    setActionLoading(String(orderId))
    const creds = getStoredCredentials()
    const apiKey = mode === 'demo' ? creds.demoApiKey : creds.liveApiKey
    const apiSecret = mode === 'demo' ? creds.demoApiSecret : creds.liveApiSecret

    try {
      const res = await cancelTradeOrder(sym, orderId, market, mode, apiKey, apiSecret)
      if (res.success) {
        onPositionClosed?.(sym)
        loadData(true)
      } else {
        alert(res.message || 'Gagal membatalkan order')
      }
    } catch (err: any) {
      alert(err?.message || 'Error saat membatalkan order')
    } finally {
      setActionLoading(null)
    }
  }

  return (
    <div className="w-full flex-1 min-h-0 flex flex-col overflow-hidden select-none text-xs">
      {/* 1. Header Bar */}
      <div className="p-3 bg-[#131823] border-b border-[#21262d] space-y-2 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-1.5 text-slate-300 font-bold uppercase tracking-wider text-[11px]">
            <Activity className="w-3.5 h-3.5 text-[#00c087]" />
            <span>Monitor Posisi & Order</span>
          </div>

          <div className="flex items-center space-x-1.5">
            <div className="flex items-center p-0.5 bg-[#0b0e14] border border-[#21262d] rounded">
              <button
                type="button"
                onClick={() => handleSetMode('demo')}
                className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                  mode === 'demo' ? 'bg-amber-950 text-[#f0b90b]' : 'text-slate-400'
                }`}
              >
                DEMO
              </button>
              <button
                type="button"
                onClick={() => handleSetMode('live')}
                className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                  mode === 'live' ? 'bg-emerald-950 text-[#00c087]' : 'text-slate-400'
                }`}
              >
                LIVE
              </button>
            </div>

            <button
              type="button"
              onClick={() => setIsApiModalOpen(true)}
              title="Atur Kredensial API Binance"
              className="p-1 rounded text-slate-400 hover:text-[#f0b90b] hover:bg-[#1c2434] transition-colors"
            >
              <Key className="w-3.5 h-3.5" />
            </button>

            <button
              type="button"
              onClick={() => loadData(false)}
              disabled={isLoading}
              title="Refresh Posisi"
              className="p-1 rounded text-slate-400 hover:text-white hover:bg-[#1c2434] transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-[#f0b90b]' : ''}`} />
            </button>
          </div>
        </div>

        {/* Total Unrealized PnL Banner */}
        <div
          className={`p-2.5 rounded-lg border flex items-center justify-between ${
            totalUnPnl >= 0
              ? 'bg-emerald-950/40 border-emerald-800/60 text-emerald-300'
              : 'bg-rose-950/40 border-rose-800/60 text-rose-300'
          }`}
        >
          <div>
            <span className="text-[10px] text-slate-400 block font-sans">Total Unrealized PnL</span>
            <span className="font-mono font-bold text-sm">
              {totalUnPnl >= 0 ? `+$${totalUnPnl.toFixed(2)}` : `-$${Math.abs(totalUnPnl).toFixed(2)}`} USDT
            </span>
          </div>

          <div className="text-right">
            <span className="text-[10px] text-slate-400 block font-sans">Posisi Aktif</span>
            <span className="font-mono font-bold text-white text-xs">{positions.length}</span>
          </div>
        </div>
      </div>



      {/* Missing Live API Key Warning Banner */}
      {(() => {
        const creds = getStoredCredentials()
        const hasLiveKey = Boolean(creds.liveApiKey && creds.liveApiSecret)
        if (mode === 'live' && !hasLiveKey) {
          return (
            <div className="m-2.5 p-3 rounded-lg bg-amber-950/40 border border-amber-600/60 text-amber-200 text-xs space-y-2">
              <div className="flex items-center space-x-1.5 font-bold text-amber-300 text-[11px]">
                <AlertTriangle className="w-4 h-4 text-[#f0b90b] shrink-0" />
                <span>API Key Live Belum Tersimpan</span>
              </div>
              <p className="text-[10px] text-slate-300 leading-relaxed font-sans">
                Simpan API Key & Secret Binance Anda di browser ini agar posisi riil Anda dapat tersinkron otomatis.
              </p>
              <button
                type="button"
                onClick={() => setIsApiModalOpen(true)}
                className="w-full py-1.5 rounded bg-[#f0b90b] hover:bg-[#d9a508] text-black font-bold text-xs shadow transition-colors flex items-center justify-center space-x-1"
              >
                <Key className="w-3.5 h-3.5" />
                <span>Masukkan API Key Binance</span>
              </button>
            </div>
          )
        }
        return null
      })()}

      {/* 2. Scrollable Body: Position & Order Cards */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y p-2.5 pb-24 space-y-3">
        {/* SECTION A: Positions */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1">
            <span>Posisi Terbuka ({positions.length})</span>
          </div>

          {positions.length === 0 ? (
            <div className="p-4 text-center rounded-lg bg-[#0d1117] border border-dashed border-[#21262d] text-slate-500 text-[11px]">
              Tidak ada posisi aktif ({mode.toUpperCase()})
            </div>
          ) : (
            positions.map((pos) => {
              const isLong = pos.side === 'LONG'
              const pnlVal = Number(pos.unrealizedProfit || 0)
              const roeVal = Number(pos.roePct || 0)
              const marginVal = Number(pos.margin || 0)
              const posAmtVal = Number(pos.positionAmt || 0)
              const isProfit = pnlVal >= 0
              const isSelected = (pos.symbol || '').toUpperCase() === currentSymbol.toUpperCase()
              const isActioning = actionLoading === pos.symbol

              return (
                <div
                  key={`${pos.symbol}-${pos.side}`}
                  className={`p-2.5 rounded-lg border transition-all space-y-2 ${
                    isSelected
                      ? 'bg-[#18202e] border-[#f0b90b]/60'
                      : 'bg-[#0d1117] border-[#21262d] hover:border-[#303848]'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-1.5">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                          isLong
                            ? 'bg-emerald-950 text-[#00c087] border border-emerald-800'
                            : 'bg-rose-950 text-[#f6465d] border border-rose-800'
                        }`}
                      >
                        {pos.side} {pos.leverage || 1}x
                      </span>
                      <button
                        type="button"
                        onClick={() => onSelectSymbol(pos.symbol)}
                        className="font-bold text-xs text-white hover:text-[#f0b90b] flex items-center space-x-1"
                      >
                        <span>{pos.symbol}</span>
                        <ExternalLink className="w-2.5 h-2.5 text-slate-500" />
                      </button>
                    </div>

                    <div className={`font-mono font-bold text-xs ${isProfit ? 'text-[#00c087]' : 'text-[#f6465d]'}`}>
                      {isProfit ? `+$${pnlVal.toFixed(2)}` : `-$${Math.abs(pnlVal).toFixed(2)}`}
                      <span className="text-[10px] ml-1 opacity-80 font-normal">
                        ({roeVal > 0 ? `+${roeVal.toFixed(1)}` : roeVal.toFixed(1)}%)
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-1 pt-1.5 border-t border-[#1a2230] font-mono text-[10px]">
                    <div>
                      <span className="text-[9px] text-slate-500 block">Entry</span>
                      <span className="text-slate-300 font-semibold">${formatPrice(pos.entryPrice)}</span>
                    </div>
                    <div>
                      <span className="text-[9px] text-slate-500 block">Mark</span>
                      <span className="text-white font-bold">${formatPrice(pos.markPrice)}</span>
                    </div>
                    <div className="text-right">
                      <span className="text-[9px] text-slate-500 block">Margin</span>
                      <span className="text-slate-300">${marginVal.toFixed(2)}</span>
                    </div>
                  </div>

                  <div className="pt-1 flex items-center justify-between">
                    <span className="text-[9px] font-mono text-slate-500">
                      Size: {Math.abs(posAmtVal)}
                    </span>

                    <button
                      type="button"
                      onClick={() => handleClosePosition(pos.symbol)}
                      disabled={isActioning}
                      className="px-2 py-0.5 rounded bg-rose-600/90 hover:bg-rose-500 text-white font-sans text-[10px] font-bold transition-all disabled:opacity-50"
                    >
                      {isActioning ? 'Tutup...' : 'Tutup Posisi'}
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>

        {/* SECTION B: Pending Orders */}
        <div className="space-y-1.5 pt-2 border-t border-[#1a2230]">
          <div className="flex items-center justify-between text-[10px] font-bold text-slate-400 uppercase tracking-wider px-1">
            <span>Order Pending / Limit ({orders.length})</span>
          </div>

          {orders.length === 0 ? (
            <div className="p-3 text-center rounded-lg bg-[#0d1117] border border-dashed border-[#21262d] text-slate-500 text-[10px]">
              Tidak ada order limit atau pending
            </div>
          ) : (
            orders.map((ord) => {
              const isBuy = ord.side === 'BUY'
              const isActioning = actionLoading === String(ord.orderId)

              return (
                <div
                  key={String(ord.orderId)}
                  className="p-2 rounded-lg bg-[#0d1117] border border-[#21262d] flex items-center justify-between font-mono text-[10px]"
                >
                  <div className="space-y-0.5">
                    <div className="flex items-center space-x-1.5">
                      <span className={`font-bold ${isBuy ? 'text-[#00c087]' : 'text-[#f6465d]'}`}>
                        {ord.side}
                      </span>
                      <span className="text-white font-bold">{ord.symbol}</span>
                      <span className="text-[9px] px-1 rounded bg-[#1c2434] text-slate-400">
                        {ord.type}
                      </span>
                    </div>
                    <div className="text-slate-400">
                      Harga: {ord.price > 0 ? `$${formatPrice(ord.price)}` : (ord.stopPrice ? `Trigger $${formatPrice(ord.stopPrice)}` : 'Market')}
                      <span className="ml-1 text-slate-500">Qty: {ord.origQty}</span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleCancelOrder(ord.symbol, Number(ord.orderId))}
                    disabled={isActioning}
                    className="p-1 rounded bg-[#1c2434] hover:bg-rose-900/60 text-slate-400 hover:text-rose-200 transition-colors"
                    title="Batalkan order"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              )
            })
          )}
        </div>
      </div>

      <ApiCredentialsModal
        isOpen={isApiModalOpen}
        onClose={() => setIsApiModalOpen(false)}
        initialMode={mode}
        market={market}
        onSaved={() => loadData(false)}
      />
    </div>
  )
}
