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
  Check,
  Minus,
  Flame
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
}

interface LayerOption {
  key: keyof LayerVisibility
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
  onOpenOrderflowSettings
}) => {
  const [isOpen, setIsOpen] = useState(false)
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
    {
      key: 'entryBoxes',
      label: 'Box Area Entry',
      desc: 'Kotak Entry, Target TP, dan Stop Loss',
      icon: <Target className="w-3.5 h-3.5" />,
      color: 'text-emerald-400'
    },
    {
      key: 'orderBlocks',
      label: 'Order Blocks (OB)',
      desc: 'Area jejak akumulasi institusional',
      icon: <Boxes className="w-3.5 h-3.5" />,
      color: 'text-indigo-400'
    },
    {
      key: 'fvgs',
      label: 'Fair Value Gaps (FVG)',
      desc: 'Ketidakseimbangan likuiditas pasar',
      icon: <Layers className="w-3.5 h-3.5" />,
      color: 'text-cyan-400'
    },
    {
      key: 'smcEvents',
      label: 'BOS / CHoCH',
      desc: 'Break of Structure & Change of Character',
      icon: <Split className="w-3.5 h-3.5" />,
      color: 'text-amber-400'
    },
    {
      key: 'smcSwings',
      label: 'Swings (HH/LL)',
      desc: 'Struktur titik puncak & lembah swing',
      icon: <GitCommit className="w-3.5 h-3.5" />,
      color: 'text-purple-400'
    },
    {
      key: 'fibonacci',
      label: 'Auto Fib Retracement',
      desc: 'Auto Retracement OTE & Golden Ratio (Anti-Repaint)',
      icon: <SlidersHorizontal className="w-3.5 h-3.5" />,
      color: 'text-amber-400'
    },
    {
      key: 'volumeProfile',
      label: 'Volume Profile (VPVR)',
      desc: 'POC, VAH, VAL & Distribusi Volume 70% VA',
      icon: <BarChart2 className="w-3.5 h-3.5 rotate-90" />,
      color: 'text-cyan-400'
    },
    {
      key: 'liquidationHeatmap',
      label: 'Liquidation Heatmap (25x/50x/100x)',
      desc: 'Zona magnet likuidasi leverage Short & Long',
      icon: <Flame className="w-3.5 h-3.5" />,
      color: 'text-amber-400'
    },
    {
      key: 'cvdOrderflow',
      label: 'CVD & Orderflow Divergence',
      desc: 'Kurva Cumulative Volume Delta & Bull/Bear Div',
      icon: <Activity className="w-3.5 h-3.5" />,
      color: 'text-emerald-400'
    },
    {
      key: 'patterns',
      label: 'Pola Chart',
      desc: 'Double Top/Bottom, H&S, Triangles',
      icon: <Shapes className="w-3.5 h-3.5" />,
      color: 'text-emerald-400'
    },
    {
      key: 'srLevels',
      label: 'S/R Levels',
      desc: 'Support & Resistance dinamis',
      icon: <Minus className="w-3.5 h-3.5" />,
      color: 'text-teal-400'
    },
    {
      key: 'marketSessions',
      label: 'Sesi Pasar',
      desc: 'Asia, London, New York & Range H/L',
      icon: <Clock className="w-3.5 h-3.5" />,
      color: 'text-amber-400'
    },
    {
      key: 'forecastCone',
      label: 'Forecast Cone',
      desc: 'Kerucut deviasi volatilitas pasar (ATR)',
      icon: <Compass className="w-3.5 h-3.5" />,
      color: 'text-yellow-400'
    },
    {
      key: 'forecastScenarios',
      label: 'Target Skenario',
      desc: 'Garis proyeksi lintasan harga ke depan',
      icon: <Compass className="w-3.5 h-3.5" />,
      color: 'text-orange-400'
    },
    {
      key: 'volume',
      label: 'Volume Delta',
      desc: 'Tekanan Taker Buy vs Sell bar',
      icon: <BarChart2 className="w-3.5 h-3.5" />,
      color: 'text-blue-400'
    },
    ...(hasHtf
      ? [
          {
            key: 'htfOverlay' as keyof LayerVisibility,
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
            label: 'Open Interest (OI)',
            desc: 'Total kontrak aktif pasar Futures',
            icon: <Activity className="w-3.5 h-3.5" />,
            color: 'text-sky-400'
          },
          {
            key: 'fundingRate' as keyof LayerVisibility,
            label: 'Funding Rate',
            desc: 'Tarif pendanaan posisi Long vs Short',
            icon: <Percent className="w-3.5 h-3.5" />,
            color: 'text-purple-400'
          }
        ]
      : [])
  ]

  const activeCount = layerOptions.filter((opt) => visibility[opt.key]).length

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
        <span className="hidden md:inline">Layers</span>
        <span className="px-1 py-0.2 rounded bg-[#161b22] text-[#f0b90b] text-[8.5px] sm:text-[9px] font-mono shrink-0">
          {activeCount}
        </span>
        <ChevronDown
          className={`w-2.5 h-2.5 text-slate-400 transition-transform duration-150 hidden sm:inline shrink-0 ${
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
            className="fixed sm:absolute inset-x-3 sm:inset-x-auto sm:left-0 top-16 sm:top-full sm:mt-1.5 sm:w-72 max-h-[75vh] overflow-y-auto bg-[#0d1117] border border-[#30363d] rounded-xl shadow-2xl z-50 font-sans text-xs animate-in fade-in zoom-in-95 duration-100"
          >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-[#21262d] bg-[#161b22]">
            <div className="flex items-center space-x-1.5">
              <span className="w-2 h-2 rounded-full bg-[#f0b90b] animate-pulse" />
              <span className="font-extrabold text-[11px] text-[#f0b90b] tracking-wide font-mono">
                {paneTitle} LAYERS
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

          {/* List of layers */}
          <div className="max-h-72 overflow-y-auto divide-y divide-[#1e2430]/60 p-1 custom-scrollbar">
            {layerOptions.map((opt) => {
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
                      <span
                        className={`text-[11px] font-bold leading-tight truncate ${
                          isEnabled ? 'text-slate-100' : 'text-slate-500 line-through opacity-75'
                        }`}
                      >
                        {opt.label}
                      </span>
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
          <div className="px-3 py-1.5 bg-[#0b0e14] border-t border-[#21262d] text-[9.5px] text-slate-500 font-mono flex items-center justify-between">
            <span>Khusus {paneTitle}</span>
            <span className="text-amber-400 font-bold">{activeCount} Aktif</span>
          </div>
        </div>
        </>
      )}
    </div>
  )
}

