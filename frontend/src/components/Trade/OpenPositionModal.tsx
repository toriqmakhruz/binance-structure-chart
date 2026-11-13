import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  TradeAccountMode,
  TradeCredentials,
  TradeBalanceResponse,
  TradeOrderResponse
} from '../../types/analysis'
import {
  fetchTradeBalance,
  testTradeConnection,
  fetchTradeRules,
  executeTradeOrder
} from '../../services/api'
import { formatPrice } from '../../utils/formatters'
import {
  X,
  Target,
  ShieldCheck,
  AlertTriangle,
  KeyRound,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Lock,
  Wallet,
  Zap,
  Check,
  ChevronDown,
  ChevronUp
} from 'lucide-react'

export interface SetupTradeTarget {
  symbol: string
  market: 'spot' | 'futures'
  direction: 'LONG' | 'SHORT'
  name?: string
  entry_price: number
  invalidation_price: number
  target_price: number
  risk_reward_ratio?: number
  confluence_score?: number
}

interface OpenPositionModalProps {
  isOpen: boolean
  target: SetupTradeTarget | null
  currentPrice?: number
  onClose: () => void
  onSuccess?: (orderRes: TradeOrderResponse) => void
}

const STORAGE_KEYS = {
  credentials: 'cp_trade_credentials',
  accountMode: 'cp_trade_active_mode',
  lastLeverage: 'cp_trade_last_leverage',
  riskValue: 'cp_trade_risk_value',
  riskMode: 'cp_trade_risk_mode'
}

function readStoredCredentials(): TradeCredentials {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.credentials)
    if (!raw) {
      return {
        demoApiKey: '',
        demoApiSecret: '',
        liveApiKey: '',
        liveApiSecret: '',
        useSimulatedDemo: true
      }
    }
    return JSON.parse(raw)
  } catch {
    return {
      demoApiKey: '',
      demoApiSecret: '',
      liveApiKey: '',
      liveApiSecret: '',
      useSimulatedDemo: true
    }
  }
}

export const OpenPositionModal: React.FC<OpenPositionModalProps> = ({
  isOpen,
  target,
  currentPrice,
  onClose,
  onSuccess
}) => {
  // 1. Account Mode: DEMO vs LIVE
  const [mode, setMode] = useState<TradeAccountMode>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEYS.accountMode)
      return saved === 'live' ? 'live' : 'demo'
    } catch {
      return 'demo'
    }
  })

  // 2. Credentials state
  const [credentials, setCredentials] = useState<TradeCredentials>(() => readStoredCredentials())
  const [showApiSettings, setShowApiSettings] = useState<boolean>(false)
  const [apiTesting, setApiTesting] = useState<boolean>(false)
  const [apiStatusMsg, setApiStatusMsg] = useState<{ success: boolean; text: string } | null>(null)

  // 3. Balance state
  const [balance, setBalance] = useState<number>(10000)
  const [isBalanceLoading, setIsBalanceLoading] = useState<boolean>(false)
  const [balanceMsg, setBalanceMsg] = useState<string>('')

  // 4. Order parameters
  const [orderType, setOrderType] = useState<'MARKET' | 'LIMIT'>('MARKET')
  const [entryInput, setEntryInput] = useState<string>('')
  const [slInput, setSlInput] = useState<string>('')
  const [tpInput, setTpInput] = useState<string>('')
  const [leverage, setLeverage] = useState<number>(10)
  const [attachBracket, setAttachBracket] = useState<boolean>(true)

  // Sizing inputs
  const [riskMode, setRiskMode] = useState<'USDT' | 'PERCENT'>('USDT')
  const [riskValue, setRiskValue] = useState<number>(25)

  // Symbol rules from Binance
  const [rules, setRules] = useState<{ stepSize: number; tickSize: number; minQty: number; minNotional: number }>({
    stepSize: 0.001,
    tickSize: 0.01,
    minQty: 0.001,
    minNotional: 5.0
  })

  // Execution states
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false)
  const [executionResult, setExecutionResult] = useState<TradeOrderResponse | null>(null)
  const [confirmLiveOpen, setConfirmLiveOpen] = useState<boolean>(false)

  // Persist settings
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.accountMode, mode)
    } catch {}
  }, [mode])

  // Sync inputs when target setup changes or modal opens
  useEffect(() => {
    if (!isOpen || !target) return

    setEntryInput(target.entry_price > 0 ? String(target.entry_price) : (currentPrice ? String(currentPrice) : ''))
    setSlInput(target.invalidation_price > 0 ? String(target.invalidation_price) : '')
    setTpInput(target.target_price > 0 ? String(target.target_price) : '')
    setExecutionResult(null)
    setConfirmLiveOpen(false)

    // Load symbol precision & minNotional
    fetchTradeRules(target.symbol, target.market, mode).then((res) => {
      if (res) {
        setRules({
          stepSize: res.stepSize || 0.001,
          tickSize: res.tickSize || 0.01,
          minQty: res.minQty || 0.001,
          minNotional: res.minNotional || 5.0
        })
      }
    })
  }, [isOpen, target, currentPrice, mode])

  // Active key pair depending on current mode
  const activeKey = mode === 'demo' ? credentials.demoApiKey : credentials.liveApiKey
  const activeSecret = mode === 'demo' ? credentials.demoApiSecret : credentials.liveApiSecret

  // Load live balance
  const loadBalance = useCallback(async (currentMode = mode) => {
    if (!target) return
    setIsBalanceLoading(true)
    setBalanceMsg('')
    try {
      const curKey = currentMode === 'demo' ? credentials.demoApiKey : credentials.liveApiKey
      const curSecret = currentMode === 'demo' ? credentials.demoApiSecret : credentials.liveApiSecret
      const res = await fetchTradeBalance(target.market, currentMode, curKey, curSecret)
      if (res.success) {
        setBalance(res.availableBalance)
        setBalanceMsg(res.is_simulated ? 'Saldo Paper Trading' : `Tersedia: $${res.availableBalance.toFixed(2)}`)
      } else {
        setBalanceMsg(res.message || 'Gagal mengambil saldo')
      }
    } catch (err: any) {
      setBalanceMsg(err?.message || 'Error koneksi saldo')
    } finally {
      setIsBalanceLoading(false)
    }
  }, [mode, target, credentials])

  // Fetch balance on open & mode switch
  useEffect(() => {
    if (isOpen) {
      loadBalance(mode)
    }
  }, [isOpen, mode, loadBalance])

  // Save Credentials
  const handleSaveCredentials = () => {
    try {
      localStorage.setItem(STORAGE_KEYS.credentials, JSON.stringify(credentials))
      setApiStatusMsg({ success: true, text: 'Kredensial API berhasil disimpan di browser Anda!' })
      loadBalance(mode)
      setTimeout(() => setApiStatusMsg(null), 3500)
    } catch {
      setApiStatusMsg({ success: false, text: 'Gagal menyimpan kredensial ke penyimpanan lokal' })
    }
  }

  // Test Connection
  const handleTestConnection = async () => {
    if (!target) return
    setApiTesting(true)
    setApiStatusMsg(null)
    try {
      const res = await testTradeConnection(target.market, mode, activeKey, activeSecret)
      setApiStatusMsg({
        success: res.success,
        text: res.message
      })
      if (res.success) {
        loadBalance(mode)
      }
    } catch (err: any) {
      setApiStatusMsg({
        success: false,
        text: err?.message || 'Koneksi gagal'
      })
    } finally {
      setApiTesting(false)
    }
  }

  // Parse numerical inputs
  const entryPrice = parseFloat(entryInput) || (currentPrice || 0)
  const stopLoss = parseFloat(slInput) || 0
  const targetPrice = parseFloat(tpInput) || 0
  const effectiveLeverage = target?.market === 'spot' ? 1 : Math.max(1, leverage)

  // Real-time Position Sizing calculations
  const calc = useMemo(() => {
    const slDist = Math.abs(entryPrice - stopLoss)
    const tpDist = Math.abs(targetPrice - entryPrice)
    const safeAccount = Math.max(0, balance || 0)

    const riskUSDT = riskMode === 'USDT' ? Math.max(0, riskValue) : safeAccount * (Math.max(0, riskValue) / 100)
    const isSlValid = entryPrice > 0 && stopLoss > 0 && (
      target?.direction === 'LONG' ? stopLoss < entryPrice : stopLoss > entryPrice
    )

    // Sizing: Quantity = Risk USDT / SL Distance
    let rawQty = (slDist > 0 && isSlValid) ? riskUSDT / slDist : 0
    if (rules.stepSize > 0) {
      const steps = Math.floor(rawQty / rules.stepSize)
      rawQty = steps * rules.stepSize
    }

    const notionalUSDT = rawQty * entryPrice
    const requiredMargin = effectiveLeverage > 0 ? notionalUSDT / effectiveLeverage : notionalUSDT
    const isMarginExceeded = requiredMargin > safeAccount && safeAccount > 0
    const isUnderMinNotional = notionalUSDT < rules.minNotional && notionalUSDT > 0

    const estProfitUSDT = rawQty * tpDist
    const estLossUSDT = riskUSDT
    const roeProfitPct = requiredMargin > 0 ? (estProfitUSDT / requiredMargin) * 100 : 0
    const roeLossPct = requiredMargin > 0 ? -(estLossUSDT / requiredMargin) * 100 : 0
    const rr = slDist > 0 ? tpDist / slDist : 0

    // Estimated liquidation price
    let estLiq = 0
    if (target?.market === 'futures' && effectiveLeverage > 1 && entryPrice > 0) {
      estLiq = target.direction === 'LONG'
        ? Math.max(0, entryPrice * (1 - 1 / effectiveLeverage + 0.005))
        : entryPrice * (1 + 1 / effectiveLeverage - 0.005)
    }
    const isLiqBeforeSL = target?.market === 'futures' && estLiq > 0 && isSlValid && (
      target.direction === 'LONG' ? estLiq >= stopLoss : estLiq <= stopLoss
    )

    return {
      qty: rawQty,
      notionalUSDT,
      requiredMargin,
      isMarginExceeded,
      isUnderMinNotional,
      estProfitUSDT,
      estLossUSDT,
      roeProfitPct,
      roeLossPct,
      rr,
      estLiq,
      isLiqBeforeSL
    }
  }, [entryPrice, stopLoss, targetPrice, balance, riskMode, riskValue, effectiveLeverage, target, rules])

  // Execute Order handler
  const handleExecute = async () => {
    if (!target) return
    if (mode === 'live' && !confirmLiveOpen) {
      setConfirmLiveOpen(true)
      return
    }

    setIsSubmitting(true)
    setExecutionResult(null)

    try {
      const res = await executeTradeOrder({
        symbol: target.symbol,
        market: target.market,
        mode,
        api_key: activeKey,
        api_secret: activeSecret,
        side: target.direction === 'LONG' ? 'BUY' : 'SELL',
        order_type: orderType,
        quantity: calc.qty,
        price: orderType === 'LIMIT' ? entryPrice : undefined,
        leverage: effectiveLeverage,
        stop_loss: attachBracket ? stopLoss : undefined,
        take_profit: attachBracket ? targetPrice : undefined
      })

      if (res.success) {
        loadBalance(mode)
        onSuccess?.(res)
        onClose()
      } else {
        setExecutionResult(res)
      }
    } catch (err: any) {
      setExecutionResult({
        success: false,
        message: err?.message || 'Gagal mengeksekusi order'
      })
    } finally {
      setIsSubmitting(false)
      setConfirmLiveOpen(false)
    }
  }

  if (!isOpen || !target) return null

  const isLong = target.direction === 'LONG'
  const baseAsset = target.symbol.replace(/USDT$|BUSD$|USDC$/i, '')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/75 backdrop-blur-sm select-none">
      <div className="w-full max-w-xl max-h-[92vh] flex flex-col bg-[#0f141f] border border-[#263040] rounded-xl shadow-2xl text-slate-100 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        
        {/* 1. Modal Header */}
        <div className="p-3.5 bg-[#141a27] border-b border-[#212a38] flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2.5">
            <span
              className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                isLong
                  ? 'bg-emerald-950 text-[#00c087] border border-emerald-800/80'
                  : 'bg-rose-950 text-[#f6465d] border border-rose-800/80'
              }`}
            >
              {isLong ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              <span>{target.direction}</span>
            </span>

            <div className="flex items-baseline space-x-1.5">
              <span className="font-mono font-bold text-base text-white">{target.symbol}</span>
              <span className="text-[11px] font-bold text-slate-400 uppercase">({target.market})</span>
            </div>

            {target.risk_reward_ratio && (
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#1c2434] text-[#f0b90b] font-bold border border-[#2d3748]">
                R:R 1:{target.risk_reward_ratio}
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-[#1f2636] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 2. Scrollable Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3.5 text-xs">
          
          {/* A. Account Mode Switcher (2 API MODE: DEMO vs LIVE) */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-400 font-semibold uppercase tracking-wider">Mode Akun Binance API:</span>
              <button
                type="button"
                onClick={() => setShowApiSettings(!showApiSettings)}
                className="inline-flex items-center space-x-1 text-[11px] text-[#f0b90b] hover:underline"
              >
                <KeyRound className="w-3 h-3" />
                <span>Kunci API {showApiSettings ? '▲' : '▼'}</span>
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2 p-1 bg-[#0b0e14] border border-[#212a38] rounded-lg">
              <button
                type="button"
                onClick={() => setMode('demo')}
                className={`py-2 px-3 rounded-md text-xs font-bold flex items-center justify-center space-x-2 transition-all ${
                  mode === 'demo'
                    ? 'bg-amber-950/80 text-[#f0b90b] border border-[#f0b90b]/50 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${mode === 'demo' ? 'bg-[#f0b90b] animate-pulse' : 'bg-slate-600'}`} />
                <span>Akun Demo (Testnet / Paper)</span>
              </button>

              <button
                type="button"
                onClick={() => setMode('live')}
                className={`py-2 px-3 rounded-md text-xs font-bold flex items-center justify-center space-x-2 transition-all ${
                  mode === 'live'
                    ? 'bg-emerald-950/80 text-[#00c087] border border-emerald-600/60 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${mode === 'live' ? 'bg-[#00c087] animate-pulse' : 'bg-slate-600'}`} />
                <span>Akun Live (Binance Real)</span>
              </button>
            </div>

            {/* Mode Description & Warning Badge */}
            {mode === 'demo' ? (
              <p className="text-[10px] text-amber-400/90 flex items-center space-x-1">
                <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
                <span>Mode Demo aktif: Transaksi aman untuk uji coba tanpa risiko modal nyata.</span>
              </p>
            ) : (
              <div className="p-2 rounded bg-rose-950/40 border border-rose-800/50 text-[10px] text-rose-300 flex items-start space-x-1.5">
                <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                <span>
                  <strong>PERINGATAN RESIKO:</strong> Mode Live menggunakan saldo riil akun Binance Anda. Pastikan parameter posisi dan manajemen risiko sudah sesuai.
                </span>
              </div>
            )}
          </div>

          {/* B. Expandable API Key Settings Drawer */}
          {showApiSettings && (
            <div className="p-3 bg-[#0d121c] border border-[#232c3b] rounded-lg space-y-2.5">
              <div className="flex items-center justify-between border-b border-[#1c2433] pb-1.5">
                <span className="font-bold text-[11px] text-white">
                  Kredensial API ({mode === 'demo' ? 'Binance Futures Testnet' : 'Binance Production'})
                </span>
                <span className="text-[10px] text-slate-400">Tersimpan aman di browser Anda</span>
              </div>

              {mode === 'demo' && (
                <label className="flex items-center space-x-2 cursor-pointer text-[11px] text-slate-300">
                  <input
                    type="checkbox"
                    checked={credentials.useSimulatedDemo}
                    onChange={(e) =>
                      setCredentials((prev) => ({ ...prev, useSimulatedDemo: e.target.checked }))
                    }
                    className="rounded border-[#2c3647] bg-[#161c28] text-[#f0b90b] focus:ring-0"
                  />
                  <span>Gunakan Paper Trading Virtual ($10,000 USDT) jika belum punya Testnet Key</span>
                </label>
              )}

              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-400">API Key ({mode.toUpperCase()})</label>
                <input
                  type="password"
                  placeholder={mode === 'demo' ? 'Binance Testnet API Key...' : 'Binance Live API Key...'}
                  value={mode === 'demo' ? credentials.demoApiKey : credentials.liveApiKey}
                  onChange={(e) => {
                    const val = e.target.value
                    setCredentials((prev) =>
                      mode === 'demo' ? { ...prev, demoApiKey: val } : { ...prev, liveApiKey: val }
                    )
                  }}
                  className="w-full px-2.5 py-1.5 rounded bg-[#161c28] border border-[#283244] text-white font-mono text-[11px] focus:outline-none focus:border-[#f0b90b]"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[10px] text-slate-400">API Secret Key ({mode.toUpperCase()})</label>
                <input
                  type="password"
                  placeholder={mode === 'demo' ? 'Binance Testnet API Secret...' : 'Binance Live API Secret...'}
                  value={mode === 'demo' ? credentials.demoApiSecret : credentials.liveApiSecret}
                  onChange={(e) => {
                    const val = e.target.value
                    setCredentials((prev) =>
                      mode === 'demo' ? { ...prev, demoApiSecret: val } : { ...prev, liveApiSecret: val }
                    )
                  }}
                  className="w-full px-2.5 py-1.5 rounded bg-[#161c28] border border-[#283244] text-white font-mono text-[11px] focus:outline-none focus:border-[#f0b90b]"
                />
              </div>

              {apiStatusMsg && (
                <div
                  className={`p-2 rounded text-[10px] flex items-center space-x-1.5 ${
                    apiStatusMsg.success
                      ? 'bg-emerald-950/70 text-[#00c087] border border-emerald-800'
                      : 'bg-rose-950/70 text-[#f6465d] border border-rose-800'
                  }`}
                >
                  {apiStatusMsg.success ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <XCircle className="w-3.5 h-3.5 shrink-0" />}
                  <span>{apiStatusMsg.text}</span>
                </div>
              )}

              <div className="flex items-center space-x-2 pt-1">
                <button
                  type="button"
                  onClick={handleSaveCredentials}
                  className="px-3 py-1.5 rounded bg-[#f0b90b] text-black font-bold text-[11px] hover:bg-[#d9a508] transition-colors"
                >
                  Simpan Kunci
                </button>
                <button
                  type="button"
                  onClick={handleTestConnection}
                  disabled={apiTesting}
                  className="px-3 py-1.5 rounded bg-[#1e2535] text-slate-200 font-semibold text-[11px] hover:bg-[#283247] transition-colors flex items-center space-x-1"
                >
                  <RefreshCw className={`w-3 h-3 ${apiTesting ? 'animate-spin' : ''}`} />
                  <span>Test Koneksi</span>
                </button>
              </div>
            </div>
          )}

          {/* C. Live Balance Header Bar */}
          <div className="p-2.5 bg-[#131926] border border-[#212a38] rounded-lg flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Wallet className="w-4 h-4 text-[#f0b90b]" />
              <div>
                <div className="text-[10px] text-slate-400">Saldo Tersedia ({mode.toUpperCase()})</div>
                <div className="font-mono font-bold text-sm text-white">
                  ${balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDT
                </div>
              </div>
            </div>

            <div className="flex items-center space-x-1">
              {[10, 25, 50, 100].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => {
                    setRiskMode('PERCENT')
                    setRiskValue(pct)
                  }}
                  className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-[#1c2434] text-slate-300 hover:text-[#f0b90b] hover:bg-[#253045] border border-[#2b3648]"
                >
                  {pct}%
                </button>
              ))}

              <button
                type="button"
                onClick={() => loadBalance(mode)}
                disabled={isBalanceLoading}
                title="Sinkronkan saldo akun"
                className="p-1 rounded text-slate-400 hover:text-white"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isBalanceLoading ? 'animate-spin text-[#f0b90b]' : ''}`} />
              </button>
            </div>
          </div>

          {/* D. Order Type, Leverage & Entry Grid */}
          <div className="grid grid-cols-2 gap-2.5">
            {/* Order Type Toggle */}
            <div className="space-y-1">
              <label className="text-[10px] text-slate-400 font-semibold">Tipe Order</label>
              <div className="grid grid-cols-2 gap-1 p-0.5 bg-[#0b0e14] border border-[#212a38] rounded-md">
                <button
                  type="button"
                  onClick={() => setOrderType('MARKET')}
                  className={`py-1 rounded text-[10px] font-bold ${
                    orderType === 'MARKET' ? 'bg-[#1e2535] text-white shadow-sm' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Market (Instan)
                </button>
                <button
                  type="button"
                  onClick={() => setOrderType('LIMIT')}
                  className={`py-1 rounded text-[10px] font-bold ${
                    orderType === 'LIMIT' ? 'bg-[#1e2535] text-white shadow-sm' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Limit (Pending)
                </button>
              </div>
            </div>

            {/* Leverage (Futures only) */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-slate-400 font-semibold">Leverage</span>
                <span className="font-mono font-bold text-[#f0b90b]">{effectiveLeverage}x</span>
              </div>
              <div className="flex items-center space-x-1">
                {[1, 5, 10, 20, 50].map((lev) => (
                  <button
                    key={lev}
                    type="button"
                    disabled={target.market === 'spot'}
                    onClick={() => setLeverage(lev)}
                    className={`flex-1 py-1 rounded text-[10px] font-mono font-bold border transition-colors ${
                      effectiveLeverage === lev
                        ? 'bg-[#f0b90b]/20 text-[#f0b90b] border-[#f0b90b]/50'
                        : 'bg-[#121722] text-slate-400 border-[#212a38] hover:text-white'
                    }`}
                  >
                    {lev}x
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* E. Entry, Stop Loss, Take Profit Inputs */}
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1">
              <label className="text-[10px] text-slate-400">Harga Entry</label>
              <input
                type="number"
                step="any"
                value={entryInput}
                onChange={(e) => setEntryInput(e.target.value)}
                placeholder="0.00"
                className="w-full px-2 py-1.5 rounded bg-[#131926] border border-[#212a38] text-white font-mono text-[11px] focus:outline-none focus:border-[#f0b90b]"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] text-[#f6465d]">SL Invalidasi</label>
              <input
                type="number"
                step="any"
                value={slInput}
                onChange={(e) => setSlInput(e.target.value)}
                placeholder="0.00"
                className="w-full px-2 py-1.5 rounded bg-[#131926] border border-[#212a38] text-[#f6465d] font-mono text-[11px] focus:outline-none focus:border-[#f6465d]"
              />
            </div>

            <div className="space-y-1">
              <label className="text-[10px] text-[#00c087]">Target TP</label>
              <input
                type="number"
                step="any"
                value={tpInput}
                onChange={(e) => setTpInput(e.target.value)}
                placeholder="0.00"
                className="w-full px-2 py-1.5 rounded bg-[#131926] border border-[#212a38] text-[#00c087] font-mono text-[11px] focus:outline-none focus:border-[#00c087]"
              />
            </div>
          </div>

          {/* Bracket Order SL/TP toggle */}
          {target.market === 'futures' && (
            <label className="flex items-center space-x-2 cursor-pointer text-[10px] text-slate-300">
              <input
                type="checkbox"
                checked={attachBracket}
                onChange={(e) => setAttachBracket(e.target.checked)}
                className="rounded border-[#2c3647] bg-[#161c28] text-[#00c087] focus:ring-0"
              />
              <span>Pasang bracket order otomatis TP & SL di Binance saat posisi terbuka</span>
            </label>
          )}

          {/* F. Risk Sizing Input */}
          <div className="p-3 bg-[#111724] border border-[#1f2838] rounded-lg space-y-2">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-300 font-semibold">Toleransi Risiko (Risk Sizing)</span>
              <div className="flex items-center space-x-1 bg-[#0b0e14] p-0.5 rounded border border-[#212a38]">
                <button
                  type="button"
                  onClick={() => setRiskMode('USDT')}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                    riskMode === 'USDT' ? 'bg-[#1f2738] text-white' : 'text-slate-400'
                  }`}
                >
                  USDT ($)
                </button>
                <button
                  type="button"
                  onClick={() => setRiskMode('PERCENT')}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                    riskMode === 'PERCENT' ? 'bg-[#1f2738] text-white' : 'text-slate-400'
                  }`}
                >
                  % Saldo
                </button>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <input
                type="number"
                min="1"
                step="any"
                value={riskValue}
                onChange={(e) => setRiskValue(parseFloat(e.target.value) || 0)}
                className="flex-1 px-2.5 py-1.5 rounded bg-[#161c28] border border-[#283244] text-white font-mono text-xs focus:outline-none focus:border-[#f0b90b]"
              />
              <span className="text-slate-400 font-mono text-xs font-bold">
                {riskMode === 'USDT' ? 'USDT' : `% = $${((balance * riskValue) / 100).toFixed(1)}`}
              </span>
            </div>
          </div>

          {/* G. Calculations Summary Card */}
          <div className="p-3 bg-[#0d121c] border border-[#232c3b] rounded-lg space-y-2 font-mono text-[11px]">
            <div className="grid grid-cols-2 gap-2 pb-2 border-b border-[#1b2230]">
              <div>
                <span className="text-[10px] text-slate-400 block font-sans">Kuantitas Posisi</span>
                <span className="font-bold text-white text-xs">
                  {calc.qty.toLocaleString('en-US', { maximumFractionDigits: 4 })} {baseAsset}
                </span>
                <span className="text-[10px] text-slate-500 block">
                  ≈ ${calc.notionalUSDT.toFixed(2)} USDT
                </span>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-slate-400 block font-sans">Margin Dibutuhkan</span>
                <span className={`font-bold text-xs ${calc.isMarginExceeded ? 'text-rose-400' : 'text-[#f0b90b]'}`}>
                  ${calc.requiredMargin.toFixed(2)} USDT
                </span>
                <span className="text-[10px] text-slate-500 block">
                  {balance > 0 ? `${((calc.requiredMargin / balance) * 100).toFixed(1)}% saldo` : ''}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-1 pt-0.5">
              <div>
                <span className="text-[9px] text-slate-400 block font-sans">Potensi Profit</span>
                <span className="text-[#00c087] font-bold">
                  +${calc.estProfitUSDT.toFixed(2)}
                </span>
                <span className="text-[9px] text-emerald-400/80 block">
                  (+{calc.roeProfitPct.toFixed(0)}% ROE)
                </span>
              </div>

              <div>
                <span className="text-[9px] text-slate-400 block font-sans">Risiko Loss</span>
                <span className="text-[#f6465d] font-bold">
                  -${calc.estLossUSDT.toFixed(2)}
                </span>
                <span className="text-[9px] text-rose-400/80 block">
                  ({calc.roeLossPct.toFixed(0)}% ROE)
                </span>
              </div>

              <div className="text-right">
                <span className="text-[9px] text-slate-400 block font-sans">Estimasi Likuidasi</span>
                <span className={`font-bold ${calc.isLiqBeforeSL ? 'text-rose-400' : 'text-slate-300'}`}>
                  {calc.estLiq > 0 ? `$${formatPrice(calc.estLiq)}` : 'N/A'}
                </span>
                {calc.isLiqBeforeSL && (
                  <span className="text-[8px] text-rose-400 block font-bold">Liq &lt; SL!</span>
                )}
              </div>
            </div>
          </div>

          {/* H. Error or Validation Warnings */}
          {calc.isMarginExceeded && (
            <div className="p-2.5 rounded bg-rose-950/60 border border-rose-800 text-rose-300 text-[10px] flex items-center space-x-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-rose-400" />
              <span>Margin dibutuhkan (${calc.requiredMargin.toFixed(2)}) melebihi saldo tersedia (${balance.toFixed(2)}). Kurangi risiko atau naikkan leverage.</span>
            </div>
          )}

          {calc.isUnderMinNotional && (
            <div className="p-2 rounded bg-amber-950/60 border border-amber-800 text-amber-300 text-[10px]">
              Nilai posisi (${calc.notionalUSDT.toFixed(2)}) di bawah batas minimal Binance (${rules.minNotional} USDT).
            </div>
          )}

          {/* I. Execution Result Alert */}
          {executionResult && (
            <div
              className={`p-3 rounded-lg border text-xs space-y-1.5 ${
                executionResult.success
                  ? 'bg-emerald-950/80 border-emerald-700/80 text-emerald-200'
                  : 'bg-rose-950/80 border-rose-700/80 text-rose-200'
              }`}
            >
              <div className="flex items-center space-x-1.5 font-bold">
                {executionResult.success ? <CheckCircle2 className="w-4 h-4 text-[#00c087]" /> : <XCircle className="w-4 h-4 text-[#f6465d]" />}
                <span>{executionResult.success ? 'Order Berhasil Dikirim!' : 'Order Ditolak'}</span>
              </div>
              <p className="text-[11px] leading-relaxed">{executionResult.message}</p>
              {executionResult.order_id && (
                <div className="font-mono text-[10px] opacity-80 pt-1 border-t border-emerald-900/60">
                  Order ID: {executionResult.order_id} | Status: {executionResult.status}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 3. Modal Footer: Action Buttons */}
        <div className="p-3.5 bg-[#141a27] border-t border-[#212a38] flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 rounded-lg bg-[#1a2232] text-slate-300 text-xs font-semibold hover:bg-[#222d42] transition-colors"
          >
            Tutup
          </button>

          <div className="flex items-center space-x-2">
            {confirmLiveOpen ? (
              <div className="flex items-center space-x-1.5 animate-in fade-in">
                <span className="text-[10px] text-rose-400 font-bold">Yakin buka order riil?</span>
                <button
                  type="button"
                  onClick={handleExecute}
                  disabled={isSubmitting}
                  className="px-3 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs shadow-lg transition-all"
                >
                  {isSubmitting ? 'Mengirim...' : 'Ya, Eksekusi Sekarang'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmLiveOpen(false)}
                  className="px-2 py-2 rounded-lg bg-[#253045] text-slate-300 text-xs"
                >
                  Batal
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleExecute}
                disabled={isSubmitting || calc.qty <= 0 || calc.isMarginExceeded}
                className={`px-5 py-2.5 rounded-lg font-bold text-xs shadow-lg transition-all flex items-center space-x-2 disabled:opacity-50 disabled:cursor-not-allowed ${
                  mode === 'demo'
                    ? 'bg-[#f0b90b] hover:bg-[#d9a508] text-black'
                    : isLong
                    ? 'bg-[#00c087] hover:bg-[#00ab78] text-black'
                    : 'bg-[#f6465d] hover:bg-[#e03a50] text-white'
                }`}
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Mengirim Order ke Binance...</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-3.5 h-3.5" />
                    <span>
                      {isLong ? 'Buka Posisi LONG (BUY)' : 'Buka Posisi SHORT (SELL)'}
                      {mode === 'demo' ? ' [DEMO]' : ' [LIVE]'}
                    </span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  )
}
