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
  cancelTradeOrder,
  setPositionBrackets,
  fetchTradeHistory,
  clearTradeHistory,
  TradeHistoryItem
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
  ExternalLink,
  Shield,
  Target,
  Key,
  History,
  DollarSign,
  Award
} from 'lucide-react'
import { ApiCredentialsModal } from '../Settings/ApiCredentialsModal'

interface TradingDashboardDrawerProps {
  isOpen: boolean
  onToggle: () => void
  market: 'spot' | 'futures'
  currentSymbol: string
  onSelectSymbol: (symbol: string) => void
  refreshTrigger?: number
  onPositionClosed?: (symbol: string) => void
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
  refreshTrigger = 0,
  onPositionClosed
}) => {
  const [activeTab, setActiveTab] = useState<'positions' | 'orders' | 'history'>('positions')
  const [history, setHistory] = useState<TradeHistoryItem[]>([])
  const [isClearingHistory, setIsClearingHistory] = useState(false)
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
  const [isApiModalOpen, setIsApiModalOpen] = useState<boolean>(false)

  const handleSetMode = (m: TradeAccountMode) => {
    setMode(m)
    try {
      localStorage.setItem('cp_trade_active_mode', m)
      window.dispatchEvent(new CustomEvent('cp_trade_mode_change', { detail: m }))
    } catch {}
  }

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

      // Load trade history
      const histRes = await fetchTradeHistory(
        market,
        mode,
        apiKey,
        apiSecret,
        filterCurrentSymbol ? currentSymbol : undefined,
        50
      )
      if (histRes.success && Array.isArray(histRes.trades)) {
        setHistory(histRes.trades)
      }
    } catch (err: any) {
      console.warn('Failed loading trading dashboard data:', err)
    } finally {
      if (!silent) setIsLoading(false)
    }
  }, [market, mode])

  // Periodic polling and reactive sync when drawer is open
  useEffect(() => {
    if (!isOpen) return
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
    window.addEventListener('storage', handleSync)

    return () => {
      clearInterval(timer)
      window.removeEventListener('cp_trade_mode_change', handleSync)
      window.removeEventListener('cp_position_closed', handleSync)
      window.removeEventListener('cp_credentials_updated', handleSync)
      window.removeEventListener('storage', handleSync)
    }
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
        onPositionClosed?.(sym)
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

  // SL / TP Bracket Modal state
  const [bracketModalPos, setBracketModalPos] = useState<TradePositionItem | null>(null)
  const [bracketSlInput, setBracketSlInput] = useState<string>('')
  const [bracketTpInput, setBracketTpInput] = useState<string>('')
  const [isSavingBrackets, setIsSavingBrackets] = useState<boolean>(false)
  const [bracketError, setBracketError] = useState<string | null>(null)

  const openBracketModal = (pos: TradePositionItem) => {
    setBracketModalPos(pos)
    setBracketSlInput(pos.stopLoss && pos.stopLoss > 0 ? String(pos.stopLoss) : '')
    setBracketTpInput(pos.takeProfit && pos.takeProfit > 0 ? String(pos.takeProfit) : '')
    setBracketError(null)
  }

  // Quick helper to calculate exact Stop Loss price for any target dollar risk
  const handleCalculateSlForRisk = (targetRisk: number) => {
    if (!bracketModalPos || targetRisk <= 0) return
    const qty = Math.abs(bracketModalPos.positionAmt)
    if (qty <= 0) return
    const entry = bracketModalPos.entryPrice
    const priceDelta = targetRisk / qty
    const isLong = bracketModalPos.side === 'LONG'
    const sl = isLong ? (entry - priceDelta) : (entry + priceDelta)
    if (sl > 0) {
      setBracketSlInput(String(Number(sl.toFixed(4))))
    }
  }

  // Live estimated loss/gain text for modal
  const calcSlRiskText = useMemo(() => {
    if (!bracketModalPos) return null
    const slNum = parseFloat(bracketSlInput)
    if (!Number.isFinite(slNum) || slNum <= 0) return null
    const qty = Math.abs(bracketModalPos.positionAmt)
    const entry = bracketModalPos.entryPrice
    const isLong = bracketModalPos.side === 'LONG'
    const diff = isLong ? (entry - slNum) : (slNum - entry)
    const lossUsd = diff * qty
    return `-$${Math.max(0, lossUsd).toFixed(2)}`
  }, [bracketModalPos, bracketSlInput])

  const calcTpRewardText = useMemo(() => {
    if (!bracketModalPos) return null
    const tpNum = parseFloat(bracketTpInput)
    if (!Number.isFinite(tpNum) || tpNum <= 0) return null
    const qty = Math.abs(bracketModalPos.positionAmt)
    const entry = bracketModalPos.entryPrice
    const isLong = bracketModalPos.side === 'LONG'
    const diff = isLong ? (tpNum - entry) : (entry - tpNum)
    const gainUsd = diff * qty
    return `+$${Math.max(0, gainUsd).toFixed(2)}`
  }, [bracketModalPos, bracketTpInput])

  const handleSaveBrackets = async () => {
    if (!bracketModalPos) return
    setIsSavingBrackets(true)
    setBracketError(null)

    const sl = bracketSlInput.trim() ? parseFloat(bracketSlInput) : null
    const tp = bracketTpInput.trim() ? parseFloat(bracketTpInput) : null

    const creds = getStoredCredentials()
    const apiKey = mode === 'demo' ? creds.demoApiKey : creds.liveApiKey
    const apiSecret = mode === 'demo' ? creds.demoApiSecret : creds.liveApiSecret

    try {
      const res = await setPositionBrackets(
        bracketModalPos.symbol,
        sl,
        tp,
        market,
        mode,
        apiKey,
        apiSecret
      )
      if (res.success) {
        setStatusNotice(res.message || `SL/TP ${bracketModalPos.symbol} berhasil dipasang!`)
        setBracketModalPos(null)
        loadData(true)
        setTimeout(() => setStatusNotice(null), 4000)
      } else {
        setBracketError(res.message || 'Gagal memasang order SL/TP')
      }
    } catch (err: any) {
      setBracketError(err?.message || 'Error saat memasang order SL/TP')
    } finally {
      setIsSavingBrackets(false)
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

  const displayedHistory = useMemo(() => {
    if (!filterCurrentSymbol) return history
    return history.filter((h) => (h.symbol || '').toUpperCase() === currentSymbol.toUpperCase())
  }, [history, filterCurrentSymbol, currentSymbol])

  const historySummary = useMemo(() => {
    const list = displayedHistory
    const totalPnl = list.reduce((acc, t) => acc + Number(t.netPnl != null ? t.netPnl : (t.realizedPnl || 0)), 0)
    const totalFee = list.reduce((acc, t) => acc + Number(t.fee || t.commission || 0), 0)
    const winning = list.filter((t) => Number(t.netPnl != null ? t.netPnl : (t.realizedPnl || 0)) > 0).length
    const losing = list.filter((t) => Number(t.netPnl != null ? t.netPnl : (t.realizedPnl || 0)) < 0).length
    const winRate = list.length > 0 ? (winning / list.length) * 100 : 0
    return {
      totalPnl: Math.round(totalPnl * 100) / 100,
      totalFee: Math.round(totalFee * 10000) / 10000,
      winning,
      losing,
      winRate: Math.round(winRate * 10) / 10,
      totalCount: list.length
    }
  }, [displayedHistory])

  const handleClearHistory = async () => {
    if (!confirm('Apakah Anda yakin ingin menghapus riwayat trade Paper Trading?')) return
    setIsClearingHistory(true)
    try {
      await clearTradeHistory()
      setHistory([])
      setStatusNotice('Riwayat trade berhasil dibersihkan.')
      setTimeout(() => setStatusNotice(null), 3500)
    } catch {
      setStatusNotice('Gagal membersihkan riwayat.')
      setTimeout(() => setStatusNotice(null), 3500)
    } finally {
      setIsClearingHistory(false)
    }
  }

  return (
    <div className="w-full bg-[#0d121c] border-t border-[#232c3d] flex flex-col transition-all duration-200 select-none z-30 shadow-2xl">
      {/* 1. Dock Bar Header (Always Visible) */}
      <div className="h-10 px-2 sm:px-3 bg-[#131926] flex items-center justify-between text-xs border-b border-[#21293a]">
        {/* Left: Collapse toggle, Tabs, Counts, Total PnL */}
        <div className="flex items-center space-x-1 sm:space-x-2 overflow-x-auto no-scrollbar shrink mr-1">
          <button
            type="button"
            onClick={onToggle}
            className="flex items-center space-x-1 px-1.5 sm:px-2 py-1 rounded hover:bg-[#1e2638] text-slate-300 font-bold transition-colors shrink-0"
          >
            {isOpen ? <ChevronDown className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#f0b90b]" /> : <ChevronUp className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-[#f0b90b]" />}
            <span className="text-[10px] sm:text-[11px] font-sans hidden xs:inline">Monitor</span>
          </button>

          {/* Tab 1: Positions */}
          <button
            type="button"
            onClick={() => {
              setActiveTab('positions')
              if (!isOpen) onToggle()
            }}
            className={`flex items-center space-x-1 sm:space-x-1.5 px-2 py-1 rounded text-[10px] sm:text-[11px] font-bold transition-all shrink-0 ${
              isOpen && activeTab === 'positions'
                ? 'bg-[#1e273a] text-white border border-[#303d54]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#182030]'
            }`}
          >
            <Activity className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-[#00c087]" />
            <span className="hidden sm:inline">Posisi Terbuka</span>
            <span className="sm:hidden">Posisi</span>
            <span className="px-1.5 py-0.2 rounded-full bg-[#273248] text-white font-mono text-[9px] sm:text-[10px]">
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
            className={`flex items-center space-x-1 sm:space-x-1.5 px-2 py-1 rounded text-[10px] sm:text-[11px] font-bold transition-all shrink-0 ${
              isOpen && activeTab === 'orders'
                ? 'bg-[#1e273a] text-white border border-[#303d54]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#182030]'
            }`}
          >
            <FileText className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-[#f0b90b]" />
            <span className="hidden sm:inline">Order Pending</span>
            <span className="sm:hidden">Order</span>
            <span className="px-1.5 py-0.2 rounded-full bg-[#273248] text-white font-mono text-[9px] sm:text-[10px]">
              {orders.length}
            </span>
          </button>

          {/* Tab 3: Riwayat Trade & Realized PnL */}
          <button
            type="button"
            onClick={() => {
              setActiveTab('history')
              if (!isOpen) onToggle()
            }}
            className={`flex items-center space-x-1 sm:space-x-1.5 px-2 py-1 rounded text-[10px] sm:text-[11px] font-bold transition-all shrink-0 ${
              isOpen && activeTab === 'history'
                ? 'bg-[#1e273a] text-white border border-[#303d54]'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#182030]'
            }`}
          >
            <History className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-cyan-400" />
            <span className="hidden sm:inline">Riwayat & PnL</span>
            <span className="sm:hidden">Riwayat</span>
            <span className="px-1.5 py-0.2 rounded-full bg-[#273248] text-white font-mono text-[9px] sm:text-[10px]">
              {history.length}
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
        <div className="flex items-center space-x-1 sm:space-x-2 shrink-0">
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
              onClick={() => handleSetMode('demo')}
              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                mode === 'demo' ? 'bg-amber-950/80 text-[#f0b90b]' : 'text-slate-400'
              }`}
            >
              DEMO
            </button>
            <button
              type="button"
              onClick={() => handleSetMode('live')}
              className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                mode === 'live' ? 'bg-emerald-950/80 text-[#00c087]' : 'text-slate-400'
              }`}
            >
              LIVE
            </button>
          </div>

          <button
            type="button"
            onClick={() => setIsApiModalOpen(true)}
            title="Atur Kredensial API Binance"
            className="p-1 rounded text-slate-400 hover:text-[#f0b90b] hover:bg-[#1a2232] transition-colors"
          >
            <Key className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => loadData(false)}
            disabled={isLoading}
            title="Muat ulang posisi & order"
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-[#1a2232] transition-colors"
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
            (() => {
              const creds = getStoredCredentials()
              const hasLiveKey = Boolean(creds.liveApiKey && creds.liveApiSecret)
              if (mode === 'live' && !hasLiveKey) {
                return (
                  <div className="h-full flex flex-col items-center justify-center p-6 text-center space-y-2.5">
                    <div className="w-10 h-10 rounded-full bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-[#f0b90b]">
                      <Key className="w-5 h-5" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-amber-300">Mode LIVE Aktif - API Key Belum Terhubung</p>
                      <p className="text-[11px] text-slate-400 max-w-sm mt-0.5">
                        Masukkan API Key & Secret Binance Anda untuk menyinkronkan posisi riil Anda secara real-time di sini.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsApiModalOpen(true)}
                      className="px-4 py-1.5 rounded-lg bg-[#f0b90b] hover:bg-[#d9a508] text-black font-bold text-xs shadow transition-colors flex items-center space-x-1"
                    >
                      <Key className="w-3.5 h-3.5" />
                      <span>Masukkan API Key Binance</span>
                    </button>
                  </div>
                )
              }
              return null
            })() || (
            displayedPositions.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center p-6 text-slate-500 space-y-1.5">
                <Activity className="w-6 h-6 opacity-40 text-slate-400" />
                <p className="text-xs font-semibold text-slate-400">Tidak ada posisi terbuka ({mode.toUpperCase()})</p>
                <p className="text-[10px] text-slate-500">
                  {filterCurrentSymbol ? `Tidak ada posisi untuk ${currentSymbol}.` : 'Buka posisi melalui tombol "Open Posisi" pada kartu setup.'}
                </p>
              </div>
            ) : (
              <div className="w-full">
                {/* 1. Mobile Positions Cards View (Phones < md) */}
                <div className="block md:hidden p-2 space-y-2">
                  {displayedPositions.map((pos) => {
                    const isLong = pos.side === 'LONG'
                    const pnlVal = Number(pos.unrealizedProfit || 0)
                    const roeVal = Number(pos.roePct || 0)
                    const marginVal = Number(pos.margin || 0)
                    const posAmtVal = Number(pos.positionAmt || 0)
                    const isProfit = pnlVal >= 0
                    const isActioning = actionLoading === pos.symbol

                    return (
                      <div
                        key={`mob-${pos.symbol}-${pos.side}`}
                        className="p-2.5 rounded-lg bg-[#111724] border border-[#212d40] space-y-2 text-xs"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-1.5">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                isLong ? 'bg-emerald-950 text-[#00c087] border border-emerald-800' : 'bg-rose-950 text-[#f6465d] border border-rose-800'
                              }`}
                            >
                              {pos.side} {pos.leverage}x
                            </span>
                            <span className="font-bold text-white text-sm">{pos.symbol}</span>
                            {pos.is_simulated && (
                              <span className="text-[8px] px-1 rounded bg-[#20293a] text-slate-400 font-sans">
                                SIM
                              </span>
                            )}
                          </div>
                          <div className={`font-mono font-bold text-xs ${isProfit ? 'text-[#00c087]' : 'text-[#f6465d]'}`}>
                            {isProfit ? `+$${pnlVal.toFixed(2)}` : `-$${Math.abs(pnlVal).toFixed(2)}`}
                            <span className="text-[10px] ml-1 opacity-80">
                              ({roeVal > 0 ? `+${roeVal.toFixed(1)}` : roeVal.toFixed(1)}%)
                            </span>
                          </div>
                        </div>

                        <div className="grid grid-cols-3 gap-1 pt-1.5 border-t border-[#192232] font-mono text-[10px]">
                          <div>
                            <span className="text-[9px] text-slate-500 block">Entry</span>
                            <span className="text-slate-300">${formatPrice(pos.entryPrice)}</span>
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

                        {/* SL / TP Badges if any */}
                        {(pos.stopLoss || pos.takeProfit) && (
                          <div className="flex items-center space-x-2 pt-1 font-mono text-[9px]">
                            {pos.stopLoss && (
                              <span className="text-[#f6465d]">SL: ${formatPrice(pos.stopLoss)}</span>
                            )}
                            {pos.takeProfit && (
                              <span className="text-[#00c087]">TP: ${formatPrice(pos.takeProfit)}</span>
                            )}
                          </div>
                        )}

                        {/* Mobile Actions: Roomy, clean, NO OVERLAPPING */}
                        <div className="pt-2 flex items-center space-x-2 border-t border-[#192232]">
                          <button
                            type="button"
                            onClick={() => openBracketModal(pos)}
                            className="flex-1 py-1.5 rounded bg-[#1c2434] hover:bg-[#253046] border border-slate-700/60 text-slate-200 font-sans text-xs font-semibold flex items-center justify-center space-x-1"
                          >
                            <Shield className="w-3 h-3 text-[#f0b90b]" />
                            <span>Atur SL/TP</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleClosePosition(pos.symbol)}
                            disabled={isActioning}
                            className="flex-1 py-1.5 rounded bg-rose-600 hover:bg-rose-500 text-white font-sans text-xs font-bold shadow transition-all disabled:opacity-50"
                          >
                            {isActioning ? 'Tutup...' : 'Tutup Posisi'}
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* 2. Desktop Full Table View (Screens md and above) */}
                <div className="hidden md:block overflow-x-auto w-full">
                  <table className="w-full text-left text-xs font-mono border-collapse min-w-[720px]">
                <thead className="sticky top-0 bg-[#121824] text-[10px] text-slate-400 uppercase border-b border-[#21293a] font-sans">
                  <tr>
                    <th className="py-2 px-3">Simbol & Sisi</th>
                    <th className="py-2 px-2 text-right">Ukuran (Size)</th>
                    <th className="py-2 px-2 text-right">Harga Entry</th>
                    <th className="py-2 px-2 text-right">Harga Pasar (Mark)</th>
                    <th className="py-2 px-2 text-right">Estimasi Liq.</th>
                    <th className="py-2 px-2 text-right">Stop Loss / Take Profit</th>
                    <th className="py-2 px-2 text-right">Margin</th>
                    <th className="py-2 px-3 text-right">Unrealized PnL (ROE)</th>
                    <th className="py-2 px-3 text-center">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#17202e] text-[11px]">
                  {displayedPositions.map((pos) => {
                    const isLong = pos.side === 'LONG'
                    const pnlVal = Number(pos.unrealizedProfit || 0)
                    const roeVal = Number(pos.roePct || 0)
                    const marginVal = Number(pos.margin || 0)
                    const notionalVal = Number(pos.notional || 0)
                    const posAmtVal = Number(pos.positionAmt || 0)
                    const isProfit = pnlVal >= 0
                    const isSelected = (pos.symbol || '').toUpperCase() === currentSymbol.toUpperCase()
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
                            {Math.abs(posAmtVal).toLocaleString('en-US', { maximumFractionDigits: 4 })}
                          </div>
                          {notionalVal > 0 && (
                            <div className="text-[10px] text-slate-500 font-sans">
                              ≈ ${notionalVal.toFixed(2)}
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

                        {/* Stop Loss & Take Profit Badges */}
                        <td className="py-2 px-2 text-right">
                          <div className="flex flex-col items-end space-y-0.5">
                            {pos.stopLoss && pos.stopLoss > 0 ? (
                              <span className="px-1.5 py-0.5 rounded bg-rose-950/80 border border-rose-800/60 text-[#f6465d] text-[10px] font-mono font-bold">
                                SL: ${formatPrice(pos.stopLoss)}
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded bg-amber-950/60 border border-amber-800/50 text-amber-400 text-[9px] font-semibold flex items-center space-x-1">
                                <AlertCircle className="w-2.5 h-2.5" />
                                <span>Tanpa SL</span>
                              </span>
                            )}
                            {pos.takeProfit && pos.takeProfit > 0 ? (
                              <span className="px-1.5 py-0.5 rounded bg-emerald-950/80 border border-emerald-800/60 text-[#00c087] text-[10px] font-mono font-bold">
                                TP: ${formatPrice(pos.takeProfit)}
                              </span>
                            ) : (
                              <span className="px-1.5 py-0.5 rounded bg-slate-800/50 text-slate-400 text-[9px]">
                                Tanpa TP
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Margin */}
                        <td className="py-2 px-2 text-right text-slate-300">
                          ${marginVal.toFixed(2)}
                        </td>

                        {/* Unrealized PnL & ROE */}
                        <td className={`py-2 px-3 text-right font-bold ${isProfit ? 'text-[#00c087]' : 'text-[#f6465d]'}`}>
                          <div>
                            {isProfit ? `+$${pnlVal.toFixed(2)}` : `-$${Math.abs(pnlVal).toFixed(2)}`}
                          </div>
                          <div className="text-[10px] font-sans">
                            {isProfit ? `+${roeVal.toFixed(2)}%` : `${roeVal.toFixed(2)}%`}
                          </div>
                        </td>

                        {/* Action: Set SL/TP & Close Position */}
                        <td className="py-2 px-3 text-center">
                          <div className="flex items-center justify-center space-x-1.5">
                            <button
                              type="button"
                              onClick={() => openBracketModal(pos)}
                              className="px-2 py-1 rounded bg-[#1c2434] hover:bg-[#273248] border border-slate-700/60 text-slate-200 font-sans text-[10px] font-semibold transition-colors flex items-center space-x-1"
                              title="Pasang atau ubah Stop Loss & Take Profit posisi ini"
                            >
                              <Shield className="w-2.5 h-2.5 text-[#f0b90b]" />
                              <span>SL/TP</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleClosePosition(pos.symbol)}
                              disabled={isActioning}
                              className="px-2 py-1 rounded bg-rose-600/90 hover:bg-rose-500 text-white font-sans text-[10px] font-bold shadow transition-all disabled:opacity-50"
                            >
                              {isActioning ? 'Tutup...' : 'Tutup'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                  </table>
                </div>
              </div>
            )
          ))}

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
              <div className="w-full">
                {/* Mobile Orders View */}
                <div className="block md:hidden p-2 space-y-2">
                  {displayedOrders.map((ord) => {
                    const isBuy = ord.side === 'BUY'
                    const isActioning = actionLoading === String(ord.orderId)
                    const ordPrice = Number(ord.price || 0)
                    const ordStopPrice = Number(ord.stopPrice || 0)

                    return (
                      <div key={`mob-ord-${ord.orderId}`} className="p-2.5 rounded-lg bg-[#111724] border border-[#212d40] space-y-2 text-xs">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center space-x-1.5">
                            <span className={`font-bold text-[10px] px-1.5 py-0.5 rounded ${isBuy ? 'bg-emerald-950 text-[#00c087] border border-emerald-800' : 'bg-rose-950 text-[#f6465d] border border-rose-800'}`}>
                              {ord.side}
                            </span>
                            <span className="font-bold text-white">{ord.symbol}</span>
                            <span className="text-[9px] px-1 py-0.2 rounded bg-[#1c2434] text-slate-300 font-sans">{ord.type}</span>
                          </div>
                          <span className="font-mono text-slate-300 text-[11px]">Qty: {ord.origQty}</span>
                        </div>
                        <div className="flex items-center justify-between text-[11px] font-mono pt-1 border-t border-[#192232]">
                          <span className="text-slate-400">Harga: {ordPrice > 0 ? `$${formatPrice(ordPrice)}` : 'Market'}</span>
                          {ordStopPrice > 0 && <span className="text-[#f0b90b]">Trigger: ${formatPrice(ordStopPrice)}</span>}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleCancelOrder(ord.symbol, Number(ord.orderId))}
                          disabled={isActioning}
                          className="w-full py-1.5 rounded bg-[#20293a] hover:bg-rose-900/60 hover:text-rose-200 text-slate-300 font-sans text-xs font-semibold transition-colors"
                        >
                          {isActioning ? 'Membatalkan...' : 'Batalkan Order'}
                        </button>
                      </div>
                    )
                  })}
                </div>

                {/* Desktop Orders Table */}
                <div className="hidden md:block overflow-x-auto w-full">
                  <table className="w-full text-left text-xs font-mono border-collapse min-w-[650px]">
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
                    const rawTime = Number(ord.time || 0)
                    const timeMs = rawTime > 1e11 ? rawTime : (rawTime > 0 ? rawTime * 1000 : 0)
                    const timeStr = timeMs > 0 ? new Date(timeMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'
                    const ordPrice = Number(ord.price || 0)
                    const ordStopPrice = Number(ord.stopPrice || 0)

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
                          {ordPrice > 0 ? `$${formatPrice(ordPrice)}` : 'Market'}
                        </td>
                        <td className="py-2 px-2 text-right text-[#f0b90b]">
                          {ordStopPrice > 0 ? `$${formatPrice(ordStopPrice)}` : '—'}
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
                </div>
              </div>
            )
          )}

          {/* TAB 3: Trade History & Realized PnL */}
          {activeTab === 'history' && (
            <div className="w-full space-y-3 p-2 sm:p-3">
              {/* Summary Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="p-2.5 rounded-lg bg-[#111724] border border-[#212d40]">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Total PnL Bersih</p>
                    <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-800/40 font-mono">Net</span>
                  </div>
                  <p className={`text-base sm:text-lg font-bold font-mono mt-0.5 ${historySummary.totalPnl >= 0 ? 'text-[#00c087]' : 'text-[#f6465d]'}`}>
                    {historySummary.totalPnl >= 0 ? '+' : ''}${historySummary.totalPnl.toFixed(2)} <span className="text-[10px] font-normal text-slate-400">USDT</span>
                  </p>
                  <p className="text-[9px] text-slate-500 mt-0.5">Sudah dipotong total fee</p>
                </div>

                <div className="p-2.5 rounded-lg bg-[#111724] border border-[#212d40]">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Terpotong Fee</p>
                    <span className="text-[9px] px-1 py-0.2 rounded bg-amber-950/60 text-amber-400 border border-amber-800/40 font-mono">Komisi</span>
                  </div>
                  <p className="text-base sm:text-lg font-bold font-mono mt-0.5 text-amber-400">
                    -${historySummary.totalFee.toFixed(4)} <span className="text-[10px] font-normal text-slate-400">USDT</span>
                  </p>
                  <p className="text-[9px] text-slate-500 mt-0.5">Total komisi exchange</p>
                </div>

                <div className="p-2.5 rounded-lg bg-[#111724] border border-[#212d40]">
                  <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Win Rate Bersih</p>
                  <p className="text-base sm:text-lg font-bold font-mono mt-0.5 text-purple-400">
                    {historySummary.winRate.toFixed(1)}%
                  </p>
                  <p className="text-[9px] text-slate-500 mt-0.5">Berdasarkan trade profit bersih</p>
                </div>

                <div className="p-2.5 rounded-lg bg-[#111724] border border-[#212d40] flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">Menang / Kalah</p>
                    <p className="text-xs sm:text-sm font-bold font-mono mt-0.5">
                      <span className="text-[#00c087]">{historySummary.winning}W</span>
                      <span className="text-slate-500 mx-1">/</span>
                      <span className="text-[#f6465d]">{historySummary.losing}L</span>
                    </p>
                    <p className="text-[9px] text-slate-500 mt-0.5">{historySummary.totalCount} Trade Selesai</p>
                  </div>
                  {mode === 'demo' && history.length > 0 && (
                    <button
                      type="button"
                      onClick={handleClearHistory}
                      disabled={isClearingHistory}
                      className="px-2 py-1 rounded text-[10px] font-bold bg-rose-950/60 hover:bg-rose-900 border border-rose-800/60 text-rose-300 transition-colors"
                      title="Bersihkan riwayat paper"
                    >
                      {isClearingHistory ? '...' : 'Reset'}
                    </button>
                  )}
                </div>
              </div>

              {/* History List or Empty state */}
              {displayedHistory.length === 0 ? (
                <div className="h-44 flex flex-col items-center justify-center p-6 text-slate-500 space-y-1.5">
                  <History className="w-7 h-7 opacity-40 text-slate-400" />
                  <p className="text-xs font-semibold text-slate-400">Belum ada riwayat trade yang ditutup ({mode.toUpperCase()})</p>
                  <p className="text-[10px] text-slate-500 text-center max-w-sm">
                    {filterCurrentSymbol 
                      ? `Belum ada posisi ${currentSymbol} yang ditutup.` 
                      : 'Posisi yang ditutup manual atau terkena TP/SL akan tercatat otomatis lengkap dengan PnL di sini.'}
                  </p>
                </div>
              ) : (
                <div className="w-full">
                  {/* Mobile Cards View */}
                  <div className="block md:hidden space-y-2">
                    {displayedHistory.map((tr) => {
                      const netPnl = Number(tr.netPnl != null ? tr.netPnl : (tr.realizedPnl || 0))
                      const feeNum = Number(tr.fee || tr.commission || 0)
                      const isProfit = netPnl >= 0
                      const roeNum = tr.roePct != null ? Number(tr.roePct) : null
                      const dateStr = tr.time ? new Date(tr.time).toLocaleString('id-ID', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'

                      return (
                        <div key={`mob-hist-${tr.id}`} className="p-2.5 rounded-lg bg-[#111724] border border-[#212d40] space-y-2 text-xs">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center space-x-1.5">
                              <span className={`font-bold text-[10px] px-1.5 py-0.5 rounded ${
                                tr.side === 'LONG' || tr.side === 'BUY'
                                  ? 'bg-emerald-950 text-[#00c087] border border-emerald-800'
                                  : tr.side === 'SHORT' || tr.side === 'SELL'
                                  ? 'bg-rose-950 text-[#f6465d] border border-rose-800'
                                  : isProfit ? 'bg-emerald-950 text-[#00c087]' : 'bg-rose-950 text-[#f6465d]'
                              }`}>
                                {tr.side}
                              </span>
                              <span className="font-bold text-slate-200">{tr.symbol}</span>
                            </div>
                            <span className="text-[10px] text-slate-500 font-mono">{dateStr}</span>
                          </div>

                          <div className="flex items-center justify-between pt-1 border-t border-[#1a2332]">
                            <div>
                              <p className="text-[10px] text-slate-400">Harga Masuk / Keluar</p>
                              <p className="font-mono text-slate-300 text-[11px]">
                                {tr.entryPrice ? formatPrice(tr.entryPrice) : '-'} → {tr.closePrice ? formatPrice(tr.closePrice) : (tr.price ? formatPrice(tr.price) : '-')}
                              </p>
                              {feeNum > 0 && (
                                <p className="text-[10px] text-amber-400/90 font-mono mt-0.5">
                                  Fee: -${feeNum.toFixed(4)}
                                </p>
                              )}
                            </div>
                            <div className="text-right">
                              <p className="text-[10px] text-slate-400">PnL Bersih</p>
                              <p className={`font-bold font-mono text-xs ${isProfit ? 'text-[#00c087]' : 'text-[#f6465d]'}`}>
                                {isProfit ? '+' : ''}${netPnl.toFixed(2)}
                                {roeNum != null && (
                                  <span className="text-[10px] ml-1 font-normal opacity-90">({isProfit ? '+' : ''}{roeNum.toFixed(1)}%)</span>
                                )}
                              </p>
                              <span className={`inline-block text-[9px] px-1.5 py-0.2 rounded font-bold mt-0.5 ${
                                isProfit
                                  ? 'bg-emerald-950/80 text-[#00c087] border border-emerald-800/60'
                                  : 'bg-rose-950/80 text-[#f6465d] border border-rose-800/60'
                              }`}>
                                {isProfit ? 'WIN' : 'LOSS'}
                              </span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>

                  {/* Desktop Table View */}
                  <div className="hidden md:block overflow-x-auto rounded-lg border border-[#212d40]">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-[#141b27] text-slate-400 text-[10px] font-semibold border-b border-[#212d40] uppercase tracking-wider">
                          <th className="py-2.5 px-3">Waktu</th>
                          <th className="py-2.5 px-3">Simbol</th>
                          <th className="py-2.5 px-3">Arah</th>
                          <th className="py-2.5 px-3 text-right">Harga Masuk</th>
                          <th className="py-2.5 px-3 text-right">Harga Keluar</th>
                          <th className="py-2.5 px-3 text-right">Jumlah</th>
                          <th className="py-2.5 px-3 text-right">Fee Terpotong</th>
                          <th className="py-2.5 px-3 text-right">PnL Bersih</th>
                          <th className="py-2.5 px-3 text-center">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#1c2638] bg-[#0c1017]">
                        {displayedHistory.map((tr) => {
                          const netPnl = Number(tr.netPnl != null ? tr.netPnl : (tr.realizedPnl || 0))
                          const feeNum = Number(tr.fee || tr.commission || 0)
                          const isProfit = netPnl >= 0
                          const roeNum = tr.roePct != null ? Number(tr.roePct) : null
                          const dateStr = tr.time ? new Date(tr.time).toLocaleString('id-ID', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'

                          return (
                            <tr key={`dt-hist-${tr.id}`} className="hover:bg-[#141b28] transition-colors">
                              <td className="py-2 px-3 font-mono text-[10px] text-slate-400">{dateStr}</td>
                              <td className="py-2 px-3 font-bold text-slate-200">{tr.symbol}</td>
                              <td className="py-2 px-3">
                                <span className={`font-bold text-[10px] px-1.5 py-0.5 rounded ${
                                  tr.side === 'LONG' || tr.side === 'BUY'
                                    ? 'bg-emerald-950 text-[#00c087] border border-emerald-800'
                                    : tr.side === 'SHORT' || tr.side === 'SELL'
                                    ? 'bg-rose-950 text-[#f6465d] border border-rose-800'
                                    : isProfit ? 'bg-emerald-950 text-[#00c087]' : 'bg-rose-950 text-[#f6465d]'
                                }`}>
                                  {tr.side}
                                </span>
                              </td>
                              <td className="py-2 px-3 text-right font-mono text-slate-300">
                                {tr.entryPrice ? formatPrice(tr.entryPrice) : '-'}
                              </td>
                              <td className="py-2 px-3 text-right font-mono text-slate-300">
                                {tr.closePrice ? formatPrice(tr.closePrice) : (tr.price ? formatPrice(tr.price) : '-')}
                              </td>
                              <td className="py-2 px-3 text-right font-mono text-slate-300">
                                {tr.quantity ? tr.quantity.toLocaleString('en-US', { maximumFractionDigits: 4 }) : '-'}
                              </td>
                              <td className="py-2 px-3 text-right font-mono text-slate-400 text-xs">
                                {feeNum > 0 ? (
                                  <span className="text-amber-400/90 font-mono">-${feeNum.toFixed(4)}</span>
                                ) : (
                                  <span className="text-slate-500 font-mono">$0.0000</span>
                                )}
                              </td>
                              <td className="py-2 px-3 text-right font-mono font-bold">
                                <span className={isProfit ? 'text-[#00c087]' : 'text-[#f6465d]'}>
                                  {isProfit ? '+' : ''}${netPnl.toFixed(2)}
                                </span>
                                {roeNum != null && (
                                  <span className={`block text-[10px] font-normal ${isProfit ? 'text-emerald-400/80' : 'text-rose-400/80'}`}>
                                    {isProfit ? '+' : ''}{roeNum.toFixed(1)}%
                                  </span>
                                )}
                              </td>
                              <td className="py-2 px-3 text-center">
                                <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                                  isProfit
                                    ? 'bg-emerald-950/80 text-[#00c087] border border-emerald-800/60'
                                    : 'bg-rose-950/80 text-[#f6465d] border border-rose-800/60'
                                }`}>
                                  {isProfit ? 'WIN' : 'LOSS'}
                                </span>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      )}

      {/* 3. Floating Modal to Set or Edit SL / TP for Open Position */}
      {bracketModalPos && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
          <div className="w-full max-w-sm bg-[#121824] border border-[#2b384e] rounded-xl shadow-2xl p-5 text-slate-100 font-sans">
            <div className="flex items-center justify-between border-b border-[#212b3c] pb-3 mb-4">
              <div className="flex items-center space-x-2">
                <Shield className="w-5 h-5 text-[#f0b90b]" />
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center space-x-1.5">
                    <span>Atur SL & TP: {bracketModalPos.symbol}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-mono font-bold ${
                        bracketModalPos.side === 'LONG'
                          ? 'bg-emerald-950 text-[#00c087] border border-emerald-800'
                          : 'bg-rose-950 text-[#f6465d] border border-rose-800'
                      }`}
                    >
                      {bracketModalPos.side} {bracketModalPos.leverage}x
                    </span>
                  </h3>
                  <p className="text-[10px] text-slate-400 font-mono mt-0.5">
                    Entry: ${formatPrice(bracketModalPos.entryPrice)} | Mark: ${formatPrice(bracketModalPos.markPrice)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setBracketModalPos(null)}
                className="text-slate-400 hover:text-white p-1 rounded transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {bracketError && (
              <div className="mb-3 p-2.5 rounded bg-rose-950/80 border border-rose-800/80 text-[#f6465d] text-xs flex items-start space-x-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span className="leading-tight">{bracketError}</span>
              </div>
            )}

            <div className="space-y-4 text-xs">
              {/* Stop Loss Field */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="font-semibold text-slate-300 flex items-center space-x-1 text-[11px]">
                    <span className="w-2 h-2 rounded-full bg-[#f6465d]" />
                    <span>Stop Loss Price ($)</span>
                  </label>
                  <div className="flex items-center space-x-1">
                    <span className="text-[10px] text-slate-400 font-sans">Hitung SL per Risk:</span>
                    {[10, 20, 50, 100, 250].map((amt) => (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => handleCalculateSlForRisk(amt)}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-[#1c2434] hover:bg-[#253045] border border-[#2d384c] text-[#f0b90b] font-mono font-bold transition-colors"
                        title={`Hitung SL agar kerugian posisi ini tepat $${amt}`}
                      >
                        ${amt}
                      </button>
                    ))}
                  </div>
                </div>
                <input
                  type="number"
                  step="any"
                  value={bracketSlInput}
                  onChange={(e) => setBracketSlInput(e.target.value)}
                  placeholder="Contoh: 42.50"
                  className="w-full bg-[#0b0e14] border border-[#2b384e] focus:border-[#f6465d] focus:ring-1 focus:ring-[#f6465d] rounded px-3 py-2 text-white font-mono text-sm outline-none"
                />
                {calcSlRiskText && (
                  <div className="mt-1 text-[10px] text-slate-400 font-mono flex items-center justify-between">
                    <span>Estimasi Kerugian:</span>
                    <span className="text-[#f6465d] font-bold">{calcSlRiskText}</span>
                  </div>
                )}
              </div>

              {/* Take Profit Field */}
              <div>
                <label className="block font-semibold text-slate-300 mb-1.5 text-[11px] flex items-center space-x-1">
                  <span className="w-2 h-2 rounded-full bg-[#00c087]" />
                  <span>Take Profit Price ($)</span>
                </label>
                <input
                  type="number"
                  step="any"
                  value={bracketTpInput}
                  onChange={(e) => setBracketTpInput(e.target.value)}
                  placeholder="Contoh: 48.00"
                  className="w-full bg-[#0b0e14] border border-[#2b384e] focus:border-[#00c087] focus:ring-1 focus:ring-[#00c087] rounded px-3 py-2 text-white font-mono text-sm outline-none"
                />
                {calcTpRewardText && (
                  <div className="mt-1 text-[10px] text-slate-400 font-mono flex items-center justify-between">
                    <span>Estimasi Keuntungan:</span>
                    <span className="text-[#00c087] font-bold">{calcTpRewardText}</span>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="pt-2 flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => setBracketModalPos(null)}
                  className="flex-1 py-2 rounded bg-[#1c2434] hover:bg-[#253046] text-slate-300 font-semibold text-xs transition-colors"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleSaveBrackets}
                  disabled={isSavingBrackets}
                  className="flex-1 py-2 rounded bg-[#f0b90b] hover:bg-[#dfaa05] text-[#0b0e14] font-bold text-xs shadow-lg transition-all disabled:opacity-50 flex items-center justify-center space-x-1"
                >
                  {isSavingBrackets ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Memasang...</span>
                    </>
                  ) : (
                    <span>Pasang SL & TP</span>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* API Credentials Setup Modal */}
      <ApiCredentialsModal
        isOpen={isApiModalOpen}
        onClose={() => setIsApiModalOpen(false)}
      />
    </div>
  )
}
