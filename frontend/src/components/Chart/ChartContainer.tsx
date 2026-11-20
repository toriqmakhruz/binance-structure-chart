import React, { useState, useEffect, useMemo, useRef } from 'react'
import { Crosshair, Layers } from 'lucide-react'
import { LightweightChart } from './LightweightChart'
import { PaneLayerDropdown } from './PaneLayerDropdown'
import { fetchAnalysis, defaultAppSettings } from '../../services/api'
import { BinanceWsClient } from '../../services/binanceWs'
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
  FundingRateData,
  AutoFibSettings,
  VolumeProfileSettings,
  OrderflowSettings
} from '../../types/analysis'

interface SubChartProps {
  symbol: string
  timeframe: string
  chartId?: string
  syncCrosshair?: boolean
  primaryForecast?: ForecastResult
  livePrice?: number
  syncSetup?: boolean
  market: 'spot' | 'futures'
  settings?: AppSettings
  visibility: LayerVisibility
  autoFibSettings?: AutoFibSettings
  vpvrSettings?: VolumeProfileSettings
  orderflowSettings?: OrderflowSettings
  activeTool: DrawingToolType
  onSelectTool?: (tool: DrawingToolType) => void
  drawings: DrawingItem[]
  onAddDrawing: (d: DrawingItem) => void
  onUpdateDrawing?: (d: DrawingItem) => void
  onUndoDrawing?: () => void
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
  livePrice,
  syncSetup = true,
  market,
  settings,
  visibility,
  autoFibSettings,
  vpvrSettings,
  orderflowSettings,
  activeTool,
  onSelectTool,
  drawings,
  onAddDrawing,
  onUpdateDrawing,
  onUndoDrawing,
  onRemoveDrawing,
  openInterest,
  fundingRate,
  onToggleLayer
}) => {
  const [data, setData] = useState<FullAnalysisResponse | null>(null)
  const [subCandles, setSubCandles] = useState<Candle[]>([])
  const [loading, setLoading] = useState(true)
  const settingsRef = useRef<AppSettings | undefined>(settings)

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  // 1. Initial & reactive analysis fetch
  useEffect(() => {
    let cancelled = false
    setLoading((prev) => (subCandles.length === 0 ? true : prev))

    fetchAnalysis(symbol, timeframe, market, settings || defaultAppSettings)
      .then((res) => {
        if (!cancelled) {
          setData(res)
          setSubCandles(res.candles || [])
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

  // 2. Dedicated Real-Time WebSocket Stream for this Pane's Timeframe
  useEffect(() => {
    const wsClient = new BinanceWsClient(symbol, timeframe, market, {
      onCandle: (liveCandle, isClosed, candleSym) => {
        if (candleSym.toUpperCase() !== symbol.toUpperCase()) return

        setSubCandles((prev) => {
          if (prev.length === 0) return prev
          const last = prev[prev.length - 1]
          if (last.time === liveCandle.time) {
            const updated = [...prev]
            updated[updated.length - 1] = liveCandle
            return updated
          } else if (liveCandle.time > last.time) {
            return [...prev.slice(1), liveCandle]
          }
          return prev
        })

        // Silent background re-analysis when candle closes on this timeframe
        if (isClosed) {
          fetchAnalysis(symbol, timeframe, market, settingsRef.current || defaultAppSettings)
            .then((res) => {
              setData(res)
              setSubCandles(res.candles || [])
            })
            .catch(() => {})
        }
      }
    })

    wsClient.connect()
    return () => {
      wsClient.disconnect()
    }
  }, [symbol, timeframe, market])

  // 3. Instant Zero-Lag Tick Sync from Primary Chart's Live Price
  useEffect(() => {
    if (typeof livePrice !== 'number' || !Number.isFinite(livePrice) || livePrice <= 0) return
    setSubCandles((prev) => {
      if (prev.length === 0) return prev
      const last = prev[prev.length - 1]
      if (last.close === livePrice) return prev
      const updated = [...prev]
      updated[updated.length - 1] = {
        ...last,
        close: livePrice,
        high: Math.max(last.high, livePrice),
        low: Math.min(last.low, livePrice)
      }
      return updated
    })
  }, [livePrice])

  // Synchronize trade setup box: Avoid conflicting signals (e.g. 5m SHORT vs 15m LONG) on the same coin
  const effectiveForecast = useMemo(() => {
    if (syncSetup && primaryForecast && primaryForecast.scenarios) {
      const validPrimaryScenarios = primaryForecast.scenarios.filter(
        (s) =>
          (s.is_valid === true && (s.risk_reward_ratio || 0) >= 1.5 && s.status === 'VALID_ENTRY') ||
          s.name?.includes('[TERKUNCI]') ||
          s.id?.startsWith('locked_') ||
          s.id?.startsWith('radar_')
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
      candles={subCandles}
      smc={data.smc}
      patterns={data.patterns}
      forecast={effectiveForecast}
      htfOverlay={data.htf_overlay}
      visibility={visibility}
      autoFibSettings={autoFibSettings}
      vpvrSettings={vpvrSettings}
      orderflowSettings={orderflowSettings}
      activeTool={activeTool}
      onSelectTool={onSelectTool}
      drawings={drawings}
      onAddDrawing={onAddDrawing}
      onUpdateDrawing={onUpdateDrawing}
      onUndoDrawing={onUndoDrawing}
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
  paneVisibility?: Record<string, LayerVisibility>
  autoFibSettings?: AutoFibSettings
  onOpenAutoFibSettings?: () => void
  vpvrSettings?: VolumeProfileSettings
  onOpenVpvrSettings?: () => void
  orderflowSettings?: OrderflowSettings
  onOpenOrderflowSettings?: (tab: 'liquidation' | 'cvd') => void
  onTogglePaneLayer?: (paneId: string, key: keyof LayerVisibility) => void
  onSetAllPaneLayers?: (paneId: string, enabled: boolean) => void
  activePaneId?: string
  onSelectPane?: (paneId: string) => void
  activeTool: DrawingToolType
  onSelectTool?: (tool: DrawingToolType) => void
  drawings: DrawingItem[]
  onAddDrawing: (d: DrawingItem) => void
  onUpdateDrawing?: (d: DrawingItem) => void
  onUndoDrawing?: () => void
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
  paneVisibility,
  autoFibSettings,
  onOpenAutoFibSettings,
  vpvrSettings,
  onOpenVpvrSettings,
  orderflowSettings,
  onOpenOrderflowSettings,
  onTogglePaneLayer,
  onSetAllPaneLayers,
  activePaneId = 'chart-1',
  onSelectPane,
  activeTool,
  onSelectTool,
  drawings,
  onAddDrawing,
  onUpdateDrawing,
  onUndoDrawing,
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

    const paneVis =
      (paneVisibility &&
        (paneVisibility[chartId] ||
          (chartId === 'chart-main' ? paneVisibility['chart-1'] : undefined))) ||
      visibility

    const paneTitle =
      chartId === 'chart-1' || chartId === 'chart-main'
        ? 'PANE 1'
        : chartId === 'chart-2'
          ? 'PANE 2'
          : chartId === 'chart-3'
            ? 'PANE 3'
            : 'PANE 4'

    const isActive = activePaneId === chartId || (chartId === 'chart-main' && activePaneId === 'chart-1')

    return (
      <div
        key={chartId}
        onClick={() => onSelectPane && onSelectPane(chartId === 'chart-main' ? 'chart-1' : chartId)}
        className={`relative w-full h-full bg-[#0b0e14] border transition-all overflow-hidden flex flex-col ${
          layout !== 'single' && isActive
            ? 'border-amber-500/60 shadow-sm shadow-amber-950/20 ring-1 ring-amber-500/30'
            : 'border-[#21262d]'
        }`}
      >
        {/* Interactive Chart Header (Dibuat Ringkes, Rapi & Kompak) */}
        <div className="h-7 sm:h-8 bg-[#161b22] px-2 flex items-center justify-between text-[10px] sm:text-[11px] font-mono border-b border-[#21262d] z-20 shrink-0 select-none whitespace-nowrap gap-1.5">
          {/* Left: Pane Badge (Hanya jika multi-chart) + Symbol + Layers Dropdown */}
          <div className="flex items-center space-x-1.5 min-w-0 shrink">
            {layout !== 'single' && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onSelectPane && onSelectPane(chartId)
                }}
                className={`text-[9.5px] font-black px-1.5 py-0.5 rounded border transition-colors shrink-0 ${
                  isActive
                    ? 'bg-amber-500 text-black border-amber-400 shadow-sm'
                    : 'bg-[#252d3d] text-[#f0b90b] border-amber-500/30 hover:border-amber-400'
                }`}
                title={`Fokus ke ${paneTitle}`}
              >
                P{chartId.replace(/[^0-9]/g, '') || (chartId === 'chart-main' ? '1' : '1')}
              </button>
            )}
            <span className="font-extrabold text-white tracking-wider text-[11px] shrink-0">
              {symbol}
            </span>

            {/* Dedicated Per-Pane Independent Layer Toggles */}
            <PaneLayerDropdown
              paneTitle={paneTitle}
              chartId={chartId}
              visibility={paneVis}
              onToggleLayer={(key) => {
                if (onTogglePaneLayer) {
                  onTogglePaneLayer(chartId === 'chart-main' ? 'chart-1' : chartId, key)
                } else if (onToggleLayer) {
                  onToggleLayer(key)
                }
              }}
              onSetAllLayers={(enabled) => {
                if (onSetAllPaneLayers) {
                  onSetAllPaneLayers(chartId === 'chart-main' ? 'chart-1' : chartId, enabled)
                }
              }}
              market={market}
              hasHtf={Boolean(htfOverlay)}
              onOpenAutoFibSettings={onOpenAutoFibSettings}
              onOpenVpvrSettings={onOpenVpvrSettings}
              onOpenOrderflowSettings={onOpenOrderflowSettings}
            />
          </div>

          {/* Right: Sync Toggles (Hanya jika multi-chart) + Timeframe Dropdown */}
          <div className="flex items-center space-x-1 sm:space-x-1.5 shrink-0">
            {layout !== 'single' && onToggleSyncCrosshair && (
              <button
                type="button"
                onClick={onToggleSyncCrosshair}
                title={
                  syncCrosshair
                    ? 'Sinkronisasi Kursor: AKTIF (Kursor bergerak serempak di semua chart)'
                    : 'Sinkronisasi Kursor: NONAKTIF (Kursor independen)'
                }
                className={`p-1 rounded border transition-all shrink-0 ${
                  syncCrosshair
                    ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-sm'
                    : 'bg-[#0b0e14] text-slate-500 hover:text-slate-300 border-[#21262d]'
                }`}
              >
                <Crosshair className={`w-3.5 h-3.5 ${syncCrosshair ? 'text-cyan-400' : 'text-slate-500'}`} />
              </button>
            )}

            {layout !== 'single' && onToggleSyncSetup && (
              <button
                type="button"
                onClick={onToggleSyncSetup}
                title={
                  syncSetup
                    ? 'Sinkronisasi Setup Box: AKTIF (Semua chart mengikuti setup yang sama)'
                    : 'Sinkronisasi Setup Box: NONAKTIF (Setup independen)'
                }
                className={`p-1 rounded border transition-all shrink-0 ${
                  syncSetup
                    ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 shadow-sm'
                    : 'bg-[#0b0e14] text-slate-500 hover:text-slate-300 border-[#21262d]'
                }`}
              >
                <Layers className={`w-3.5 h-3.5 ${syncSetup ? 'text-amber-400' : 'text-slate-500'}`} />
              </button>
            )}

            {/* Timeframe Select Dropdown (Ringkas, Rapi & Lengkap) */}
            <select
              value={effectiveTf.toLowerCase()}
              onChange={(e) => handlePaneTfChange(chartId, e.target.value)}
              className="bg-[#0b0e14] text-[#f0b90b] font-bold text-[10px] px-1.5 py-0.5 rounded border border-[#21262d] outline-none cursor-pointer hover:border-amber-500/50 shrink-0 font-mono"
              title={`Pilih Timeframe ${paneTitle}`}
            >
              {TIMEFRAMES.map((tf) => (
                <option key={tf} value={tf} className="bg-[#161b22] text-slate-200">
                  {tf.toUpperCase()}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex-1 w-full h-full relative">
          {isPrimary ? (
            <LightweightChart
              key={`${symbol}_${timeframe}_${market}_primary`}
              chartId={chartId}
              syncCrosshair={syncCrosshair}
              symbol={symbol}
              timeframe={timeframe}
              candles={candles}
              smc={smc}
              patterns={patterns}
              forecast={forecast}
              htfOverlay={htfOverlay}
              visibility={paneVis}
              autoFibSettings={autoFibSettings}
              vpvrSettings={vpvrSettings}
              orderflowSettings={orderflowSettings}
              activeTool={activeTool}
              onSelectTool={onSelectTool}
              drawings={drawings}
              onAddDrawing={onAddDrawing}
              onUpdateDrawing={onUpdateDrawing}
              onUndoDrawing={onUndoDrawing}
              onRemoveDrawing={onRemoveDrawing}
              openInterest={openInterest}
              fundingRate={fundingRate}
              market={market}
              onToggleLayer={(key) => {
                if (onTogglePaneLayer) {
                  onTogglePaneLayer(chartId === 'chart-main' ? 'chart-1' : chartId, key)
                } else if (onToggleLayer) {
                  onToggleLayer(key)
                }
              }}
            />
          ) : (
            <SubTimeframeChart
              key={`${symbol}_${effectiveTf}_${market}_${chartId}`}
              chartId={chartId}
              syncCrosshair={syncCrosshair}
              primaryForecast={forecast}
              livePrice={candles.length > 0 ? candles[candles.length - 1].close : undefined}
              syncSetup={syncSetup}
              symbol={symbol}
              timeframe={effectiveTf}
              market={market}
              settings={settings}
              visibility={paneVis}
              autoFibSettings={autoFibSettings}
              vpvrSettings={vpvrSettings}
              orderflowSettings={orderflowSettings}
              activeTool={activeTool}
              onSelectTool={onSelectTool}
              drawings={drawings}
              onAddDrawing={onAddDrawing}
              onUpdateDrawing={onUpdateDrawing}
              onUndoDrawing={onUndoDrawing}
              onRemoveDrawing={onRemoveDrawing}
              openInterest={openInterest}
              fundingRate={fundingRate}
              onToggleLayer={(key) => {
                if (onTogglePaneLayer) {
                  onTogglePaneLayer(chartId, key)
                } else if (onToggleLayer) {
                  onToggleLayer(key)
                }
              }}
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
