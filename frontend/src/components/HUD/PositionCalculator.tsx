import React, { useState, useEffect, useMemo } from 'react'
import {
  Candle,
  ForecastResult,
  ForecastScenario
} from '../../types/analysis'
import { formatPrice, getPricePrecision } from '../../utils/formatters'
import {
  Calculator,
  Link2,
  Link2Off,
  RotateCcw,
  Copy,
  Check,
  AlertTriangle,
  TrendingUp,
  TrendingDown,
  ShieldCheck,
  Coins,
  Zap
} from 'lucide-react'

interface PositionCalculatorProps {
  symbol: string
  market: 'spot' | 'futures'
  candles: Candle[]
  forecast?: ForecastResult
  currentPrice?: number
  onOpenTrade?: (target: any) => void
}

type RiskMode = 'USDT' | 'PERCENT'

const STORAGE_KEYS = {
  accountSize: 'cp_calc_account_size',
  riskValue: 'cp_calc_risk_value',
  riskMode: 'cp_calc_risk_mode',
  leverage: 'cp_calc_leverage'
}

function readStoredNumber(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const n = parseFloat(raw)
    return Number.isFinite(n) && n > 0 ? n : fallback
  } catch {
    return fallback
  }
}

function readStoredRiskMode(): RiskMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.riskMode)
    return raw === 'PERCENT' ? 'PERCENT' : 'USDT'
  } catch {
    return 'USDT'
  }
}

function roundToPrecision(val: number, precision: number): number {
  if (!Number.isFinite(val)) return 0
  const factor = Math.pow(10, precision)
  return Math.round(val * factor) / factor
}

function formatQty(qty: number): string {
  if (!Number.isFinite(qty) || qty <= 0) return '0'
  if (qty >= 1000) return qty.toLocaleString('en-US', { maximumFractionDigits: 1 })
  if (qty >= 10) return qty.toLocaleString('en-US', { maximumFractionDigits: 2 })
  if (qty >= 1) return qty.toLocaleString('en-US', { maximumFractionDigits: 3 })
  if (qty >= 0.01) return qty.toFixed(4)
  return qty.toFixed(6)
}

export const PositionCalculator: React.FC<PositionCalculatorProps> = ({
  symbol,
  market,
  candles,
  forecast,
  currentPrice,
  onOpenTrade
}) => {
  // User Primary Inputs (persisted in localStorage)
  const [accountSize, setAccountSize] = useState<number>(() => readStoredNumber(STORAGE_KEYS.accountSize, 476))
  const [riskValue, setRiskValue] = useState<number>(() => readStoredNumber(STORAGE_KEYS.riskValue, 20))
  const [riskMode, setRiskMode] = useState<RiskMode>(() => readStoredRiskMode())
  const [leverage, setLeverage] = useState<number>(() => readStoredNumber(STORAGE_KEYS.leverage, 10))

  // Sync mode: true = Entry, SL, TP otomatis selaras dengan Box A+ aktif di chart
  const [syncWithBox, setSyncWithBox] = useState<boolean>(true)
  const [selectedRrPreset, setSelectedRrPreset] = useState<number | null>(null) // null = ikuti TP Box

  // Price level states (in sync mode updated automatically; in custom mode editable)
  const [direction, setDirection] = useState<'LONG' | 'SHORT'>('LONG')
  const [entryInput, setEntryInput] = useState<string>('')
  const [slInput, setSlInput] = useState<string>('')
  const [tpInput, setTpInput] = useState<string>('')

  const [copiedField, setCopiedField] = useState<string | null>(null)

  const { precision, minMove } = useMemo(() => getPricePrecision(candles), [candles])

  // Persist user inputs
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEYS.accountSize, String(accountSize))
      localStorage.setItem(STORAGE_KEYS.riskValue, String(riskValue))
      localStorage.setItem(STORAGE_KEYS.riskMode, riskMode)
      localStorage.setItem(STORAGE_KEYS.leverage, String(leverage))
    } catch {
      // ignore storage quota errors
    }
  }, [accountSize, riskValue, riskMode, leverage])

  // Active valid box on chart (same criteria as LightweightChart.tsx)
  const activeBox: ForecastScenario | undefined = useMemo(() => {
    if (!forecast?.scenarios) return undefined
    return forecast.scenarios.find(
      (s) => s.is_valid === true && (s.risk_reward_ratio || 0) >= 1.5 && s.status === 'VALID_ENTRY'
    )
  }, [forecast])

  // Fallback reference scenario when no valid box is currently active
  const fallbackRef: ForecastScenario | undefined = useMemo(() => {
    if (activeBox) return activeBox
    if (!forecast?.scenarios || forecast.scenarios.length === 0) return undefined
    const biasBull = forecast.predicted_trend === 'BULLISH'
    return (
      forecast.scenarios.find((s) => (biasBull ? s.direction === 'LONG' : s.direction === 'SHORT')) ||
      forecast.scenarios[0]
    )
  }, [activeBox, forecast])

  // Auto-sync Entry, SL, TP when activeBox changes or syncWithBox is enabled
  useEffect(() => {
    if (!syncWithBox) return

    const source = activeBox || fallbackRef
    if (source) {
      const dir: 'LONG' | 'SHORT' =
        source.direction === 'SHORT' || source.name.toLowerCase().includes('bearish') ? 'SHORT' : 'LONG'
      const entryVal: number = (source.entry_price ?? 0) > 0 ? (source.entry_price as number) : (currentPrice || 0)
      const slVal = source.invalidation_price || 0
      let tpVal = source.target_price || 0

      // If user clicked a quick R:R multiplier (e.g. 1:2, 1:3), adjust TP while keeping Entry & SL synced!
      if (selectedRrPreset !== null && entryVal > 0 && slVal > 0) {
        const slDist = Math.abs(entryVal - slVal)
        tpVal = dir === 'LONG' ? entryVal + slDist * selectedRrPreset : Math.max(0, entryVal - slDist * selectedRrPreset)
      }

      setDirection(dir)
      if (entryVal > 0) setEntryInput(String(roundToPrecision(entryVal, precision)))
      if (slVal > 0) setSlInput(String(roundToPrecision(slVal, precision)))
      if (tpVal > 0) setTpInput(String(roundToPrecision(tpVal, precision)))
    } else if (currentPrice && currentPrice > 0) {
      const isBear = forecast?.predicted_trend === 'BEARISH'
      const slDist = currentPrice * 0.01
      const slVal = isBear ? currentPrice + slDist : currentPrice - slDist
      const mult = selectedRrPreset ?? 2
      const tpVal = isBear ? Math.max(0, currentPrice - slDist * mult) : currentPrice + slDist * mult
      setDirection(isBear ? 'SHORT' : 'LONG')
      setEntryInput(String(roundToPrecision(currentPrice, precision)))
      setSlInput(String(roundToPrecision(slVal, precision)))
      setTpInput(String(roundToPrecision(tpVal, precision)))
    }
  }, [syncWithBox, activeBox, fallbackRef, currentPrice, forecast?.predicted_trend, precision, selectedRrPreset])

  // Effective leverage (Spot is always 1x)
  const effectiveLeverage = market === 'spot' ? 1 : Math.max(1, Math.min(125, leverage || 1))

  // Parse numeric levels
  const entryPrice = parseFloat(entryInput) || 0
  const stopLoss = parseFloat(slInput) || 0
  const targetPrice = parseFloat(tpInput) || 0

  // Core Position Sizing & Risk-Reward Calculation
  const calc = useMemo(() => {
    const safeAccount = Math.max(0, accountSize || 0)
    const rawRisk = Math.max(0, riskValue || 0)
    const riskUSDT = riskMode === 'USDT' ? rawRisk : safeAccount * (rawRisk / 100)
    const riskPctOfAccount = safeAccount > 0 ? (riskUSDT / safeAccount) * 100 : 0

    const slDist = Math.abs(entryPrice - stopLoss)
    const tpDist = Math.abs(targetPrice - entryPrice)

    const slTicks = minMove > 0 ? Math.round(slDist / minMove) : 0
    const tpTicks = minMove > 0 ? Math.round(tpDist / minMove) : 0

    const slPct = entryPrice > 0 ? (slDist / entryPrice) * 100 : 0
    const tpPct = entryPrice > 0 ? (tpDist / entryPrice) * 100 : 0

    const isSlValidSide =
      entryPrice > 0 &&
      stopLoss > 0 &&
      (direction === 'LONG' ? stopLoss < entryPrice : stopLoss > entryPrice)

    const isTpValidSide =
      entryPrice > 0 &&
      targetPrice > 0 &&
      (direction === 'LONG' ? targetPrice > entryPrice : targetPrice < entryPrice)

    const rr = slDist > 0 ? tpDist / slDist : 0

    // Position Size (Coin Qty) determined by Risk USDT & SL Distance
    const qty = slDist > 0 && isSlValidSide ? riskUSDT / slDist : 0
    const notionalUSDT = qty * entryPrice
    const requiredMargin = effectiveLeverage > 0 ? notionalUSDT / effectiveLeverage : notionalUSDT
    const marginUsagePct = safeAccount > 0 ? (requiredMargin / safeAccount) * 100 : 0

    const estProfitUSDT = qty * tpDist
    const estLossUSDT = riskUSDT
    const roeProfitPct = requiredMargin > 0 ? (estProfitUSDT / requiredMargin) * 100 : 0
    const roeLossPct = requiredMargin > 0 ? -(estLossUSDT / requiredMargin) * 100 : 0

    // Max Qty affordable by account balance * leverage
    const maxNotional = safeAccount * effectiveLeverage
    const maxQty = entryPrice > 0 ? maxNotional / entryPrice : 0
    const isMarginInsufficient = requiredMargin > safeAccount && safeAccount > 0

    // Estimated Isolated Liquidation Price (MMR ~0.5%)
    const mmr = 0.005
    let estLiqPrice = 0
    if (market === 'futures' && entryPrice > 0 && effectiveLeverage > 1) {
      estLiqPrice =
        direction === 'LONG'
          ? Math.max(0, entryPrice * (1 - 1 / effectiveLeverage + mmr))
          : entryPrice * (1 + 1 / effectiveLeverage - mmr)
    }

    const isLiqBeforeSL =
      market === 'futures' &&
      estLiqPrice > 0 &&
      isSlValidSide &&
      (direction === 'LONG' ? estLiqPrice >= stopLoss : estLiqPrice <= stopLoss)

    return {
      riskUSDT,
      riskPctOfAccount,
      slDist,
      tpDist,
      slTicks,
      tpTicks,
      slPct,
      tpPct,
      isSlValidSide,
      isTpValidSide,
      rr,
      qty,
      notionalUSDT,
      requiredMargin,
      marginUsagePct,
      estProfitUSDT,
      estLossUSDT,
      roeProfitPct,
      roeLossPct,
      maxQty,
      isMarginInsufficient,
      estLiqPrice,
      isLiqBeforeSL
    }
  }, [
    accountSize,
    riskValue,
    riskMode,
    effectiveLeverage,
    entryPrice,
    stopLoss,
    targetPrice,
    direction,
    minMove,
    market
  ])

  const baseAsset = symbol.replace(/USDT$|BUSD$|USDC$/i, '') || symbol

  const handleCopy = (label: string, val: string) => {
    navigator.clipboard?.writeText(val)
    setCopiedField(label)
    setTimeout(() => setCopiedField(null), 1500)
  }

  const handleResetToBox = () => {
    setSelectedRrPreset(null)
    setSyncWithBox(true)
  }

  const handleSelectRrPreset = (mult: number | null) => {
    setSelectedRrPreset(mult)
    if (mult !== null && entryPrice > 0 && stopLoss > 0) {
      const slDist = Math.abs(entryPrice - stopLoss)
      const nextTp =
        direction === 'LONG' ? entryPrice + slDist * mult : Math.max(0, entryPrice - slDist * mult)
      setTpInput(String(roundToPrecision(nextTp, precision)))
    }
  }

  const handleTpTicksChange = (ticksStr: string) => {
    const ticks = parseFloat(ticksStr)
    if (!Number.isFinite(ticks) || ticks < 0 || entryPrice <= 0) return
    setSyncWithBox(false)
    setSelectedRrPreset(null)
    const diff = ticks * minMove
    const nextTp = direction === 'LONG' ? entryPrice + diff : Math.max(0, entryPrice - diff)
    setTpInput(String(roundToPrecision(nextTp, precision)))
  }

  const handleSlTicksChange = (ticksStr: string) => {
    const ticks = parseFloat(ticksStr)
    if (!Number.isFinite(ticks) || ticks < 0 || entryPrice <= 0) return
    setSyncWithBox(false)
    const diff = ticks * minMove
    const nextSl = direction === 'LONG' ? Math.max(0, entryPrice - diff) : entryPrice + diff
    setSlInput(String(roundToPrecision(nextSl, precision)))
  }

  return (
    <div className="w-full flex-1 flex flex-col overflow-y-auto select-none divide-y divide-[#21262d] text-xs">
      {/* 1. Sync Status & Direction Header */}
      <div className="p-3.5 bg-gradient-to-b from-[#161d2b] to-[#111620] space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-1.5 text-slate-300 font-bold uppercase tracking-wider text-[11px]">
            <Calculator className="w-4 h-4 text-[#f0b90b]" />
            <span>Kalkulator Posisi</span>
          </div>

          <button
            type="button"
            onClick={() => (syncWithBox ? setSyncWithBox(false) : handleResetToBox())}
            title={syncWithBox ? 'Sedang selaras otomatis dengan Box Chart' : 'Klik untuk selaraskan kembali dengan Box'}
            className={`flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-bold border transition-colors ${
              syncWithBox
                ? activeBox
                  ? 'bg-emerald-950/70 text-emerald-400 border-emerald-700/60'
                  : 'bg-sky-950/60 text-sky-300 border-sky-700/50'
                : 'bg-amber-950/60 text-amber-300 border-amber-700/50 hover:bg-amber-900/60'
            }`}
          >
            {syncWithBox ? <Link2 className="w-3 h-3" /> : <Link2Off className="w-3 h-3" />}
            <span>{syncWithBox ? (activeBox ? 'Selaras Box' : 'Auto-Sync') : 'Mode Kustom'}</span>
          </button>
        </div>

        {/* Active Setup / Direction Bar */}
        <div className="flex items-center justify-between bg-[#0d1117] border border-[#21262d] rounded-lg px-2.5 py-2">
          <div className="flex items-center space-x-2 min-w-0">
            <button
              type="button"
              onClick={() => {
                if (syncWithBox) setSyncWithBox(false)
                setDirection((d) => (d === 'LONG' ? 'SHORT' : 'LONG'))
              }}
              className={`flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-extrabold border shrink-0 ${
                direction === 'LONG'
                  ? 'bg-emerald-950 text-emerald-400 border-emerald-700'
                  : 'bg-rose-950 text-rose-400 border-rose-700'
              }`}
            >
              {direction === 'LONG' ? (
                <TrendingUp className="w-3 h-3" />
              ) : (
                <TrendingDown className="w-3 h-3" />
              )}
              <span>{direction}</span>
            </button>
            <span className="text-[11px] text-slate-300 font-semibold truncate">
              {activeBox ? activeBox.name : `Simulasi ${symbol}`}
            </span>
          </div>

          {(!syncWithBox || selectedRrPreset !== null) && (
            <button
              type="button"
              onClick={handleResetToBox}
              className="flex items-center space-x-1 text-[10px] text-[#f0b90b] hover:text-amber-300 font-semibold shrink-0 ml-1"
              title="Reset ke koordinat Box Chart"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset</span>
            </button>
          )}
        </div>

        {!activeBox && (
          <p className="text-[10px] text-amber-400/90 leading-snug bg-amber-950/25 border border-amber-800/40 rounded px-2 py-1.5">
            Belum ada Box Setup A+ aktif di chart. Nilai sementara memakai estimasi harga saat ini.
          </p>
        )}
      </div>

      {/* 2. User Core Inputs: Margin Akun, Risk, Leverage (TradingView Style) */}
      <div className="p-3.5 space-y-3">
        <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
          Input Modal & Risiko
        </div>

        {/* Account Size / Margin Akun */}
        <div className="flex items-center justify-between gap-2">
          <label className="text-[11px] text-slate-300 font-medium w-28 shrink-0">
            Margin Akun
          </label>
          <div className="flex flex-1 items-center bg-[#0d1117] border border-[#2b3342] rounded-md overflow-hidden focus-within:border-[#f0b90b]">
            <input
              type="number"
              min="0"
              step="any"
              value={accountSize || ''}
              onChange={(e) => setAccountSize(Math.max(0, parseFloat(e.target.value) || 0))}
              className="w-full bg-transparent px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none"
              placeholder="476"
            />
            <span className="px-2 text-[10px] font-mono text-slate-400 border-l border-[#21262d]">
              USDT
            </span>
          </div>
        </div>

        {/* Risk Input with USDT / % Switcher */}
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <label className="text-[11px] text-slate-300 font-medium w-28 shrink-0">
              Risk per Trade
            </label>
            <div className="flex flex-1 items-center bg-[#0d1117] border border-[#2b3342] rounded-md overflow-hidden focus-within:border-[#f0b90b]">
              <input
                type="number"
                min="0"
                step="any"
                value={riskValue || ''}
                onChange={(e) => setRiskValue(Math.max(0, parseFloat(e.target.value) || 0))}
                className="w-full bg-transparent px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none"
                placeholder="20"
              />
              <button
                type="button"
                onClick={() => setRiskMode((m) => (m === 'USDT' ? 'PERCENT' : 'USDT'))}
                className="px-2.5 py-1.5 text-[10px] font-bold font-mono bg-[#161b22] text-[#f0b90b] hover:bg-[#1e2533] border-l border-[#21262d] transition-colors"
                title="Klik untuk ganti mode USDT / %"
              >
                {riskMode === 'USDT' ? 'USDT' : '%'}
              </button>
            </div>
          </div>
          <div className="flex justify-end text-[10px] font-mono text-slate-400">
            {riskMode === 'USDT'
              ? `Setara ${calc.riskPctOfAccount.toFixed(2)}% dari margin akun`
              : `Setara $${calc.riskUSDT.toFixed(2)} USDT`}
          </div>
        </div>

        {/* Leverage */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <label className="text-[11px] text-slate-300 font-medium w-28 shrink-0">
              Leverage
            </label>
            {market === 'spot' ? (
              <div className="flex-1 bg-[#0d1117] border border-[#21262d] rounded-md px-2.5 py-1.5 text-slate-400 font-mono text-xs text-right">
                1.0x (Spot)
              </div>
            ) : (
              <div className="flex flex-1 items-center bg-[#0d1117] border border-[#2b3342] rounded-md overflow-hidden focus-within:border-[#f0b90b]">
                <input
                  type="number"
                  min="1"
                  max="125"
                  step="1"
                  value={leverage || ''}
                  onChange={(e) =>
                    setLeverage(Math.max(1, Math.min(125, parseFloat(e.target.value) || 1)))
                  }
                  className="w-full bg-transparent px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none"
                  placeholder="10"
                />
                <span className="px-2.5 text-[10px] font-mono text-slate-400 border-l border-[#21262d]">
                  x
                </span>
              </div>
            )}
          </div>

          {market === 'futures' && (
            <div className="flex items-center justify-end space-x-1">
              {[5, 10, 20, 25, 50].map((lev) => (
                <button
                  key={lev}
                  type="button"
                  onClick={() => setLeverage(lev)}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold border transition-colors ${
                    Math.round(effectiveLeverage) === lev
                      ? 'bg-[#f0b90b]/15 text-[#f0b90b] border-[#f0b90b]/50'
                      : 'bg-[#0d1117] text-slate-400 border-[#21262d] hover:text-slate-200'
                  }`}
                >
                  {lev}x
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 3. Entry, Profit Level (TP), and Stop Level (SL) — Synced with Box */}
      <div className="p-3.5 space-y-3">
        {/* Entry Price */}
        <div className="flex items-center justify-between gap-2">
          <label className="text-[11px] text-sky-400 font-semibold w-28 shrink-0">
            Entry Price
          </label>
          <input
            type="number"
            step="any"
            value={entryInput}
            onChange={(e) => {
              setSyncWithBox(false)
              setSelectedRrPreset(null)
              setEntryInput(e.target.value)
            }}
            className="flex-1 bg-[#0d1117] border border-[#2b3342] focus:border-sky-400 rounded-md px-2.5 py-1.5 text-white font-mono text-xs focus:outline-none"
          />
        </div>

        {/* PROFIT LEVEL */}
        <div className="bg-[#0d1117] border border-emerald-900/50 rounded-lg p-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#00c087]">
              Profit Level (TP)
            </span>
            <span className="font-mono text-[10px] font-bold text-[#00c087]">
              +{calc.tpPct.toFixed(2)}% • +${calc.estProfitUSDT.toFixed(2)}
            </span>
          </div>

          {/* Quick R:R Target Adjuster ("ntr tp nya menyesuaikan") */}
          <div className="flex items-center space-x-1">
            {activeBox && (
              <button
                type="button"
                onClick={() => handleSelectRrPreset(null)}
                className={`px-1.5 py-0.5 rounded text-[9px] font-bold border transition-colors ${
                  selectedRrPreset === null && syncWithBox
                    ? 'bg-emerald-950 text-[#00c087] border-emerald-600'
                    : 'bg-[#131924] text-slate-400 border-[#21262d] hover:text-white'
                }`}
              >
                Box TP
              </button>
            )}
            {[1.5, 2, 3, 4].map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => handleSelectRrPreset(r)}
                className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border transition-colors ${
                  selectedRrPreset === r
                    ? 'bg-emerald-950 text-[#00c087] border-emerald-600'
                    : 'bg-[#131924] text-slate-400 border-[#21262d] hover:text-white'
                }`}
              >
                1:{r}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-[9px] text-slate-400 block mb-0.5">Price (USDT)</span>
              <input
                type="number"
                step="any"
                value={tpInput}
                onChange={(e) => {
                  setSyncWithBox(false)
                  setSelectedRrPreset(null)
                  setTpInput(e.target.value)
                }}
                className="w-full bg-[#131924] border border-[#263042] focus:border-[#00c087] rounded px-2 py-1 text-white font-mono text-[11px] focus:outline-none"
              />
            </div>
            <div>
              <span className="text-[9px] text-slate-400 block mb-0.5">Ticks</span>
              <input
                type="number"
                min="0"
                step="1"
                value={calc.tpTicks}
                onChange={(e) => handleTpTicksChange(e.target.value)}
                className="w-full bg-[#131924] border border-[#263042] focus:border-[#00c087] rounded px-2 py-1 text-white font-mono text-[11px] focus:outline-none"
              />
            </div>
          </div>
        </div>

        {/* STOP LEVEL */}
        <div className="bg-[#0d1117] border border-rose-900/50 rounded-lg p-2.5 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-wider text-[#f6465d]">
              Stop Level (SL)
            </span>
            <span className="font-mono text-[10px] font-bold text-[#f6465d]">
              -{calc.slPct.toFixed(2)}% • -${calc.estLossUSDT.toFixed(2)}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-[9px] text-slate-400 block mb-0.5">Price (USDT)</span>
              <input
                type="number"
                step="any"
                value={slInput}
                onChange={(e) => {
                  setSyncWithBox(false)
                  setSlInput(e.target.value)
                }}
                className="w-full bg-[#131924] border border-[#263042] focus:border-[#f6465d] rounded px-2 py-1 text-white font-mono text-[11px] focus:outline-none"
              />
            </div>
            <div>
              <span className="text-[9px] text-slate-400 block mb-0.5">Ticks</span>
              <input
                type="number"
                min="0"
                step="1"
                value={calc.slTicks}
                onChange={(e) => handleSlTicksChange(e.target.value)}
                className="w-full bg-[#131924] border border-[#263042] focus:border-[#f6465d] rounded px-2 py-1 text-white font-mono text-[11px] focus:outline-none"
              />
            </div>
          </div>
        </div>
      </div>

      {/* 4. Order Execution Summary */}
      <div className="p-3.5 space-y-2.5 bg-[#0e131c]">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">
            <Coins className="w-3.5 h-3.5 text-[#f0b90b]" />
            <span>Hasil Kalkulasi Eksekusi</span>
          </div>
          <span className="font-mono font-bold text-[11px] text-white">
            R:R 1 : {calc.rr.toFixed(2)}
          </span>
        </div>

        {/* Primary Highlight: Position Size Qty (Copyable for Binance) */}
        <div className="bg-[#131924] border border-[#2a3447] rounded-lg p-2.5 flex items-center justify-between">
          <div>
            <span className="text-[10px] text-slate-400 block">Ukuran Posisi (Size)</span>
            <span className="font-mono text-sm font-extrabold text-white">
              {formatQty(calc.qty)} <span className="text-[#f0b90b]">{baseAsset}</span>
            </span>
          </div>
          <button
            type="button"
            onClick={() => handleCopy('qty', formatQty(calc.qty).replace(/,/g, ''))}
            className="flex items-center space-x-1 px-2 py-1 rounded bg-[#1d2536] hover:bg-[#283349] text-slate-200 text-[10px] font-semibold border border-[#323e54] transition-colors"
            title="Salin Qty Coin"
          >
            {copiedField === 'qty' ? (
              <>
                <Check className="w-3 h-3 text-[#00c087]" />
                <span className="text-[#00c087]">Tersalin</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                <span>Salin Qty</span>
              </>
            )}
          </button>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 gap-2 font-mono">
          <div className="bg-[#0d1117] border border-[#21262d] p-2 rounded">
            <span className="text-[9px] text-slate-500 block font-sans">Margin Dibutuhkan</span>
            <span
              className={`text-xs font-bold ${
                calc.isMarginInsufficient ? 'text-[#f6465d]' : 'text-white'
              }`}
            >
              ${calc.requiredMargin.toFixed(2)}
            </span>
            <span className="text-[9px] text-slate-400 block">
              {calc.marginUsagePct.toFixed(1)}% dari saldo
            </span>
          </div>

          <div className="bg-[#0d1117] border border-[#21262d] p-2 rounded">
            <span className="text-[9px] text-slate-500 block font-sans">Nilai Posisi (Notional)</span>
            <span className="text-xs font-bold text-slate-200">
              ${calc.notionalUSDT.toLocaleString('en-US', { maximumFractionDigits: 2 })}
            </span>
            <span className="text-[9px] text-slate-400 block">{effectiveLeverage}x Lev</span>
          </div>

          <div className="bg-[#0d1117] border border-emerald-950/60 p-2 rounded">
            <span className="text-[9px] text-slate-500 block font-sans">Target Profit (TP)</span>
            <span className="text-xs font-bold text-[#00c087]">
              +${calc.estProfitUSDT.toFixed(2)}
            </span>
            <span className="text-[9px] text-emerald-400/80 block">
              ROE +{calc.roeProfitPct.toFixed(1)}%
            </span>
          </div>

          <div className="bg-[#0d1117] border border-rose-950/60 p-2 rounded">
            <span className="text-[9px] text-slate-500 block font-sans">Risiko Rugi (SL)</span>
            <span className="text-xs font-bold text-[#f6465d]">
              -${calc.estLossUSDT.toFixed(2)}
            </span>
            <span className="text-[9px] text-rose-400/80 block">
              ROE {calc.roeLossPct.toFixed(1)}%
            </span>
          </div>
        </div>

        {/* Liquidation Price Row (Futures only) */}
        {market === 'futures' && calc.estLiqPrice > 0 && (
          <div className="bg-[#0d1117] border border-[#21262d] px-2.5 py-2 rounded flex items-center justify-between text-[10px]">
            <span className="text-slate-400">Est. Likuidasi (Isolated):</span>
            <span
              className={`font-mono font-bold ${
                calc.isLiqBeforeSL ? 'text-[#f6465d]' : 'text-amber-300'
              }`}
            >
              ${formatPrice(calc.estLiqPrice)}
            </span>
          </div>
        )}

        {/* Safety Warnings */}
        {!calc.isSlValidSide && entryPrice > 0 && stopLoss > 0 && (
          <div className="flex items-start space-x-1.5 bg-rose-950/40 border border-rose-800/60 text-rose-300 p-2 rounded text-[10px]">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#f6465d]" />
            <span>
              Posisi Stop Loss tidak valid untuk arah {direction} (untuk {direction}, SL harus di{' '}
              {direction === 'LONG' ? 'bawah' : 'atas'} Entry).
            </span>
          </div>
        )}

        {calc.isMarginInsufficient && (
          <div className="flex items-start space-x-1.5 bg-rose-950/40 border border-rose-800/60 text-rose-300 p-2 rounded text-[10px]">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-[#f6465d]" />
            <span>
              Margin dibutuhkan (${calc.requiredMargin.toFixed(2)}) melebihi saldo akun ($
              {accountSize.toFixed(2)}). Naikkan leverage atau turunkan risk! Maks Qty akun:{' '}
              <strong className="font-mono text-white">
                {formatQty(calc.maxQty)} {baseAsset}
              </strong>
              .
            </span>
          </div>
        )}

        {calc.isLiqBeforeSL && (
          <div className="flex items-start space-x-1.5 bg-amber-950/40 border border-amber-700/60 text-amber-300 p-2 rounded text-[10px]">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-400" />
            <span>
              Peringatan Leverage: Harga likuidasi (${formatPrice(calc.estLiqPrice)}) lebih dekat
              daripada Stop Loss (${formatPrice(stopLoss)}). Kurangi leverage!
            </span>
          </div>
        )}

        {!calc.isMarginInsufficient && !calc.isLiqBeforeSL && calc.isSlValidSide && calc.qty > 0 && (
          <div className="flex items-center space-x-1.5 text-[10px] text-emerald-400/90 pt-0.5">
            <ShieldCheck className="w-3.5 h-3.5 shrink-0" />
            <span>Risk & margin aman sesuai batas saldo akun Anda.</span>
          </div>
        )}

        {/* Quick Open Position Button */}
        {onOpenTrade && (
          <button
            type="button"
            onClick={() => {
              onOpenTrade({
                symbol,
                market,
                direction,
                entry_price: entryPrice,
                invalidation_price: stopLoss,
                target_price: targetPrice,
                risk_reward_ratio: calc.rr > 0 ? Number(calc.rr.toFixed(2)) : undefined
              })
            }}
            disabled={!calc.isSlValidSide || calc.qty <= 0}
            className={`w-full mt-2 py-2 px-3 rounded-lg font-bold text-xs shadow-md transition-all flex items-center justify-center space-x-2 disabled:opacity-40 disabled:cursor-not-allowed ${
              direction === 'LONG'
                ? 'bg-emerald-500 hover:bg-emerald-400 text-black shadow-emerald-950/40'
                : 'bg-rose-500 hover:bg-rose-400 text-white shadow-rose-950/40'
            }`}
          >
            <Zap className="w-3.5 h-3.5" />
            <span>Buka Posisi {direction} di Binance</span>
          </button>
        )}
      </div>
    </div>
  )
}
