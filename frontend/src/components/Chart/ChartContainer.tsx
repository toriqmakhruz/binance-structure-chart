import React, { useState, useEffect, useMemo } from 'react'
import { Crosshair, Layers } from 'lucide-react'
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
  AppSettings,
  OpenInterestData,
  FundingRateData
} from '../../types/analysis'

interface SubChartProps {
  symbol: string
  timeframe: string
  chartId?: string
  syncCrosshair?: boolean
  primaryForecast?: ForecastResult
  syncSetup?: boolean
  market: 'spot' | 'futures'
  settings?: AppSettings
  visibility: LayerVisibility
  activeTool: DrawingToolType
  drawings: DrawingItem[]
  onAddDrawing: (d: DrawingItem) => void
  onRemoveDrawing: (id: string) => void
  openInterest?: OpenInterestData | null
  fundingRate?: FundingRateData | null
  onToggleLayer?: (key: keyof LayerVisibility) => void
}

const SubTimeframeChart: React.FC<SubChartProps> = ({
  symbol,
  timeframe,
  chartId,
  syncCrosshair,
  primaryForecast,
  syncSetup = true,
  market,
  settings,
  visibility,
  activeTool,
  drawings,
  onAddDrawing,
  onRemoveDrawing,
  openInterest,
  fundingRate,
  onToggleLayer
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

  // Synchronize trade setup box: Avoid conflicting signals (e.g. 5m SHORT vs 15m LONG) on the same coin
  const effectiveForecast = useMemo(() => {
    if (syncSetup && primaryForecast && primaryForecast.scenarios) {
      const validPrimaryScenarios = primaryForecast.scenarios.filter(
        (s) =>
          (s.is_valid === true && (s.risk_reward_ratio || 0) >= 1.5 && s.status === 'VALID_ENTRY') ||
          s.name?.includes('[TERKUNCI]') ||
          s.id?.startsWith('locked_')
      )

      if (validPrimaryScenarios.length > 0) {
        return {
          ...(data?.forecast || primaryForecast),
          scenarios: validPrimaryScenarios,
          predicted_trend: primaryForecast.predicted_trend,
          confluence_score: primaryForecast.confluence_score,
          structural_target: primaryForecast.structural_target
        }
      }

      // If primary chart has no valid active setup, do not show contradictory local setup
      return undefined
    }

    // If syncSetup is turned off, show local timeframe's independent scan
    return data?.forecast
  }, [syncSetup, primaryForecast, data?.forecast])

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
      chartId={chartId}
      syncCrosshair={syncCrosshair}
      candles={data.candles}
      smc={data.smc}
      patterns={data.patterns}
      forecast={effectiveForecast}
      htfOverlay={data.htf_overlay}
      visibility={visibility}
      activeTool={activeTool}
      drawings={drawings}
      onAddDrawing={onAddDrawing}
      onRemoveDrawing={onRemoveDrawing}
      openInterest={data?.open_interest || openInterest}
      fundingRate={data?.funding_rate || fundingRate}
      market={market}
      onToggleLayer={onToggleLayer}
    />
  )
}

interface ChartContainerProps {
  symbol: string
  timeframe: string
  market?: 'spot' | 'futures'
  settings?: AppSettings
  layout: 'single' | 'split-vertical' | 'split-horizontal' | 'grid-4'
  syncCrosshair?: boolean
  onToggleSyncCrosshair?: () => void
  syncSetup?: boolean
  onToggleSyncSetup?: () => void
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
  openInterest?: OpenInterestData | null
  fundingRate?: FundingRateData | null
  onToggleLayer?: (key: keyof LayerVisibility) => void
  onTimeframeChange?: (tf: string) => void
}

const TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d']

const DEFAULT_PANE_TFS: Record<string, string> = {
  'chart-1': '5m',
  'chart-2': '15m',
  'chart-3': '1h',
  'chart-4': '4h'
}

export const ChartContainer: React.FC<ChartContainerProps> = ({
  symbol,
  timeframe,
  market = 'futures',
  settings,
  layout,
  syncCrosshair = true,
  onToggleSyncCrosshair,
  syncSetup = true,
  onToggleSyncSetup,
  candles,
  smc,
  patterns,
  forecast,
  htfOverlay,
  visibility,
  activeTool,
  drawings,
  onAddDrawing,
  onRemoveDrawing,
  openInterest,
  fundingRate,
  onToggleLayer,
  onTimeframeChange
}) => {
  const [paneTfs, setPaneTfs] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem('cp_multi_chart_tfs')
      if (saved) {
        return { ...DEFAULT_PANE_TFS, ...JSON.parse(saved) }
      }
    } catch {}
    return DEFAULT_PANE_TFS
  })

  const handlePaneTfChange = (chartId: string, newTf: string) => {
    if (chartId === 'chart-1' && onTimeframeChange) {
      onTimeframeChange(newTf)
    }
    setPaneTfs((prev) => {
      const next = { ...prev, [chartId]: newTf }
      try {
        localStorage.setItem('cp_multi_chart_tfs', JSON.stringify(next))
      } catch {}
      return next
    })
  }

  const renderChart = (chartId: string, effectiveTf: string) => {
    const isPrimary =
      (chartId === 'chart-1' || chartId === 'chart-main') &&
      effectiveTf.toLowerCase() === timeframe.toLowerCase()

    return (
      <div key={chartId} className="relative w-full h-full bg-[#0b0e14] border border-[#21262d] overflow-hidden flex flex-col">
        {/* Interactive Chart Header for multi-chart view */}
        {layout !== 'single' && (
          <div className="h-8 bg-[#161b22] px-2 md:px-3 flex items-center justify-between text-[11px] font-mono border-b border-[#21262d] z-20 shrink-0 select-none">
            <div className="flex items-center space-x-1.5 md:space-x-2">
              <span className="text-[10px] font-extrabold px-1.5 py-0.5 rounded bg-[#252d3d] text-[#f0b90b] border border-amber-500/30">
                {chartId === 'chart-1'
                  ? 'PANE 1'
                  : chartId === 'chart-2'
                    ? 'PANE 2'
                    : chartId === 'chart-3'
                      ? 'PANE 3'
                      : 'PANE 4'}
              </span>
              <span className="font-bold text-white tracking-wider">{symbol}</span>
              <span className="text-[#00c087] font-bold hidden sm:inline">[{effectiveTf.toUpperCase()}]</span>
            </div>

            {/* Timeframe selector & Crosshair/Setup Sync toggles for THIS pane */}
            <div className="flex items-center space-x-1 sm:space-x-1.5">
              {onToggleSyncCrosshair && (
                <button
                  type="button"
                  onClick={onToggleSyncCrosshair}
                  title={
                    syncCrosshair
                      ? 'Sinkronisasi Kursor: AKTIF (Kursor bergerak serempak di semua chart. Klik untuk mematikan)'
                      : 'Sinkronisasi Kursor: NONAKTIF (Klik untuk mengaktifkan)'
                  }
                  className={`flex items-center space-x-1 px-1.5 py-0.5 rounded border text-[10px] font-bold transition-all ${
                    syncCrosshair
                      ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40 shadow-sm'
                      : 'bg-[#0b0e14] text-slate-500 hover:text-slate-300 border-[#21262d]'
                  }`}
                >
                  <Crosshair className={`w-3 h-3 ${syncCrosshair ? 'text-cyan-400' : 'text-slate-500'}`} />
                  <span className="hidden xl:inline">{syncCrosshair ? 'Sync ON' : 'Sync OFF'}</span>
                </button>
              )}

              {onToggleSyncSetup && (
                <button
                  type="button"
                  onClick={onToggleSyncSetup}
                  title={
                    syncSetup
                      ? 'Sinkronisasi Setup Box: AKTIF (Semua chart mengikuti setup yang sama dari Pane 1. Klik untuk mode independen)'
                      : 'Sinkronisasi Setup Box: NONAKTIF (Tiap chart mencari setup sendiri. Klik untuk sinkronkan)'
                  }
                  className={`flex items-center space-x-1 px-1.5 py-0.5 rounded border text-[10px] font-bold transition-all ${
                    syncSetup
                      ? 'bg-amber-500/15 text-amber-300 border-amber-500/40 shadow-sm'
                      : 'bg-[#0b0e14] text-slate-500 hover:text-slate-300 border-[#21262d]'
                  }`}
                >
                  <Layers className={`w-3 h-3 ${syncSetup ? 'text-amber-400' : 'text-slate-500'}`} />
                  <span className="hidden xl:inline">{syncSetup ? 'Setup Sync ON' : 'Setup Sync OFF'}</span>
                </button>
              )}

              <div className="flex items-center space-x-0.5 bg-[#0b0e14] p-0.5 rounded border border-[#21262d]">
                {['1m', '5m', '15m', '1h', '4h'].map((tf) => (
                  <button
                    key={tf}
                    type="button"
                    onClick={() => handlePaneTfChange(chartId, tf)}
                    title={`Ubah ${chartId} ke timeframe ${tf.toUpperCase()}`}
                    className={`px-1.5 py-0.5 text-[10px] rounded font-bold transition-all ${
                      effectiveTf.toLowerCase() === tf.toLowerCase()
                        ? 'bg-[#f0b90b] text-black shadow-sm font-extrabold'
                        : 'text-slate-400 hover:text-white hover:bg-[#1f2636]'
                    }`}
                  >
                    {tf.toUpperCase()}
                  </button>
                ))}
              </div>
              <select
                value={effectiveTf.toLowerCase()}
                onChange={(e) => handlePaneTfChange(chartId, e.target.value)}
                className="bg-[#0b0e14] text-[#f0b90b] font-bold text-[10px] px-1.5 py-1 rounded border border-[#21262d] outline-none cursor-pointer hover:border-amber-500/50"
                title={`Pilih Timeframe ${chartId}`}
              >
                {TIMEFRAMES.map((tf) => (
                  <option key={tf} value={tf} className="bg-[#161b22] text-slate-200">
                    {tf.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        <div className="flex-1 w-full h-full relative">
          {isPrimary ? (
            <LightweightChart
              key={`${symbol}_${timeframe}_primary`}
              chartId={chartId}
              syncCrosshair={syncCrosshair}
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
              openInterest={openInterest}
              fundingRate={fundingRate}
              market={market}
              onToggleLayer={onToggleLayer}
            />
          ) : (
            <SubTimeframeChart
              key={`${symbol}_${effectiveTf}_${chartId}`}
              chartId={chartId}
              syncCrosshair={syncCrosshair}
              primaryForecast={forecast}
              syncSetup={syncSetup}
              symbol={symbol}
              timeframe={effectiveTf}
              market={market}
              settings={settings}
              visibility={visibility}
              activeTool={activeTool}
              drawings={drawings}
              onAddDrawing={onAddDrawing}
              onRemoveDrawing={onRemoveDrawing}
              openInterest={openInterest}
              fundingRate={fundingRate}
              onToggleLayer={onToggleLayer}
            />
          )}
        </div>
      </div>
    )
  }

  if (layout === 'split-vertical') {
    return (
      <div className="grid grid-cols-2 w-full h-full gap-1 p-1 bg-[#111620]">
        {renderChart('chart-1', timeframe)}
        {renderChart('chart-2', paneTfs['chart-2'] || '15m')}
      </div>
    )
  }

  if (layout === 'split-horizontal') {
    return (
      <div className="grid grid-rows-2 w-full h-full gap-1 p-1 bg-[#111620]">
        {renderChart('chart-1', timeframe)}
        {renderChart('chart-2', paneTfs['chart-2'] || '4h')}
      </div>
    )
  }

  if (layout === 'grid-4') {
    return (
      <div className="grid grid-cols-2 grid-rows-2 w-full h-full gap-1 p-1 bg-[#111620]">
        {renderChart('chart-1', timeframe)}
        {renderChart('chart-2', paneTfs['chart-2'] || '15m')}
        {renderChart('chart-3', paneTfs['chart-3'] || '1h')}
        {renderChart('chart-4', paneTfs['chart-4'] || '4h')}
      </div>
    )
  }

  // Single default layout
  return (
    <div className="w-full h-full p-1 bg-[#111620]">
      {renderChart('chart-main', timeframe)}
    </div>
  )
}
