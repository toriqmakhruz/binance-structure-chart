import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { fetchValidSetups, fetchOpenPositions } from '../../services/api'
import { WatchlistWsClient, TickerTick } from '../../services/binanceWs'
import { formatPrice } from '../../utils/formatters'
import {
  AppSettings,
  ForecastResult,
  ValidSetupItem,
  LockedTradeSetup
} from '../../types/analysis'
import {
  Target,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Clock,
  ShieldAlert,
  Shield,
  ArrowUpRight,
  Zap,
  CheckCircle2,
  Activity
} from 'lucide-react'

export interface ActivePositionBadgeInfo {
  symbol: string
  side: 'LONG' | 'SHORT'
  size?: number
  entryPrice?: number
  markPrice?: number
  unrealizedProfit?: number
  roePct?: number
}

function getStoredCredentials() {
  try {
    const raw = localStorage.getItem('cp_trade_credentials')
    if (raw) return JSON.parse(raw)
  } catch {}
  return { demoApiKey: '', demoApiSecret: '', liveApiKey: '', liveApiSecret: '', useSimulatedDemo: true }
}

function getStoredLockedSetups(): Record<string, any> {
  try {
    const raw = localStorage.getItem('cp_locked_trade_setups')
    if (raw) return JSON.parse(raw)
  } catch {}
  return {}
}

function getStoredTradeMode(): 'demo' | 'live' {
  try {
    const saved = localStorage.getItem('cp_trade_active_mode')
    return saved === 'live' ? 'live' : 'demo'
  } catch {
    return 'demo'
  }
}

interface SetupRadarPanelProps {
  symbol: string
  timeframe: string
  market: 'spot' | 'futures'
  settings: AppSettings
  forecast?: ForecastResult
  currentPrice?: number
  lockedSetups?: Record<string, LockedTradeSetup>
  onSelectSymbol: (symbol: string) => void
  onOpenTrade?: (setup: ValidSetupItem) => void
}

type DirectionFilter = 'ALL' | 'LONG' | 'SHORT' | 'IN_POSITION'

function isPriceStillValid(
  price: number,
  direction: 'LONG' | 'SHORT',
  sl: number,
  tp: number
): boolean {
  if (!Number.isFinite(price) || price <= 0) return true
  if (direction === 'LONG') {
    return price > sl && price < tp
  }
  return price < sl && price > tp
}

function formatTimeAgo(unixSec: number): string {
  const diffSec = Math.max(0, Math.floor(Date.now() / 1000) - unixSec)
  if (diffSec < 60) return 'Baru saja'
  const mins = Math.floor(diffSec / 60)
  if (mins < 60) return `${mins}m lalu`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}j ${mins % 60}m lalu`
  const days = Math.floor(hrs / 24)
  return `${days}h lalu`
}

export const SetupRadarPanel: React.FC<SetupRadarPanelProps> = ({
  symbol,
  timeframe,
  market,
  settings,
  forecast,
  currentPrice,
  lockedSetups,
  onSelectSymbol,
  onOpenTrade
}) => {
  const [setups, setSetups] = useState<ValidSetupItem[]>([])
  const [activePositions, setActivePositions] = useState<Map<string, ActivePositionBadgeInfo>>(new Map())
  const [scannedCount, setScannedCount] = useState<number>(24)
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [isWsConnected, setIsWsConnected] = useState<boolean>(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [dirFilter, setDirFilter] = useState<DirectionFilter>('ALL')

  // Real-time synchronization of open positions (both local locked & live Binance)
  const loadActivePositions = useCallback(async () => {
    const creds = getStoredCredentials()
    const mode = getStoredTradeMode()
    const apiKey = mode === 'demo' ? creds.demoApiKey : creds.liveApiKey
    const apiSecret = mode === 'demo' ? creds.demoApiSecret : creds.liveApiSecret

    const posMap = new Map<string, ActivePositionBadgeInfo>()

    // 1. Local locked trade setups cache (immediate 0ms responsiveness)
    const localLocked = { ...getStoredLockedSetups(), ...(lockedSetups || {}) }
    for (const [sym, item] of Object.entries(localLocked)) {
      if (item && item.status === 'ACTIVE') {
        const symUpper = sym.toUpperCase()
        posMap.set(symUpper, {
          symbol: symUpper,
          side: item.direction || 'LONG',
          entryPrice: item.entry_price
        })
      }
    }

    // 2. Query live positions from Binance API
    try {
      const res = await fetchOpenPositions(market, mode, apiKey, apiSecret)
      if (res.success && Array.isArray(res.positions)) {
        for (const p of res.positions) {
          const pSym = (p.symbol || '').toUpperCase()
          const pAmt = Number(p.positionAmt || 0)
          if (pSym && pAmt !== 0) {
            const isLong = pAmt > 0 || p.side === 'LONG'
            posMap.set(pSym, {
              symbol: pSym,
              side: isLong ? 'LONG' : 'SHORT',
              size: Math.abs(pAmt),
              entryPrice: Number(p.entryPrice || 0),
              markPrice: Number(p.markPrice || 0),
              unrealizedProfit: Number(p.unrealizedProfit || 0),
              roePct: Number(p.roePct || 0)
            })
          }
        }
      }
    } catch {
      // ignore network errors gracefully
    }

    setActivePositions(posMap)
  }, [market, lockedSetups])

  // Periodic polling for positions
  useEffect(() => {
    loadActivePositions()
    const timer = setInterval(loadActivePositions, 3500)
    const handleStorage = () => loadActivePositions()
    window.addEventListener('storage', handleStorage)
    return () => {
      clearInterval(timer)
      window.removeEventListener('storage', handleStorage)
    }
  }, [loadActivePositions])

  const loadSetups = useCallback(async (forceRefresh = false, silent = false) => {
    if (!silent) setIsLoading(true)
    setErrorMsg(null)
    try {
      const resp = await fetchValidSetups(timeframe, market, settings, forceRefresh)
      const list = Array.isArray(resp.setups) ? resp.setups : []
      // Strictly keep only valid setups & sort newest first
      const filtered = list
        .filter((item) =>
          isPriceStillValid(item.current_price, item.direction, item.invalidation_price, item.target_price)
        )
        .sort((a, b) => (b.entry_time - a.entry_time) || (b.confluence_weight - a.confluence_weight))

      setSetups(filtered)
      setScannedCount(resp.scanned_count || 24)
    } catch (err: any) {
      setErrorMsg(err?.message || 'Gagal memindai setup terbaru')
    } finally {
      if (!silent) setIsLoading(false)
    }
  }, [timeframe, market, settings])

  // Initial scan on mount / market / timeframe / settings change + periodic 60s rescan
  useEffect(() => {
    setSetups([])
    loadSetups(false, false)
    const timer = setInterval(() => loadSetups(true, true), 60000)
    return () => clearInterval(timer)
  }, [loadSetups])

  // Real-time ticker WebSocket validation: discard any setup immediately when SL or TP is hit
  useEffect(() => {
    const wsClient = new WatchlistWsClient(market, {
      onStatusChange: (connected) => setIsWsConnected(connected),
      onTickers: (batch: TickerTick[]) => {
        if (!batch.length) return
        const tickMap = new Map<string, TickerTick>()
        for (const t of batch) {
          tickMap.set(t.s, t)
        }

        setSetups((prev) => {
          if (prev.length === 0) return prev
          let changed = false
          const next: ValidSetupItem[] = []

          for (const item of prev) {
            const u = tickMap.get(item.symbol)
            if (!u) {
              next.push(item)
              continue
            }
            if (!isPriceStillValid(u.c, item.direction, item.invalidation_price, item.target_price)) {
              // Discard immediately because SL or TP was reached
              changed = true
              continue
            }
            if (u.c !== item.current_price || u.P !== item.price_change_pct) {
              changed = true
              next.push({
                ...item,
                current_price: u.c,
                price_change_pct: u.P,
                quote_volume: u.q > 0 ? u.q : item.quote_volume
              })
            } else {
              next.push(item)
            }
          }

          return changed ? next : prev
        })
      }
    })

    wsClient.connect()
    return () => {
      wsClient.disconnect()
      setIsWsConnected(false)
    }
  }, [market])

  // Sync with the currently opened chart analysis & live candle price
  useEffect(() => {
    if (!forecast) return
    const activeUpper = symbol.toUpperCase()
    const validSc = forecast.scenarios?.find(
      (s) =>
        s.is_valid === true &&
        s.status === 'VALID_ENTRY' &&
        (s.risk_reward_ratio || 0) >= 1.5 &&
        s.entry_price !== undefined &&
        (s.direction === 'LONG' || s.direction === 'SHORT')
    )

    setSetups((prev) => {
      const others = prev.filter((item) => item.symbol.toUpperCase() !== activeUpper)
      if (!validSc || !validSc.direction || validSc.entry_price === undefined) {
        return others.length === prev.length ? prev : others
      }

      const livePrice = currentPrice && currentPrice > 0
        ? currentPrice
        : (prev.find((x) => x.symbol.toUpperCase() === activeUpper)?.current_price || validSc.entry_price)

      if (!isPriceStillValid(livePrice, validSc.direction, validSc.invalidation_price, validSc.target_price)) {
        return others.length === prev.length ? prev : others
      }

      const existing = prev.find((x) => x.symbol.toUpperCase() === activeUpper)
      const upserted: ValidSetupItem = {
        symbol: activeUpper,
        baseAsset: activeUpper.replace(/USDT$|BUSD$|USDC$/i, ''),
        market,
        timeframe,
        direction: validSc.direction,
        name: validSc.name,
        entry_price: validSc.entry_price,
        entry_time: validSc.entry_time || Math.floor(Date.now() / 1000),
        entry_zone_high: validSc.entry_zone_high ?? validSc.entry_price,
        entry_zone_low: validSc.entry_zone_low ?? validSc.entry_price,
        invalidation_price: validSc.invalidation_price,
        target_price: validSc.target_price,
        risk_reward_ratio: validSc.risk_reward_ratio,
        confluence_weight: validSc.confluence_weight,
        confluence_score: forecast.confluence_score,
        current_price: livePrice,
        price_change_pct: existing?.price_change_pct ?? 0,
        quote_volume: existing?.quote_volume ?? 0
      }

      return [upserted, ...others].sort(
        (a, b) => (b.entry_time - a.entry_time) || (b.confluence_weight - a.confluence_weight)
      )
    })
  }, [symbol, market, timeframe, forecast, currentPrice])

  const freshSetups = useMemo(() => {
    return setups.filter((s) => !activePositions.has(s.symbol.toUpperCase()))
  }, [setups, activePositions])

  const inPositionSetups = useMemo(() => {
    return setups.filter((s) => activePositions.has(s.symbol.toUpperCase()))
  }, [setups, activePositions])

  const freshLongCount = useMemo(() => freshSetups.filter((s) => s.direction === 'LONG').length, [freshSetups])
  const freshShortCount = useMemo(() => freshSetups.filter((s) => s.direction === 'SHORT').length, [freshSetups])
  const inPositionCount = inPositionSetups.length

  const displayedSetups = useMemo(() => {
    if (dirFilter === 'LONG') {
      return freshSetups.filter((item) => item.direction === 'LONG')
    }
    if (dirFilter === 'SHORT') {
      return freshSetups.filter((item) => item.direction === 'SHORT')
    }
    if (dirFilter === 'IN_POSITION') {
      return inPositionSetups
    }
    // 'ALL' default: strictly show ONLY fresh setups without active positions (best available other pairs)
    return freshSetups
  }, [dirFilter, freshSetups, inPositionSetups])

  return (
    <div className="w-full flex-1 flex flex-col overflow-hidden select-none text-xs">
      {/* 1. Header */}
      <div className="p-3 bg-[#131823] border-b border-[#21262d] space-y-2 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-1.5 text-slate-300 font-bold uppercase tracking-wider text-[11px]">
            <Target className="w-3.5 h-3.5 text-[#00c087]" />
            <span>Setup Valid ({timeframe.toUpperCase()})</span>
            <span
              title={isWsConnected ? 'Validasi SL/TP Real-Time Aktif' : 'Menyinkronkan Ticker...'}
              className={`inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[9px] font-bold ${
                isWsConnected
                  ? 'bg-emerald-950/80 text-[#00c087] border border-emerald-800/60'
                  : 'bg-slate-800 text-slate-400 border border-slate-700'
              }`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${isWsConnected ? 'bg-[#00c087] animate-pulse' : 'bg-slate-500'}`} />
              <span>{freshSetups.length}</span>
            </span>
          </div>

          <button
            type="button"
            onClick={() => {
              loadSetups(true, false)
              loadActivePositions()
            }}
            disabled={isLoading}
            title="Pindai ulang setup & sinkronkan posisi"
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-[#1e2533] transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-[#f0b90b]' : ''}`} />
          </button>
        </div>

        <p className="text-[10px] text-slate-400 leading-relaxed">
          Menampilkan setup A+ terbaik yang belum memiliki posisi ({market.toUpperCase()}). Pair yang sudah ada posisi disembunyikan otomatis.
        </p>

        {/* Direction & In-Position Filter Pills */}
        <div className="grid grid-cols-4 gap-1">
          <button
            type="button"
            onClick={() => setDirFilter('ALL')}
            className={`py-1 rounded text-[10px] font-bold border transition-colors ${
              dirFilter === 'ALL'
                ? 'bg-[#f0b90b]/15 text-[#f0b90b] border-[#f0b90b]/50'
                : 'bg-[#0d1117] text-slate-400 border-[#21262d] hover:text-slate-200'
            }`}
          >
            Semua ({freshSetups.length})
          </button>
          <button
            type="button"
            onClick={() => setDirFilter('LONG')}
            className={`py-1 rounded text-[10px] font-bold border transition-colors ${
              dirFilter === 'LONG'
                ? 'bg-emerald-950/70 text-[#00c087] border-emerald-700/60'
                : 'bg-[#0d1117] text-slate-400 border-[#21262d] hover:text-slate-200'
            }`}
          >
            Long ({freshLongCount})
          </button>
          <button
            type="button"
            onClick={() => setDirFilter('SHORT')}
            className={`py-1 rounded text-[10px] font-bold border transition-colors ${
              dirFilter === 'SHORT'
                ? 'bg-rose-950/70 text-[#f6465d] border-rose-700/60'
                : 'bg-[#0d1117] text-slate-400 border-[#21262d] hover:text-slate-200'
            }`}
          >
            Short ({freshShortCount})
          </button>
          <button
            type="button"
            onClick={() => setDirFilter('IN_POSITION')}
            className={`py-1 rounded text-[10px] font-bold border transition-colors flex items-center justify-center space-x-1 ${
              dirFilter === 'IN_POSITION'
                ? 'bg-emerald-950 text-[#00c087] border-[#00c087] shadow-sm'
                : inPositionCount > 0
                ? 'bg-[#0d1117] text-[#00c087] border-emerald-800/50 hover:bg-emerald-950/30'
                : 'bg-[#0d1117] text-slate-500 border-[#21262d] opacity-50'
            }`}
            title="Lihat pair yang sedang memiliki posisi aktif"
          >
            <Shield className="w-2.5 h-2.5" />
            <span>Posisi ({inPositionCount})</span>
          </button>
        </div>
      </div>

      {/* 2. Scrollable Valid Setup Cards */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
        {isLoading && setups.length === 0 ? (
          <div className="p-6 text-center space-y-2 text-slate-400 text-[11px]">
            <RefreshCw className="w-5 h-5 animate-spin text-[#f0b90b] mx-auto" />
            <p>Memindai setup A+ valid di {scannedCount} koin teratas...</p>
          </div>
        ) : errorMsg && setups.length === 0 ? (
          <div className="p-6 text-center text-rose-400 text-[11px] space-y-2">
            <p>{errorMsg}</p>
            <button
              type="button"
              onClick={() => loadSetups(true, false)}
              className="px-2.5 py-1 rounded bg-[#1e2533] text-white text-[10px] font-semibold"
            >
              Pindai Lagi
            </button>
          </div>
        ) : displayedSetups.length === 0 ? (
          <div className="p-6 text-center space-y-2 bg-[#0d1117] border border-dashed border-[#21262d] rounded-lg">
            <ShieldAlert className="w-5 h-5 text-slate-500 mx-auto" />
            <p className="text-[11px] text-slate-400 font-semibold">
              {dirFilter === 'IN_POSITION'
                ? 'Belum ada pair setup dengan posisi aktif'
                : `Belum ada setup ${dirFilter === 'ALL' ? 'baru' : dirFilter} yang tersedia`}
            </p>
            <p className="text-[10px] text-slate-500">
              {dirFilter === 'IN_POSITION'
                ? 'Pair yang sudah Anda buka posisi akan muncul di sini agar tidak mengganggu rekomendasi setup baru.'
                : 'Pair yang sudah ada posisi otomatis disembunyikan agar Anda bisa fokus pada peluang terbaik lainnya.'}
            </p>
          </div>
        ) : (
          displayedSetups.map((item) => {
            const symUpper = item.symbol.toUpperCase()
            const posInfo = activePositions.get(symUpper)
            const hasPosition = Boolean(posInfo)
            const isLong = item.direction === 'LONG'
            const isSelected = symUpper === symbol.toUpperCase()

            return (
              <div
                key={`${item.symbol}-${item.direction}-${item.entry_time}`}
                onClick={() => onSelectSymbol(item.symbol)}
                className={`p-2.5 rounded-lg border cursor-pointer transition-all space-y-2 relative ${
                  hasPosition
                    ? 'bg-[#101722] border-emerald-800/60 hover:border-emerald-600/70'
                    : isSelected
                    ? 'bg-[#1a2232] border-[#f0b90b]/70 shadow-sm'
                    : 'bg-[#0d1117] border-[#21262d] hover:border-[#374151] hover:bg-[#131823]'
                }`}
              >
                {/* Top row: Symbol, Direction, Time Ago */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5 min-w-0">
                    <span
                      className={`inline-flex items-center space-x-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                        isLong
                          ? 'bg-emerald-950 text-[#00c087] border border-emerald-800/70'
                          : 'bg-rose-950 text-[#f6465d] border border-rose-800/70'
                      }`}
                    >
                      {isLong ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                      <span>{item.direction}</span>
                    </span>

                    <span className={`font-mono font-bold text-xs truncate ${isSelected ? 'text-[#f0b90b]' : 'text-white'}`}>
                      {item.symbol}
                    </span>

                    {/* Lencana Kecil Posisi Aktif */}
                    {hasPosition && (
                      <span
                        title={`Pair memiliki posisi aktif ${posInfo?.side || ''} (ROE: ${posInfo?.roePct !== undefined ? `${posInfo.roePct.toFixed(1)}%` : '0%'})`}
                        className={`inline-flex items-center space-x-0.5 px-1.5 py-0.5 rounded text-[8.5px] font-black uppercase tracking-wider shrink-0 ${
                          posInfo?.side === 'LONG'
                            ? 'bg-emerald-950/90 text-[#00c087] border border-emerald-700/60 shadow-sm'
                            : 'bg-rose-950/90 text-[#f6465d] border border-rose-700/60 shadow-sm'
                        }`}
                      >
                        <Shield className="w-2.5 h-2.5 shrink-0" />
                        <span>POSISI</span>
                      </span>
                    )}
                  </div>

                  <div className="flex items-center space-x-1.5 shrink-0">
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#1b2230] text-[#f0b90b] font-bold">
                      1:{item.risk_reward_ratio}
                    </span>
                    <ArrowUpRight className="w-3 h-3 text-slate-500" />
                  </div>
                </div>

                {/* Setup reason + live price + age */}
                <div className="flex items-center justify-between text-[10px]">
                  <span className="text-slate-300 truncate pr-2" title={item.name}>
                    {item.name}
                  </span>
                  <span className="font-mono font-semibold text-white shrink-0">
                    ${formatPrice(item.current_price)}
                  </span>
                </div>

                {/* Entry Zone / SL / TP grid */}
                <div className="grid grid-cols-3 gap-1.5 pt-1.5 border-t border-[#1e2430] text-[10px]">
                  <div>
                    <div className="text-[9px] text-slate-500">Entry</div>
                    <div className="font-mono font-semibold text-slate-200 truncate">
                      ${formatPrice(item.entry_price)}
                    </div>
                  </div>
                  <div>
                    <div className="text-[9px] text-slate-500">SL Invalidasi</div>
                    <div className="font-mono font-semibold text-[#f6465d] truncate">
                      ${formatPrice(item.invalidation_price)}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-[9px] text-slate-500">Target TP</div>
                    <div className="font-mono font-semibold text-[#00c087] truncate">
                      ${formatPrice(item.target_price)}
                    </div>
                  </div>
                </div>

                {/* Footer meta & Open Posisi Action */}
                <div className="flex items-center justify-between pt-1 border-t border-[#18202d] text-[9px] text-slate-500">
                  <div className="flex items-center space-x-2">
                    <span className="inline-flex items-center space-x-1">
                      <Clock className="w-2.5 h-2.5" />
                      <span>{formatTimeAgo(item.entry_time)}</span>
                    </span>
                    <span className="font-mono">
                      {item.confluence_weight.toFixed(0)}%
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      onSelectSymbol(item.symbol)
                      onOpenTrade?.(item)
                    }}
                    className={`px-2 py-1 rounded text-[10px] font-bold flex items-center space-x-1 transition-all shadow-sm ${
                      hasPosition
                        ? 'bg-[#1b2536] hover:bg-[#223147] text-[#00c087] border border-emerald-600/70'
                        : isLong
                        ? 'bg-emerald-500/90 hover:bg-emerald-400 text-black shadow-emerald-950/40'
                        : 'bg-rose-500/90 hover:bg-rose-400 text-white shadow-rose-950/40'
                    }`}
                  >
                    {hasPosition ? (
                      <>
                        <CheckCircle2 className="w-3 h-3 text-[#00c087]" />
                        <span>Kelola Posisi</span>
                      </>
                    ) : (
                      <>
                        <Zap className="w-3 h-3" />
                        <span>Open Posisi</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
