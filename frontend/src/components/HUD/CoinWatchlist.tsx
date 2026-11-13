import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { fetchSymbols } from '../../services/api'
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
  ArrowUp
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
  currentPrice?: number
  onSelectSymbol: (symbol: string) => void
}

type WatchlistFilter = 'ALL' | 'FAV' | 'GAINERS' | 'LOSERS'
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
  currentPrice,
  onSelectSymbol
}) => {
  const [symbols, setSymbols] = useState<SymbolTickerItem[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [isWsConnected, setIsWsConnected] = useState<boolean>(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [filter, setFilter] = useState<WatchlistFilter>('ALL')
  const [sortField, setSortField] = useState<SortField>('volume')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [favorites, setFavorites] = useState<string[]>(() => readFavorites())

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

  // Fetch initial sorted list from backend & periodic resync every 60s
  useEffect(() => {
    prevPricesRef.current = {}
    flashDirRef.current = {}
    loadSymbols(false)
    const timer = setInterval(() => loadSymbols(true), 60000)
    return () => clearInterval(timer)
  }, [loadSymbols])

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
    let list = symbols

    if (filter === 'FAV') {
      list = list.filter((item) => favorites.includes(item.symbol))
    } else if (filter === 'GAINERS') {
      list = list.filter((item) => item.priceChangePercent > 0)
    } else if (filter === 'LOSERS') {
      list = list.filter((item) => item.priceChangePercent < 0)
    }

    const q = searchTerm.trim().toLowerCase()
    if (q) {
      list = list.filter((item) => item.symbol.toLowerCase().includes(q))
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

  const nowTs = Date.now()

  return (
    <div className="w-full flex-1 flex flex-col overflow-hidden select-none text-xs">
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
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-[#1e2533] transition-colors"
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

        {/* Filter Pills */}
        <div className="grid grid-cols-4 gap-1">
          {[
            { key: 'ALL', label: 'Semua' },
            { key: 'FAV', label: 'Favorit' },
            { key: 'GAINERS', label: 'Naik' },
            { key: 'LOSERS', label: 'Turun' }
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => handleFilterChange(tab.key as WatchlistFilter)}
              className={`py-1 rounded text-[10px] font-bold border transition-colors ${
                filter === tab.key
                  ? 'bg-[#f0b90b]/15 text-[#f0b90b] border-[#f0b90b]/50'
                  : 'bg-[#0d1117] text-slate-400 border-[#21262d] hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* 2. Interactive Sortable Column Headers (Binance Watchlist Style) */}
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
      <div className="flex-1 overflow-y-auto divide-y divide-[#1a202c]">
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
    </div>
  )
}
