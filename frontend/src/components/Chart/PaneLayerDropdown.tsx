import React, { useState, useRef, useEffect } from 'react'
import { LayerVisibility } from '../../types/analysis'
import {
  SlidersHorizontal,
  Sliders,
  ChevronDown,
  Target,
  Boxes,
  Layers,
  Split,
  GitCommit,
  Shapes,
  Clock,
  Compass,
  BarChart2,
  Percent,
  Activity,
  Minus,
  Flame,
  Gauge,
  Anchor,
  ShieldCheck,
  Zap,
  TrendingUp,
  Database,
  Radar,
  Crosshair
} from 'lucide-react'

interface PaneLayerDropdownProps {
  paneTitle: string
  chartId: string
  visibility: LayerVisibility
  onToggleLayer: (key: keyof LayerVisibility) => void
  onSetAllLayers?: (enabled: boolean) => void
  market?: 'spot' | 'futures'
  hasHtf?: boolean
  onOpenAutoFibSettings?: () => void
  onOpenVpvrSettings?: () => void
  onOpenOrderflowSettings?: (tab: 'liquidation' | 'cvd') => void
  onOpenMarketSessionSettings?: () => void
}

type LayerCategoryKey = 'institusional' | 'teknikal' | 'market'

interface LayerOption {
  key: keyof LayerVisibility
  category: LayerCategoryKey
  label: string
  desc: string
  icon: React.ReactNode
  color: string
}

export const PaneLayerDropdown: React.FC<PaneLayerDropdownProps> = ({
  paneTitle,
  chartId,
  visibility,
  onToggleLayer,
  onSetAllLayers,
  market = 'futures',
  hasHtf = true,
  onOpenAutoFibSettings,
  onOpenVpvrSettings,
  onOpenOrderflowSettings,
  onOpenMarketSessionSettings
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<'all' | LayerCategoryKey>('all')
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false)
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleKeyDown)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  const layerOptions: LayerOption[] = [
    // 1. KATEGORI 1: INDIKATOR INSTITUSIONAL (Smart Money, Order Flow & Market Structure)
    {
      key: 'whaleSentimentMatrix' as keyof LayerVisibility,
      category: 'institusional',
      label: 'Whale vs Retail Matrix HUD',
      desc: 'Tabel transparansi posisi Paus vs Retail & Taker Aggression',
      icon: <span className="text-xs">🐋</span>,
      color: 'text-cyan-400'
    },
    {
      key: 'sniperEntry' as keyof LayerVisibility,
      category: 'institusional',
      label: 'Sniper Entry Crosshair (3-in-1)',
      desc: 'Bidik entry SL tipis: Whale Wall + SL Pool + Spot CVD + OI Flush',
      icon: <Crosshair className="w-3.5 h-3.5" />,
      color: 'text-amber-300'
    },
    {
      key: 'marketXray' as keyof LayerVisibility,
      category: 'institusional',
      label: 'Market X-Ray (Stop Loss & Whale Radar)',
      desc: 'Radar jeroan orderbook: Squeeze Magnet, SL Cascade & Whale Walls',
      icon: <Radar className="w-3.5 h-3.5" />,
      color: 'text-rose-400'
    },
    {
      key: 'smartDivergence' as keyof LayerVisibility,
      category: 'institusional',
      label: 'Smart Divergence (RSI+MACD+CVD)',
      desc: 'Bull/Bear Divergence tervalidasi Sweep, Pinbar & OB/FVG',
      icon: <Target className="w-3.5 h-3.5" />,
      color: 'text-emerald-400'
    },
    {
      key: 'anchoredVwap' as keyof LayerVisibility,
      category: 'institusional',
      label: 'Anchored VWAP (AVWAP)',
      desc: 'Patokan harga wajar institusi ±1σ & ±2σ bands',
      icon: <Anchor className="w-3.5 h-3.5" />,
      color: 'text-amber-400'
    },
    {
      key: 'deltaAbsorption' as keyof LayerVisibility,
      category: 'institusional',
      label: 'Delta Absorption & Exhaustion',
      desc: 'Deteksi paus menyerap panic sell / FOMO buy ritel',
      icon: <ShieldCheck className="w-3.5 h-3.5" />,
      color: 'text-emerald-400'
    },
    {
      key: 'judasSwing' as keyof LayerVisibility,
      category: 'institusional',
      label: 'ICT Judas Swing (Trap Detector)',
      desc: 'Jebakan breakout palsu awal sesi London & NY',
      icon: <Zap className="w-3.5 h-3.5" />,
      color: 'text-yellow-400'
    },
    {
      key: 'orderBlocks',
      category: 'institusional',
      label: 'Order Blocks (OB)',
      desc: 'Area jejak akumulasi institusional',
      icon: <Boxes className="w-3.5 h-3.5" />,
      color: 'text-indigo-400'
    },
    {
      key: 'fvgs',
      category: 'institusional',
      label: 'Fair Value Gaps (FVG)',
      desc: 'Ketidakseimbangan likuiditas pasar',
      icon: <Layers className="w-3.5 h-3.5" />,
      color: 'text-cyan-400'
    },
    {
      key: 'smcEvents',
      category: 'institusional',
      label: 'BOS / CHoCH',
      desc: 'Break of Structure & Change of Character',
      icon: <Split className="w-3.5 h-3.5" />,
      color: 'text-amber-400'
    },
    {
      key: 'smcSwings',
      category: 'institusional',
      label: 'Swings (HH/LL Structure)',
      desc: 'Struktur titik puncak & lembah swing',
      icon: <GitCommit className="w-3.5 h-3.5" />,
      color: 'text-purple-400'
    },
    {
      key: 'liquidationHeatmap',
      category: 'institusional',
      label: 'Coinglass Liquidation Heatmap',
      desc: 'Matriks thermal likuidasi leverage 100x/50x/25x & Depth Bar',
      icon: <Flame className="w-3.5 h-3.5" />,
      color: 'text-amber-400'
    },
    {
      key: 'cvdOrderflow',
      category: 'institusional',
      label: 'CVD & Orderflow Divergence',
      desc: 'Kurva Cumulative Volume Delta & Bull/Bear Div',
      icon: <Activity className="w-3.5 h-3.5" />,
      color: 'text-emerald-400'
    },
    {
      key: 'marketSessions',
      category: 'institusional',
      label: 'Sesi Pasar & Killzones',
      desc: 'Asia, London, New York & Range H/L',
      icon: <Clock className="w-3.5 h-3.5" />,
      color: 'text-amber-400'
    },

    // 2. KATEGORI 2: INDIKATOR TEKNIKAL KLASIK (Trend, Patterns & Geometry)
    {
      key: 'trendRibbon' as keyof LayerVisibility,
      category: 'teknikal',
      label: 'Pita Tren (EMA Ribbon)',
      desc: 'Pita tren dinamis EMA 8, 21, 55, 200',
      icon: <TrendingUp className="w-3.5 h-3.5" />,
      color: 'text-amber-400'
    },
    {
      key: 'trendStrengthMeter' as keyof LayerVisibility,
      category: 'teknikal',
      label: 'Meter Kekuatan Tren (TSI)',
      desc: 'Badge ADX, Ribbon & Skor Tren 0-100%',
      icon: <Gauge className="w-3.5 h-3.5" />,
      color: 'text-emerald-400'
    },
    {
      key: 'fibonacci',
      category: 'teknikal',
      label: 'Auto Fib Retracement',
      desc: 'Auto Retracement OTE & Golden Ratio (Anti-Repaint)',
      icon: <SlidersHorizontal className="w-3.5 h-3.5" />,
      color: 'text-amber-400'
    },
    {
      key: 'patterns',
      category: 'teknikal',
      label: 'Pola Chart Klasik',
      desc: 'Double Top/Bottom, H&S, Triangles',
      icon: <Shapes className="w-3.5 h-3.5" />,
      color: 'text-emerald-400'
    },
    {
      key: 'srLevels',
      category: 'teknikal',
      label: 'S/R Levels Dinamis',
      desc: 'Support & Resistance horizontal otomatis',
      icon: <Minus className="w-3.5 h-3.5" />,
      color: 'text-teal-400'
    },
    {
      key: 'volumeProfile',
      category: 'teknikal',
      label: 'Volume Profile (VPVR)',
      desc: 'POC, VAH, VAL & Distribusi Volume 70% VA',
      icon: <BarChart2 className="w-3.5 h-3.5 rotate-90" />,
      color: 'text-cyan-400'
    },

    // 3. KATEGORI 3: DATA PASAR & DERIVATIF (Overlays, Panes & Predictions)
    {
      key: 'countdownBar' as keyof LayerVisibility,
      category: 'market',
      label: 'Hitung Mundur Bar (Countdown)',
      desc: 'Countdown waktu penutupan candle pada garis harga (ala TradingView)',
      icon: <Clock className="w-3.5 h-3.5" />,
      color: 'text-amber-300'
    },
    {
      key: 'entryBoxes',
      category: 'market',
      label: 'Box Area Entry & R:R',
      desc: 'Kotak Entry, Target TP, dan Stop Loss',
      icon: <Target className="w-3.5 h-3.5" />,
      color: 'text-emerald-400'
    },
    {
      key: 'forecastCone',
      category: 'market',
      label: 'Forecast Cone Volatilitas',
      desc: 'Kerucut deviasi volatilitas pasar (ATR)',
      icon: <Compass className="w-3.5 h-3.5" />,
      color: 'text-yellow-400'
    },
    {
      key: 'forecastScenarios',
      category: 'market',
      label: 'Target Skenario Proyeksi',
      desc: 'Garis proyeksi lintasan harga ke depan',
      icon: <Compass className="w-3.5 h-3.5" />,
      color: 'text-orange-400'
    },
    {
      key: 'volume',
      category: 'market',
      label: 'Volume Delta Bar',
      desc: 'Tekanan Taker Buy vs Sell bar di bawah',
      icon: <BarChart2 className="w-3.5 h-3.5" />,
      color: 'text-blue-400'
    },
    ...(hasHtf
      ? [
          {
            key: 'htfOverlay' as keyof LayerVisibility,
            category: 'market' as LayerCategoryKey,
            label: 'MTF Overlay (HTF)',
            desc: 'Konfirmasi tren Higher Timeframe',
            icon: <Clock className="w-3.5 h-3.5" />,
            color: 'text-amber-400'
          }
        ]
      : []),
    ...(market === 'futures'
      ? [
          {
            key: 'openInterest' as keyof LayerVisibility,
            category: 'market' as LayerCategoryKey,
            label: 'Open Interest (OI)',
            desc: 'Total kontrak aktif pasar Futures',
            icon: <Database className="w-3.5 h-3.5" />,
            color: 'text-sky-400'
          },
          {
            key: 'fundingRate' as keyof LayerVisibility,
            category: 'market' as LayerCategoryKey,
            label: 'Funding Rate',
            desc: 'Tarif pendanaan posisi Long vs Short',
            icon: <Percent className="w-3.5 h-3.5" />,
            color: 'text-purple-400'
          }
        ]
      : [])
  ]

  const activeCount = layerOptions.filter((opt) => visibility[opt.key]).length
  const instCount = layerOptions.filter((opt) => opt.category === 'institusional' && visibility[opt.key]).length
  const tekCount = layerOptions.filter((opt) => opt.category === 'teknikal' && visibility[opt.key]).length
  const mktCount = layerOptions.filter((opt) => opt.category === 'market' && visibility[opt.key]).length

  const filteredOptions = selectedCategory === 'all'
    ? layerOptions
    : layerOptions.filter((opt) => opt.category === selectedCategory)

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          setIsOpen((prev) => !prev)
        }}
        className={`flex items-center space-x-1 px-1 sm:px-1.5 py-0.5 rounded border text-[9.5px] sm:text-[10px] font-bold transition-all cursor-pointer shrink-0 ${
          isOpen
            ? 'bg-[#252d3d] text-[#f0b90b] border-[#f0b90b]/50 shadow-sm'
            : 'bg-[#0b0e14] hover:bg-[#1a2230] text-slate-300 hover:text-white border-[#21262d]'
        }`}
        title={`Atur Indikator & Lapisan khusus untuk ${paneTitle}`}
      >
        <SlidersHorizontal className="w-3 h-3 text-[#f0b90b] shrink-0" />
        <span className="hidden 2xl:inline">Layers</span>
        <span className="px-1 py-0.2 rounded bg-[#161b22] text-[#f0b90b] text-[8.5px] sm:text-[9px] font-mono shrink-0">
          {activeCount}
        </span>
        <ChevronDown
          className={`w-2.5 h-2.5 text-slate-400 transition-transform duration-150 shrink-0 ${
            isOpen ? 'rotate-180 text-[#f0b90b]' : ''
          }`}
        />
      </button>

      {isOpen && (
        <>
          {/* Backdrop on mobile for easy dismissal */}
          <div
            className="sm:hidden fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
            onClick={(e) => {
              e.stopPropagation()
              setIsOpen(false)
            }}
          />
          <div
            onClick={(e) => e.stopPropagation()}
            className="fixed sm:absolute inset-x-3 sm:inset-x-auto sm:left-0 top-16 sm:top-full sm:mt-1.5 sm:w-80 max-h-[82vh] overflow-y-auto bg-[#0d1117] border border-[#30363d] rounded-xl shadow-2xl z-50 font-sans text-xs animate-in fade-in zoom-in-95 duration-100 flex flex-col"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-[#21262d] bg-[#161b22] shrink-0">
              <div className="flex items-center space-x-1.5">
                <span className="w-2 h-2 rounded-full bg-[#f0b90b] animate-pulse" />
                <span className="font-extrabold text-[11px] text-[#f0b90b] tracking-wide font-mono">
                  {paneTitle} INDIKATOR
                </span>
              </div>
              {onSetAllLayers && (
                <div className="flex items-center space-x-1 text-[10px]">
                  <button
                    type="button"
                    onClick={() => onSetAllLayers(true)}
                    className="px-1.5 py-0.5 rounded bg-emerald-950/60 text-emerald-300 hover:bg-emerald-900/60 border border-emerald-800/50 cursor-pointer font-bold transition-colors"
                  >
                    Semua
                  </button>
                  <button
                    type="button"
                    onClick={() => onSetAllLayers(false)}
                    className="px-1.5 py-0.5 rounded bg-rose-950/60 text-rose-300 hover:bg-rose-900/60 border border-rose-800/50 cursor-pointer font-bold transition-colors"
                  >
                    Reset
                  </button>
                </div>
              )}
            </div>

            {/* Category Filter Tabs */}
            <div className="grid grid-cols-4 gap-1 p-1.5 bg-[#0e131b] border-b border-[#21262d] shrink-0 text-[10px] font-bold">
              <button
                type="button"
                onClick={() => setSelectedCategory('all')}
                className={`py-1 px-1 rounded text-center transition-all cursor-pointer ${
                  selectedCategory === 'all'
                    ? 'bg-[#21283b] text-[#f0b90b] border border-[#f0b90b]/40 shadow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-[#161c28]'
                }`}
              >
                Semua ({activeCount})
              </button>
              <button
                type="button"
                onClick={() => setSelectedCategory('institusional')}
                className={`py-1 px-1 rounded text-center transition-all cursor-pointer ${
                  selectedCategory === 'institusional'
                    ? 'bg-amber-950/50 text-amber-300 border border-amber-500/50 shadow-sm'
                    : 'text-slate-400 hover:text-amber-200 hover:bg-[#161c28]'
                }`}
                title="Indikator Institusional & Smart Money"
              >
                🏛️ Institusi ({instCount})
              </button>
              <button
                type="button"
                onClick={() => setSelectedCategory('teknikal')}
                className={`py-1 px-1 rounded text-center transition-all cursor-pointer ${
                  selectedCategory === 'teknikal'
                    ? 'bg-emerald-950/50 text-emerald-300 border border-emerald-500/50 shadow-sm'
                    : 'text-slate-400 hover:text-emerald-200 hover:bg-[#161c28]'
                }`}
                title="Indikator Teknikal Klasik"
              >
                📈 Teknikal ({tekCount})
              </button>
              <button
                type="button"
                onClick={() => setSelectedCategory('market')}
                className={`py-1 px-1 rounded text-center transition-all cursor-pointer ${
                  selectedCategory === 'market'
                    ? 'bg-sky-950/50 text-sky-300 border border-sky-500/50 shadow-sm'
                    : 'text-slate-400 hover:text-sky-200 hover:bg-[#161c28]'
                }`}
                title="Data Pasar & Derivatif"
              >
                📊 Pasar ({mktCount})
              </button>
            </div>

            {/* List of layers */}
            <div className="max-h-80 overflow-y-auto divide-y divide-[#1e2430]/60 p-1.5 custom-scrollbar">
              {filteredOptions.map((opt) => {
                const isEnabled = Boolean(visibility[opt.key])
                return (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => onToggleLayer(opt.key)}
                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded transition-colors text-left cursor-pointer ${
                      isEnabled
                        ? 'bg-[#161f2e]/70 hover:bg-[#1a2538]'
                        : 'hover:bg-[#161b22] text-slate-500'
                    }`}
                  >
                    <div className="flex items-center space-x-2 min-w-0 pr-2">
                      <span className={`${isEnabled ? opt.color : 'text-slate-600'} shrink-0`}>
                        {opt.icon}
                      </span>
                      <div className="flex flex-col min-w-0">
                        <div className="flex items-center space-x-1.5">
                          <span
                            className={`text-[11px] font-bold leading-tight truncate ${
                              isEnabled ? 'text-slate-100' : 'text-slate-500 line-through opacity-75'
                            }`}
                          >
                            {opt.label}
                          </span>
                          {/* Mini Category Badge */}
                          <span
                            className={`text-[8px] font-mono px-1 py-0.2 rounded uppercase ${
                              opt.category === 'institusional'
                                ? 'bg-amber-950/60 text-amber-300 border border-amber-800/40'
                                : opt.category === 'teknikal'
                                ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800/40'
                                : 'bg-sky-950/60 text-sky-300 border border-sky-800/40'
                            }`}
                          >
                            {opt.category === 'institusional' ? 'INSTITUSI' : opt.category === 'teknikal' ? 'TEKNIKAL' : 'PASAR'}
                          </span>
                        </div>
                        <span className="text-[9.5px] text-slate-500 truncate leading-tight">
                          {opt.desc}
                        </span>
                      </div>
                    </div>

                    {/* Toggle Switch Pill & Optional Settings */}
                    <div className="flex items-center space-x-1.5 shrink-0">
                      {opt.key === 'fibonacci' && onOpenAutoFibSettings && (
                        <span
                          onClick={(e) => {
                            e.stopPropagation()
                            onOpenAutoFibSettings()
                          }}
                          className="p-1 rounded bg-[#202738] hover:bg-[#2b354b] text-amber-400 hover:text-amber-300 border border-amber-500/30 transition-all cursor-pointer"
                          title="Pengaturan Auto Fibonacci"
                        >
                          <Sliders className="w-3 h-3" />
                        </span>
                      )}
                      {opt.key === 'volumeProfile' && onOpenVpvrSettings && (
                        <span
                          onClick={(e) => {
                            e.stopPropagation()
                            onOpenVpvrSettings()
                          }}
                          className="p-1 rounded bg-[#202738] hover:bg-[#2b354b] text-cyan-400 hover:text-cyan-300 border border-cyan-500/30 transition-all cursor-pointer"
                          title="Pengaturan Volume Profile (VPVR)"
                        >
                          <Sliders className="w-3 h-3" />
                        </span>
                      )}
                      {opt.key === 'liquidationHeatmap' && onOpenOrderflowSettings && (
                        <span
                          onClick={(e) => {
                            e.stopPropagation()
                            onOpenOrderflowSettings('liquidation')
                          }}
                          className="p-1 rounded bg-[#202738] hover:bg-[#2b354b] text-amber-400 hover:text-amber-300 border border-amber-500/30 transition-all cursor-pointer"
                          title="Pengaturan Liquidation Heatmap"
                        >
                          <Sliders className="w-3 h-3" />
                        </span>
                      )}
                      {opt.key === 'cvdOrderflow' && onOpenOrderflowSettings && (
                        <span
                          onClick={(e) => {
                            e.stopPropagation()
                            onOpenOrderflowSettings('cvd')
                          }}
                          className="p-1 rounded bg-[#202738] hover:bg-[#2b354b] text-emerald-400 hover:text-emerald-300 border border-emerald-500/30 transition-all cursor-pointer"
                          title="Pengaturan CVD & Orderflow Divergence"
                        >
                          <Sliders className="w-3 h-3" />
                        </span>
                      )}
                      {opt.key === 'marketSessions' && onOpenMarketSessionSettings && (
                        <span
                          onClick={(e) => {
                            e.stopPropagation()
                            onOpenMarketSessionSettings()
                          }}
                          className="p-1 rounded bg-[#202738] hover:bg-[#2b354b] text-amber-400 hover:text-amber-300 border border-amber-500/30 transition-all cursor-pointer"
                          title="Pengaturan Sesi Pasar (Garis Vertikal Tipis)"
                        >
                          <Sliders className="w-3 h-3" />
                        </span>
                      )}
                      <div
                        className={`w-7 h-4 flex items-center rounded-full p-0.5 transition-colors shrink-0 ${
                          isEnabled ? 'bg-emerald-500 justify-end' : 'bg-slate-700 justify-start'
                        }`}
                      >
                        <div className="w-3 h-3 rounded-full bg-white shadow-sm" />
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>

            {/* Footer note */}
            <div className="px-3 py-1.5 bg-[#0b0e14] border-t border-[#21262d] text-[9.5px] text-slate-500 font-mono flex items-center justify-between shrink-0">
              <span>{paneTitle}</span>
              <span className="text-[#f0b90b] font-bold">{activeCount} Terpasang</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
