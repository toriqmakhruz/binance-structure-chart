import React, { useState, useEffect } from 'react'
import { LightweightChart } from './LightweightChart'
import { fetchAnalysis, defaultAppSettings } from '../../services/api'
import {
  Candle,
  SmcAnalysisResult,
  PatternAnalysisResult,
  ForecastResult,
  FullAnalysisResponse,
  LayerVisibility,
  DrawingToolType,
  DrawingItem,
  AppSettings
} from '../../types/analysis'

interface SubChartProps {
  symbol: string
  timeframe: string
  market: 'spot' | 'futures'
  settings?: AppSettings
  visibility: LayerVisibility
  activeTool: DrawingToolType
  drawings: DrawingItem[]
  onAddDrawing: (d: DrawingItem) => void
  onRemoveDrawing: (id: string) => void
}

const SubTimeframeChart: React.FC<SubChartProps> = ({
  symbol,
  timeframe,
  market,
  settings,
  visibility,
  activeTool,
  drawings,
  onAddDrawing,
  onRemoveDrawing
}) => {
  const [data, setData] = useState<FullAnalysisResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    fetchAnalysis(symbol, timeframe, market, settings || defaultAppSettings)
      .then((res) => {
        if (!cancelled) {
          setData(res)
          setLoading(false)
        }
      })
      .catch((err) => {
        console.error(`Failed to load MTF data for ${timeframe}:`, err)
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [symbol, timeframe, market, settings])

  if (loading || !data) {
    return (
      <div className="flex-1 w-full h-full flex flex-col items-center justify-center bg-[#0b0e14] text-slate-500 font-mono text-xs space-y-2">
        <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
        <span>Memuat data {timeframe.toUpperCase()}...</span>
      </div>
    )
  }

  return (
    <LightweightChart
      symbol={symbol}
      timeframe={timeframe}
      candles={data.candles}
      smc={data.smc}
      patterns={data.patterns}
      forecast={data.forecast}
      htfOverlay={data.htf_overlay}
      visibility={visibility}
      activeTool={activeTool}
      drawings={drawings}
      onAddDrawing={onAddDrawing}
      onRemoveDrawing={onRemoveDrawing}
    />
  )
}

interface ChartContainerProps {
  symbol: string
  timeframe: string
  market?: 'spot' | 'futures'
  settings?: AppSettings
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
  market = 'futures',
  settings,
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
  const renderChart = (chartId: string, subTf?: string) => {
    const isSub = Boolean(subTf && subTf.toLowerCase() !== timeframe.toLowerCase())
    const effectiveTf = subTf || timeframe

    return (
      <div key={chartId} className="relative w-full h-full bg-[#0b0e14] border border-[#21262d] overflow-hidden flex flex-col">
        {/* Chart Header for multi-chart view */}
        {layout !== 'single' && (
          <div className="h-6 bg-[#161b22] px-3 flex items-center justify-between text-[11px] font-mono border-b border-[#21262d] z-20">
            <span className="font-bold text-white">{symbol}</span>
            <span className="text-[#f0b90b] font-bold">{effectiveTf.toUpperCase()}</span>
          </div>
        )}
        <div className="flex-1 w-full h-full relative">
          {isSub ? (
            <SubTimeframeChart
              key={`${symbol}_${effectiveTf}`}
              symbol={symbol}
              timeframe={effectiveTf}
              market={market}
              settings={settings}
              visibility={visibility}
              activeTool={activeTool}
              drawings={drawings}
              onAddDrawing={onAddDrawing}
              onRemoveDrawing={onRemoveDrawing}
            />
          ) : (
            <LightweightChart
              key={`${symbol}_${timeframe}`}
              symbol={symbol}
              timeframe={timeframe}
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
          )}
        </div>
      </div>
    )
  }

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
