import React, { useState, useEffect } from 'react'
import {
  X,
  Play,
  Square,
  AlertTriangle,
  RotateCcw,
  ShieldAlert,
  Sliders,
  Terminal,
  Activity,
  Layers,
  CheckCircle2,
  Lock,
  ArrowUpRight,
  ArrowDownRight,
  Zap,
  Info
} from 'lucide-react'
import {
  AutoBotStatusResponse,
  AutoBotConfig,
  fetchAutoBotStatus,
  updateAutoBotConfig,
  startAutoBot,
  stopAutoBot,
  resetAutoBotCircuitBreaker,
  panicCloseAllAutoBot
} from '../../services/autobotApi'
import { formatPrice } from '../../utils/formatters'

interface AutoBotDrawerProps {
  isOpen: boolean
  onClose: () => void
  currentSymbol: string
  onSelectSymbol?: (symbol: string) => void
}

export const AutoBotDrawer: React.FC<AutoBotDrawerProps> = ({
  isOpen,
  onClose,
  currentSymbol,
  onSelectSymbol
}) => {
  const [data, setData] = useState<AutoBotStatusResponse | null>(null)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [actionMsg, setActionMsg] = useState<{ success: boolean; text: string } | null>(null)

  // Local form editing states
  const [riskPerTrade, setRiskPerTrade] = useState<number>(4.0)
  const [maxDailyLoss, setMaxDailyLoss] = useState<number>(16.0)
  const [maxPositions, setMaxPositions] = useState<number>(4)
  const [leverage, setLeverage] = useState<number>(10)
  const [mode, setMode] = useState<'demo' | 'live'>('demo')
  const [timeframe, setTimeframe] = useState<string>('15m')
  const [isSavingConfig, setIsSavingConfig] = useState<boolean>(false)
  const [confirmPanic, setConfirmPanic] = useState<boolean>(false)

  // Sync credentials from LocalStorage
  const getStoredCredentials = () => {
    try {
      const raw = localStorage.getItem('cp_trade_credentials_v1')
      if (raw) return JSON.parse(raw)
    } catch {}
    return { demoApiKey: '', demoApiSecret: '', liveApiKey: '', liveApiSecret: '' }
  }

  // Load status
  const loadStatus = async () => {
    const res = await fetchAutoBotStatus()
    if (res) {
      setData(res)
      setRiskPerTrade(res.config.risk_per_trade_usd)
      setMaxDailyLoss(res.config.max_daily_loss_usd)
      setMaxPositions(res.config.max_concurrent_positions)
      setLeverage(res.config.leverage)
      setMode(res.config.mode)
      setTimeframe(res.config.timeframe)
    }
  }

  useEffect(() => {
    if (isOpen) {
      loadStatus()
      const interval = setInterval(loadStatus, 4000)
      return () => clearInterval(interval)
    }
  }, [isOpen])

  const showNotification = (success: boolean, text: string) => {
    setActionMsg({ success, text })
    setTimeout(() => setActionMsg(null), 4000)
  }

  // Handle Save Settings
  const handleSaveConfig = async () => {
    setIsSavingConfig(true)
    const creds = getStoredCredentials()
    const payload: Partial<AutoBotConfig> = {
      risk_per_trade_usd: Number(riskPerTrade),
      max_daily_loss_usd: Number(maxDailyLoss),
      max_concurrent_positions: Number(maxPositions),
      leverage: Number(leverage),
      mode,
      timeframe,
      api_key: mode === 'live' ? creds.liveApiKey : creds.demoApiKey,
      api_secret: mode === 'live' ? creds.liveApiSecret : creds.demoApiSecret
    }
    const ok = await updateAutoBotConfig(payload)
    setIsSavingConfig(false)
    if (ok) {
      showNotification(true, 'Pengaturan risiko bot berhasil disimpan!')
      loadStatus()
    } else {
      showNotification(false, 'Gagal menyimpan pengaturan bot.')
    }
  }

  // Toggle Bot Start / Stop
  const handleToggleBot = async () => {
    setIsLoading(true)
    const isCurrentlyEnabled = data?.config.enabled ?? false
    if (isCurrentlyEnabled) {
      const res = await stopAutoBot()
      showNotification(res.success, res.message)
    } else {
      // First save current inputs and credentials
      const creds = getStoredCredentials()
      await updateAutoBotConfig({
        risk_per_trade_usd: Number(riskPerTrade) || 4.0,
        max_daily_loss_usd: Number(maxDailyLoss) || 16.0,
        max_concurrent_positions: Number(maxPositions) || 4,
        leverage: Number(leverage) || 10,
        mode,
        timeframe,
        api_key: mode === 'live' ? creds.liveApiKey : creds.demoApiKey,
        api_secret: mode === 'live' ? creds.liveApiSecret : creds.demoApiSecret
      })
      const res = await startAutoBot()
      showNotification(res.success, res.message)
    }
    setIsLoading(false)
    await loadStatus()
  }

  // Reset Circuit Breaker
  const handleResetBreaker = async () => {
    const ok = await resetAutoBotCircuitBreaker()
    if (ok) {
      showNotification(true, 'Batas risiko harian berhasil direset ke $0.')
      loadStatus()
    }
  }

  // Panic Close All
  const handlePanicClose = async () => {
    if (!confirmPanic) {
      setConfirmPanic(true)
      return
    }
    setIsLoading(true)
    const res = await panicCloseAllAutoBot()
    setIsLoading(false)
    setConfirmPanic(false)
    showNotification(res.success, res.message)
    loadStatus()
  }

  if (!isOpen) return null

  const isEnabled = data?.config?.enabled || false
  const isCircuitBreaker = data?.state?.circuit_breaker_triggered || false
  const activePositions = data?.state?.active_positions || []
  const pendingOrders = data?.state?.pending_orders || []
  const totalOccupied = activePositions.length + pendingOrders.length
  const maxSlots = data?.config?.max_concurrent_positions || 4
  const dailyPnL = data?.state?.daily_realized_pnl || 0.0

  return (
    <div className="fixed inset-0 z-50 overflow-hidden select-none animate-fadeIn">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" 
        onClick={onClose} 
      />

      {/* Slide-over panel */}
      <aside className="absolute inset-y-0 right-0 max-w-2xl w-full bg-[#0d1117] border-l border-[#21262d] shadow-2xl flex flex-col z-10 text-slate-200">
        {/* Header */}
        <div className="h-16 px-6 border-b border-[#21262d] flex items-center justify-between bg-[#111620]">
          <div className="flex items-center space-x-3">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shadow-lg ${
              isEnabled 
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 shadow-emerald-500/10' 
                : 'bg-[#1e2533] text-slate-400 border border-[#30363d]'
            }`}>
              <Zap className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold text-white tracking-wide">AUTO-BOT RADAR TRADING</h2>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                  mode === 'live'
                    ? 'bg-rose-950/80 text-rose-400 border border-rose-800/60'
                    : 'bg-blue-950/80 text-blue-400 border border-blue-800/60'
                }`}>
                  {mode === 'live' ? '🔴 Live Binance' : '🟢 Demo Testnet'}
                </span>
              </div>
              <p className="text-xs text-slate-400">Eksekusi otomatis setup A+ radar (Market / Limit) dengan SL & TP bracket.</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-[#1f2634] transition-all"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action message banner */}
        {actionMsg && (
          <div className={`px-6 py-2.5 text-xs font-medium flex items-center space-x-2 border-b ${
            actionMsg.success 
              ? 'bg-emerald-950/70 text-emerald-300 border-emerald-800/60' 
              : 'bg-rose-950/70 text-rose-300 border-rose-800/60'
          }`}>
            <Info className="w-4 h-4 shrink-0" />
            <span>{actionMsg.text}</span>
          </div>
        )}

        {/* Content Container */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6 custom-scrollbar">
          
          {/* Master Switch & Status Card */}
          <div className={`p-5 rounded-2xl border transition-all ${
            isCircuitBreaker
              ? 'bg-rose-950/30 border-rose-700/60 shadow-lg shadow-rose-950/20'
              : isEnabled
              ? 'bg-emerald-950/20 border-emerald-600/50 shadow-lg shadow-emerald-950/20'
              : 'bg-[#161b22] border-[#30363d]'
          }`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center space-x-2 mb-1">
                  <span className={`w-3 h-3 rounded-full ${
                    isCircuitBreaker 
                      ? 'bg-rose-500 animate-pulse' 
                      : isEnabled 
                      ? 'bg-emerald-400 animate-ping' 
                      : 'bg-slate-500'
                  }`} />
                  <span className="text-xs font-bold font-mono tracking-wider uppercase text-slate-300">
                    STATUS EKSEKUSI BOT:
                  </span>
                </div>
                <div className="text-lg font-extrabold text-white">
                  {isCircuitBreaker ? (
                    <span className="text-rose-400">🔴 CIRCUIT BREAKER HIT (MAKS LOSS TERCAPAI)</span>
                  ) : isEnabled ? (
                    <span className="text-emerald-400">🟢 AKTIF BERJALAN ({totalOccupied}/{maxSlots} Slot Terisi)</span>
                  ) : (
                    <span className="text-slate-400">🟡 NONAKTIF / HIBERNASI (OFF)</span>
                  )}
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  {isEnabled
                    ? 'Bot terus memantau setup terbaik dan mengelola posisi 24/7 di VPS.'
                    : 'Bot sedang mati lelap. Sistem trading manual Anda bebas digunakan 100% tanpa campur tangan bot.'}
                </p>
              </div>

              {/* Action Button Toggle */}
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={handleToggleBot}
                  disabled={isLoading}
                  className={`flex items-center space-x-2 px-5 py-2.5 rounded-xl font-bold text-xs uppercase tracking-wider transition-all shadow-md ${
                    isEnabled
                      ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-900/30'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/30'
                  } disabled:opacity-50`}
                >
                  {isEnabled ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                  <span>{isEnabled ? 'MATIKAN BOT' : 'AKTIFKAN BOT'}</span>
                </button>
              </div>
            </div>

            {/* Daily Drawdown Meter */}
            <div className="mt-4 pt-4 border-t border-[#30363d]/60">
              <div className="flex items-center justify-between text-xs mb-1.5">
                <span className="text-slate-400">Akumulasi Realized PnL Hari Ini (UTC):</span>
                <span className={`font-mono font-bold ${dailyPnL >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {dailyPnL >= 0 ? `+$${dailyPnL.toFixed(2)}` : `-$${Math.abs(dailyPnL).toFixed(2)}`} / Maks Batas: ${maxDailyLoss.toFixed(2)}
                </span>
              </div>
              <div className="w-full h-2 rounded-full bg-[#21262d] overflow-hidden">
                <div 
                  className={`h-full transition-all duration-500 ${
                    dailyPnL < 0 ? (isCircuitBreaker ? 'bg-rose-500' : 'bg-amber-500') : 'bg-emerald-500'
                  }`}
                  style={{
                    width: `${Math.min(100, Math.max(0, (Math.abs(dailyPnL) / maxDailyLoss) * 100))}%`
                  }}
                />
              </div>

              {isCircuitBreaker && (
                <div className="mt-3 flex items-center justify-between bg-rose-950/60 p-2.5 rounded-lg border border-rose-800/50">
                  <span className="text-xs text-rose-300">Trading dijeda demi melindungi modal. Reset manual jika ingin lanjut.</span>
                  <button
                    onClick={handleResetBreaker}
                    className="flex items-center space-x-1 px-2.5 py-1 rounded bg-rose-800 hover:bg-rose-700 text-white text-xs font-bold"
                  >
                    <RotateCcw className="w-3 h-3" />
                    <span>Reset Kuota</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 4 Concurrent Position Slots */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center space-x-2">
                <Layers className="w-4 h-4 text-[#f0b90b]" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                  Slot Posisi Berjalan ({totalOccupied} / {maxSlots} Terbuka)
                </h3>
              </div>
              <span className="text-[11px] text-slate-400">Maksimal 4 pair berbeda secara bersamaan</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {Array.from({ length: maxSlots }).map((_, idx) => {
                const pos = activePositions[idx]
                const pend = !pos && pendingOrders[idx - activePositions.length]

                if (pos) {
                  const contracts = parseFloat(pos.contracts || pos.positionAmt || pos.size || 0)
                  const isLong = pos.side === 'BUY' || pos.side === 'LONG' || parseFloat(pos.positionAmt || 0) > 0
                  const pnl = parseFloat(pos.unrealizedPnl ?? pos.unrealizedProfit ?? 0)
                  return (
                    <div 
                      key={`slot_pos_${idx}`}
                      className="p-3.5 rounded-xl bg-[#161b22] border border-emerald-500/30 hover:border-emerald-500/60 transition-all flex flex-col justify-between"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-1.5">
                          <span className="font-bold text-sm text-white font-mono">{pos.symbol}</span>
                          <span className={`text-[10px] font-bold px-1.5 py-0.2 rounded font-mono ${
                            isLong ? 'bg-emerald-950 text-emerald-400' : 'bg-rose-950 text-rose-400'
                          }`}>
                            {isLong ? 'LONG ▲' : 'SHORT ▼'}
                          </span>
                        </div>
                        <span className={`text-xs font-bold font-mono ${pnl >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {pnl >= 0 ? `+$${pnl.toFixed(2)}` : `-$${Math.abs(pnl).toFixed(2)}`}
                        </span>
                      </div>

                      <div className="text-[11px] font-mono text-slate-400 space-y-0.5 mb-2.5">
                        <div className="flex justify-between">
                          <span>Entry:</span>
                          <span className="text-slate-200">${formatPrice(pos.entryPrice)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Kuantitas:</span>
                          <span className="text-slate-200">{Math.abs(contracts)}</span>
                        </div>
                      </div>

                      {onSelectSymbol && (
                        <button
                          type="button"
                          onClick={() => onSelectSymbol(pos.symbol)}
                          className="w-full py-1 text-[11px] rounded bg-[#21262d] hover:bg-[#30363d] text-slate-300 font-medium transition-all"
                        >
                          Lihat di Chart
                        </button>
                      )}
                    </div>
                  )
                }

                if (pend) {
                  return (
                    <div 
                      key={`slot_pend_${idx}`}
                      className="p-3.5 rounded-xl bg-[#161b22] border border-amber-500/30 hover:border-amber-500/60 transition-all flex flex-col justify-between"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-1.5">
                          <span className="font-bold text-sm text-white font-mono">{pend.symbol}</span>
                          <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-amber-950 text-amber-400 font-mono">
                            LIMIT JEMPUTAN ⏳
                          </span>
                        </div>
                        <span className="text-[10px] text-amber-400 font-mono">Menunggu Retest</span>
                      </div>
                      <div className="text-[11px] font-mono text-slate-400 space-y-0.5 mb-2.5">
                        <div className="flex justify-between">
                          <span>Harga Antre:</span>
                          <span className="text-slate-200">${formatPrice(pend.price)}</span>
                        </div>
                        <div className="flex justify-between">
                          <span>Qty:</span>
                          <span className="text-slate-200">{pend.origQty}</span>
                        </div>
                      </div>
                      <span className="text-[10px] text-slate-500 text-center italic">
                        Invalid jika tembus SL / dekati TP
                      </span>
                    </div>
                  )
                }

                return (
                  <div 
                    key={`slot_empty_${idx}`}
                    className="p-4 rounded-xl border border-dashed border-[#30363d] bg-[#111620]/40 flex flex-col items-center justify-center text-center min-h-[110px]"
                  >
                    <div className="w-6 h-6 rounded-full bg-[#1e2533] flex items-center justify-center text-slate-500 mb-1.5">
                      <span className="text-[11px] font-bold font-mono">#{idx + 1}</span>
                    </div>
                    <span className="text-xs font-medium text-slate-400">Slot Kosong</span>
                    <span className="text-[10px] text-slate-500">Mencari setup A+ terbaik...</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Risk Management Settings Form */}
          <div className="p-5 rounded-2xl bg-[#161b22] border border-[#30363d] space-y-4">
            <div className="flex items-center justify-between border-b border-[#21262d] pb-3">
              <div className="flex items-center space-x-2">
                <Sliders className="w-4 h-4 text-[#f0b90b]" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-white">
                  Pengaturan Manajemen Risiko Fleksibel
                </h3>
              </div>
              <span className="text-[11px] text-slate-400">Bebas diatur kapan saja</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Risk Per Position */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Risk Per Posisi (USDT):
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-slate-500 text-xs font-mono">$</span>
                  <input
                    type="number"
                    min="1"
                    max="500"
                    step="0.5"
                    value={riskPerTrade}
                    onChange={(e) => setRiskPerTrade(parseFloat(e.target.value) || 0)}
                    className="w-full bg-[#0d1117] border border-[#30363d] focus:border-[#f0b90b] rounded-lg pl-7 pr-3 py-2 text-xs font-mono text-white outline-none"
                  />
                </div>
                <div className="flex items-center space-x-1.5 mt-1.5">
                  {[2, 4, 5, 10, 20].map((v) => (
                    <button
                      key={`preset_risk_${v}`}
                      type="button"
                      onClick={() => setRiskPerTrade(v)}
                      className={`text-[10px] px-2 py-0.5 rounded font-mono ${
                        riskPerTrade === v 
                          ? 'bg-[#f0b90b] text-black font-bold' 
                          : 'bg-[#21262d] text-slate-400 hover:text-white'
                      }`}
                    >
                      ${v}
                    </button>
                  ))}
                </div>
              </div>

              {/* Max Daily Loss */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Maks Rugi Harian / Circuit Breaker ($):
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-2.5 text-slate-500 text-xs font-mono">$</span>
                  <input
                    type="number"
                    min="2"
                    max="2000"
                    step="1"
                    value={maxDailyLoss}
                    onChange={(e) => setMaxDailyLoss(parseFloat(e.target.value) || 0)}
                    className="w-full bg-[#0d1117] border border-[#30363d] focus:border-[#f0b90b] rounded-lg pl-7 pr-3 py-2 text-xs font-mono text-white outline-none"
                  />
                </div>
                <div className="flex items-center space-x-1.5 mt-1.5">
                  {[8, 16, 20, 40, 80].map((v) => (
                    <button
                      key={`preset_maxloss_${v}`}
                      type="button"
                      onClick={() => setMaxDailyLoss(v)}
                      className={`text-[10px] px-2 py-0.5 rounded font-mono ${
                        maxDailyLoss === v 
                          ? 'bg-[#f0b90b] text-black font-bold' 
                          : 'bg-[#21262d] text-slate-400 hover:text-white'
                      }`}
                    >
                      ${v}
                    </button>
                  ))}
                </div>
              </div>

              {/* Max Concurrent Positions */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Maks Posisi Terbuka Simultan:
                </label>
                <select
                  value={maxPositions}
                  onChange={(e) => setMaxPositions(parseInt(e.target.value, 10))}
                  className="w-full bg-[#0d1117] border border-[#30363d] focus:border-[#f0b90b] rounded-lg px-3 py-2 text-xs font-mono text-white outline-none"
                >
                  <option value={1}>1 Posisi (Sekuensial Murni)</option>
                  <option value={2}>2 Posisi Bersamaan</option>
                  <option value={3}>3 Posisi Bersamaan</option>
                  <option value={4}>4 Posisi Bersamaan (Default)</option>
                  <option value={5}>5 Posisi Bersamaan</option>
                </select>
              </div>

              {/* Leverage Slider */}
              <div>
                <div className="flex items-center justify-between text-xs font-medium text-slate-300 mb-1">
                  <span>Leverage:</span>
                  <span className="font-mono font-bold text-[#f0b90b]">{leverage}x</span>
                </div>
                <input
                  type="range"
                  min="2"
                  max="50"
                  step="1"
                  value={leverage}
                  onChange={(e) => setLeverage(parseInt(e.target.value, 10))}
                  className="w-full accent-[#f0b90b]"
                />
              </div>

              {/* Account Mode */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Mode Akun Eksekusi:
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setMode('demo')}
                    className={`py-1.5 rounded-lg text-xs font-bold transition-all ${
                      mode === 'demo'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'bg-[#21262d] text-slate-400 hover:text-white'
                    }`}
                  >
                    Demo (Testnet)
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('live')}
                    className={`py-1.5 rounded-lg text-xs font-bold transition-all ${
                      mode === 'live'
                        ? 'bg-rose-600 text-white shadow-sm'
                        : 'bg-[#21262d] text-slate-400 hover:text-white'
                    }`}
                  >
                    Live (Akun Riil)
                  </button>
                </div>
              </div>

              {/* Timeframe */}
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  Timeframe Radar:
                </label>
                <select
                  value={timeframe}
                  onChange={(e) => setTimeframe(e.target.value)}
                  className="w-full bg-[#0d1117] border border-[#30363d] focus:border-[#f0b90b] rounded-lg px-3 py-2 text-xs font-mono text-white outline-none"
                >
                  <option value="5m">5 Menit (5m)</option>
                  <option value="15m">15 Menit (15m - Standar)</option>
                  <option value="30m">30 Menit (30m)</option>
                  <option value="1h">1 Jam (1h)</option>
                  <option value="4h">4 Jam (4h)</option>
                </select>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={handleSaveConfig}
                disabled={isSavingConfig}
                className="px-4 py-2 rounded-lg bg-[#21262d] hover:bg-[#30363d] text-white text-xs font-bold transition-all flex items-center space-x-1.5"
              >
                <CheckCircle2 className="w-3.5 h-3.5 text-[#f0b90b]" />
                <span>Simpan Pengaturan Risiko</span>
              </button>
            </div>
          </div>

          {/* Emergency Panic Button */}
          <div className="p-4 rounded-xl bg-rose-950/20 border border-rose-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center space-x-1.5 text-rose-400 font-bold text-xs uppercase mb-0.5">
                <ShieldAlert className="w-4 h-4" />
                <span>TOMBOL DARURAT / PANIC BUTTON</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Seketika menutup seluruh posisi aktif di pasar dan mencabut semua antrean limit.
              </p>
            </div>
            <button
              type="button"
              onClick={handlePanicClose}
              disabled={isLoading}
              className={`px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all shrink-0 ${
                confirmPanic
                  ? 'bg-rose-500 hover:bg-rose-400 text-white animate-pulse'
                  : 'bg-rose-900/60 hover:bg-rose-800 text-rose-200 border border-rose-700/60'
              }`}
            >
              {confirmPanic ? 'YAKIN TUTUP SEMUA?' : 'TUTUP SEMUA POSISI'}
            </button>
          </div>

          {/* Execution Terminal Activity Logs */}
          <div className="p-4 rounded-xl bg-[#090d13] border border-[#21262d]">
            <div className="flex items-center space-x-2 text-xs font-bold uppercase text-slate-300 font-mono mb-2.5">
              <Terminal className="w-4 h-4 text-emerald-400" />
              <span>TERMINAL LOG AKTIVITAS BOT (REALTIME)</span>
            </div>
            <div className="h-44 overflow-y-auto space-y-1.5 text-[11px] font-mono custom-scrollbar pr-2">
              {data?.recent_logs && data.recent_logs.length > 0 ? (
                data.recent_logs.map((l, i) => (
                  <div key={`log_${i}`} className="flex items-start space-x-2">
                    <span className="text-slate-500 shrink-0">[{l.time_str}]</span>
                    <span className={`break-words ${
                      l.level === 'SUCCESS' ? 'text-emerald-400' :
                      l.level === 'ERROR' ? 'text-rose-400' :
                      l.level === 'WARN' ? 'text-amber-400' : 'text-slate-300'
                    }`}>
                      {l.message}
                    </span>
                  </div>
                ))
              ) : (
                <div className="text-slate-600 text-center py-8">
                  Belum ada log aktivitas bot. Aktifkan bot untuk memulai pemantauan.
                </div>
              )}
            </div>
          </div>

        </div>
      </aside>
    </div>
  )
}
