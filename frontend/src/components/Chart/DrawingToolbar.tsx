import React, { useState, useRef, useEffect } from 'react'
import {
  MousePointer,
  Square,
  Percent,
  Ruler,
  Trash2,
  Eraser,
  HelpCircle,
  Star,
  ChevronRight
} from 'lucide-react'
import { DrawingToolType } from '../../types/analysis'
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
} from './LineToolIcons'

interface DrawingToolbarProps {
  activeTool: DrawingToolType
  onSelectTool: (tool: DrawingToolType) => void
  onClearAll: () => void
  drawingCount: number
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

export const DrawingToolbar: React.FC<DrawingToolbarProps> = ({
  activeTool,
  onSelectTool,
  onClearAll,
  drawingCount
}) => {
  const [isLineMenuOpen, setIsLineMenuOpen] = useState(false)
  const [selectedLineTool, setSelectedLineTool] = useState<DrawingToolType>('trendline')
  const [favorites, setFavorites] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('cp_favorite_drawing_tools')
      return saved ? JSON.parse(saved) : ['trendline', 'horizontal_line', 'ray']
    } catch {
      return ['trendline', 'horizontal_line', 'ray']
    }
  })

  const flyoutRef = useRef<HTMLDivElement>(null)
  const lineButtonRef = useRef<HTMLDivElement>(null)

  // Determine if active tool is part of the Line Tools group
  const isLineToolActive = LINE_TOOL_SECTIONS.some((sec) =>
    sec.items.some((it) => it.type === activeTool)
  )

  // Keep selected line tool synced if active tool changes to a line tool
  useEffect(() => {
    if (isLineToolActive) {
      setSelectedLineTool(activeTool)
    }
  }, [activeTool, isLineToolActive])

  // Click outside to close flyout
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        flyoutRef.current &&
        !flyoutRef.current.contains(e.target as Node) &&
        lineButtonRef.current &&
        !lineButtonRef.current.contains(e.target as Node)
      ) {
        setIsLineMenuOpen(false)
      }
    }
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsLineMenuOpen(false)
      }
    }

    if (isLineMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleKeyDown)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isLineMenuOpen])

  // Global hotkeys listener matching TradingView (Alt+T, Alt+H, Alt+J, Alt+V, Alt+C, Escape)
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

  // Find icon and label for the current line tool
  const currentLineToolItem =
    LINE_TOOL_SECTIONS.flatMap((s) => s.items).find((it) => it.type === selectedLineTool) ||
    LINE_TOOL_SECTIONS[0].items[0]

  return (
    <div className="hidden md:flex w-12 bg-[#111620] border-r border-[#21262d] flex-col items-center py-2 space-y-1 select-none z-30 shrink-0 relative">
      {/* 1. Cursor / Selection */}
      <button
        title="Kursor / Pan (Esc)"
        onClick={() => {
          onSelectTool('cursor')
          setIsLineMenuOpen(false)
        }}
        className={`p-2.5 rounded-lg transition-all relative group ${
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

      {/* 2. TradingView Trend Line Tools Group with Flyout Popover */}
      <div ref={lineButtonRef} className="relative">
        <div
          className={`flex items-center rounded-lg transition-all group ${
            isLineToolActive
              ? 'bg-[#252d3d] text-[#f0b90b] shadow-inner font-bold'
              : 'text-slate-400 hover:text-white hover:bg-[#1a202c]'
          }`}
        >
          {/* Main button: Click to activate currently selected line tool */}
          <button
            title={`${currentLineToolItem.label} (Klik panah untuk menu garis)`}
            onClick={() => {
              onSelectTool(selectedLineTool)
            }}
            className="p-2.5 pr-1 relative"
          >
            {currentLineToolItem.icon}
          </button>

          {/* Popover toggle arrow (▸) */}
          <button
            title="Buka Menu Garis TradingView (Lines, Channels, Pitchforks)"
            onClick={(e) => {
              e.stopPropagation()
              setIsLineMenuOpen((prev) => !prev)
            }}
            className="p-1 pr-1.5 hover:text-[#f0b90b] transition-colors"
          >
            <ChevronRight className={`w-3 h-3 transition-transform duration-200 ${isLineMenuOpen ? 'rotate-90 text-[#f0b90b]' : 'opacity-70 group-hover:opacity-100'}`} />
          </button>
        </div>

        {/* TradingView Flyout Menu Dropdown */}
        {isLineMenuOpen && (
          <div
            ref={flyoutRef}
            className="absolute left-14 top-0 w-64 bg-[#1e222d] border border-[#2a2e39] rounded-lg shadow-2xl py-1 text-[13px] font-sans text-slate-200 select-none backdrop-blur-md max-h-[85vh] overflow-y-auto custom-scrollbar z-50"
            style={{
              boxShadow: '0 20px 40px -10px rgba(0,0,0,0.8), 0 0 15px rgba(0,0,0,0.5)'
            }}
          >
            {LINE_TOOL_SECTIONS.map((section, sIdx) => (
              <div key={section.title} className={sIdx > 0 ? 'mt-1 pt-1 border-t border-[#2a2e39]' : ''}>
                {/* Section Header */}
                <div className="px-3 py-1.5 text-[10px] font-bold tracking-wider text-slate-400 uppercase bg-[#161a25]/40">
                  {section.title}
                </div>

                {/* Section Items */}
                <div className="py-0.5">
                  {section.items.map((item) => {
                    const isSelected = activeTool === item.type
                    const isFav = favorites.includes(item.type)

                    return (
                      <div
                        key={item.type}
                        onClick={() => {
                          setSelectedLineTool(item.type)
                          onSelectTool(item.type)
                          setIsLineMenuOpen(false)
                        }}
                        className={`px-3 py-1.5 flex items-center justify-between cursor-pointer transition-colors group ${
                          isSelected
                            ? 'bg-[#2a2e39] text-[#f0b90b] font-semibold'
                            : 'hover:bg-[#2a2e39]/80 hover:text-white'
                        }`}
                      >
                        {/* Left: Icon & Label */}
                        <div className="flex items-center space-x-2.5 min-w-0">
                          <span className={`shrink-0 ${isSelected ? 'text-[#f0b90b]' : 'text-slate-400 group-hover:text-slate-200'}`}>
                            {item.icon}
                          </span>
                          <span className="truncate">{item.label}</span>
                        </div>

                        {/* Right: Shortcut badge, Info, Favorite star */}
                        <div className="flex items-center space-x-1.5 shrink-0 ml-2">
                          {item.shortcut && (
                            <span className="text-[10px] font-mono text-slate-400 px-1.5 py-0.5 rounded bg-[#161a25] border border-[#2a2e39]">
                              {item.shortcut}
                            </span>
                          )}
                          <span
                            title={`Info ${item.label}`}
                            className="text-slate-500 hover:text-slate-300 transition-colors cursor-help p-0.5"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <HelpCircle className="w-3 h-3" />
                          </span>
                          <span
                            title={isFav ? 'Hapus dari favorit' : 'Tambah ke favorit'}
                            className={`p-0.5 transition-colors ${
                              isFav
                                ? 'text-amber-400 fill-amber-400'
                                : 'text-slate-500 hover:text-amber-300 opacity-40 group-hover:opacity-100'
                            }`}
                            onClick={(e) => toggleFavorite(item.type, e)}
                          >
                            <Star className={`w-3.5 h-3.5 ${isFav ? 'fill-amber-400 text-amber-400' : ''}`} />
                          </span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 3. Rectangle Box */}
      <button
        title="Kotak / Zona Rectangle"
        onClick={() => {
          onSelectTool('rectangle')
          setIsLineMenuOpen(false)
        }}
        className={`p-2.5 rounded-lg transition-all relative group ${
          activeTool === 'rectangle'
            ? 'bg-[#252d3d] text-[#f0b90b] shadow-inner font-bold'
            : 'text-slate-400 hover:text-white hover:bg-[#1a202c]'
        }`}
      >
        <Square className="w-4 h-4" />
        <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-[#1f242c] text-white text-xs px-2.5 py-1 rounded shadow-lg border border-[#30363d] whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
          Kotak / Zona Rectangle
        </div>
      </button>

      {/* 4. Fibonacci Retracement */}
      <button
        title="Fibonacci Retracement"
        onClick={() => {
          onSelectTool('fibonacci')
          setIsLineMenuOpen(false)
        }}
        className={`p-2.5 rounded-lg transition-all relative group ${
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

      {/* 5. Ruler / Measure */}
      <button
        title="Penggaris (Ruler / Measure)"
        onClick={() => {
          onSelectTool('measure')
          setIsLineMenuOpen(false)
        }}
        className={`p-2.5 rounded-lg transition-all relative group ${
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

      {/* 6. Eraser */}
      <button
        title="Penghapus Objek Gambar (Klik objek untuk hapus)"
        onClick={() => {
          onSelectTool('eraser')
          setIsLineMenuOpen(false)
        }}
        className={`p-2.5 rounded-lg transition-all relative group ${
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

      <div className="w-6 border-b border-[#21262d] my-2" />

      {/* 7. Clear All Drawings */}
      <button
        title={`Hapus Semua Gambar Manual (${drawingCount})`}
        onClick={onClearAll}
        disabled={drawingCount === 0}
        className="p-2.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 transition-all disabled:opacity-30 relative group"
      >
        <Trash2 className="w-4 h-4" />
        <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-[#1f242c] text-white text-xs px-2.5 py-1 rounded shadow-lg border border-[#30363d] whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
          Hapus Semua Gambar ({drawingCount})
        </div>
      </button>
    </div>
  )
}
