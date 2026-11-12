import React from 'react'
import {
  MousePointer,
  TrendingUp,
  Minus,
  Square,
  Percent,
  Ruler,
  Trash2,
  Eraser
} from 'lucide-react'
import { DrawingToolType } from '../../types/analysis'

interface DrawingToolbarProps {
  activeTool: DrawingToolType
  onSelectTool: (tool: DrawingToolType) => void
  onClearAll: () => void
  drawingCount: number
}

export const DrawingToolbar: React.FC<DrawingToolbarProps> = ({
  activeTool,
  onSelectTool,
  onClearAll,
  drawingCount
}) => {
  const tools: { type: DrawingToolType; label: string; icon: React.ReactNode }[] = [
    { type: 'cursor', label: 'Kursor / Pan', icon: <MousePointer className="w-4 h-4" /> },
    { type: 'trendline', label: 'Garis Tren (Trendline)', icon: <TrendingUp className="w-4 h-4" /> },
    { type: 'horizontal_line', label: 'Garis Horizontal / Ray', icon: <Minus className="w-4 h-4" /> },
    { type: 'rectangle', label: 'Kotak / Zona Retangle', icon: <Square className="w-4 h-4" /> },
    { type: 'fibonacci', label: 'Fibonacci Retracement', icon: <Percent className="w-4 h-4" /> },
    { type: 'measure', label: 'Penggaris (Ruler / Measure)', icon: <Ruler className="w-4 h-4" /> },
    { type: 'eraser', label: 'Penghapus (Klik objek gambar)', icon: <Eraser className="w-4 h-4" /> },
  ]

  return (
    <div className="w-12 bg-[#111620] border-r border-[#21262d] flex flex-col items-center py-2 space-y-1 select-none z-20">
      {tools.map((t) => {
        const isActive = activeTool === t.type
        return (
          <button
            key={t.type}
            title={t.label}
            onClick={() => onSelectTool(t.type)}
            className={`p-2.5 rounded-lg transition-all relative group ${
              isActive
                ? 'bg-[#252d3d] text-[#f0b90b] shadow-inner font-bold'
                : 'text-slate-400 hover:text-white hover:bg-[#1a202c]'
            }`}
          >
            {t.icon}
            {/* Tooltip */}
            <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-[#1f242c] text-white text-xs px-2.5 py-1 rounded shadow-lg border border-[#30363d] whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50">
              {t.label}
            </div>
          </button>
        )
      })}

      <div className="w-6 border-b border-[#21262d] my-2" />

      {/* Clear All Drawings */}
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
