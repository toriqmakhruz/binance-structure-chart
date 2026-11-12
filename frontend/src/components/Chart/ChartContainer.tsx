import React from 'react'
import { LightweightChart } from './LightweightChart'
import {
  Candle,
  SmcAnalysisResult,
  PatternAnalysisResult,
  ForecastResult,
  LayerVisibility,
  DrawingToolType,
  DrawingItem
} from '../../types/analysis'

interface ChartContainerProps {
  symbol: string
  timeframe: string
  layout: 'single' | 'split-vertical' | 'split-horizontal' | 'grid-4'
  candles: Candle[]
  smc?: SmcAnalysisResult
  patterns?: PatternAnalysisResult
  forecast?: ForecastResult
  htfOverlay?: any
  visibility: LayerVisibility
  activeTool: DrawingToolType
  drawings: DrawingItem[]
  onAddDrawing: (d: DrawingItem) => void
  onRemoveDrawing: (id: string) => void
}

export const ChartContainer: React.FC<ChartContainerProps> = ({
  symbol,
  timeframe,
  layout,
  candles,
  smc,
  patterns,
  forecast,
  htfOverlay,
  visibility,
  activeTool,
  drawings,
  onAddDrawing,
  onRemoveDrawing
}) => {
  const renderChart = (chartId: string, subTf?: string) => (
    <div key={chartId} className="relative w-full h-full bg-[#0b0e14] border border-[#21262d] overflow-hidden flex flex-col">
      {/* Chart Mini-Header for multi-chart view */}
      {layout !== 'single' && (
        <div className="h-6 bg-[#161b22] px-3 flex items-center justify-between text-[11px] font-mono border-b border-[#21262d] z-20">
          <span className="font-bold text-white">{symbol}</span>
          <span className="text-[#f0b90b] font-bold">{subTf || timeframe.toUpperCase()}</span>
        </div>
      )}
      <div className="flex-1 w-full h-full relative">
        <LightweightChart
          symbol={symbol}
          timeframe={subTf || timeframe}
          candles={candles}
          smc={smc}
          patterns={patterns}
          forecast={forecast}
          htfOverlay={htfOverlay}
          visibility={visibility}
          activeTool={activeTool}
          drawings={drawings}
          onAddDrawing={onAddDrawing}
          onRemoveDrawing={onRemoveDrawing}
        />
      </div>
    </div>
  )

  if (layout === 'split-vertical') {
    return (
      <div className="grid grid-cols-2 w-full h-full gap-1 p-1 bg-[#111620]">
        {renderChart('chart-1')}
        {renderChart('chart-2', '1h')}
      </div>
    )
  }

  if (layout === 'split-horizontal') {
    return (
      <div className="grid grid-rows-2 w-full h-full gap-1 p-1 bg-[#111620]">
        {renderChart('chart-1')}
        {renderChart('chart-2', '4h')}
      </div>
    )
  }

  if (layout === 'grid-4') {
    return (
      <div className="grid grid-cols-2 grid-rows-2 w-full h-full gap-1 p-1 bg-[#111620]">
        {renderChart('chart-1', '5m')}
        {renderChart('chart-2', '15m')}
        {renderChart('chart-3', '1h')}
        {renderChart('chart-4', '4h')}
      </div>
    )
  }

  // Single default layout
  return (
    <div className="w-full h-full p-1 bg-[#111620]">
      {renderChart('chart-main')}
    </div>
  )
}
