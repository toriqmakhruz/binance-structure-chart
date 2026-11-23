import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  fetchSymbols,
  fetchSmartDivergenceScan,
  fetchSqueezeHunterScan,
  SmartDivergenceScanItem,
  SqueezeCandidateItem
} from '../../services/api'
import { WatchlistWsClient, TickerTick } from '../../services/binanceWs'
import { formatPrice } from '../../utils/formatters'
import {
  Search,
  Star,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Coins,
  X,
  ArrowDown,
  ArrowUp,
  Target,
  Sparkles,
  Zap,
  Filter,
  CheckCircle2,
  Clock,
  Layers,
  ArrowRight,
  Flame,
  AlertTriangle
} from 'lucide-react'

export interface SymbolTickerItem {
  symbol: string
  baseAsset?: string
  lastPrice: number
  priceChangePercent: number
  quoteVolume: number
}

interface CoinWatchlistProps {
  market: 'spot' | 'futures'
  currentSymbol: string
  timeframe?: string
  currentPrice?: number
  onSelectSymbol: (symbol: string) => void
}

type WatchlistFilter = 'ALL' | 'FAV' | 'GAINERS' | 'LOSERS' | 'SMART_DIV'
type SortField = 'volume' | 'price' | 'change' | 'symbol'
type SortDir = 'desc' | 'asc'

const FAV_STORAGE_KEY = 'cp_watchlist_favorites'
const MAX_UNFILTERED_ROWS = 180

function readFavorites(): string[] {
  try {
    const raw = localStorage.getItem(FAV_STORAGE_KEY)
    if (!raw) return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT']
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT']
  }
}

function formatQuoteVolume(vol: number): string {
  if (!Number.isFinite(vol) || vol <= 0) return '$0'
  if (vol >= 1_000_000_000) return `$${(vol / 1_000_000_000).toFixed(2)}B`
  if (vol >= 1_000_000) return `$${(vol / 1_000_000).toFixed(1)}M`
  if (vol >= 1_000) return `$${(vol / 1_000).toFixed(0)}K`
  return `$${vol.toFixed(0)}`
}

export const CoinWatchlist: React.FC<CoinWatchlistProps> = ({
  market,
  currentSymbol,
  timeframe = '15m',
  currentPrice,
  onSelectSymbol
}) => {
  const [mainTab, setMainTab] = useState<'watchlist' | 'smart_divergence' | 'squeeze_hunter'>('watchlist')
  const [symbols, setSymbols] = useState<SymbolTickerItem[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [isWsConnected, setIsWsConnected] = useState<boolean>(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [filter, setFilter] = useState<WatchlistFilter>('ALL')
  const [sortField, setSortField] = useState<SortField>('volume')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [favorites, setFavorites] = useState<string[]>(() => readFavorites())

  // Smart Divergence Scanner States
  const [divergenceSignals, setDivergenceSignals] = useState<SmartDivergenceScanItem[]>([])
  const [isDivergenceLoading, setIsDivergenceLoading] = useState<boolean>(false)
  const [divergenceError, setDivergenceError] = useState<string | null>(null)
  const [scanTimeframe, setScanTimeframe] = useState<string>(timeframe || '15m')
  const [divergenceDirectionFilter, setDivergenceDirectionFilter] = useState<'ALL' | 'BULLISH' | 'BEARISH'>('ALL')
  const [divergenceGradeFilter, setDivergenceGradeFilter] = useState<'ALL' | 'A'>('ALL')
  const [divergenceUpdatedAt, setDivergenceUpdatedAt] = useState<number>(0)

  // Whale Squeeze Hunter States
  const [squeezeCandidates, setSqueezeCandidates] = useState<SqueezeCandidateItem[]>([])
  const [isSqueezeLoading, setIsSqueezeLoading] = useState<boolean>(false)
  const [squeezeError, setSqueezeError] = useState<string | null>(null)
  const [squeezeTypeFilter, setSqueezeTypeFilter] = useState<'ALL' | 'SHORT_SQUEEZE' | 'LONG_SQUEEZE'>('ALL')
  const [squeezeGradeFilter, setSqueezeGradeFilter] = useState<'ALL' | 'EXTREME'>('ALL')
  const [squeezeUpdatedAt, setSqueezeUpdatedAt] = useState<number>(0)

  const prevPricesRef = useRef<Record<string, number>>({})
  const flashDirRef = useRef<Record<string, { dir: 'up' | 'down'; expiresAt: number }>>({})

  const loadSymbols = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true)
    setErrorMsg(null)
    try {
      const data = await fetchSymbols(market)
      const list = Array.isArray(data) ? data : []
      for (const item of list) {
        if (prevPricesRef.current[item.symbol] === undefined) {
          prevPricesRef.current[item.symbol] = item.lastPrice
        }
      }
      setSymbols(list)
    } catch (err: any) {
      setErrorMsg(err?.message || 'Gagal memuat daftar koin')
    } finally {
      if (!silent) setIsLoading(false)
    }
  }, [market])

  // Fetch Smart Divergence scan from backend
  const loadSmartDivergences = useCallback(async (force = false, tf = scanTimeframe) => {
    setIsDivergenceLoading(true)
    setDivergenceError(null)
    try {
      const res = await fetchSmartDivergenceScan(tf, market, force)
      setDivergenceSignals(res?.signals || [])
      setDivergenceUpdatedAt(res?.updated_at ? res.updated_at * 1000 : Date.now())
    } catch (err: any) {
      setDivergenceError(err?.message || 'Gagal memindai Smart Divergence')
    } finally {
      setIsDivergenceLoading(false)
    }
  }, [market, scanTimeframe])

  // Fetch Squeeze Hunter scan from backend
  const loadSqueezeCandidates = useCallback(async () => {
    setIsSqueezeLoading(true)
    setSqueezeError(null)
    try {
      const res = await fetchSqueezeHunterScan(0.03, 35)
      setSqueezeCandidates(res?.candidates || [])
      setSqueezeUpdatedAt(res?.updated_at ? res.updated_at * 1000 : Date.now())
    } catch (err: any) {
      setSqueezeError(err?.message || 'Gagal memindai Squeeze Hunter')
    } finally {
      setIsSqueezeLoading(false)
    }
  }, [])

  // Fetch initial sorted list from backend & periodic resync every 60s
  useEffect(() => {
    prevPricesRef.current = {}
    flashDirRef.current = {}
    loadSymbols(false)
    const timer = setInterval(() => loadSymbols(true), 60000)
    return () => clearInterval(timer)
  }, [loadSymbols])

  // Periodic resync for Smart Divergence scanner
  useEffect(() => {
    loadSmartDivergences(false, scanTimeframe)
    const timer = setInterval(() => {
      loadSmartDivergences(false, scanTimeframe)
    }, 35000)
    return () => clearInterval(timer)
  }, [scanTimeframe, loadSmartDivergences])

  // Periodic resync for Squeeze Hunter scanner (every 30s)
  useEffect(() => {
    loadSqueezeCandidates()
    const timer = setInterval(() => {
      loadSqueezeCandidates()
    }, 30000)
    return () => clearInterval(timer)
  }, [loadSqueezeCandidates])

  // Real-time Binance !ticker@arr WebSocket updates (~1s live ticks)
  useEffect(() => {
    const wsClient = new WatchlistWsClient(market, {
      onStatusChange: (connected) => {
        setIsWsConnected(connected)
      },
      onTickers: (batch: TickerTick[]) => {
        if (!batch.length) return
        const tickMap = new Map<string, TickerTick>()
        const now = Date.now()

        for (const t of batch) {
          tickMap.set(t.s, t)
          const prev = prevPricesRef.current[t.s]
          if (prev !== undefined && t.c !== prev) {
            flashDirRef.current[t.s] = {
              dir: t.c > prev ? 'up' : 'down',
              expiresAt: now + 900
            }
          }
          prevPricesRef.current[t.s] = t.c
        }

        setSymbols((prevList) => {
          if (prevList.length === 0) return prevList
          let changed = false
          const next = prevList.map((item) => {
            const u = tickMap.get(item.symbol)
            if (!u) return item
            if (
              u.c === item.lastPrice &&
              u.P === item.priceChangePercent &&
              u.q === item.quoteVolume
            ) {
              return item
            }
            changed = true
            return {
              ...item,
              lastPrice: u.c,
              priceChangePercent: u.P,
              quoteVolume: u.q > 0 ? u.q : item.quoteVolume
            }
          })
          return changed ? next : prevList
        })
      }
    })

    wsClient.connect()
    return () => {
      wsClient.disconnect()
      setIsWsConnected(false)
    }
  }, [market])

  const handleFilterChange = (nextFilter: WatchlistFilter) => {
    setFilter(nextFilter)
    if (nextFilter === 'GAINERS') {
      setSortField('change')
      setSortDir('desc')
    } else if (nextFilter === 'LOSERS') {
      setSortField('change')
      setSortDir('asc')
    } else if (filter === 'GAINERS' || filter === 'LOSERS') {
      setSortField('volume')
      setSortDir('desc')
    }
  }

  const handleSortClick = (field: SortField) => {
    if (sortField === field) {
      setSortDir((prev) => (prev === 'desc' ? 'asc' : 'desc'))
    } else {
      setSortField(field)
      setSortDir(field === 'symbol' ? 'asc' : 'desc')
    }
  }

  const toggleFavorite = (sym: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setFavorites((prev) => {
      const next = prev.includes(sym) ? prev.filter((s) => s !== sym) : [...prev, sym]
      try {
        localStorage.setItem(FAV_STORAGE_KEY, JSON.stringify(next))
      } catch {
        // ignore storage errors
      }
      return next
    })
  }

  const displayedList = useMemo(() => {
    let list = Array.isArray(symbols) ? symbols : []

    if (filter === 'FAV') {
      const favList = Array.isArray(favorites) ? favorites : []
      list = list.filter((item) => item?.symbol && favList.includes(item.symbol))
    } else if (filter === 'GAINERS') {
      list = list.filter((item) => item && item.priceChangePercent > 0)
    } else if (filter === 'LOSERS') {
      list = list.filter((item) => item && item.priceChangePercent < 0)
    }

    const q = searchTerm.trim().toLowerCase()
    if (q) {
      list = list.filter((item) => item?.symbol && item.symbol.toLowerCase().includes(q))
    }

    const sorted = [...list].sort((a, b) => {
      let cmp = 0
      if (sortField === 'volume') {
        cmp = a.quoteVolume - b.quoteVolume
      } else if (sortField === 'price') {
        cmp = a.lastPrice - b.lastPrice
      } else if (sortField === 'change') {
        cmp = a.priceChangePercent - b.priceChangePercent
      } else {
        cmp = a.symbol.localeCompare(b.symbol)
      }
      return sortDir === 'desc' ? -cmp : cmp
    })

    return q ? sorted : sorted.slice(0, MAX_UNFILTERED_ROWS)
  }, [symbols, filter, favorites, searchTerm, sortField, sortDir])

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) return null
    return sortDir === 'desc' ? (
      <ArrowDown className="w-2.5 h-2.5 text-[#f0b90b] inline ml-0.5" />
    ) : (
      <ArrowUp className="w-2.5 h-2.5 text-[#f0b90b] inline ml-0.5" />
    )
  }

  const displayedDivergences = useMemo(() => {
    return divergenceSignals.filter((item) => {
      if (divergenceDirectionFilter !== 'ALL' && item.direction !== divergenceDirectionFilter) {
        return false
      }
      if (divergenceGradeFilter === 'A' && item.grade !== 'A') {
        return false
      }
      return true
    })
  }, [divergenceSignals, divergenceDirectionFilter, divergenceGradeFilter])

  const displayedSqueezeCandidates = useMemo(() => {
    return squeezeCandidates.filter((cand) => {
      if (squeezeTypeFilter !== 'ALL' && cand.squeeze_type !== squeezeTypeFilter) {
        return false
      }
      if (squeezeGradeFilter === 'EXTREME' && cand.funding_rate_abs < 0.1) {
        return false
      }
      return true
    })
  }, [squeezeCandidates, squeezeTypeFilter, squeezeGradeFilter])

  const extremeSqueezeCount = useMemo(() => {
    return squeezeCandidates.filter((cand) => cand.funding_rate_abs >= 0.1).length
  }, [squeezeCandidates])

  const nowTs = Date.now()

  return (
    <div className="w-full flex-1 min-h-0 flex flex-col overflow-hidden select-none text-xs">
      {/* 0. Top Main Tab Switcher */}
      <div className="grid grid-cols-3 bg-[#0d1117] border-b border-[#21262d] p-1.5 gap-1.5 shrink-0">
        <button
          type="button"
          onClick={() => setMainTab('watchlist')}
          className={`py-1.5 px-1 rounded-md text-[11px] font-bold transition-all flex items-center justify-center space-x-1 cursor-pointer ${
            mainTab === 'watchlist'
              ? 'bg-[#1a2232] text-amber-300 border border-amber-500/40 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-[#131924]'
          }`}
        >
          <Coins className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="truncate">Watchlist</span>
        </button>

        <button
          type="button"
          onClick={() => setMainTab('smart_divergence')}
          className={`py-1.5 px-1 rounded-md text-[11px] font-bold transition-all flex items-center justify-center space-x-1 cursor-pointer ${
            mainTab === 'smart_divergence'
              ? 'bg-[#0e2722] text-emerald-300 border border-emerald-500/40 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-[#131924]'
          }`}
        >
          <Target className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="truncate">Smart Div</span>
          {divergenceSignals.length > 0 && (
            <span className="ml-0.5 px-1 py-0.2 rounded-full text-[9px] font-mono font-bold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
              {divergenceSignals.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setMainTab('squeeze_hunter')}
          className={`py-1.5 px-1 rounded-md text-[11px] font-bold transition-all flex items-center justify-center space-x-1 cursor-pointer ${
            mainTab === 'squeeze_hunter'
              ? 'bg-[#29170e] text-amber-300 border border-amber-500/50 shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-[#131924]'
          }`}
        >
          <Flame className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span className="truncate">🔥 Squeeze</span>
          {squeezeCandidates.length > 0 && (
            <span className={`ml-0.5 px-1 py-0.2 rounded-full text-[9px] font-mono font-bold border ${
              extremeSqueezeCount > 0
                ? 'bg-amber-500/30 text-amber-300 border-amber-500/50 animate-pulse'
                : 'bg-slate-700/50 text-slate-300 border-slate-600'
            }`}>
              {squeezeCandidates.length}
            </span>
          )}
        </button>
      </div>

      {mainTab === 'watchlist' ? (
        <>
          {/* 1. Header & Search */}
          <div className="p-3 bg-[#131823] border-b border-[#21262d] space-y-2 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-1.5 text-slate-300 font-bold uppercase tracking-wider text-[11px]">
                <Coins className="w-3.5 h-3.5 text-[#f0b90b]" />
                <span>Watchlist ({market.toUpperCase()})</span>
                <span
                  title={isWsConnected ? 'Harga & Urutan Live Real-Time Binance' : 'Menyinkronkan Ticker...'}
                  className={`inline-flex items-center space-x-1 px-1.5 py-0.5 rounded text-[9px] font-bold ${
                    isWsConnected
                      ? 'bg-emerald-950/80 text-[#00c087] border border-emerald-800/60'
                      : 'bg-slate-800 text-slate-400 border border-slate-700'
                  }`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${isWsConnected ? 'bg-[#00c087] animate-pulse' : 'bg-slate-500'}`} />
                  <span>{isWsConnected ? 'LIVE' : 'SYNC'}</span>
                </span>
              </div>
              <button
                type="button"
                onClick={() => loadSymbols(false)}
                disabled={isLoading}
                title="Refresh daftar koin"
                className="p-1 rounded text-slate-400 hover:text-white hover:bg-[#1e2533] transition-colors cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-[#f0b90b]' : ''}`} />
              </button>
            </div>

            {/* Search Input */}
            <div className="flex items-center bg-[#0d1117] border border-[#262f3f] focus-within:border-[#f0b90b] rounded-md px-2 py-1.5 space-x-1.5">
              <Search className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Cari koin (BTC, ETH, SOL...)"
                className="w-full bg-transparent text-white text-[11px] font-mono outline-none placeholder:text-slate-500"
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="text-slate-500 hover:text-slate-300"
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>

            {/* Filter Pills with shortcut to Smart Div Scanner & Squeeze */}
            <div className="grid grid-cols-6 gap-1">
              {[
                { key: 'ALL', label: 'Semua' },
                { key: 'FAV', label: 'Favorit' },
                { key: 'SMART_DIV', label: '🎯 Div' },
                { key: 'SQUEEZE', label: '🔥 Squeeze' },
                { key: 'GAINERS', label: 'Naik' },
                { key: 'LOSERS', label: 'Turun' }
              ].map((tab) => (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => {
                    if (tab.key === 'SMART_DIV') {
                      setMainTab('smart_divergence')
                    } else if (tab.key === 'SQUEEZE') {
                      setMainTab('squeeze_hunter')
                    } else {
                      handleFilterChange(tab.key as WatchlistFilter)
                    }
                  }}
                  className={`py-1 rounded text-[10px] font-bold border transition-colors cursor-pointer truncate px-0.5 text-center ${
                    tab.key === 'SMART_DIV'
                      ? 'bg-emerald-950/60 text-emerald-300 border-emerald-700/50 hover:bg-emerald-900/60'
                      : tab.key === 'SQUEEZE'
                      ? 'bg-amber-950/60 text-amber-300 border-amber-700/50 hover:bg-amber-900/60'
                      : filter === tab.key
                      ? 'bg-[#f0b90b]/15 text-[#f0b90b] border-[#f0b90b]/50'
                      : 'bg-[#0d1117] text-slate-400 border-[#21262d] hover:text-slate-200'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {/* 2. Interactive Sortable Column Headers */}
          <div className="grid grid-cols-12 px-3 py-1.5 bg-[#0d1117] border-b border-[#21262d] text-[10px] font-bold uppercase tracking-wider text-slate-500 shrink-0">
            <div className="col-span-5 flex items-center space-x-1.5">
              <button
                type="button"
                onClick={() => handleSortClick('symbol')}
                className={`hover:text-slate-200 transition-colors ${sortField === 'symbol' ? 'text-[#f0b90b]' : ''}`}
              >
                Simbol{renderSortIcon('symbol')}
              </button>
              <span className="text-slate-700">/</span>
              <button
                type="button"
                onClick={() => handleSortClick('volume')}
                className={`hover:text-slate-200 transition-colors ${sortField === 'volume' ? 'text-[#f0b90b]' : ''}`}
              >
                Vol{renderSortIcon('volume')}
              </button>
            </div>
            <button
              type="button"
              onClick={() => handleSortClick('price')}
              className={`col-span-4 text-right hover:text-slate-200 transition-colors ${sortField === 'price' ? 'text-[#f0b90b]' : ''}`}
            >
              Harga{renderSortIcon('price')}
            </button>
            <button
              type="button"
              onClick={() => handleSortClick('change')}
              className={`col-span-3 text-right hover:text-slate-200 transition-colors ${sortField === 'change' ? 'text-[#f0b90b]' : ''}`}
            >
              24j %{renderSortIcon('change')}
            </button>
          </div>

          {/* 3. Scrollable Coin List */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y divide-y divide-[#1a202c] pb-24">
            {isLoading && symbols.length === 0 ? (
              <div className="p-6 text-center text-slate-400 text-[11px]">
                Memuat daftar koin Binance...
              </div>
            ) : errorMsg && symbols.length === 0 ? (
              <div className="p-6 text-center text-rose-400 text-[11px] space-y-2">
                <p>{errorMsg}</p>
                <button
                  type="button"
                  onClick={() => loadSymbols(false)}
                  className="px-2.5 py-1 rounded bg-[#1e2533] text-white text-[10px] font-semibold"
                >
                  Coba Lagi
                </button>
              </div>
            ) : displayedList.length === 0 ? (
              <div className="p-6 text-center text-slate-500 text-[11px]">
                {filter === 'FAV'
                  ? 'Belum ada koin favorit. Klik ikon bintang untuk menambahkan.'
                  : 'Tidak ada koin yang cocok.'}
              </div>
            ) : (
              displayedList.map((item) => {
                const isSelected = item.symbol.toUpperCase() === currentSymbol.toUpperCase()
                const isFav = favorites.includes(item.symbol)
                const displayPrice = isSelected && currentPrice ? currentPrice : item.lastPrice
                const isPositive = item.priceChangePercent >= 0
                const baseName = item.baseAsset || item.symbol.replace(/USDT$|BUSD$|USDC$/i, '')
                const quoteName = item.symbol.slice(baseName.length) || 'USDT'
                const flash = flashDirRef.current[item.symbol]
                const activeFlash = flash && flash.expiresAt > nowTs ? flash.dir : null

                return (
                  <div
                    key={item.symbol}
                    onClick={() => onSelectSymbol(item.symbol)}
                    className={`grid grid-cols-12 items-center px-3 py-2 cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-[#1c2434] border-l-2 border-[#f0b90b]'
                        : 'hover:bg-[#171d29]'
                    }`}
                  >
                    {/* Symbol & Star & Vol */}
                    <div className="col-span-5 flex items-center space-x-1.5 min-w-0">
                      <button
                        type="button"
                        onClick={(e) => toggleFavorite(item.symbol, e)}
                        title={isFav ? 'Hapus dari Favorit' : 'Tambah ke Favorit'}
                        className={`shrink-0 transition-colors ${
                          isFav ? 'text-[#f0b90b]' : 'text-slate-600 hover:text-slate-400'
                        }`}
                      >
                        <Star className="w-3 h-3" fill={isFav ? '#f0b90b' : 'none'} />
                      </button>
                      <div className="min-w-0">
                        <div className="flex items-baseline space-x-0.5 truncate">
                          <span className={`font-mono font-bold text-[11px] ${isSelected ? 'text-[#f0b90b]' : 'text-white'}`}>
                            {baseName}
                          </span>
                          <span className="font-mono text-[9px] text-slate-500">/{quoteName}</span>
                        </div>
                        <div className="text-[9px] text-slate-500 font-mono">
                          Vol {formatQuoteVolume(item.quoteVolume)}
                        </div>
                      </div>
                    </div>

                    {/* Last Price with live tick color feedback */}
                    <div
                      className={`col-span-4 text-right font-mono text-[11px] font-semibold truncate transition-colors duration-300 ${
                        activeFlash === 'up'
                          ? 'text-[#00c087]'
                          : activeFlash === 'down'
                          ? 'text-[#f6465d]'
                          : 'text-slate-100'
                      }`}
                    >
                      ${formatPrice(displayPrice)}
                    </div>

                    {/* 24h Change % */}
                    <div className="col-span-3 flex justify-end">
                      <span
                        className={`inline-flex items-center space-x-0.5 px-1.5 py-0.5 rounded font-mono text-[10px] font-bold ${
                          isPositive
                            ? 'bg-emerald-950/70 text-[#00c087]'
                            : 'bg-rose-950/70 text-[#f6465d]'
                        }`}
                      >
                        {isPositive ? (
                          <TrendingUp className="w-2.5 h-2.5" />
                        ) : (
                          <TrendingDown className="w-2.5 h-2.5" />
                        )}
                        <span>
                          {isPositive ? '+' : ''}
                          {item.priceChangePercent.toFixed(2)}%
                        </span>
                      </span>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </>
      ) : mainTab === 'smart_divergence' ? (
        /* ================= SMART DIVERGENCE SCANNER TAB ================= */
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {/* Header & Controls */}
          <div className="p-3 bg-[#131823] border-b border-[#21262d] space-y-2.5 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="w-6 h-6 rounded-md bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                  <Target className="w-3.5 h-3.5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-xs flex items-center space-x-1.5">
                    <span>Smart Divergence Radar</span>
                    <span className="text-[9px] font-mono font-bold px-1 py-0.2 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                      RSI+MACD+CVD
                    </span>
                  </h3>
                  <p className="text-[10px] text-slate-400">
                    Memindai otomatis koin aktif dengan konfirmasi Sweep & Pinbar
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => loadSmartDivergences(true, scanTimeframe)}
                disabled={isDivergenceLoading}
                title="Scan ulang live koin"
                className="p-1 rounded text-slate-400 hover:text-white hover:bg-[#1e2533] transition-colors cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isDivergenceLoading ? 'animate-spin text-emerald-400' : ''}`} />
              </button>
            </div>

            {/* Timeframe Selector */}
            <div className="flex items-center justify-between bg-[#0d1117] p-1 rounded-md border border-[#21262d]">
              <span className="text-[10px] font-semibold text-slate-400 px-1.5 flex items-center space-x-1">
                <Clock className="w-3 h-3 text-emerald-400" />
                <span>TF:</span>
              </span>
              <div className="flex items-center space-x-1">
                {['5m', '15m', '1h', '4h'].map((tf) => (
                  <button
                    key={tf}
                    type="button"
                    onClick={() => {
                      setScanTimeframe(tf)
                      loadSmartDivergences(false, tf)
                    }}
                    className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors cursor-pointer ${
                      scanTimeframe === tf
                        ? 'bg-emerald-500/25 text-emerald-300 border border-emerald-500/40'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {tf.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            {/* Filter Pills (Direction & Grade) */}
            <div className="grid grid-cols-3 gap-1">
              <button
                type="button"
                onClick={() => setDivergenceDirectionFilter('ALL')}
                className={`py-1 rounded text-[10px] font-bold border transition-colors cursor-pointer ${
                  divergenceDirectionFilter === 'ALL'
                    ? 'bg-slate-800 text-white border-slate-600'
                    : 'bg-[#0d1117] text-slate-400 border-[#21262d] hover:text-slate-200'
                }`}
              >
                Semua Arah
              </button>
              <button
                type="button"
                onClick={() => setDivergenceDirectionFilter('BULLISH')}
                className={`py-1 rounded text-[10px] font-bold border transition-colors cursor-pointer ${
                  divergenceDirectionFilter === 'BULLISH'
                    ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/50'
                    : 'bg-[#0d1117] text-slate-400 border-[#21262d] hover:text-emerald-400'
                }`}
              >
                🟢 Bullish Div
              </button>
              <button
                type="button"
                onClick={() => setDivergenceDirectionFilter('BEARISH')}
                className={`py-1 rounded text-[10px] font-bold border transition-colors cursor-pointer ${
                  divergenceDirectionFilter === 'BEARISH'
                    ? 'bg-rose-950/80 text-rose-300 border-rose-500/50'
                    : 'bg-[#0d1117] text-slate-400 border-[#21262d] hover:text-rose-400'
                }`}
              >
                🔴 Bearish Div
              </button>
            </div>
          </div>

          {/* Results List */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y p-2.5 space-y-2 pb-24 custom-scrollbar">
            {isDivergenceLoading && divergenceSignals.length === 0 ? (
              <div className="p-8 text-center space-y-2">
                <RefreshCw className="w-5 h-5 text-emerald-400 animate-spin mx-auto" />
                <p className="text-slate-400 text-[11px]">
                  Memindai koin teratas Binance Futures untuk Smart Divergence...
                </p>
              </div>
            ) : divergenceError && divergenceSignals.length === 0 ? (
              <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-lg text-center space-y-2">
                <p className="text-rose-400 text-[11px]">{divergenceError}</p>
                <button
                  type="button"
                  onClick={() => loadSmartDivergences(true, scanTimeframe)}
                  className="px-3 py-1 rounded bg-[#1e2533] text-white text-[10px] font-semibold hover:bg-[#253042]"
                >
                  Coba Scan Ulang
                </button>
              </div>
            ) : displayedDivergences.length === 0 ? (
              <div className="p-8 text-center space-y-3 bg-[#111622]/60 rounded-xl border border-[#202738]">
                <Target className="w-6 h-6 text-slate-600 mx-auto" />
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-slate-300">
                    Tidak ada Smart Divergence aktif pada TF {scanTimeframe.toUpperCase()}
                  </div>
                  <p className="text-[11px] text-slate-500 max-w-xs mx-auto">
                    Smart Divergence hanya memunculkan setup A+ dengan validasi minimal 2 indikator (RSI+MACD+CVD) & Rejection Wick.
                  </p>
                </div>
                <div className="flex items-center justify-center gap-1.5 pt-1">
                  {['15m', '1h', '5m']
                    .filter((tf) => tf !== scanTimeframe)
                    .map((tf) => (
                      <button
                        key={tf}
                        type="button"
                        onClick={() => {
                          setScanTimeframe(tf)
                          loadSmartDivergences(false, tf)
                        }}
                        className="px-2.5 py-1 rounded text-[10px] font-bold bg-[#182130] text-emerald-300 border border-emerald-500/30 hover:bg-[#1f2b3e] cursor-pointer"
                      >
                        Cek TF {tf.toUpperCase()}
                      </button>
                    ))}
                </div>
              </div>
            ) : (
              displayedDivergences.map((item) => {
                const isSelected = item.symbol.toUpperCase() === currentSymbol.toUpperCase()
                const isBull = item.direction === 'BULLISH'

                return (
                  <div
                    key={`${item.symbol}_${item.confirm_time}`}
                    onClick={() => onSelectSymbol(item.symbol)}
                    className={`p-2.5 rounded-lg border transition-all cursor-pointer space-y-2 ${
                      isSelected
                        ? 'bg-[#182436] border-[#f0b90b] shadow-md shadow-amber-500/10'
                        : isBull
                        ? 'bg-[#0f171f] border-emerald-900/40 hover:border-emerald-600/60 hover:bg-[#131f2b]'
                        : 'bg-[#181119] border-rose-900/40 hover:border-rose-600/60 hover:bg-[#201522]'
                    }`}
                  >
                    {/* Header Row: Symbol & Badges */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-1.5">
                        <span className="font-mono font-bold text-xs text-white">
                          {item.baseAsset}/USDT
                        </span>
                        <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-slate-800 text-slate-400 border border-slate-700">
                          {item.timeframe.toUpperCase()}
                        </span>
                      </div>

                      <div className="flex items-center space-x-1">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border ${
                            isBull
                              ? 'bg-emerald-950/80 text-emerald-300 border-emerald-600/50'
                              : 'bg-rose-950/80 text-rose-300 border-rose-600/50'
                          }`}
                        >
                          {isBull ? 'BULLISH DIV' : 'BEARISH DIV'}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border ${
                            item.grade === 'A'
                              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                              : 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                          }`}
                        >
                          {item.grade === 'A' ? 'GRADE A+' : 'GRADE B'}
                        </span>
                      </div>
                    </div>

                    {/* Price & Oscillator Metrics Row */}
                    <div className="flex items-center justify-between text-[11px]">
                      <div className="font-mono font-semibold text-slate-200">
                        ${formatPrice(item.current_price)}
                        <span
                          className={`ml-1 text-[10px] ${
                            item.price_change_pct >= 0 ? 'text-[#00c087]' : 'text-[#f6465d]'
                          }`}
                        >
                          ({item.price_change_pct >= 0 ? '+' : ''}
                          {item.price_change_pct.toFixed(2)}%)
                        </span>
                      </div>

                      {/* Confirming metrics badges */}
                      <div className="flex items-center space-x-1">
                        {item.confirming_metrics.map((m) => (
                          <span
                            key={m}
                            className="px-1.5 py-0.2 rounded text-[9px] font-mono font-bold bg-[#1e2738] text-slate-300 border border-[#2d3a54]"
                          >
                            {m === 'RSI' ? `RSI ${item.rsi_value}` : m === 'CVD' ? 'CVD Absorp' : 'MACD Hist'}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Reasons & Confirmation Tags */}
                    {item.reasons && item.reasons.length > 0 && (
                      <div className="flex flex-wrap items-center gap-1">
                        {item.reasons.map((r) => (
                          <span
                            key={r}
                            className={`px-1.5 py-0.5 rounded text-[9px] font-semibold border ${
                              r.includes('Sweep')
                                ? 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                                : r.includes('Pinbar')
                                ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30'
                                : 'bg-[#182132] text-slate-300 border-[#26354f]'
                            }`}
                          >
                            {r}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Setup Execution Plan: Entry, SL, TP, R:R */}
                    <div className="grid grid-cols-3 gap-1 bg-[#0b0e14] p-1.5 rounded border border-[#1e2535] text-[10px] font-mono">
                      <div>
                        <span className="text-slate-500 block text-[9px]">ENTRY</span>
                        <span className="text-slate-200 font-semibold">${formatPrice(item.entry_price)}</span>
                      </div>
                      <div>
                        <span className="text-rose-400/80 block text-[9px]">STOP LOSS</span>
                        <span className="text-rose-400 font-semibold">${formatPrice(item.stop_loss_price)}</span>
                      </div>
                      <div>
                        <span className="text-emerald-400/80 block text-[9px]">TARGET TP</span>
                        <span className="text-emerald-400 font-semibold">${formatPrice(item.take_profit_price)}</span>
                      </div>
                    </div>

                    {/* Action Link Footer */}
                    <div className="flex items-center justify-between text-[10px] text-slate-500 pt-0.5">
                      <span>R:R 1:{item.rr_ratio}</span>
                      <span className="text-emerald-400 hover:text-emerald-300 flex items-center space-x-0.5 font-semibold">
                        <span>Buka Chart {item.baseAsset}</span>
                        <ArrowRight className="w-3 h-3" />
                      </span>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      ) : (
        /* ================= WHALE SQUEEZE HUNTER TAB ================= */
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {/* Header & Controls */}
          <div className="p-3 bg-[#131823] border-b border-[#21262d] space-y-2.5 shrink-0">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <div className="w-6 h-6 rounded-md bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <Flame className="w-3.5 h-3.5" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-xs flex items-center space-x-1.5">
                    <span>Whale Squeeze Hunter</span>
                    <span className="text-[9px] font-mono font-bold px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      FUNDING ANOMALI
                    </span>
                  </h3>
                  <p className="text-[10px] text-slate-400">
                    Deteksi perangkap likuidasi & potensi lonjakan Short/Long squeeze
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => loadSqueezeCandidates()}
                disabled={isSqueezeLoading}
                title="Scan ulang live koin"
                className="p-1 rounded text-slate-400 hover:text-white hover:bg-[#1e2533] transition-colors cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSqueezeLoading ? 'animate-spin text-amber-400' : ''}`} />
              </button>
            </div>

            {/* Quick Squeeze Education Banner */}
            <div className="p-2 rounded bg-amber-500/5 border border-amber-500/20 text-[10px] text-slate-300 leading-relaxed">
              <div className="flex items-center gap-1 font-semibold text-amber-400 mb-0.5">
                <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                <span>Kunci Pembacaan Squeeze:</span>
              </div>
              <div className="text-slate-400 space-y-0.5 pl-4 text-[9.5px]">
                <div>• <b className="text-emerald-400">Rate Negatif (&lt; -0.05%)</b>: Shorts bayar fee & terjebak → Potensi <b className="text-emerald-300">SHORT SQUEEZE (PUMP)</b>.</div>
                <div>• <b className="text-rose-400">Rate Positif (&gt; +0.08%)</b>: Longs overleveraged → Rawan <b className="text-rose-300">LONG SQUEEZE (DUMP)</b>.</div>
              </div>
            </div>

            {/* Filter Pills (Direction & Grade) */}
            <div className="grid grid-cols-3 gap-1">
              <button
                type="button"
                onClick={() => setSqueezeTypeFilter('ALL')}
                className={`py-1 rounded text-[10px] font-bold border transition-colors cursor-pointer truncate ${
                  squeezeTypeFilter === 'ALL'
                    ? 'bg-slate-800 text-white border-slate-600'
                    : 'bg-[#0d1117] text-slate-400 border-[#21262d] hover:text-slate-200'
                }`}
              >
                Semua Arah
              </button>
              <button
                type="button"
                onClick={() => setSqueezeTypeFilter('SHORT_SQUEEZE')}
                className={`py-1 rounded text-[10px] font-bold border transition-colors cursor-pointer truncate ${
                  squeezeTypeFilter === 'SHORT_SQUEEZE'
                    ? 'bg-emerald-950/80 text-emerald-300 border-emerald-500/50'
                    : 'bg-[#0d1117] text-slate-400 border-[#21262d] hover:text-emerald-400'
                }`}
              >
                🔥 Short Squeeze (Pump)
              </button>
              <button
                type="button"
                onClick={() => setSqueezeTypeFilter('LONG_SQUEEZE')}
                className={`py-1 rounded text-[10px] font-bold border transition-colors cursor-pointer truncate ${
                  squeezeTypeFilter === 'LONG_SQUEEZE'
                    ? 'bg-rose-950/80 text-rose-300 border-rose-500/50'
                    : 'bg-[#0d1117] text-slate-400 border-[#21262d] hover:text-rose-400'
                }`}
              >
                💧 Long Squeeze (Dump)
              </button>
            </div>

            {/* Grade / Intensity Selector */}
            <div className="flex items-center justify-between bg-[#0d1117] p-1 rounded-md border border-[#21262d]">
              <span className="text-[10px] font-semibold text-slate-400 px-1.5 flex items-center space-x-1">
                <Zap className="w-3 h-3 text-amber-400" />
                <span>Intensitas:</span>
              </span>
              <div className="flex items-center space-x-1">
                <button
                  type="button"
                  onClick={() => setSqueezeGradeFilter('ALL')}
                  className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors cursor-pointer ${
                    squeezeGradeFilter === 'ALL'
                      ? 'bg-amber-500/25 text-amber-300 border border-amber-500/40'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Semua ({squeezeCandidates.length})
                </button>
                <button
                  type="button"
                  onClick={() => setSqueezeGradeFilter('EXTREME')}
                  className={`px-2 py-0.5 rounded text-[10px] font-bold transition-colors cursor-pointer ${
                    squeezeGradeFilter === 'EXTREME'
                      ? 'bg-rose-500/25 text-rose-300 border border-rose-500/40'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  ⚡ Ekstrem Only ({extremeSqueezeCount})
                </button>
              </div>
            </div>
          </div>

          {/* Results List */}
          <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y p-2.5 space-y-2 pb-24 custom-scrollbar">
            {isSqueezeLoading && squeezeCandidates.length === 0 ? (
              <div className="p-8 text-center space-y-2">
                <RefreshCw className="w-5 h-5 text-amber-400 animate-spin mx-auto" />
                <p className="text-slate-400 text-[11px]">
                  Memindai anomali Funding Rate seluruh pair Binance Futures...
                </p>
              </div>
            ) : squeezeError && squeezeCandidates.length === 0 ? (
              <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-lg text-center space-y-2">
                <p className="text-rose-400 text-[11px]">{squeezeError}</p>
                <button
                  type="button"
                  onClick={() => loadSqueezeCandidates()}
                  className="px-3 py-1 rounded bg-[#1e2533] text-white text-[10px] font-semibold hover:bg-[#253042]"
                >
                  Coba Scan Ulang
                </button>
              </div>
            ) : displayedSqueezeCandidates.length === 0 ? (
              <div className="p-8 text-center space-y-3 bg-[#111622]/60 rounded-xl border border-[#202738]">
                <Flame className="w-6 h-6 text-slate-600 mx-auto" />
                <div className="space-y-1">
                  <div className="text-xs font-semibold text-slate-300">
                    Tidak ada kandidat Squeeze yang sesuai filter saat ini
                  </div>
                  <p className="text-[11px] text-slate-500 max-w-xs mx-auto">
                    Kandidat Squeeze muncul otomatis ketika Funding Rate pair futures menyimpang jauh dari normal (&ge; 0.03%).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSqueezeTypeFilter('ALL')
                    setSqueezeGradeFilter('ALL')
                  }}
                  className="px-3 py-1 rounded text-[10px] font-bold bg-[#182130] text-amber-300 border border-amber-500/30 hover:bg-[#1f2b3e] cursor-pointer"
                >
                  Tampilkan Semua Squeeze
                </button>
              </div>
            ) : (
              displayedSqueezeCandidates.map((cand) => {
                const isSelected = cand.symbol.toUpperCase() === currentSymbol.toUpperCase()
                const isShortSqueeze = cand.squeeze_type === 'SHORT_SQUEEZE'
                const isExtreme = cand.funding_rate_abs >= 0.1 || cand.grade.includes('EXTREME')

                return (
                  <div
                    key={cand.symbol}
                    onClick={() => onSelectSymbol(cand.symbol)}
                    className={`p-2.5 rounded-lg border transition-all cursor-pointer space-y-2 ${
                      isSelected
                        ? 'bg-[#182436] border-[#f0b90b] shadow-md shadow-amber-500/10'
                        : isShortSqueeze
                        ? isExtreme
                          ? 'bg-[#0f1f18] border-emerald-600/50 hover:border-emerald-500 hover:bg-[#132820]'
                          : 'bg-[#0f171f] border-emerald-900/40 hover:border-emerald-600/60 hover:bg-[#131f2b]'
                        : isExtreme
                        ? 'bg-[#221014] border-rose-600/50 hover:border-rose-500 hover:bg-[#2b1419]'
                        : 'bg-[#181119] border-rose-900/40 hover:border-rose-600/60 hover:bg-[#201522]'
                    }`}
                  >
                    {/* Header Row: Symbol, Direction, Grade */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-1.5">
                        <span className="font-mono font-bold text-xs text-white">
                          {cand.baseAsset}/USDT
                        </span>
                        <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-slate-800 text-slate-400 border border-slate-700">
                          FUTURES
                        </span>
                      </div>

                      <div className="flex items-center space-x-1">
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border ${
                            isShortSqueeze
                              ? 'bg-emerald-950/80 text-emerald-300 border-emerald-600/50'
                              : 'bg-rose-950/80 text-rose-300 border-rose-600/50'
                          }`}
                        >
                          {isShortSqueeze ? '🔥 SHORT SQUEEZE' : '💧 LONG SQUEEZE'}
                        </span>
                        <span
                          className={`px-1.5 py-0.5 rounded text-[9px] font-mono font-bold border ${
                            isExtreme
                              ? 'bg-amber-500/25 text-amber-300 border-amber-500/50 animate-pulse'
                              : 'bg-slate-800 text-slate-300 border-slate-700'
                          }`}
                        >
                          {cand.grade.split(' ')[0]} {cand.grade.split(' ')[1] || ''}
                        </span>
                      </div>
                    </div>

                    {/* Funding Rate Metrics Showcase */}
                    <div className="grid grid-cols-3 gap-1 bg-[#0b0e14] p-1.5 rounded border border-[#1e2535] text-[10px] font-mono items-center">
                      <div>
                        <span className="text-slate-500 block text-[9px]">FUNDING RATE</span>
                        <span
                          className={`text-xs font-bold ${
                            isShortSqueeze ? 'text-[#00c087]' : 'text-[#f6465d]'
                          }`}
                        >
                          {cand.funding_rate_pct > 0 ? '+' : ''}
                          {cand.funding_rate_pct.toFixed(4)}%
                        </span>
                      </div>

                      <div>
                        <span className="text-slate-500 block text-[9px]">APR SETAHUN</span>
                        <span
                          className={`font-semibold ${
                            Math.abs(cand.annualized_apr) >= 100
                              ? 'text-amber-400'
                              : 'text-slate-300'
                          }`}
                        >
                          {cand.annualized_apr > 0 ? '+' : ''}
                          {cand.annualized_apr.toLocaleString()}%
                        </span>
                      </div>

                      <div className="text-right">
                        <span className="text-slate-500 block text-[9px]">SETTLEMENT</span>
                        <span className="text-slate-300 font-semibold">{cand.time_left_str}</span>
                      </div>
                    </div>

                    {/* Price & Target Row */}
                    <div className="flex items-center justify-between text-[11px] pt-0.5">
                      <div className="font-mono text-slate-300">
                        <span className="text-slate-500 text-[9px] mr-1">MARK:</span>
                        ${formatPrice(cand.mark_price)}
                      </div>

                      <div className="font-mono text-right">
                        <span className="text-slate-500 text-[9px] mr-1">EST. TARGET:</span>
                        <span className={`font-bold ${isShortSqueeze ? 'text-emerald-400' : 'text-rose-400'}`}>
                          ${formatPrice(cand.est_liquidation_target)}
                        </span>
                      </div>
                    </div>

                    {/* Rationale Text */}
                    <div className="text-[10px] text-slate-400 leading-snug bg-[#0d1117]/60 p-1.5 rounded border border-[#1e2535]/50">
                      {cand.rationale}
                    </div>

                    {/* Action Link Footer */}
                    <div className="flex items-center justify-between text-[10px] text-slate-500 pt-0.5">
                      <span className="flex items-center gap-1 font-mono">
                        <span>Score:</span>
                        <span className="text-amber-400 font-bold">{cand.score}/100</span>
                      </span>
                      <span className="text-amber-400 hover:text-amber-300 flex items-center space-x-0.5 font-semibold">
                        <span>Buka Chart {cand.baseAsset}</span>
                        <ArrowRight className="w-3 h-3" />
                      </span>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
