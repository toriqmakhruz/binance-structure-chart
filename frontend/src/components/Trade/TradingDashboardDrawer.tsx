import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  TradeAccountMode,
  TradePositionItem,
  TradeOrderItem
} from '../../types/analysis'
import {
  fetchOpenPositions,
  fetchOpenOrders,
  closeTradePosition,
  cancelTradeOrder
} from '../../services/api'
import { formatPrice } from '../../utils/formatters'
import {
  ChevronUp,
  ChevronDown,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  X,
  AlertCircle,
  Clock,
  Layers,
  FileText,
  Activity,
  CheckCircle2,
  Trash2,
  ExternalLink
} from 'lucide-react'

interface TradingDashboardDrawerProps {
  isOpen: boolean
  onToggle: () => void
  market: 'spot' | 'futures'
  currentSymbol: string
  onSelectSymbol: (symbol: string) => void
  refreshTrigger?: number
}

function getStoredCredentials() {
  try {
    const raw = localStorage.getItem('cp_trade_credentials')
    if (raw) return JSON.parse(raw)
  } catch {}
  return { demoApiKey: '', demoApiSecret: '', liveApiKey: '', liveApiSecret: '', useSimulatedDemo: true }
}

export const TradingDashboardDrawer: React.FC<TradingDashboardDrawerProps> = ({
  isOpen,
  onToggle,
  market,
  currentSymbol,
  onSelectSymbol,
  refreshTrigger = 0
}) => {
  const [activeTab, setActiveTab] = useState<'positions' | 'orders'>('positions')
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
  const [actionLoading, setActionLoading] = useState<string | null>(null) // symbol or orderId being actioned
  const [filterCurrentSymbol, setFilterCurrentSymbol] = useState<boolean>(false)
  const [statusNotice, setStatusNotice] = useState<string | null>(null)

  // Load positions & orders
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

      if (posRes.success && Array.isArray(posRes.positions)) {
        setPositions(posRes.positions)
        setTotalUnPnl(posRes.total_unrealized_pnl || 0)
      } else {
        setPositions([])
        setTotalUnPnl(0)
      }

      if (ordRes.success && Array.isArray(ordRes.orders)) {
        setOrders(ordRes.orders)
      } else {
        setOrders([])
      }
    } catch (err: any) {
      console.warn('Failed loading trading dashboard data:', err)
    } finally {
      if (!silent) setIsLoading(false)
    }
  }, [market, mode])

  // Periodic polling every 3s when drawer is open
  useEffect(() => {
    loadData(false)
    if (!isOpen) return
    const timer = setInterval(() => loadData(true), 3000)
    return () => clearInterval(timer)
  }, [isOpen, loadData, refreshTrigger])

  // Close Position handler
  const handleClosePosition = async (sym: string) => {
    if (!confirm(`Konfirmasi: Tutup posisi ${sym} sekarang di harga pasar?`)) return
    setActionLoading(sym)
    setStatusNotice(null)
    const creds = getStoredCredentials()
    const apiKey = mode === 'demo' ? creds.demoApiKey : creds.liveApiKey
    const apiSecret = mode === 'demo' ? creds.demoApiSecret : creds.liveApiSecret

    try {
      const res = await closeTradePosition(sym, market, mode, apiKey, apiSecret)
      if (res.success) {
        setStatusNotice(`Posisi ${sym} berhasil ditutup!`)
        loadData(true)
        setTimeout(() => setStatusNotice(null), 3000)
      } else {
        alert(res.message || 'Gagal menutup posisi')
      }
    } catch (err: any) {
      alert(err?.message || 'Error saat menutup posisi')
    } finally {
      setActionLoading(null)
    }
  }

  // Cancel Order handler
  const handleCancelOrder = async (sym: string, orderId: number) => {
    setActionLoading(String(orderId))
    const creds = getStoredCredentials()
    const apiKey = mode === 'demo' ? creds.demoApiKey : creds.liveApiKey
    const apiSecret = mode === 'demo' ? creds.demoApiSecret : creds.liveApiSecret

    try {
      const res = await cancelTradeOrder(sym, orderId, market, mode, apiKey, apiSecret)
      if (res.success) {
        setStatusNotice(`Order #${orderId} dibatalkan`)
        loadData(true)
        setTimeout(() => setStatusNotice(null), 3000)
      } else {
        alert(res.message || 'Gagal membatalkan order')
      }
    } catch (err: any) {
      alert(err?.message || 'Error saat membatalkan order')
    } finally {
      setActionLoading(null)
    }
  }

  // Filtered views
  const displayedPositions = useMemo(() => {
    if (!filterCurrentSymbol) return positions
    return positions.filter((p) => p.symbol.toUpperCase() === currentSymbol.toUpperCase())
  }, [positions, filterCurrentSymbol, currentSymbol])

  const displayedOrders = useMemo(() => {
    if (!filterCurrentSymbol) return orders
    return orders.filter((o) => o.symbol.toUpperCase() === currentSymbol.toUpperCase())
  }, [orders, filterCurrentSymbol, currentSymbol])

  return (
    <div className="w-full bg-[#0d121c] border-t border-[#232c3d] flex flex-col transition-all duration-200 select-none z-30 shadow-2xl">
      {/* 1. Dock Bar Header (Always Visible) */}
      <div className="h-10 px-3 bg-[#131926] flex items-center justify-between text-xs border-b border-[#21293a]">
        {/* Left: Collapse toggle, Tabs, Counts, Total PnL */}
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={onToggle}
            className="flex items-center space-x-1 px-2 py-1 rounded hover:bg-[#1e2638] text-slate-300 font-bold transition-colors"
          >
            {isOpen ? <ChevronDown className="w-4 h-4 text-[#f0b90b]" /> : <ChevronUp className="w-4 h-4 text-[#f0b90b]" />}
            <span className="text-[11px] font-sans">Dashboard Monitor</span>
          </button>

          {/* Tab 1: Positions */}
          <button
            type="button"
            onClick={() => {
              setActiveTab('positions')
              if (!isOpen) onToggle()
            }}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded text-[11px] font-bold transition-all ${
              isOpen && activeTab === 'positions'
                ? 'bg-[#1e273a] text-white border border-[#303d54]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#182030]'
            }`}
          >
            <Activity className="w-3.5 h-3.5 text-[#00c087]" />
            <span>Posisi Terbuka</span>
            <span className="px-1.5 py-0.2 rounded-full bg-[#273248] text-white font-mono text-[10px]">
              {positions.length}
            </span>
          </button>

          {/* Tab 2: Orders */}
          <button
            type="button"
            onClick={() => {
              setActiveTab('orders')
              if (!isOpen) onToggle()
            }}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded text-[11px] font-bold transition-all ${
              isOpen && activeTab === 'orders'
                ? 'bg-[#1e273a] text-white border border-[#303d54]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#182030]'
            }`}
          >
            <FileText className="w-3.5 h-3.5 text-[#f0b90b]" />
            <span>Order Limit / Pending</span>
            <span className="px-1.5 py-0.2 rounded-full bg-[#273248] text-white font-mono text-[10px]">
              {orders.length}
            </span>
          </button>

          {/* Total Unrealized PnL summary pill */}
          {positions.length > 0 && (
            <div
              className={`hidden sm:flex items-center space-x-1 px-2 py-0.5 rounded font-mono text-[11px] font-bold ${
                totalUnPnl >= 0 ? 'bg-emerald-950/80 text-[#00c087] border border-emerald-800/60' : 'bg-rose-950/80 text-[#f6465d] border border-rose-800/60'
              }`}
            >
              <span>Total PnL:</span>
              <span>{totalUnPnl >= 0 ? `+$${totalUnPnl.toFixed(2)}` : `-$${Math.abs(totalUnPnl).toFixed(2)}`}</span>
            </div>
          )}

          {statusNotice && (
            <span className="hidden md:inline text-[10px] text-emerald-400 animate-pulse font-semibold">
              ✓ {statusNotice}
            </span>
          )}
        </div>

        {/* Right: Symbol filter, Mode toggle, Refresh, Hide */}
        <div className="flex items-center space-x-2">
          {/* Filter Current Symbol Checkbox */}
          <label className="hidden md:flex items-center space-x-1.5 text-[10px] text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={filterCurrentSymbol}
              onChange={(e) => setFilterCurrentSymbol(e.target.checked)}
              className="rounded bg-[#161c28] border-[#293448] text-[#f0b90b] focus:ring-0"
            />
            <span>Hanya {currentSymbol}</span>
          </label>

          {/* Mode switch pill */}
          <div className="flex items-center p-0.5 bg-[#0b0e14] border border-[#21293a] rounded">
            <button
              type="button"
              onClick={() => setMode('demo')}
              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                mode === 'demo' ? 'bg-amber-950/80 text-[#f0b90b]' : 'text-slate-400'
              }`}
            >
              DEMO
            </button>
            <button
              type="button"
              onClick={() => setMode('live')}
              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                mode === 'live' ? 'bg-emerald-950/80 text-[#00c087]' : 'text-slate-400'
              }`}
            >
              LIVE
            </button>
          </div>

          <button
            type="button"
            onClick={() => loadData(false)}
            disabled={isLoading}
            title="Muat ulang posisi & order"
            className="p-1 rounded text-slate-400 hover:text-white"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-[#f0b90b]' : ''}`} />
          </button>
        </div>
      </div>

      {/* 2. Expandable Panel Drawer Content */}
      {isOpen && (
        <div className="h-56 overflow-y-auto bg-[#0a0e17] text-slate-200">
          {/* TAB 1: Open Positions Table */}
          {activeTab === 'positions' && (
            displayedPositions.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center p-6 text-slate-500 space-y-1.5">
                <Activity className="w-6 h-6 opacity-40 text-slate-400" />
                <p className="text-xs font-semibold text-slate-400">Tidak ada posisi terbuka ({mode.toUpperCase()})</p>
                <p className="text-[10px] text-slate-500">
                  {filterCurrentSymbol ? `Tidak ada posisi untuk ${currentSymbol}.` : 'Buka posisi melalui tombol "Open Posisi" pada kartu setup.'}
                </p>
              </div>
            ) : (
              <table className="w-full text-left text-xs font-mono border-collapse">
                <thead className="sticky top-0 bg-[#121824] text-[10px] text-slate-400 uppercase border-b border-[#21293a] font-sans">
                  <tr>
                    <th className="py-2 px-3">Simbol & Sisi</th>
                    <th className="py-2 px-2 text-right">Ukuran (Size)</th>
                    <th className="py-2 px-2 text-right">Harga Entry</th>
                    <th className="py-2 px-2 text-right">Harga Pasar (Mark)</th>
                    <th className="py-2 px-2 text-right">Estimasi Liq.</th>
                    <th className="py-2 px-2 text-right">Margin</th>
                    <th className="py-2 px-3 text-right">Unrealized PnL (ROE)</th>
                    <th className="py-2 px-3 text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#17202e] text-[11px]">
                  {displayedPositions.map((pos) => {
                    const isLong = pos.side === 'LONG'
                    const isProfit = pos.unrealizedProfit >= 0
                    const isSelected = pos.symbol.toUpperCase() === currentSymbol.toUpperCase()
                    const isActioning = actionLoading === pos.symbol

                    return (
                      <tr
                        key={`${pos.symbol}-${pos.side}`}
                        className={`hover:bg-[#121a28] transition-colors ${isSelected ? 'bg-[#141d2c]/60' : ''}`}
                      >
                        {/* Symbol & Side */}
                        <td className="py-2 px-3">
                          <div className="flex items-center space-x-1.5">
                            <button
                              type="button"
                              onClick={() => onSelectSymbol(pos.symbol)}
                              className="font-bold text-white hover:text-[#f0b90b] transition-colors flex items-center space-x-1"
                              title="Buka chart koin ini"
                            >
                              <span>{pos.symbol}</span>
                              <ExternalLink className="w-2.5 h-2.5 text-slate-500" />
                            </button>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                isLong ? 'bg-emerald-950 text-[#00c087] border border-emerald-800/80' : 'bg-rose-950 text-[#f6465d] border border-rose-800/80'
                              }`}
                            >
                              {pos.side} {pos.leverage}x
                            </span>
                            {pos.is_simulated && (
                              <span className="text-[8px] px-1 rounded bg-[#20293a] text-slate-400 font-sans">
                                SIM
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Size */}
                        <td className="py-2 px-2 text-right">
                          <div className="font-semibold text-slate-200">
                            {Math.abs(pos.positionAmt).toLocaleString('en-US', { maximumFractionDigits: 4 })}
                          </div>
                          {pos.notional && (
                            <div className="text-[10px] text-slate-500 font-sans">
                              ≈ ${pos.notional.toFixed(2)}
                            </div>
                          )}
                        </td>

                        {/* Entry Price */}
                        <td className="py-2 px-2 text-right text-slate-300">
                          ${formatPrice(pos.entryPrice)}
                        </td>

                        {/* Mark Price */}
                        <td className="py-2 px-2 text-right font-bold text-white">
                          ${formatPrice(pos.markPrice)}
                        </td>

                        {/* Liquidation Price */}
                        <td className="py-2 px-2 text-right text-slate-400">
                          {pos.liquidationPrice && pos.liquidationPrice > 0 ? (
                            <span className="text-amber-400">${formatPrice(pos.liquidationPrice)}</span>
                          ) : (
                            <span className="text-slate-600">—</span>
                          )}
                        </td>

                        {/* Margin */}
                        <td className="py-2 px-2 text-right text-slate-300">
                          ${pos.margin.toFixed(2)}
                        </td>

                        {/* Unrealized PnL & ROE */}
                        <td className={`py-2 px-3 text-right font-bold ${isProfit ? 'text-[#00c087]' : 'text-[#f6465d]'}`}>
                          <div>
                            {isProfit ? `+$${pos.unrealizedProfit.toFixed(2)}` : `-$${Math.abs(pos.unrealizedProfit).toFixed(2)}`}
                          </div>
                          <div className="text-[10px] font-sans">
                            {isProfit ? `+${pos.roePct.toFixed(2)}%` : `${pos.roePct.toFixed(2)}%`}
                          </div>
                        </td>

                        {/* Action: Close Position */}
                        <td className="py-2 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => handleClosePosition(pos.symbol)}
                            disabled={isActioning}
                            className="px-2.5 py-1 rounded bg-rose-600/90 hover:bg-rose-500 text-white font-sans text-[10px] font-bold shadow transition-all disabled:opacity-50"
                          >
                            {isActioning ? 'Tutup...' : 'Tutup Posisi'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )
          )}

          {/* TAB 2: Open / Pending Orders Table */}
          {activeTab === 'orders' && (
            displayedOrders.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center p-6 text-slate-500 space-y-1.5">
                <FileText className="w-6 h-6 opacity-40 text-slate-400" />
                <p className="text-xs font-semibold text-slate-400">Tidak ada order pending ({mode.toUpperCase()})</p>
                <p className="text-[10px] text-slate-500">
                  Order limit atau bracket SL/TP yang belum terisi akan muncul di sini.
                </p>
              </div>
            ) : (
              <table className="w-full text-left text-xs font-mono border-collapse">
                <thead className="sticky top-0 bg-[#121824] text-[10px] text-slate-400 uppercase border-b border-[#21293a] font-sans">
                  <tr>
                    <th className="py-2 px-3">Waktu</th>
                    <th className="py-2 px-2">Simbol</th>
                    <th className="py-2 px-2">Tipe Order</th>
                    <th className="py-2 px-2">Sisi</th>
                    <th className="py-2 px-2 text-right">Harga Order</th>
                    <th className="py-2 px-2 text-right">Trigger SL/TP</th>
                    <th className="py-2 px-2 text-right">Jumlah (Qty)</th>
                    <th className="py-2 px-3 text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#17202e] text-[11px]">
                  {displayedOrders.map((ord) => {
                    const isBuy = ord.side === 'BUY'
                    const isActioning = actionLoading === String(ord.orderId)
                    const timeStr = ord.time ? new Date(ord.time * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'

                    return (
                      <tr key={String(ord.orderId)} className="hover:bg-[#121a28] transition-colors">
                        <td className="py-2 px-3 text-slate-400 text-[10px]">{timeStr}</td>
                        <td className="py-2 px-2 font-bold text-white">{ord.symbol}</td>
                        <td className="py-2 px-2">
                          <span className="px-1.5 py-0.5 rounded bg-[#1c2434] text-slate-300 text-[9px] font-sans">
                            {ord.type}
                          </span>
                        </td>
                        <td className="py-2 px-2">
                          <span className={`font-bold text-[10px] ${isBuy ? 'text-[#00c087]' : 'text-[#f6465d]'}`}>
                            {ord.side}
                          </span>
                        </td>
                        <td className="py-2 px-2 text-right text-slate-200">
                          {ord.price > 0 ? `$${formatPrice(ord.price)}` : 'Market'}
                        </td>
                        <td className="py-2 px-2 text-right text-[#f0b90b]">
                          {ord.stopPrice && ord.stopPrice > 0 ? `$${formatPrice(ord.stopPrice)}` : '—'}
                        </td>
                        <td className="py-2 px-2 text-right text-slate-300">
                          {ord.origQty}
                        </td>
                        <td className="py-2 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => handleCancelOrder(ord.symbol, Number(ord.orderId))}
                            disabled={isActioning}
                            className="px-2 py-0.5 rounded bg-[#20293a] hover:bg-rose-900/60 hover:text-rose-200 text-slate-400 font-sans text-[10px] transition-colors"
                          >
                            {isActioning ? 'Batal...' : 'Batalkan'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )
          )}
        </div>
      )}
    </div>
  )
}
