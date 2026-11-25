import React, { useState, useRef, useEffect } from 'react'
import { LayerVisibility, OpenInterestData } from '../../types/analysis'
import {
  SlidersHorizontal,
  ChevronDown,
  Eye,
  EyeOff,
  Boxes,
  Layers,
  Split,
  GitCommit,
  Shapes,
  Clock,
  Compass,
  Target,
  BarChart2,
  Percent,
  Activity,
  Minus,
  Sliders,
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

interface LayerTogglesProps {
  visibility: LayerVisibility
  onToggle: (key: keyof LayerVisibility) => void
  hasHtf?: boolean
  market?: 'spot' | 'futures'
  openInterest?: OpenInterestData | null
  onSetAll?: (enabled: boolean) => void
  activePaneTitle?: string
  onOpenAutoFibSettings?: () => void
  onOpenVpvrSettings?: () => void
  onOpenOrderflowSettings?: (tab: 'liquidation' | 'cvd') => void
  onOpenMarketSessionSettings?: () => void
}

type LayerCategoryKey = 'institusional' | 'teknikal' | 'market'

interface LayerItem {
  key: keyof LayerVisibility
  label: string
  desc: string
  icon: React.ReactNode
  color: string
  bgHover: string
}

interface LayerCategory {
  id: LayerCategoryKey
  category: string
  badgeText: string
  badgeClass: string
  items: LayerItem[]
}

export const LayerToggles: React.FC<LayerTogglesProps> = ({
  visibility,
  onToggle,
  hasHtf,
  market = 'futures',
  openInterest,
  onSetAll,
  activePaneTitle,
  onOpenAutoFibSettings,
  onOpenVpvrSettings,
  onOpenOrderflowSettings,
  onOpenMarketSessionSettings
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<'all' | LayerCategoryKey>('all')
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Close dropdown on click outside or Escape
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsOpen(false)
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

  // Clear 3-way Institutional separation
  const categories: LayerCategory[] = [
    {
      id: 'institusional',
      category: '🏛️ Indikator Institusional (Smart Money & Order Flow)',
      badgeText: 'INSTITUSI',
      badgeClass: 'bg-amber-950/60 text-amber-300 border-amber-800/50',
      items: [
        { key: 'whaleSentimentMatrix', label: 'Whale vs Retail Matrix HUD', desc: 'Tabel transparansi posisi Paus vs Retail & Taker Aggression', icon: <span className="text-xs">🐋</span>, color: 'text-cyan-400', bgHover: 'hover:bg-cyan-950/30' },
        { key: 'candleDeltaStrip', label: 'Candle Net-Delta Strip (Jeroan)', desc: 'Net Delta ($) Buy vs Sell & Hidden Absorption per candle', icon: <BarChart2 className="w-3.5 h-3.5" />, color: 'text-emerald-400', bgHover: 'hover:bg-emerald-950/30' },
        { key: 'sniperEntry', label: 'Sniper Entry Crosshair (3-in-1)', desc: 'Bidik entry SL tipis: Whale Wall + SL Pool + Spot CVD + OI Flush', icon: <Crosshair className="w-3.5 h-3.5" />, color: 'text-amber-300', bgHover: 'hover:bg-amber-950/30' },
        { key: 'marketXray', label: 'Market X-Ray (Stop Loss & Whale Radar)', desc: 'Radar jeroan orderbook: Squeeze Magnet, SL Cascade & Whale Walls', icon: <Radar className="w-3.5 h-3.5" />, color: 'text-rose-400', bgHover: 'hover:bg-rose-950/30' },
        { key: 'smartDivergence', label: 'Smart Divergence (RSI+MACD+CVD)', desc: 'Bull/Bear Divergence tervalidasi Sweep, Pinbar & OB/FVG', icon: <Target className="w-3.5 h-3.5" />, color: 'text-emerald-400', bgHover: 'hover:bg-emerald-950/30' },
        { key: 'anchoredVwap', label: 'Anchored VWAP (AVWAP)', desc: 'Patokan harga wajar institusi ±1σ & ±2σ bands', icon: <Anchor className="w-3.5 h-3.5" />, color: 'text-amber-400', bgHover: 'hover:bg-amber-950/30' },
        { key: 'deltaAbsorption', label: 'Delta Absorption & Exhaustion', desc: 'Deteksi paus menyerap panic sell / FOMO buy', icon: <ShieldCheck className="w-3.5 h-3.5" />, color: 'text-emerald-400', bgHover: 'hover:bg-emerald-950/30' },
        { key: 'judasSwing', label: 'ICT Judas Swing (Trap Detector)', desc: 'Jebakan breakout palsu awal sesi London & NY', icon: <Zap className="w-3.5 h-3.5" />, color: 'text-yellow-400', bgHover: 'hover:bg-yellow-950/30' },
        { key: 'orderBlocks', label: 'Order Blocks (OB)', desc: 'Area jejak akumulasi institusional', icon: <Boxes className="w-3.5 h-3.5" />, color: 'text-indigo-400', bgHover: 'hover:bg-indigo-950/30' },
        { key: 'fvgs', label: 'Fair Value Gaps (FVG)', desc: 'Ketidakseimbangan likuiditas pasar', icon: <Layers className="w-3.5 h-3.5" />, color: 'text-cyan-400', bgHover: 'hover:bg-cyan-950/30' },
        { key: 'smcEvents', label: 'BOS / CHoCH', desc: 'Break of Structure & Change of Character', icon: <Split className="w-3.5 h-3.5" />, color: 'text-amber-400', bgHover: 'hover:bg-amber-950/30' },
        { key: 'smcSwings', label: 'Swings (HH/LL Structure)', desc: 'Struktur titik puncak & lembah swing', icon: <GitCommit className="w-3.5 h-3.5" />, color: 'text-purple-400', bgHover: 'hover:bg-purple-950/30' },
        { key: 'liquidationHeatmap', label: 'Coinglass Liquidation Heatmap', desc: 'Matriks thermal likuidasi leverage 100x/50x/25x & Depth Bar', icon: <Flame className="w-3.5 h-3.5" />, color: 'text-amber-400', bgHover: 'hover:bg-amber-950/30' },
        { key: 'cvdOrderflow', label: 'CVD & Orderflow Divergence', desc: 'Kurva Cumulative Volume Delta & Bull/Bear Div', icon: <Activity className="w-3.5 h-3.5" />, color: 'text-emerald-400', bgHover: 'hover:bg-emerald-950/30' },
        { key: 'marketSessions', label: 'Sesi Pasar & Killzones', desc: 'Asia, London, New York & Range H/L', icon: <Clock className="w-3.5 h-3.5" />, color: 'text-amber-400', bgHover: 'hover:bg-amber-950/30' }
      ]
    },
    {
      id: 'teknikal',
      category: '📈 Indikator Teknikal Biasa (Klasik & Geometri)',
      badgeText: 'TEKNIKAL',
      badgeClass: 'bg-emerald-950/60 text-emerald-300 border-emerald-800/50',
      items: [
        { key: 'trendRibbon', label: 'Pita Tren (EMA Ribbon)', desc: 'Pita tren dinamis EMA 8, 21, 55, 200', icon: <TrendingUp className="w-3.5 h-3.5" />, color: 'text-amber-400', bgHover: 'hover:bg-amber-950/30' },
        { key: 'trendStrengthMeter', label: 'Meter Kekuatan Tren (TSI)', desc: 'Badge ADX, Ribbon & Skor Tren 0-100%', icon: <Gauge className="w-3.5 h-3.5" />, color: 'text-emerald-400', bgHover: 'hover:bg-emerald-950/30' },
        { key: 'fibonacci', label: 'Auto Fib Retracement', desc: 'Auto OTE & Golden Pocket (Anti-Repaint)', icon: <SlidersHorizontal className="w-3.5 h-3.5" />, color: 'text-amber-400', bgHover: 'hover:bg-amber-950/30' },
        { key: 'patterns', label: 'Pola Chart Klasik', desc: 'Double Top/Bottom, H&S, Triangles', icon: <Shapes className="w-3.5 h-3.5" />, color: 'text-emerald-400', bgHover: 'hover:bg-emerald-950/30' },
        { key: 'srLevels', label: 'S/R Levels Dinamis', desc: 'Support & Resistance dinamis', icon: <Minus className="w-3.5 h-3.5" />, color: 'text-teal-400', bgHover: 'hover:bg-teal-950/30' },
        { key: 'volumeProfile', label: 'Volume Profile (VPVR)', desc: 'POC, VAH, VAL & Distribusi Volume Horizontal (70% VA)', icon: <BarChart2 className="w-3.5 h-3.5 rotate-90" />, color: 'text-cyan-400', bgHover: 'hover:bg-cyan-950/30' }
      ]
    },
    {
      id: 'market',
      category: '📊 Data Pasar & Derivatif (Overlays & Panes)',
      badgeText: 'PASAR',
      badgeClass: 'bg-sky-950/60 text-sky-300 border-sky-800/50',
      items: [
        { key: 'countdownBar', label: 'Hitung Mundur Bar (Countdown)', desc: 'Countdown waktu penutupan candle pada garis harga (ala TradingView)', icon: <Clock className="w-3.5 h-3.5" />, color: 'text-amber-300', bgHover: 'hover:bg-amber-950/30' },
        { key: 'entryBoxes', label: 'Box Area Entry & R:R', desc: 'Kotak Entry, Target TP, dan Stop Loss', icon: <Target className="w-3.5 h-3.5" />, color: 'text-emerald-400', bgHover: 'hover:bg-emerald-950/30' },
        { key: 'forecastCone', label: 'Forecast Cone Volatilitas', desc: 'Kerucut deviasi volatilitas pasar (ATR)', icon: <Compass className="w-3.5 h-3.5" />, color: 'text-yellow-400', bgHover: 'hover:bg-yellow-950/30' },
        { key: 'forecastScenarios', label: 'Target Skenario Proyeksi', desc: 'Garis proyeksi lintasan harga ke depan', icon: <Compass className="w-3.5 h-3.5" />, color: 'text-orange-400', bgHover: 'hover:bg-orange-950/30' },
        { key: 'volume', label: 'Volume Delta Bar', desc: 'Tekanan Taker Buy vs Sell bar', icon: <BarChart2 className="w-3.5 h-3.5" />, color: 'text-blue-400', bgHover: 'hover:bg-blue-950/30' },
        { key: 'openInterest', label: 'Open Interest (OI)', desc: 'Total kontrak aktif pasar Futures (Indikator Murni)', icon: <Database className="w-3.5 h-3.5" />, color: 'text-sky-400', bgHover: 'hover:bg-sky-950/30' },
        { key: 'fundingRate', label: 'Funding Rate [Futures]', desc: 'Tarif pendanaan posisi Long vs Short (Indikator Murni)', icon: <Percent className="w-3.5 h-3.5" />, color: 'text-purple-400', bgHover: 'hover:bg-purple-950/30' },
        ...(hasHtf ? [{ key: 'htfOverlay' as keyof LayerVisibility, label: 'MTF Overlay (HTF)', desc: 'Konfirmasi tren Higher Timeframe', icon: <Clock className="w-3.5 h-3.5" />, color: 'text-amber-400', bgHover: 'hover:bg-amber-950/30' }] : [])
      ]
    }
  ]

  // Count active layers
  const allKeys: (keyof LayerVisibility)[] = [
    'whaleSentimentMatrix', 'candleDeltaStrip', 'sniperEntry', 'marketXray', 'smartDivergence', 'anchoredVwap', 'deltaAbsorption', 'judasSwing', 'smcEvents', 'orderBlocks', 'fvgs', 'smcSwings',
    'liquidationHeatmap', 'cvdOrderflow', 'marketSessions',
    'trendRibbon', 'trendStrengthMeter', 'fibonacci', 'patterns', 'srLevels', 'volumeProfile',
    'entryBoxes', 'countdownBar', 'forecastCone', 'forecastScenarios', 'volume', 'openInterest', 'fundingRate',
    ...(hasHtf ? ['htfOverlay' as keyof LayerVisibility] : [])
  ]

  const activeCount = allKeys.filter((k) => visibility[k]).length
  const totalCount = allKeys.length

  const instCount = categories.find((c) => c.id === 'institusional')?.items.filter((i) => visibility[i.key]).length || 0
  const tekCount = categories.find((c) => c.id === 'teknikal')?.items.filter((i) => visibility[i.key]).length || 0
  const mktCount = categories.find((c) => c.id === 'market')?.items.filter((i) => visibility[i.key]).length || 0

  const visibleCategories = selectedCategory === 'all'
    ? categories
    : categories.filter((c) => c.id === selectedCategory)

  // Quick chips for top core indicators
  const quickChips: { key: keyof LayerVisibility; label: string }[] = [
    { key: 'whaleSentimentMatrix', label: '🐋 Whale' },
    { key: 'sniperEntry', label: 'Sniper' },
    { key: 'marketXray', label: 'X-Ray' },
    { key: 'smartDivergence', label: 'SmartDiv' },
    { key: 'anchoredVwap', label: 'AVWAP' },
    { key: 'deltaAbsorption', label: 'Absorption' },
    { key: 'judasSwing', label: 'Judas' },
    { key: 'orderBlocks', label: 'OB' },
    { key: 'fvgs', label: 'FVG' },
    { key: 'smcEvents', label: 'BOS' }
  ]

  return (
    <div className="h-8 sm:h-9 shrink-0 bg-[#111620]/95 backdrop-blur border-b border-[#21262d] flex items-center justify-between px-2 md:px-3 select-none text-xs relative z-40 whitespace-nowrap">
      {/* Left: TradingView-style Dropdown Button & Quick Chips */}
      <div className="flex items-center space-x-1.5 sm:space-x-2 shrink-0">
        {/* Main TradingView-Style Dropdown Trigger */}
        <div className="relative inline-block" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setIsOpen((prev) => !prev)}
            className={`flex items-center space-x-1 sm:space-x-1.5 px-2 py-0.5 sm:px-2.5 sm:py-1 rounded-md font-bold text-xs transition-all shadow-sm shrink-0 cursor-pointer ${
              isOpen
                ? 'bg-[#252d3d] text-[#f0b90b] border border-[#f0b90b]/50'
                : 'bg-[#18202d] hover:bg-[#20293a] text-slate-200 border border-[#2b3548] hover:border-slate-500'
            }`}
            title="Buka Menu Indikator & Lapisan Chart Terpisah"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-[#f0b90b] shrink-0" />
            <span className="hidden sm:inline">Indikator & </span><span>Layers</span>
            {activePaneTitle && (
              <span className="px-1 sm:px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[9px] sm:text-[10px] font-mono font-extrabold shrink-0">
                <span className="sm:hidden">{activePaneTitle.replace('PANE ', 'P')}</span>
                <span className="hidden sm:inline">{activePaneTitle}</span>
              </span>
            )}
            <span className="px-1.5 py-0.2 rounded-full bg-[#0d1117] text-[#f0b90b] font-mono text-[9px] sm:text-[10px] font-bold shrink-0">
              {activeCount}/{totalCount}
            </span>
            <ChevronDown className={`w-3 h-3 text-slate-400 transition-transform duration-200 shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
          </button>

          {/* TradingView-Style Dropdown Menu Popover */}
          {isOpen && (
            <>
              <div
                className="sm:hidden fixed inset-0 bg-black/60 z-40 backdrop-blur-sm"
                onClick={(e) => {
                  e.stopPropagation()
                  setIsOpen(false)
                }}
              />
              <div className="fixed sm:absolute top-12 sm:top-full sm:mt-1.5 inset-x-3 sm:inset-x-auto sm:left-0 sm:w-84 md:w-96 max-h-[82vh] overflow-y-auto bg-[#0d1117] border border-[#2b3548] rounded-xl shadow-2xl p-2.5 z-50 space-y-2 divide-y divide-[#1e2533] backdrop-blur-md animate-in fade-in zoom-in-95 duration-150">
                {/* Header & Quick Action Row */}
                <div className="flex items-center justify-between pb-1.5">
                  <div>
                    <div className="font-bold text-white text-xs flex items-center space-x-1.5">
                      <SlidersHorizontal className="w-3.5 h-3.5 text-[#f0b90b]" />
                      <span>Indikator & Lapisan Chart</span>
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {activeCount} dari {totalCount} indikator aktif
                    </div>
                  </div>

                  {onSetAll && (
                    <div className="flex items-center space-x-1">
                      <button
                        type="button"
                        onClick={() => onSetAll(true)}
                        className="px-2 py-0.5 rounded bg-emerald-950/60 hover:bg-emerald-900/60 text-emerald-300 text-[10px] font-bold border border-emerald-800/40 transition-colors cursor-pointer"
                      >
                        Semua On
                      </button>
                      <button
                        type="button"
                        onClick={() => onSetAll(false)}
                        className="px-2 py-0.5 rounded bg-rose-950/60 hover:bg-rose-900/60 text-rose-300 text-[10px] font-bold border border-rose-800/40 transition-colors cursor-pointer"
                      >
                        Reset Off
                      </button>
                    </div>
                  )}
                </div>

                {/* 3-Category Filter Tabs (Clear separation so user never gets confused) */}
                <div className="grid grid-cols-4 gap-1 pt-2 text-[10px] font-bold">
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
                        ? 'bg-amber-950/60 text-amber-300 border border-amber-500/50 shadow-sm'
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
                        ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-500/50 shadow-sm'
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
                        ? 'bg-sky-950/60 text-sky-300 border border-sky-500/50 shadow-sm'
                        : 'text-slate-400 hover:text-sky-200 hover:bg-[#161c28]'
                    }`}
                    title="Data Pasar & Derivatif"
                  >
                    📊 Pasar ({mktCount})
                  </button>
                </div>

                {/* Categorized List */}
                <div className="space-y-3 pt-2">
                  {visibleCategories.map((cat) => (
                    <div key={cat.id} className="space-y-1">
                      <div className="flex items-center justify-between px-1 py-0.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300 flex items-center space-x-1.5">
                          <span>{cat.category}</span>
                        </span>
                        <span className={`text-[8.5px] font-mono px-1 py-0.2 rounded border ${cat.badgeClass}`}>
                          {cat.badgeText}
                        </span>
                      </div>

                      <div className="space-y-1">
                        {cat.items.map((item) => {
                          const isVisible = visibility[item.key]
                          return (
                            <div
                              key={item.key}
                              onClick={() => onToggle(item.key)}
                              className={`flex items-center justify-between p-2 rounded-lg cursor-pointer transition-all border ${
                                isVisible
                                  ? 'bg-[#151c28] border-[#2d394e] text-white shadow-sm'
                                  : 'bg-transparent border-transparent text-slate-400 hover:bg-[#121722]'
                              }`}
                            >
                              <div className="flex items-center space-x-2.5 min-w-0">
                                <span className={`p-1.5 rounded-md bg-[#0b0e14] ${item.color} border border-[#21262d] shrink-0`}>
                                  {item.icon}
                                </span>
                                <div className="min-w-0">
                                  <div className="text-xs font-semibold truncate flex items-center space-x-1.5">
                                    <span>{item.label}</span>
                                    {item.key === 'openInterest' && (
                                      <span className="text-[9px] px-1 py-0.2 rounded bg-sky-950 text-sky-400 border border-sky-800/50 font-mono">
                                        Futures
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[10px] text-slate-500 truncate">
                                    {item.desc}
                                  </div>
                                </div>
                              </div>

                              {/* Interactive Toggle Switch / Settings */}
                              <div className="shrink-0 ml-2 flex items-center space-x-1">
                                {item.key === 'fibonacci' && onOpenAutoFibSettings && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      onOpenAutoFibSettings()
                                    }}
                                    className="p-1.5 rounded-md bg-[#1c2434] hover:bg-[#252f44] text-amber-400 hover:text-amber-300 border border-amber-500/30 transition-all shadow-sm cursor-pointer"
                                    title="Buka Pengaturan Auto Fibonacci (TradingView)"
                                  >
                                    <Sliders className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                {item.key === 'volumeProfile' && onOpenVpvrSettings && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      onOpenVpvrSettings()
                                    }}
                                    className="p-1.5 rounded-md bg-[#1c2434] hover:bg-[#252f44] text-cyan-400 hover:text-cyan-300 border border-cyan-500/30 transition-all shadow-sm cursor-pointer"
                                    title="Buka Pengaturan Volume Profile (VPVR)"
                                  >
                                    <Sliders className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                {item.key === 'liquidationHeatmap' && onOpenOrderflowSettings && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      onOpenOrderflowSettings('liquidation')
                                    }}
                                    className="p-1.5 rounded-md bg-[#1c2434] hover:bg-[#252f44] text-amber-400 hover:text-amber-300 border border-amber-500/30 transition-all shadow-sm cursor-pointer"
                                    title="Buka Pengaturan Liquidation Heatmap (25x/50x/100x)"
                                  >
                                    <Sliders className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                {item.key === 'cvdOrderflow' && onOpenOrderflowSettings && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      onOpenOrderflowSettings('cvd')
                                    }}
                                    className="p-1.5 rounded-md bg-[#1c2434] hover:bg-[#252f44] text-emerald-400 hover:text-emerald-300 border border-emerald-500/30 transition-all shadow-sm cursor-pointer"
                                    title="Buka Pengaturan CVD & Orderflow Divergence"
                                  >
                                    <Sliders className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                {item.key === 'marketSessions' && onOpenMarketSessionSettings && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      onOpenMarketSessionSettings()
                                    }}
                                    className="p-1.5 rounded-md bg-[#1c2434] hover:bg-[#252f44] text-amber-400 hover:text-amber-300 border border-amber-500/30 transition-all shadow-sm cursor-pointer"
                                    title="Buka Pengaturan Sesi Pasar (Garis Vertikal Tipis)"
                                  >
                                    <Sliders className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    onToggle(item.key)
                                  }}
                                  className={`p-1.5 rounded-md transition-all cursor-pointer ${
                                    isVisible
                                      ? 'bg-emerald-950/80 text-[#00c087] border border-emerald-700/60 shadow-sm'
                                      : 'bg-[#1c2434] text-slate-500 hover:text-slate-300'
                                  }`}
                                  title={isVisible ? 'Sembunyikan layer' : 'Tampilkan layer'}
                                >
                                  {isVisible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Quick Chips for Immediate One-Tap Toggling */}
        <div className="hidden md:flex items-center space-x-1 shrink-0">
          {quickChips.map((chip) => {
            const isAct = visibility[chip.key]
            return (
              <button
                key={chip.key}
                type="button"
                onClick={() => onToggle(chip.key)}
                className={`px-2 py-0.5 rounded text-[10.5px] font-semibold transition-all shrink-0 cursor-pointer ${
                  isAct
                    ? 'bg-[#1e2533] text-slate-200 border border-[#3b455b]'
                    : 'text-slate-500 hover:text-slate-300 hover:bg-[#161b22] border border-transparent'
                }`}
                title={`Klik untuk toggle ${chip.label}`}
              >
                {chip.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Right: Live Open Interest Quick Indicator Badge (When Futures & OI Active) */}
      {market === 'futures' && visibility.openInterest && openInterest && (
        <div 
          className="flex items-center space-x-1 sm:space-x-1.5 px-1.5 sm:px-2 py-0.5 rounded-md bg-sky-950/60 border border-sky-700/50 text-sky-300 text-[9.5px] sm:text-[10.5px] font-mono shrink-0 shadow-sm"
          title={`Open Interest (OI) Binance Futures: Total kontrak aktif saat ini. Indikator murni, tidak mempengaruhi rumus sinyal.`}
        >
          <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
          <span className="font-bold">OI:</span>
          <span className="text-white font-bold">{formatOpenInterestValue(openInterest.open_interest_value)}</span>
          <span className={`text-[9px] sm:text-[9.5px] font-bold ${openInterest.change_pct_1h >= 0 ? 'text-[#00c087]' : 'text-[#f6465d]'}`}>
            ({openInterest.change_pct_1h >= 0 ? '+' : ''}{openInterest.change_pct_1h}%)
          </span>
        </div>
      )}
    </div>
  )
}

function formatOpenInterestValue(val: number): string {
  if (!val || isNaN(val)) return '$0'
  if (val >= 1e9) return `$${(val / 1e9).toFixed(2)}B`
  if (val >= 1e6) return `$${(val / 1e6).toFixed(2)}M`
  if (val >= 1e3) return `$${(val / 1e3).toFixed(2)}K`
  return `$${val.toFixed(2)}`
}
