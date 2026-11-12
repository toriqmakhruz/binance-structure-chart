import React, { useState, useEffect } from 'react'
import { Search, X, Flame, ArrowUpRight, ArrowDownRight } from 'lucide-react'
import { fetchSymbols } from '../../services/api'

interface SymbolSelectorProps {
  isOpen: boolean
  market: 'spot' | 'futures'
  currentSymbol: string
  onClose: () => void
  onSelectSymbol: (symbol: string) => void
}

export const SymbolSelector: React.FC<SymbolSelectorProps> = ({
  isOpen,
  market,
  currentSymbol,
  onClose,
  onSelectSymbol
}) => {
  const [searchTerm, setSearchTerm] = useState('')
  const [symbols, setSymbols] = useState<any[]>([])
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setIsLoading(true)
    fetchSymbols(market)
      .then((data) => {
        setSymbols(data)
        setIsLoading(false)
      })
      .catch((err) => {
        console.error('Failed to load symbols:', err)
        setIsLoading(false)
      })
  }, [isOpen, market])

  if (!isOpen) return null

  const filtered = symbols.filter((s) =>
    s.symbol.toLowerCase().includes(searchTerm.toLowerCase().trim())
  )

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#161b22] border border-[#30363d] rounded-xl w-full max-w-xl max-h-[80vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in duration-150">
        {/* Header */}
        <div className="p-4 border-b border-[#21262d] flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Flame className="w-5 h-5 text-[#f0b90b]" />
            <h3 className="font-bold text-white text-base">
              Pilih Pasangan Crypto ({market.toUpperCase()})
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-[#21262d]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search input */}
        <div className="p-3 bg-[#0d1117] border-b border-[#21262d] flex items-center space-x-3">
          <Search className="w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Cari koin (contoh: BTC, ETH, SOL, PEPE, SUI)..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            autoFocus
            className="bg-transparent text-white w-full text-sm outline-none placeholder:text-slate-500 font-mono"
          />
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto divide-y divide-[#21262d]">
          {isLoading ? (
            <div className="p-8 text-center text-slate-400 text-sm">
              Memuat data pasar Binance...
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-sm">
              Tidak ada pasangan ditemukan untuk "{searchTerm}"
            </div>
          ) : (
            filtered.map((item) => {
              const isSelected = item.symbol === currentSymbol
              const isPositive = item.priceChangePercent >= 0
              return (
                <div
                  key={item.symbol}
                  onClick={() => {
                    onSelectSymbol(item.symbol)
                    onClose()
                  }}
                  className={`flex items-center justify-between p-3.5 hover:bg-[#1f242c] cursor-pointer transition-colors ${
                    isSelected ? 'bg-[#252d3d]/50 border-l-4 border-[#f0b90b]' : ''
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <div>
                      <div className="font-bold text-sm text-white font-mono flex items-center">
                        {item.symbol}
                        {isSelected && (
                          <span className="ml-2 text-[10px] bg-[#f0b90b]/20 text-[#f0b90b] px-1.5 py-0.5 rounded font-sans font-bold">
                            AKTIF
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400 mt-0.5">
                        Vol 24h: ${(item.quoteVolume / 1_000_000).toFixed(1)}M
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <div className="font-mono text-sm font-semibold text-white">
                      ${item.lastPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}
                    </div>
                    <div
                      className={`text-xs font-mono font-medium flex items-center justify-end ${
                        isPositive ? 'text-[#00c087]' : 'text-[#f6465d]'
                      }`}
                    >
                      {isPositive ? (
                        <ArrowUpRight className="w-3.5 h-3.5 mr-0.5" />
                      ) : (
                        <ArrowDownRight className="w-3.5 h-3.5 mr-0.5" />
                      )}
                      {isPositive ? '+' : ''}{item.priceChangePercent.toFixed(2)}%
                    </div>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
