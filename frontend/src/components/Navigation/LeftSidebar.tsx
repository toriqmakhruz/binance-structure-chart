import React, { useState, useRef, useEffect } from 'react'
import {
  MousePointer,
  Square,
  Percent,
  Ruler,
  Trash2,
  Eraser,
  ChevronRight,
  TrendingUp,
  Search,
  Clock,
  Zap,
  LayoutGrid,
  Columns,
  Rows,
  Crosshair,
  Layers,
  Lock,
  Unlock,
  RefreshCw,
  Activity,
  Send,
  Cloud,
  Settings as SettingsIcon,
  Star
} from 'lucide-react'
import { DrawingToolType, SetupMode } from '../../types/analysis'
import {
  IconTrendline,
  IconRay,
  IconInfoLine,
  IconExtendedLine,
  IconTrendAngle,
  IconHorizontalLine,
  IconHorizontalRay,
  IconVerticalLine,
  IconCrossline,
  IconParallelChannel,
  IconRegressionTrend,
  IconFlatTopBottom,
  IconDisjointChannel,
  IconPitchfork,
  IconSchiffPitchfork,
  IconModifiedSchiff,
  IconInsidePitchfork
} from '../Chart/LineToolIcons'
import { formatPrice } from '../../utils/formatters'

export type StreamStatusType = 'LIVE' | 'CONNECTING' | 'RECONNECTING' | 'STALE' | 'OFFLINE'

export interface LeftSidebarProps {
  // Pair & Market
  symbol: string
  lastPrice?: number
  onSymbolClick: () => void
  timeframe: string
  onTimeframeChange: (tf: string) => void
  market: 'spot' | 'futures'
  onMarketChange: (m: 'spot' | 'futures') => void
  setupMode?: SetupMode
  onModeChange?: (mode: SetupMode) => void

  // Multi-chart Layout & Sync
  layout: 'single' | 'split-vertical' | 'split-horizontal' | 'grid-4'
  onLayoutChange: (l: 'single' | 'split-vertical' | 'split-horizontal' | 'grid-4') => void
  syncCrosshair?: boolean
  onToggleSyncCrosshair?: () => void
  syncSetup?: boolean
  onToggleSyncSetup?: () => void

  // Active Setup & Trade Actions
  isSetupLocked?: boolean
  onUnlockSetup?: () => void
  activeSetup?: any
  onOpenTrade?: (setup: any) => void

  // Drawing Toolbar
  activeTool: DrawingToolType
  onSelectTool: (tool: DrawingToolType) => void
  onClearAll: () => void
  drawingCount: number

  // Bottom Utilities
  isLoading: boolean
  onRefresh: () => void
  isDashboardOpen?: boolean
  onToggleDashboard?: () => void
  isTelegramActive?: boolean
  onOpenTelegram?: () => void
  isCloudSyncing?: boolean
  onCloudSync?: () => void
  onOpenSettings: () => void
  streamStatus?: StreamStatusType
}

interface LineToolItem {
  type: DrawingToolType
  label: string
  shortcut?: string
  icon: React.ReactNode
}

interface LineToolSection {
  title: string
  items: LineToolItem[]
}

const LINE_TOOL_SECTIONS: LineToolSection[] = [
  {
    title: 'LINES',
    items: [
      { type: 'trendline', label: 'Trendline', shortcut: 'Alt + T', icon: <IconTrendline className="w-4 h-4" /> },
      { type: 'ray', label: 'Ray', icon: <IconRay className="w-4 h-4" /> },
      { type: 'info_line', label: 'Info line', icon: <IconInfoLine className="w-4 h-4" /> },
      { type: 'extended_line', label: 'Extended line', icon: <IconExtendedLine className="w-4 h-4" /> },
      { type: 'trend_angle', label: 'Trend angle', icon: <IconTrendAngle className="w-4 h-4" /> },
      { type: 'horizontal_line', label: 'Horizontal line', shortcut: 'Alt + H', icon: <IconHorizontalLine className="w-4 h-4" /> },
      { type: 'horizontal_ray', label: 'Horizontal ray', shortcut: 'Alt + J', icon: <IconHorizontalRay className="w-4 h-4" /> },
      { type: 'vertical_line', label: 'Vertical line', shortcut: 'Alt + V', icon: <IconVerticalLine className="w-4 h-4" /> },
      { type: 'crossline', label: 'Crossline', shortcut: 'Alt + C', icon: <IconCrossline className="w-4 h-4" /> },
    ]
  },
  {
    title: 'CHANNELS',
    items: [
      { type: 'parallel_channel', label: 'Parallel channel', icon: <IconParallelChannel className="w-4 h-4" /> },
      { type: 'regression_trend', label: 'Regression trend', icon: <IconRegressionTrend className="w-4 h-4" /> },
      { type: 'flat_top_bottom', label: 'Flat top/bottom', icon: <IconFlatTopBottom className="w-4 h-4" /> },
      { type: 'disjoint_channel', label: 'Disjoint channel', icon: <IconDisjointChannel className="w-4 h-4" /> },
    ]
  },
  {
    title: 'PITCHFORKS',
    items: [
      { type: 'pitchfork', label: 'Pitchfork', icon: <IconPitchfork className="w-4 h-4" /> },
      { type: 'schiff_pitchfork', label: 'Schiff pitchfork', icon: <IconSchiffPitchfork className="w-4 h-4" /> },
      { type: 'modified_schiff', label: 'Modified Schiff pitchfork', icon: <IconModifiedSchiff className="w-4 h-4" /> },
      { type: 'inside_pitchfork', label: 'Inside pitchfork', icon: <IconInsidePitchfork className="w-4 h-4" /> },
    ]
  }
]

const TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d']

type ActiveFlyout = 'none' | 'lines' | 'layout' | 'timeframe' | 'mode'

export const LeftSidebar: React.FC<LeftSidebarProps> = ({
  symbol,
  lastPrice,
  onSymbolClick,
  timeframe,
  onTimeframeChange,
  market,
  onMarketChange,
  setupMode = 'standard',
  onModeChange,
  layout,
  onLayoutChange,
  syncCrosshair = true,
  onToggleSyncCrosshair,
  syncSetup = true,
  onToggleSyncSetup,
  isSetupLocked = false,
  onUnlockSetup,
  activeSetup,
  onOpenTrade,
  activeTool,
  onSelectTool,
  onClearAll,
  drawingCount,
  isLoading,
  onRefresh,
  isDashboardOpen,
  onToggleDashboard,
  isTelegramActive = false,
  onOpenTelegram,
  isCloudSyncing = false,
  onCloudSync,
  onOpenSettings,
  streamStatus = 'OFFLINE'
}) => {
  const [activeFlyout, setActiveFlyout] = useState<ActiveFlyout>('none')
  const [selectedLineTool, setSelectedLineTool] = useState<DrawingToolType>('trendline')
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('cp_favorite_drawing_tools')
      return saved ? JSON.parse(saved) : ['trendline', 'horizontal_line', 'ray']
    } catch {
      return ['trendline', 'horizontal_line', 'ray']
    }
  })

  const sidebarRef = useRef<HTMLDivElement>(null)

  // Determine if active tool is part of the Line Tools group
  const isLineToolActive = LINE_TOOL_SECTIONS.some((sec) =>
    sec.items.some((it) => it.type === activeTool)
  )

  useEffect(() => {
    if (isLineToolActive) {
      setSelectedLineTool(activeTool)
    }
  }, [activeTool, isLineToolActive])

  // Click outside to close any open flyout
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (sidebarRef.current && !sidebarRef.current.contains(e.target as Node)) {
        setActiveFlyout('none')
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handleGlobalShortcuts = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName)) return

      if (e.altKey && (e.key === 't' || e.key === 'T')) {
        e.preventDefault()
        onSelectTool('trendline')
      } else if (e.altKey && (e.key === 'h' || e.key === 'H')) {
        e.preventDefault()
        onSelectTool('horizontal_line')
      } else if (e.altKey && (e.key === 'j' || e.key === 'J')) {
        e.preventDefault()
        onSelectTool('horizontal_ray')
      } else if (e.altKey && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault()
        onSelectTool('vertical_line')
      } else if (e.altKey && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault()
        onSelectTool('crossline')
      } else if (e.key === 'Escape') {
        onSelectTool('cursor')
        setActiveFlyout('none')
      }
    }

    window.addEventListener('keydown', handleGlobalShortcuts)
    return () => window.removeEventListener('keydown', handleGlobalShortcuts)
  }, [onSelectTool])

  const toggleFavorite = (type: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setFavorites((prev) => {
      const next = prev.includes(type) ? prev.filter((id) => id !== type) : [...prev, type]
      try {
        localStorage.setItem('cp_favorite_drawing_tools', JSON.stringify(next))
      } catch {}
      return next
    })
  }

  const currentLineToolItem =
    LINE_TOOL_SECTIONS.flatMap((s) => s.items).find((it) => it.type === selectedLineTool) ||
    LINE_TOOL_SECTIONS[0].items[0]

  const getBadgeConfig = () => {
    switch (streamStatus) {
      case 'LIVE':
        return {
          title: 'Binance WebSocket Terhubung Real-time Live',
          dot: 'bg-emerald-400 animate-pulse',
          label: 'LIVE'
        }
      case 'STALE':
        return {
          title: 'Data Stale: Tidak ada tick dalam 45 detik',
          dot: 'bg-amber-400',
          label: 'STALE'
        }
      case 'RECONNECTING':
        return {
          title: 'Mencoba menghubungkan ulang ke Binance...',
          dot: 'bg-yellow-400 animate-ping',
          label: 'RECONNECTING'
        }
      case 'CONNECTING':
        return {
          title: 'Menghubungkan ke upstream Binance...',
          dot: 'bg-blue-400 animate-pulse',
          label: 'CONNECTING'
        }
      default:
        return {
          title: 'WebSocket Terputus',
          dot: 'bg-rose-400',
          label: 'OFFLINE'
        }
    }
  }

  const badge = getBadgeConfig()

  // Layout icon helper
  const getLayoutIcon = () => {
    switch (layout) {
      case 'split-vertical':
        return <Columns className="w-4 h-4 text-[#f0b90b]" />
      case 'split-horizontal':
        return <Rows className="w-4 h-4 text-[#f0b90b]" />
      case 'grid-4':
        return <LayoutGrid className="w-4 h-4 text-[#f0b90b]" />
      default:
        return <Square className="w-4 h-4 text-slate-300" />
    }
  }

  return (
    <div
      ref={sidebarRef}
      className="w-12 bg-[#111620] border-r border-[#21262d] flex flex-col justify-between items-center py-2 select-none z-30 shrink-0 relative h-full overflow-visible"
    >
      {/* ========================================================================= */}
      {/* --- TOP SECTION: Symbol, Timeframe, Engine Mode, Layout Dropdown & Trade --- */}
      {/* ========================================================================= */}
      <div className="flex flex-col items-center space-y-1 w-full relative">
        {/* 1. Symbol Search Button */}
        <button
          type="button"
          onClick={() => {
            setActiveFlyout('none')
            onSymbolClick()
          }}
          title={`Pilih Koin: ${symbol} ${lastPrice ? `($${formatPrice(lastPrice)})` : ''}`}
          className="p-2 rounded-lg text-slate-300 hover:text-[#f0b90b] hover:bg-[#1a202c] transition-all relative group cursor-pointer"
        >
          <Search className="w-4 h-4" />
          <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-[#1f242c] text-white text-xs px-2.5 py-1 rounded shadow-lg border border-[#30363d] whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
            <span className="font-bold text-[#f0b90b]">{symbol}</span>
            {lastPrice && <span className="ml-1 text-slate-300 font-mono">${formatPrice(lastPrice)}</span>}
            <span className="ml-1 text-slate-400">(Klik untuk ganti koin)</span>
          </div>
        </button>

        {/* 2. Timeframe Dropdown Button */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setActiveFlyout((prev) => (prev === 'timeframe' ? 'none' : 'timeframe'))}
            title={`Timeframe: ${timeframe.toUpperCase()}`}
            className={`px-1.5 py-1 rounded-lg text-[10px] font-mono font-bold transition-all relative group cursor-pointer ${
              activeFlyout === 'timeframe'
                ? 'bg-[#f0b90b] text-black shadow'
                : 'text-[#f0b90b] hover:bg-[#1a202c]'
            }`}
          >
            <span>{timeframe.toUpperCase()}</span>
            <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-[#1f242c] text-white text-xs px-2.5 py-1 rounded shadow-lg border border-[#30363d] whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
              Pilih Timeframe ({timeframe.toUpperCase()})
            </div>
          </button>

          {/* Timeframe Popover Dropdown */}
          {activeFlyout === 'timeframe' && (
            <div className="absolute left-13 top-0 z-50 bg-[#161b24] border border-[#263042] rounded-xl shadow-2xl p-2.5 w-44 text-slate-200 select-none animate-in fade-in zoom-in-95 duration-150">
              <div className="text-[11px] font-bold text-white mb-2 pb-1.5 border-b border-[#21262d] flex items-center space-x-1.5">
                <Clock className="w-3.5 h-3.5 text-[#f0b90b]" />
                <span>Pilih Timeframe</span>
              </div>
              <div className="grid grid-cols-4 gap-1">
                {TIMEFRAMES.map((tf) => (
                  <button
                    key={tf}
                    type="button"
                    onClick={() => {
                      onTimeframeChange(tf)
                      setActiveFlyout('none')
                    }}
                    className={`py-1.5 rounded text-center font-mono text-xs font-bold transition-all ${
                      timeframe.toLowerCase() === tf.toLowerCase()
                        ? 'bg-[#f0b90b] text-black shadow font-black'
                        : 'bg-[#0f131a] border border-[#21262d] text-slate-300 hover:text-white hover:border-amber-500/50'
                    }`}
                  >
                    {tf.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 3. Market & Engine Mode Dropdown Button */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setActiveFlyout((prev) => (prev === 'mode' ? 'none' : 'mode'))}
            title={`Pasar & Modul: ${market.toUpperCase()} - ${setupMode.toUpperCase()}`}
            className={`p-2 rounded-lg transition-all relative group cursor-pointer ${
              activeFlyout === 'mode'
                ? 'bg-[#252d3d] text-[#f0b90b] shadow-inner font-bold'
                : 'text-slate-400 hover:text-[#f0b90b] hover:bg-[#1a202c]'
            }`}
          >
            <Zap className="w-4 h-4 text-[#f0b90b]" />
            <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-[#1f242c] text-white text-xs px-2.5 py-1 rounded shadow-lg border border-[#30363d] whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
              Pasar & Modul ({market.toUpperCase()} · {setupMode})
            </div>
          </button>

          {/* Market & Engine Mode Popover Dropdown */}
          {activeFlyout === 'mode' && (
            <div className="absolute left-13 top-0 z-50 bg-[#161b24] border border-[#263042] rounded-xl shadow-2xl p-3 w-64 text-slate-200 select-none animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between pb-2 mb-2.5 border-b border-[#21262d]">
                <span className="text-xs font-bold text-white flex items-center space-x-1.5">
                  <Zap className="w-3.5 h-3.5 text-[#f0b90b]" />
                  <span>Pasar & Modul Trading</span>
                </span>
              </div>

              {/* Market Toggle (Spot vs Futures) */}
              <div className="mb-3">
                <div className="text-[10px] text-slate-400 mb-1 font-semibold uppercase tracking-wider">Pasar Binance</div>
                <div className="grid grid-cols-2 gap-1 bg-[#0b0e14] p-1 rounded-lg border border-[#21262d]">
                  <button
                    type="button"
                    onClick={() => onMarketChange('futures')}
                    className={`py-1 rounded text-xs font-bold transition-all ${
                      market === 'futures'
                        ? 'bg-[#f0b90b] text-black shadow font-extrabold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    FUTURES
                  </button>
                  <button
                    type="button"
                    onClick={() => onMarketChange('spot')}
                    className={`py-1 rounded text-xs font-bold transition-all ${
                      market === 'spot'
                        ? 'bg-[#f0b90b] text-black shadow font-extrabold'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    SPOT
                  </button>
                </div>
              </div>

              {/* Mode Selection */}
              {onModeChange && (
                <div>
                  <div className="text-[10px] text-slate-400 mb-1 font-semibold uppercase tracking-wider">Modul Engine Analisa</div>
                  <div className="space-y-1">
                    {[
                      { id: 'standard', name: 'Standard', desc: 'Klasik SMC & Pattern Detection' },
                      { id: 'pro_shield', name: 'Pro Shield', desc: 'High Winrate SFP & Invalidation Defense' },
                      { id: 'craig_10x', name: 'Craig 10x', desc: 'Aggressive Confluence & Max R:R' },
                      { id: 'apex_quant', name: 'Apex Quant', desc: 'Multi-Timeframe Algorithmic Engine' }
                    ].map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => {
                          onModeChange(m.id as SetupMode)
                          setActiveFlyout('none')
                        }}
                        className={`w-full text-left p-2 rounded-lg border transition-all ${
                          setupMode === m.id
                            ? 'bg-amber-500/15 border-amber-500/50 text-[#f0b90b] font-bold shadow-sm'
                            : 'bg-[#0f131a] border-[#21262d] text-slate-300 hover:border-slate-500 hover:text-white'
                        }`}
                      >
                        <div className="text-xs font-bold">{m.name}</div>
                        <div className="text-[10px] text-slate-400">{m.desc}</div>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 4. Multi-Chart Layout Dropdown Button (Dropdown as requested) */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setActiveFlyout((prev) => (prev === 'layout' ? 'none' : 'layout'))}
            title="Tata Letak Multi-Chart & Sinkronisasi"
            className={`p-2 rounded-lg transition-all relative group cursor-pointer ${
              activeFlyout === 'layout' || layout !== 'single'
                ? 'bg-[#252d3d] text-[#f0b90b] shadow-inner font-bold'
                : 'text-slate-400 hover:text-white hover:bg-[#1a202c]'
            }`}
          >
            {getLayoutIcon()}
            <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-[#1f242c] text-white text-xs px-2.5 py-1 rounded shadow-lg border border-[#30363d] whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
              Tata Letak Chart & Sinkronisasi
            </div>
          </button>

          {/* Layout Dropdown Popover */}
          {activeFlyout === 'layout' && (
            <div className="absolute left-13 top-0 z-50 bg-[#161b24] border border-[#263042] rounded-xl shadow-2xl p-3 w-64 text-slate-200 select-none animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between pb-2 mb-2.5 border-b border-[#21262d]">
                <span className="text-xs font-bold text-white flex items-center space-x-1.5">
                  <LayoutGrid className="w-3.5 h-3.5 text-[#f0b90b]" />
                  <span>Tata Letak Multi-Chart</span>
                </span>
                <span className="text-[10px] text-slate-400 font-mono">
                  {layout === 'single'
                    ? '1 Chart'
                    : layout === 'split-vertical'
                    ? '2 Vertikal'
                    : layout === 'split-horizontal'
                    ? '2 Horizontal'
                    : '4 Grid'}
                </span>
              </div>

              {/* 4 Layout options */}
              <div className="grid grid-cols-2 gap-1.5 mb-3">
                <button
                  type="button"
                  onClick={() => {
                    onLayoutChange('single')
                    setActiveFlyout('none')
                  }}
                  className={`flex items-center space-x-2 p-2 rounded-lg border text-left text-xs transition-all ${
                    layout === 'single'
                      ? 'bg-[#f0b90b]/15 border-[#f0b90b]/60 text-[#f0b90b] font-bold shadow-sm'
                      : 'bg-[#0f131a] border-[#21262d] text-slate-300 hover:border-slate-500 hover:text-white'
                  }`}
                >
                  <Square className="w-4 h-4 shrink-0" />
                  <span>1 Chart</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onLayoutChange('split-vertical')
                    setActiveFlyout('none')
                  }}
                  className={`flex items-center space-x-2 p-2 rounded-lg border text-left text-xs transition-all ${
                    layout === 'split-vertical'
                      ? 'bg-[#f0b90b]/15 border-[#f0b90b]/60 text-[#f0b90b] font-bold shadow-sm'
                      : 'bg-[#0f131a] border-[#21262d] text-slate-300 hover:border-slate-500 hover:text-white'
                  }`}
                >
                  <Columns className="w-4 h-4 shrink-0" />
                  <span>2 Vertikal</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onLayoutChange('split-horizontal')
                    setActiveFlyout('none')
                  }}
                  className={`flex items-center space-x-2 p-2 rounded-lg border text-left text-xs transition-all ${
                    layout === 'split-horizontal'
                      ? 'bg-[#f0b90b]/15 border-[#f0b90b]/60 text-[#f0b90b] font-bold shadow-sm'
                      : 'bg-[#0f131a] border-[#21262d] text-slate-300 hover:border-slate-500 hover:text-white'
                  }`}
                >
                  <Rows className="w-4 h-4 shrink-0" />
                  <span>2 Horizontal</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onLayoutChange('grid-4')
                    setActiveFlyout('none')
                  }}
                  className={`flex items-center space-x-2 p-2 rounded-lg border text-left text-xs transition-all ${
                    layout === 'grid-4'
                      ? 'bg-[#f0b90b]/15 border-[#f0b90b]/60 text-[#f0b90b] font-bold shadow-sm'
                      : 'bg-[#0f131a] border-[#21262d] text-slate-300 hover:border-slate-500 hover:text-white'
                  }`}
                >
                  <LayoutGrid className="w-4 h-4 shrink-0" />
                  <span>4 Grid</span>
                </button>
              </div>

              {/* Multi-Chart Sync Options */}
              {layout !== 'single' && (
                <div className="pt-2 border-t border-[#21262d] space-y-1.5">
                  <div className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Sinkronisasi Antar Chart</div>
                  {onToggleSyncCrosshair && (
                    <div className="flex items-center justify-between p-1.5 rounded-lg bg-[#0f131a] border border-[#21262d]">
                      <div className="flex items-center space-x-2">
                        <Crosshair className={`w-3.5 h-3.5 ${syncCrosshair ? 'text-cyan-400' : 'text-slate-500'}`} />
                        <span className="text-xs text-slate-300">Sinkron Kursor</span>
                      </div>
                      <button
                        type="button"
                        onClick={onToggleSyncCrosshair}
                        className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
                          syncCrosshair
                            ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 shadow-sm'
                            : 'bg-[#1a202c] text-slate-500 border border-transparent'
                        }`}
                      >
                        {syncCrosshair ? 'AKTIF' : 'OFF'}
                      </button>
                    </div>
                  )}

                  {onToggleSyncSetup && (
                    <div className="flex items-center justify-between p-1.5 rounded-lg bg-[#0f131a] border border-[#21262d]">
                      <div className="flex items-center space-x-2">
                        <Layers className={`w-3.5 h-3.5 ${syncSetup ? 'text-amber-400' : 'text-slate-500'}`} />
                        <span className="text-xs text-slate-300">Sinkron Setup Box</span>
                      </div>
                      <button
                        type="button"
                        onClick={onToggleSyncSetup}
                        className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
                          syncSetup
                            ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                            : 'bg-[#1a202c] text-slate-500 border border-transparent'
                        }`}
                      >
                        {syncSetup ? 'AKTIF' : 'OFF'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 5. Trade Action / Setup Lock Button */}
        {isSetupLocked ? (
          <button
            type="button"
            onClick={onUnlockSetup}
            title="Setup Terkunci! Klik untuk lepas kunci."
            className="p-2 rounded-lg bg-amber-500/20 text-amber-400 border border-amber-500/40 hover:bg-rose-500/20 hover:text-rose-300 hover:border-rose-500/40 transition-all relative group cursor-pointer animate-pulse"
          >
            <Lock className="w-4 h-4" />
            <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-[#1f242c] text-white text-xs px-2.5 py-1 rounded shadow-lg border border-[#30363d] whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
              Setup Terkunci · Klik untuk Lepas Kunci
            </div>
          </button>
        ) : (
          activeSetup && onOpenTrade && (
            <button
              type="button"
              onClick={() => onOpenTrade(activeSetup)}
              title={`Open Posisi ${activeSetup.direction}`}
              className={`p-2 rounded-lg transition-all relative group cursor-pointer shadow-md ${
                activeSetup.direction === 'LONG'
                  ? 'bg-emerald-500 text-black hover:bg-emerald-400'
                  : 'bg-rose-500 text-white hover:bg-rose-400'
              }`}
            >
              <Zap className="w-4 h-4 fill-current" />
              <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-[#1f242c] text-white text-xs px-2.5 py-1 rounded shadow-lg border border-[#30363d] whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
                Buka Posisi {activeSetup.direction} ({symbol})
              </div>
            </button>
          )
        )}
      </div>

      {/* Divider */}
      <div className="w-7 border-b border-[#21262d] my-1.5" />

      {/* ========================================================================= */}
      {/* --- MIDDLE SECTION: TradingView Drawing Tools --- */}
      {/* ========================================================================= */}
      <div className="flex flex-col items-center space-y-1 w-full relative">
        {/* Cursor / Selection */}
        <button
          type="button"
          title="Kursor / Pan (Esc)"
          onClick={() => {
            onSelectTool('cursor')
            setActiveFlyout('none')
          }}
          className={`p-2 rounded-lg transition-all relative group cursor-pointer ${
            activeTool === 'cursor'
              ? 'bg-[#252d3d] text-[#f0b90b] shadow-inner font-bold'
              : 'text-slate-400 hover:text-white hover:bg-[#1a202c]'
          }`}
        >
          <MousePointer className="w-4 h-4" />
          <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-[#1f242c] text-white text-xs px-2.5 py-1 rounded shadow-lg border border-[#30363d] whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
            Kursor / Pan (Esc)
          </div>
        </button>

        {/* Trend Line Tools Group with Popover Flyout */}
        <div className="relative">
          <div
            className={`flex items-center rounded-lg transition-all group ${
              isLineToolActive
                ? 'bg-[#252d3d] text-[#f0b90b] shadow-inner font-bold'
                : 'text-slate-400 hover:text-white hover:bg-[#1a202c]'
            }`}
          >
            <button
              type="button"
              title={`${currentLineToolItem.label} (Klik panah untuk menu garis)`}
              onClick={() => {
                onSelectTool(selectedLineTool)
              }}
              className="p-2 pr-0.5 relative cursor-pointer"
            >
              {currentLineToolItem.icon}
            </button>

            <button
              type="button"
              title="Buka Menu Garis TradingView"
              onClick={(e) => {
                e.stopPropagation()
                setActiveFlyout((prev) => (prev === 'lines' ? 'none' : 'lines'))
              }}
              className="p-1 pr-1.5 hover:text-[#f0b90b] transition-colors cursor-pointer"
            >
              <ChevronRight
                className={`w-3 h-3 transition-transform duration-200 ${
                  activeFlyout === 'lines' ? 'rotate-90 text-[#f0b90b]' : 'opacity-70 group-hover:opacity-100'
                }`}
              />
            </button>
          </div>

          {/* Line Tools Flyout Menu */}
          {activeFlyout === 'lines' && (
            <div className="absolute left-13 top-0 z-50 bg-[#161b24] border border-[#263042] rounded-xl shadow-2xl p-2 w-64 text-slate-200 select-none animate-in fade-in zoom-in-95 duration-150 max-h-[80vh] overflow-y-auto no-scrollbar">
              {LINE_TOOL_SECTIONS.map((section) => (
                <div key={section.title} className="mb-2 last:mb-0">
                  <div className="text-[10px] font-semibold text-slate-400 px-2 py-1 uppercase tracking-wider">
                    {section.title}
                  </div>
                  <div className="space-y-0.5">
                    {section.items.map((item) => (
                      <div
                        key={item.type}
                        onClick={() => {
                          setSelectedLineTool(item.type)
                          onSelectTool(item.type)
                          setActiveFlyout('none')
                        }}
                        className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs cursor-pointer transition-colors group ${
                          activeTool === item.type
                            ? 'bg-[#f0b90b]/15 text-[#f0b90b] font-semibold'
                            : 'hover:bg-[#1f2637] text-slate-300 hover:text-white'
                        }`}
                      >
                        <div className="flex items-center space-x-2.5">
                          <span className={activeTool === item.type ? 'text-[#f0b90b]' : 'text-slate-400 group-hover:text-white'}>
                            {item.icon}
                          </span>
                          <span>{item.label}</span>
                        </div>
                        <div className="flex items-center space-x-1.5">
                          {item.shortcut && (
                            <span className="text-[10px] text-slate-400 font-mono font-medium">
                              {item.shortcut}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={(e) => toggleFavorite(item.type, e)}
                            className="p-0.5 rounded hover:bg-slate-700/50"
                          >
                            <Star
                              className={`w-3 h-3 ${
                                favorites.includes(item.type)
                                  ? 'text-amber-400 fill-amber-400'
                                  : 'text-slate-500 opacity-0 group-hover:opacity-100 hover:text-amber-400'
                              }`}
                            />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Rectangle / Box Tool */}
        <button
          type="button"
          title="Kotak / Rectangle (Kotak custom)"
          onClick={() => {
            onSelectTool('rectangle')
            setActiveFlyout('none')
          }}
          className={`p-2 rounded-lg transition-all relative group cursor-pointer ${
            activeTool === 'rectangle'
              ? 'bg-[#252d3d] text-[#f0b90b] shadow-inner font-bold'
              : 'text-slate-400 hover:text-white hover:bg-[#1a202c]'
          }`}
        >
          <Square className="w-4 h-4" />
          <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-[#1f242c] text-white text-xs px-2.5 py-1 rounded shadow-lg border border-[#30363d] whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
            Kotak / Rectangle
          </div>
        </button>

        {/* Fibonacci Retracement */}
        <button
          type="button"
          title="Fibonacci Retracement"
          onClick={() => {
            onSelectTool('fibonacci')
            setActiveFlyout('none')
          }}
          className={`p-2 rounded-lg transition-all relative group cursor-pointer ${
            activeTool === 'fibonacci'
              ? 'bg-[#252d3d] text-[#f0b90b] shadow-inner font-bold'
              : 'text-slate-400 hover:text-white hover:bg-[#1a202c]'
          }`}
        >
          <Percent className="w-4 h-4" />
          <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-[#1f242c] text-white text-xs px-2.5 py-1 rounded shadow-lg border border-[#30363d] whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
            Fibonacci Retracement
          </div>
        </button>

        {/* Ruler / Measure */}
        <button
          type="button"
          title="Penggaris (Ruler / Measure)"
          onClick={() => {
            onSelectTool('measure')
            setActiveFlyout('none')
          }}
          className={`p-2 rounded-lg transition-all relative group cursor-pointer ${
            activeTool === 'measure'
              ? 'bg-[#252d3d] text-[#f0b90b] shadow-inner font-bold'
              : 'text-slate-400 hover:text-white hover:bg-[#1a202c]'
          }`}
        >
          <Ruler className="w-4 h-4" />
          <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-[#1f242c] text-white text-xs px-2.5 py-1 rounded shadow-lg border border-[#30363d] whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
            Penggaris (Ruler / Measure)
          </div>
        </button>

        {/* Eraser */}
        <button
          type="button"
          title="Penghapus Objek Gambar"
          onClick={() => {
            onSelectTool('eraser')
            setActiveFlyout('none')
          }}
          className={`p-2 rounded-lg transition-all relative group cursor-pointer ${
            activeTool === 'eraser'
              ? 'bg-[#252d3d] text-[#f0b90b] shadow-inner font-bold'
              : 'text-slate-400 hover:text-white hover:bg-[#1a202c]'
          }`}
        >
          <Eraser className="w-4 h-4" />
          <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-[#1f242c] text-white text-xs px-2.5 py-1 rounded shadow-lg border border-[#30363d] whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
            Penghapus (Klik objek gambar)
          </div>
        </button>

        {/* Clear All Drawings */}
        <button
          type="button"
          title={`Hapus Semua Gambar Manual (${drawingCount})`}
          onClick={onClearAll}
          disabled={drawingCount === 0}
          className="p-2 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 transition-all disabled:opacity-30 relative group cursor-pointer"
        >
          <Trash2 className="w-4 h-4" />
          <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-[#1f242c] text-white text-xs px-2.5 py-1 rounded shadow-lg border border-[#30363d] whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
            Hapus Semua Gambar ({drawingCount})
          </div>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* --- BOTTOM SECTION: Actions (Refresh, Dashboard, Telegram, Cloud, Settings, Live) --- */}
      {/* ========================================================================= */}
      <div className="flex flex-col items-center space-y-1 w-full pt-1.5 border-t border-[#21262d]">
        {/* Refresh Analysis */}
        <button
          type="button"
          title="Analisa Ulang Struktur"
          onClick={onRefresh}
          disabled={isLoading}
          className="p-2 rounded-lg text-slate-400 hover:text-[#f0b90b] hover:bg-[#1a202c] transition-all disabled:opacity-50 relative group cursor-pointer"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-[#f0b90b]' : ''}`} />
          <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-[#1f242c] text-white text-xs px-2.5 py-1 rounded shadow-lg border border-[#30363d] whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
            Analisa Ulang Struktur
          </div>
        </button>

        {/* Trading Dashboard Drawer */}
        {onToggleDashboard && (
          <button
            type="button"
            title="Dashboard Posisi & Trade"
            onClick={onToggleDashboard}
            className={`p-2 rounded-lg transition-all relative group cursor-pointer ${
              isDashboardOpen
                ? 'bg-[#252d3d] text-[#f0b90b] shadow-inner font-bold'
                : 'text-slate-400 hover:text-white hover:bg-[#1a202c]'
            }`}
          >
            <Activity className="w-4 h-4" />
            <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-[#1f242c] text-white text-xs px-2.5 py-1 rounded shadow-lg border border-[#30363d] whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
              Dashboard Posisi & Trade
            </div>
          </button>
        )}

        {/* Telegram Alerts */}
        {onOpenTelegram && (
          <button
            type="button"
            title="Telegram Alert"
            onClick={onOpenTelegram}
            className="p-2 rounded-lg text-slate-400 hover:text-[#38bdf8] hover:bg-[#1a202c] transition-all relative group cursor-pointer"
          >
            <Send className="w-4 h-4" />
            {isTelegramActive && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-[#111620]" />
            )}
            <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-[#1f242c] text-white text-xs px-2.5 py-1 rounded shadow-lg border border-[#30363d] whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
              Telegram Alert {isTelegramActive ? '(Aktif)' : ''}
            </div>
          </button>
        )}

        {/* Cloud Sync */}
        {onCloudSync && (
          <button
            type="button"
            title="Sinkronisasi Cloud"
            onClick={onCloudSync}
            disabled={isCloudSyncing}
            className={`p-2 rounded-lg transition-all relative group cursor-pointer ${
              isCloudSyncing
                ? 'text-[#38bdf8] animate-pulse'
                : 'text-slate-400 hover:text-[#38bdf8] hover:bg-[#1a202c]'
            }`}
          >
            <Cloud className={`w-4 h-4 ${isCloudSyncing ? 'animate-bounce' : ''}`} />
            <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-[#1f242c] text-white text-xs px-2.5 py-1 rounded shadow-lg border border-[#30363d] whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
              {isCloudSyncing ? 'Menyinkronkan...' : 'Sinkronkan Setingan ke Cloud'}
            </div>
          </button>
        )}

        {/* Settings */}
        <button
          type="button"
          title="Pengaturan Indikator & Engine"
          onClick={onOpenSettings}
          className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-[#1a202c] transition-all relative group cursor-pointer"
        >
          <SettingsIcon className="w-4 h-4" />
          <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-[#1f242c] text-white text-xs px-2.5 py-1 rounded shadow-lg border border-[#30363d] whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
            Pengaturan Indikator
          </div>
        </button>

        {/* Live WebSocket Status Dot */}
        <div
          title={badge.title}
          className="pt-1 pb-1 flex items-center justify-center relative group cursor-default"
        >
          <span className={`w-2.5 h-2.5 rounded-full ${badge.dot}`} />
          <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-[#1f242c] text-white text-xs px-2.5 py-1 rounded shadow-lg border border-[#30363d] whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 font-mono">
            Status: {badge.label}
          </div>
        </div>
      </div>
    </div>
  )
}
