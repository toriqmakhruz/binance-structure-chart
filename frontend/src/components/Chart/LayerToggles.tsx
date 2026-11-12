import React from 'react'
import { LayerVisibility } from '../../types/analysis'
import { 
  GitCommit, 
  Boxes, 
  Layers, 
  Shapes, 
  Split, 
  Compass, 
  BarChart2, 
  Clock,
  Target,
  Minus
} from 'lucide-react'

interface LayerTogglesProps {
  visibility: LayerVisibility
  onToggle: (key: keyof LayerVisibility) => void
  hasHtf: boolean
}

export const LayerToggles: React.FC<LayerTogglesProps> = ({
  visibility,
  onToggle,
  hasHtf
}) => {
  const toggles: { key: keyof LayerVisibility; label: string; icon: React.ReactNode; color: string }[] = [
    { key: 'smcEvents', label: 'BOS / CHoCH', icon: <Split className="w-3.5 h-3.5" />, color: 'text-amber-400' },
    { key: 'orderBlocks', label: 'Order Blocks (OB)', icon: <Boxes className="w-3.5 h-3.5" />, color: 'text-indigo-400' },
    { key: 'fvgs', label: 'Fair Value Gaps (FVG)', icon: <Layers className="w-3.5 h-3.5" />, color: 'text-cyan-400' },
    { key: 'smcSwings', label: 'Swings (HH/LL)', icon: <GitCommit className="w-3.5 h-3.5" />, color: 'text-purple-400' },
    { key: 'patterns', label: 'Pola Chart', icon: <Shapes className="w-3.5 h-3.5" />, color: 'text-emerald-400' },
    { key: 'srLevels', label: 'S/R Levels', icon: <Minus className="w-3.5 h-3.5" />, color: 'text-teal-400' },
    { key: 'forecastCone', label: 'Forecast Cone', icon: <Compass className="w-3.5 h-3.5" />, color: 'text-yellow-400' },
    { key: 'forecastScenarios', label: 'Target Skenario', icon: <Compass className="w-3.5 h-3.5" />, color: 'text-orange-400' },
    { key: 'entryBoxes', label: 'Box Area Entry', icon: <Target className="w-3.5 h-3.5" />, color: 'text-emerald-400' },
    { key: 'volume', label: 'Volume Delta', icon: <BarChart2 className="w-3.5 h-3.5" />, color: 'text-blue-400' },
  ]

  return (
    <div className="h-9 bg-[#111620]/90 backdrop-blur border-b border-[#21262d] flex items-center px-3 space-x-1 overflow-x-auto select-none text-xs">
      <span className="text-slate-500 font-semibold text-[11px] uppercase mr-1 tracking-wider">
        LAYERS:
      </span>
      {toggles.map((t) => {
        const isVisible = visibility[t.key]
        return (
          <button
            key={t.key}
            onClick={() => onToggle(t.key)}
            className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md transition-all font-medium whitespace-nowrap ${
              isVisible
                ? 'bg-[#1e2533] text-white border border-[#3b455b] shadow-sm'
                : 'text-slate-500 hover:text-slate-300 hover:bg-[#161b22] border border-transparent'
            }`}
          >
            <span className={isVisible ? t.color : 'text-slate-500'}>{t.icon}</span>
            <span>{t.label}</span>
          </button>
        )
      })}

      {hasHtf && (
        <button
          onClick={() => onToggle('htfOverlay')}
          className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md transition-all font-medium whitespace-nowrap ${
            visibility.htfOverlay
              ? 'bg-amber-950/50 text-amber-300 border border-amber-700/60 shadow-sm'
              : 'text-slate-500 hover:text-slate-300 hover:bg-[#161b22] border border-transparent'
          }`}
        >
          <Clock className="w-3.5 h-3.5 text-amber-400" />
          <span>MTF Overlay (HTF)</span>
        </button>
      )}
    </div>
  )
}
