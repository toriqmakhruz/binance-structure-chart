import React, { useState, useEffect, useCallback, useMemo } from 'react'
import { fetchSymbols } from '../../services/api'
import { formatPrice } from '../../utils/formatters'
import {
  Search,
  Star,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Coins,
  X
} from 'lucide-react'

export interface SymbolTickerItem {
  symbol: string
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

const FAV_STORAGE_KEY = 'cp_watchlist_favorites'

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

export const CoinWatchlist: React.FC<CoinWatchlistProps> = ({
  market,
  currentSymbol,
  currentPrice,
  onSelectSymbol
}) => {
  const [symbols, setSymbols] = useState<SymbolTickerItem[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState<string>('')
  const [filter, setFilter] = useState<WatchlistFilter>('ALL')
  const [favorites, setFavorites] = useState<string[]>(() => readFavorites())

  const loadSymbols = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true)
    setErrorMsg(null)
    try {
      const data = await fetchSymbols(market)
      setSymbols(Array.isArray(data) ? data : [])
    } catch (err: any) {
      setErrorMsg(err?.message || 'Gagal memuat daftar koin')
    } finally {
      if (!silent) setIsLoading(false)
    }
  }, [market])

  // Fetch on mount / market change & refresh silently every 30s
  useEffect(() => {
    loadSymbols(false)
    const timer = setInterval(() => loadSymbols(true), 30000)
    return () => clearInterval(timer)
  }, [loadSymbols])

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
      list = [...list]
        .filter((item) => item.priceChangePercent > 0)
        .sort((a, b) => b.priceChangePercent - a.priceChangePercent)
    } else if (filter === 'LOSERS') {
      list = [...list]
        .filter((item) => item.priceChangePercent < 0)
        .sort((a, b) => a.priceChangePercent - b.priceChangePercent)
    }

    const q = searchTerm.trim().toLowerCase()
    if (q) {
      list = list.filter((item) => item.symbol.toLowerCase().includes(q))
    }

    return list
  }, [symbols, filter, favorites, searchTerm])

  return (
    <div className="w-full flex-1 flex flex-col overflow-hidden select-none text-xs">
      {/* 1. Header & Search */}
      <div className="p-3 bg-[#131823] border-b border-[#21262d] space-y-2 shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-1.5 text-slate-300 font-bold uppercase tracking-wider text-[11px]">
            <Coins className="w-3.5 h-3.5 text-[#f0b90b]" />
            <span>Watchlist ({market.toUpperCase()})</span>
          </div>
          <button
            type="button"
            onClick={() => loadSymbols(false)}
            disabled={isLoading}
            title="Refresh harga pasar"
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
              onClick={() => setFilter(tab.key as WatchlistFilter)}
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

      {/* 2. Column Headers (TradingView Watchlist Style) */}
      <div className="grid grid-cols-12 px-3 py-1.5 bg-[#0d1117] border-b border-[#21262d] text-[10px] font-bold uppercase tracking-wider text-slate-500 shrink-0">
        <div className="col-span-5">Simbol</div>
        <div className="col-span-4 text-right">Harga</div>
        <div className="col-span-3 text-right">24j %</div>
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
            const baseName = item.symbol.replace(/USDT$|BUSD$|USDC$/i, '')
            const quoteName = item.symbol.slice(baseName.length) || 'USDT'

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
                      Vol ${(item.quoteVolume / 1_000_000).toFixed(0)}M
                    </div>
                  </div>
                </div>

                {/* Last Price */}
                <div className="col-span-4 text-right font-mono text-[11px] font-semibold text-slate-100 truncate">
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
