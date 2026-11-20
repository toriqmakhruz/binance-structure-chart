import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import {
  createChart,
  IChartApi,
  ISeriesApi,
  Time,
  SeriesMarker,
  ColorType,
  MouseEventParams,
  CrosshairMode
} from 'lightweight-charts'
import {
  Candle,
  SmcAnalysisResult,
  PatternAnalysisResult,
  ForecastResult,
  LayerVisibility,
  DrawingToolType,
  DrawingItem,
  OpenInterestData,
  FundingRateData,
  TrendStrengthMetrics
} from '../../types/analysis'
import { AutoFibSettings, DEFAULT_AUTO_FIB_SETTINGS } from '../../types/fibonacci'
import { VolumeProfileSettings, DEFAULT_VOLUME_PROFILE_SETTINGS } from '../../types/volumeProfile'
import { OrderflowSettings, DEFAULT_ORDERFLOW_SETTINGS } from '../../types/orderflow'
import { formatPrice, getPricePrecision, formatOpenInterestValue, formatOpenInterest } from '../../utils/formatters'
import { Crosshair, Clock, Trash2, Move, Palette, Check, X, Sliders } from 'lucide-react'
import { OpenInterestPane } from './OpenInterestPane'
import { FundingRatePane } from './FundingRatePane'
import {
  extractSessionLines,
  extractSessionZones,
  getCurrentActiveSessions,
  hexToRgba,
  MarketSessionSettings,
  DEFAULT_MARKET_SESSION_SETTINGS,
  ActiveSessionResult,
  SessionZoneBlock
} from '../../utils/marketSessions'

interface LightweightChartProps {
  symbol: string
  timeframe: string
  chartId?: string
  syncCrosshair?: boolean
  candles: Candle[]
  smc?: SmcAnalysisResult
  patterns?: PatternAnalysisResult
  forecast?: ForecastResult
  htfOverlay?: any
  visibility: LayerVisibility
  autoFibSettings?: AutoFibSettings
  vpvrSettings?: VolumeProfileSettings
  orderflowSettings?: OrderflowSettings
  marketSessionSettings?: MarketSessionSettings
  onOpenMarketSessionSettings?: () => void
  trendStrength?: TrendStrengthMetrics
  activeTool: DrawingToolType
  onSelectTool?: (tool: DrawingToolType) => void
  drawings: DrawingItem[]
  onAddDrawing: (item: DrawingItem) => void
  onUpdateDrawing?: (item: DrawingItem) => void
  onUndoDrawing?: () => void
  onRemoveDrawing: (id: string) => void
  openInterest?: OpenInterestData | null
  fundingRate?: FundingRateData | null
  market?: 'spot' | 'futures'
  onToggleLayer?: (key: keyof LayerVisibility) => void
}

export const LightweightChart: React.FC<LightweightChartProps> = ({
  symbol,
  timeframe,
  chartId = 'chart-main',
  syncCrosshair = true,
  candles,
  smc,
  patterns,
  forecast,
  htfOverlay,
  visibility,
  autoFibSettings,
  vpvrSettings,
  orderflowSettings,
  marketSessionSettings,
  onOpenMarketSessionSettings,
  trendStrength,
  activeTool,
  onSelectTool,
  drawings,
  onAddDrawing,
  onUpdateDrawing,
  onUndoDrawing,
  onRemoveDrawing,
  openInterest,
  fundingRate,
  market = 'futures',
  onToggleLayer
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)
  const prevVolumeVisibleRef = useRef<boolean>(Boolean(visibility.volume))
  const candlesRef = useRef<Candle[]>(candles)

  useEffect(() => {
    candlesRef.current = candles
  }, [candles])

  const syncCrosshairRef = useRef<boolean>(Boolean(syncCrosshair))
  const isExternalCrosshairRef = useRef<boolean>(false)
  const chartIdRef = useRef<string>(chartId)

  useEffect(() => {
    chartIdRef.current = chartId
  }, [chartId])

  useEffect(() => {
    syncCrosshairRef.current = Boolean(syncCrosshair)
    if (!syncCrosshair && chartRef.current) {
      try {
        chartRef.current.clearCrosshairPosition()
      } catch {}
    }
  }, [syncCrosshair])

  // Ref to always hold the latest redrawCanvas function (avoids stale closures during pan/scroll)
  const redrawCanvasRef = useRef<() => void>(() => {})
  const lastViewKeyRef = useRef<string>('')

  // Snap directly to the front with balanced TradingView zoom (~140-160 candles on desktop, not overly zoomed)
  const focusRecentBars = useCallback((totalCandles: number) => {
    if (!chartRef.current || totalCandles <= 0) return
    const containerWidth = containerRef.current?.clientWidth || 1200
    // Balanced ~8px per bar (standard TradingView default density, avoiding overly zoomed fat bars)
    const targetBars = Math.max(100, Math.min(200, Math.round(containerWidth / 8)))
    const barsToShow = Math.min(totalCandles, targetBars)
    const rightMarginBars = 16

    chartRef.current.timeScale().applyOptions({
      rightOffset: rightMarginBars
    })
    chartRef.current.timeScale().setVisibleLogicalRange({
      from: Math.max(0, totalCandles - barsToShow),
      to: totalCandles + rightMarginBars - 1
    })
    chartRef.current.priceScale('right').applyOptions({ autoScale: true })
  }, [])

  // Drawing & Selection state
  const [isDrawing, setIsDrawing] = useState(false)
  const [drawingStart, setDrawingStart] = useState<{ time: number; price: number; x: number; y: number } | null>(null)
  const [pendingPoints, setPendingPoints] = useState<{ time: number; price: number; x: number; y: number }[]>([])
  const [currentMouse, setCurrentMouse] = useState<{ x: number; y: number; time: number; price: number } | null>(null)

  // Interactive Selection, Editing & Dragging
  const [selectedDrawingId, setSelectedDrawingId] = useState<string | null>(null)
  const [hoveredDrawingId, setHoveredDrawingId] = useState<string | null>(null)
  const [hoveredHandleIndex, setHoveredHandleIndex] = useState<number | null>(null)
  const [isHoveringDrawing, setIsHoveringDrawing] = useState(false)
  const [dragMode, setDragMode] = useState<'handle' | 'move' | null>(null)
  const dragStartRef = useRef<{
    x: number
    y: number
    time: number
    price: number
    points: { time: number; price: number }[]
  } | null>(null)

  useEffect(() => {
    setIsDrawing(false)
    setDrawingStart(null)
    setPendingPoints([])
  }, [activeTool])

  // Market Sessions extraction & live UTC status
  const sessionSettings = useMemo(() => {
    const base = marketSessionSettings || DEFAULT_MARKET_SESSION_SETTINGS
    return {
      ...DEFAULT_MARKET_SESSION_SETTINGS,
      ...base,
      sessions: Array.isArray(base?.sessions) && base.sessions.length > 0
        ? base.sessions
        : DEFAULT_MARKET_SESSION_SETTINGS.sessions
    }
  }, [marketSessionSettings])
  const sessionLines = useMemo(() => extractSessionLines(candles, sessionSettings), [candles, sessionSettings])
  const sessionZones = useMemo(() => extractSessionZones(candles, sessionSettings), [candles, sessionSettings])
  const [activeSessionInfo, setActiveSessionInfo] = useState<ActiveSessionResult>(() => getCurrentActiveSessions(sessionSettings))

  useEffect(() => {
    setActiveSessionInfo(getCurrentActiveSessions(sessionSettings))
    const timer = setInterval(() => {
      setActiveSessionInfo(getCurrentActiveSessions(sessionSettings))
    }, 15000)
    return () => clearInterval(timer)
  }, [sessionSettings])

  // 1. Initialize Chart
  useEffect(() => {
    if (!containerRef.current) return

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0b0e14' },
        textColor: '#8b949e',
        fontSize: 11,
        fontFamily: 'Inter, system-ui, sans-serif'
      },
      grid: {
        vertLines: { color: '#161b22', style: 1 },
        horzLines: { color: '#161b22', style: 1 }
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#444d56', width: 1, style: 3, labelBackgroundColor: '#1f242c' },
        horzLine: { color: '#444d56', width: 1, style: 3, labelBackgroundColor: '#1f242c' }
      },
      rightPriceScale: {
        borderColor: '#21262d',
        autoScale: true,
        scaleMargins: { top: 0.1, bottom: 0.2 }
      },
      timeScale: {
        borderColor: '#21262d',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 12
      }
    })

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#00c087',
      downColor: '#f6465d',
      borderVisible: false,
      wickUpColor: '#00c087',
      wickDownColor: '#f6465d'
    })

    const volumeSeries = chart.addHistogramSeries({
      color: '#26a69a',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      visible: Boolean(visibility.volume)
    })

    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 }
    })

    chartRef.current = chart
    candleSeriesRef.current = candleSeries
    volumeSeriesRef.current = volumeSeries

    const handleResize = () => {
      if (containerRef.current && chartRef.current && canvasRef.current) {
        const w = containerRef.current.clientWidth
        const h = containerRef.current.clientHeight
        chartRef.current.applyOptions({ width: w, height: h })
        canvasRef.current.width = w
        canvasRef.current.height = h
        redrawCanvasRef.current()
      }
    }

    window.addEventListener('resize', handleResize)
    const resizeObserver = typeof ResizeObserver !== 'undefined' && containerRef.current
      ? new ResizeObserver(() => handleResize())
      : null
    if (resizeObserver && containerRef.current) {
      resizeObserver.observe(containerRef.current)
    }

    // Trigger canvas redraw on pan, zoom, scroll
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
      requestAnimationFrame(() => redrawCanvasRef.current())
    })
    chart.timeScale().subscribeVisibleTimeRangeChange(() => {
      requestAnimationFrame(() => redrawCanvasRef.current())
    })

    // Crosshair Sync Subscriptions (Bidirectional sync across split charts)
    const handleLocalCrosshairMove = (param: MouseEventParams) => {
      if (!syncCrosshairRef.current || isExternalCrosshairRef.current) return

      if (
        !param.point ||
        param.point.x < 0 ||
        param.point.y < 0
      ) {
        window.dispatchEvent(
          new CustomEvent('cp_sync_crosshair_clear', {
            detail: { sourceId: chartIdRef.current }
          })
        )
        return
      }

      const price = candleSeries.coordinateToPrice(param.point.y)
      let time = param.time
      if (time === undefined && chart.timeScale()) {
        const direct = chart.timeScale().coordinateToTime(param.point.x)
        if (direct !== null && direct !== undefined) {
          time = direct as Time
        } else {
          const logical = chart.timeScale().coordinateToLogical(param.point.x)
          if (logical !== null && candlesRef.current && candlesRef.current.length > 0) {
            const lastCandle = candlesRef.current[candlesRef.current.length - 1]
            const timeStep = candlesRef.current.length > 1 ? (candlesRef.current[1].time - candlesRef.current[0].time) : 900
            const futureBars = logical - (candlesRef.current.length - 1)
            time = Math.round(lastCandle.time + futureBars * timeStep) as any as Time
          }
        }
      }

      if (price !== null && price !== undefined && time !== undefined) {
        window.dispatchEvent(
          new CustomEvent('cp_sync_crosshair_move', {
            detail: {
              sourceId: chartIdRef.current,
              time: time,
              price: price
            }
          })
        )
      }
    }

    chart.subscribeCrosshairMove(handleLocalCrosshairMove)

    const handleRemoteCrosshairMove = (e: Event) => {
      const customEvent = e as CustomEvent<{ sourceId: string; time: Time; price: number }>
      if (!syncCrosshairRef.current || !chartRef.current || !candleSeriesRef.current) return
      if (customEvent.detail.sourceId === chartIdRef.current) return

      const { time, price } = customEvent.detail
      if (time === undefined || price === undefined) return

      try {
        isExternalCrosshairRef.current = true
        chartRef.current.setCrosshairPosition(price, time, candleSeriesRef.current)
      } catch {
        // Gracefully ignore if the timestamp is out of range for this chart
      } finally {
        queueMicrotask(() => {
          isExternalCrosshairRef.current = false
        })
      }
    }

    const handleRemoteCrosshairClear = (e: Event) => {
      const customEvent = e as CustomEvent<{ sourceId: string }>
      if (!chartRef.current) return
      if (customEvent.detail.sourceId === chartIdRef.current) return

      try {
        chartRef.current.clearCrosshairPosition()
      } catch {}
    }

    window.addEventListener('cp_sync_crosshair_move', handleRemoteCrosshairMove)
    window.addEventListener('cp_sync_crosshair_clear', handleRemoteCrosshairClear)

    handleResize()

    return () => {
      window.removeEventListener('resize', handleResize)
      window.removeEventListener('cp_sync_crosshair_move', handleRemoteCrosshairMove)
      window.removeEventListener('cp_sync_crosshair_clear', handleRemoteCrosshairClear)
      chart.unsubscribeCrosshairMove(handleLocalCrosshairMove)
      resizeObserver?.disconnect()
      chart.remove()
      chartRef.current = null
    }
  }, [])

  // 2. On Symbol / Timeframe change or initial load: auto-focus on point to latest price
  useEffect(() => {
    if (candles.length > 0 && chartRef.current) {
      const currentKey = `${symbol}_${timeframe}`
      if (lastViewKeyRef.current !== currentKey) {
        lastViewKeyRef.current = currentKey
        requestAnimationFrame(() => {
          focusRecentBars(candles.length)
        })
      }
    }
  }, [symbol, timeframe, candles, focusRecentBars])

  // 3. Dedicated sync for Volume Layer Visibility
  useEffect(() => {
    if (!volumeSeriesRef.current) return
    const isVisible = Boolean(visibility.volume)
    volumeSeriesRef.current.applyOptions({ visible: isVisible })
    if (!isVisible) {
      volumeSeriesRef.current.setData([])
    } else if (candles.length > 0) {
      const formattedVolumes = candles.map((c) => ({
        time: c.time as Time,
        value: c.volume,
        color: c.close >= c.open ? 'rgba(0, 192, 135, 0.25)' : 'rgba(246, 70, 93, 0.25)'
      }))
      volumeSeriesRef.current.setData(formattedVolumes)
    }
    prevVolumeVisibleRef.current = isVisible
  }, [visibility.volume, candles])

  // 4. Update Candle & Volume Data with Dynamic Price Precision & Smooth Live Ticks
  const prevCandlesCountRef = useRef<number>(0)
  const prevLastTimeRef = useRef<number>(0)
  const loadedSymbolRef = useRef<string>(symbol)
  const loadedTimeframeRef = useRef<string>(timeframe)

  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current) return

    // If candles are reset to empty (switching coins), immediately wipe old series & canvas
    if (candles.length === 0) {
      candleSeriesRef.current.setData([])
      volumeSeriesRef.current.setData([])
      candleSeriesRef.current.setMarkers([])
      prevCandlesCountRef.current = 0
      prevLastTimeRef.current = 0
      if (canvasRef.current) {
        const ctx = canvasRef.current.getContext('2d')
        if (ctx) {
          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
        }
      }
      return
    }

    const isNewSeries =
      symbol !== loadedSymbolRef.current ||
      timeframe !== loadedTimeframeRef.current ||
      prevCandlesCountRef.current === 0

    if (isNewSeries) {
      loadedSymbolRef.current = symbol
      loadedTimeframeRef.current = timeframe
    }

    // Dynamically adjust price precision for micro-coins (PEPE, SHIB, DOGE) vs macro-coins (BTC, ETH)
    const precisionOpts = getPricePrecision(candles)
    candleSeriesRef.current.applyOptions({
      priceFormat: {
        type: 'price',
        precision: precisionOpts.precision,
        minMove: precisionOpts.minMove
      }
    })

    const formattedCandles = candles.map((c) => ({
      time: c.time as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close
    }))

    const formattedVolumes = candles.map((c) => ({
      time: c.time as Time,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(0, 192, 135, 0.25)' : 'rgba(246, 70, 93, 0.25)'
    }))

    const lastCandle = formattedCandles[formattedCandles.length - 1]
    const lastVolume = formattedVolumes[formattedVolumes.length - 1]
    const lastTimeNum = Number(lastCandle.time)

    const volumeVisibilityChanged = prevVolumeVisibleRef.current !== Boolean(visibility.volume)
    prevVolumeVisibleRef.current = Boolean(visibility.volume)

    // Smooth real-time update: ONLY if it's NOT a new series, volume visibility didn't change, and count & time match
    const isIncrementalUpdate =
      !isNewSeries &&
      !volumeVisibilityChanged &&
      prevCandlesCountRef.current === formattedCandles.length &&
      prevLastTimeRef.current === lastTimeNum

    volumeSeriesRef.current.applyOptions({ visible: Boolean(visibility.volume) })

    if (isIncrementalUpdate) {
      candleSeriesRef.current.update(lastCandle)
      if (visibility.volume) {
        volumeSeriesRef.current.update(lastVolume)
      }
    } else {
      candleSeriesRef.current.setData(formattedCandles)
      if (visibility.volume) {
        volumeSeriesRef.current.setData(formattedVolumes)
      } else {
        volumeSeriesRef.current.setData([])
      }
      prevCandlesCountRef.current = formattedCandles.length
      prevLastTimeRef.current = lastTimeNum

      if (isNewSeries) {
        focusRecentBars(formattedCandles.length)
      }
    }

    // Markers: Swings and BOS/CHoCH are now rendered on high-fidelity Canvas overlay
    candleSeriesRef.current.setMarkers([])

    redrawCanvasRef.current()
  }, [candles, smc, visibility.volume, symbol, timeframe, focusRecentBars])

  // 4. Robust Continuous Coordinate Resolvers (Supports past, future blank space, and mathematical projection)
  const resolveCoord = useCallback((time: number, price: number): { x: number; y: number } | null => {
    if (!chartRef.current || !candleSeriesRef.current || candles.length === 0) return null
    const timeScale = chartRef.current.timeScale()
    const series = candleSeriesRef.current
    const canvas = canvasRef.current
    const width = canvas ? canvas.width : (containerRef.current?.clientWidth || 800)
    const height = canvas ? canvas.height : (containerRef.current?.clientHeight || 500)

    const firstTime = candles[0].time
    const lastTime = candles[candles.length - 1].time
    const timeStep = candles.length > 1 ? (candles[1].time - candles[0].time) : 900

    // Compute fractional continuous logical index
    let logicalIndex: number
    if (time >= lastTime) {
      const futureBars = (time - lastTime) / Math.max(1, timeStep)
      logicalIndex = (candles.length - 1) + futureBars
    } else if (time <= firstTime) {
      const pastBars = (firstTime - time) / Math.max(1, timeStep)
      logicalIndex = 0 - pastBars
    } else {
      let idx = 0
      for (let i = 0; i < candles.length - 1; i++) {
        if (time >= candles[i].time && time <= candles[i + 1].time) {
          idx = i
          break
        }
      }
      const span = candles[idx + 1].time - candles[idx].time
      const frac = span > 0 ? (time - candles[idx].time) / span : 0
      logicalIndex = idx + frac
    }

    // Convert logical index to screen coordinate X
    let x: number | null = timeScale.logicalToCoordinate(logicalIndex as any) as any
    if (x === null || isNaN(x)) {
      const visibleRange = timeScale.getVisibleLogicalRange()
      if (visibleRange && visibleRange.to !== visibleRange.from && width > 0) {
        x = ((logicalIndex - visibleRange.from) / (visibleRange.to - visibleRange.from)) * width
      } else {
        const lastX: number | null = timeScale.timeToCoordinate(lastTime as Time) as any
        const prevX: number | null = candles.length > 1 ? (timeScale.timeToCoordinate(candles[candles.length - 2].time as Time) as any) : null
        const barSpacing = (lastX !== null && prevX !== null) ? Math.abs(lastX - prevX) : 10
        if (lastX !== null) {
          x = lastX + (logicalIndex - (candles.length - 1)) * barSpacing
        } else {
          x = width / 2
        }
      }
    }

    // Convert price to screen coordinate Y with robust fallback
    let y: number | null = series.priceToCoordinate(price) as any
    if (y === null || isNaN(y)) {
      const pTop = series.coordinateToPrice(0 as any)
      const pBottom = series.coordinateToPrice(height as any)
      if (pTop !== null && pBottom !== null && pTop !== pBottom) {
        y = ((pTop - price) / (pTop - pBottom)) * height
      } else {
        y = height / 2
      }
    }

    if (x === null || y === null || isNaN(x) || isNaN(y)) return null
    return { x: Number(x), y: Number(y) }
  }, [candles])

  // Bidirectional resolver: convert x screen coordinate to continuous timestamp (including future/past margins)
  const getTimeFromCoordinate = useCallback((x: number): number | null => {
    if (!chartRef.current || candles.length === 0) return null
    const timeScale = chartRef.current.timeScale()
    const canvas = canvasRef.current
    const width = canvas ? canvas.width : (containerRef.current?.clientWidth || 800)

    const firstTime = candles[0].time
    const lastTime = candles[candles.length - 1].time
    const timeStep = candles.length > 1 ? (candles[1].time - candles[0].time) : 900

    let logical: number | null = timeScale.coordinateToLogical(x as any) as any
    if (logical === null || logical === undefined || isNaN(logical)) {
      const visibleRange = timeScale.getVisibleLogicalRange()
      if (visibleRange && visibleRange.to !== visibleRange.from && width > 0) {
        logical = visibleRange.from + (x / width) * (visibleRange.to - visibleRange.from)
      }
    }

    if (logical !== null && logical !== undefined && !isNaN(logical)) {
      if (logical >= candles.length - 1) {
        const futureBars = logical - (candles.length - 1)
        return Math.round(lastTime + futureBars * timeStep)
      } else if (logical <= 0) {
        return Math.round(firstTime + logical * timeStep)
      } else {
        const idx = Math.min(Math.max(0, Math.floor(logical)), candles.length - 2)
        const frac = logical - idx
        const baseTime = candles[idx].time
        const nextTime = candles[idx + 1].time
        return Math.round(baseTime + frac * (nextTime - baseTime))
      }
    }

    return Math.round(lastTime)
  }, [candles])

  // Bidirectional resolver: convert y screen coordinate to price
  const getPriceFromCoordinate = useCallback((y: number): number | null => {
    if (!candleSeriesRef.current) return null
    const series = candleSeriesRef.current
    const price = series.coordinateToPrice(y as any)
    if (price !== null && price !== undefined && !isNaN(price)) {
      return price
    }
    const canvas = canvasRef.current
    const height = canvas ? canvas.height : (containerRef.current?.clientHeight || 500)
    const pTop = series.coordinateToPrice(0 as any)
    const pBottom = series.coordinateToPrice(height as any)
    if (pTop !== null && pBottom !== null && pTop !== pBottom) {
      return pTop - (y / height) * (pTop - pBottom)
    }
    if (candles.length > 0) {
      return candles[candles.length - 1].close
    }
    return null
  }, [candles])

  // Geometric Hit Testing Utilities for Line Tools & Anchor Handles
  const findDrawingAt = useCallback((px: number, py: number): { drawing: DrawingItem; handleIndex: number | null } | null => {
    const distToSegment = (x: number, y: number, x1: number, y1: number, x2: number, y2: number) => {
      const l2 = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1)
      if (l2 === 0) return Math.hypot(x - x1, y - y1)
      let t = ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / l2
      t = Math.max(0, Math.min(1, t))
      return Math.hypot(x - (x1 + t * (x2 - x1)), y - (y1 + t * (y2 - y1)))
    }

    const distToRay = (x: number, y: number, x1: number, y1: number, x2: number, y2: number) => {
      const dx = x2 - x1
      const dy = y2 - y1
      const l2 = dx * dx + dy * dy
      if (l2 === 0) return Math.hypot(x - x1, y - y1)
      let t = ((x - x1) * dx + (y - y1) * dy) / l2
      t = Math.max(0, t)
      return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))
    }

    const distToLine = (x: number, y: number, x1: number, y1: number, x2: number, y2: number) => {
      const dx = x2 - x1
      const dy = y2 - y1
      const l2 = dx * dx + dy * dy
      if (l2 === 0) return Math.hypot(x - x1, y - y1)
      const t = ((x - x1) * dx + (y - y1) * dy) / l2
      return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy))
    }

    // 1. If a drawing is currently selected, check its handles first
    if (selectedDrawingId) {
      const selected = drawings.find((d) => d.id === selectedDrawingId)
      if (selected) {
        for (let i = 0; i < selected.points.length; i++) {
          const pt = selected.points[i]
          const cp = resolveCoord(pt.time, pt.price)
          if (cp && Math.hypot(px - cp.x, py - cp.y) <= 10) {
            return { drawing: selected, handleIndex: i }
          }
        }
      }
    }

    // 2. Check all drawings in reverse order (top drawings first)
    for (let i = drawings.length - 1; i >= 0; i--) {
      const d = drawings[i]
      const coords = d.points.map((p) => resolveCoord(p.time, p.price))
      if (coords.some((c) => !c)) continue

      // Check anchor handles
      for (let hIdx = 0; hIdx < coords.length; hIdx++) {
        const cp = coords[hIdx]!
        if (Math.hypot(px - cp.x, py - cp.y) <= 9) {
          return { drawing: d, handleIndex: hIdx }
        }
      }

      // Check geometries
      if (d.type === 'horizontal_line') {
        const y = coords[0]!.y
        if (Math.abs(py - y) <= 8) return { drawing: d, handleIndex: null }
      } else if (d.type === 'horizontal_ray') {
        const p1 = coords[0]!
        if (Math.abs(py - p1.y) <= 8 && px >= p1.x - 5) return { drawing: d, handleIndex: null }
      } else if (d.type === 'vertical_line') {
        const x = coords[0]!.x
        if (Math.abs(px - x) <= 8) return { drawing: d, handleIndex: null }
      } else if (d.type === 'crossline') {
        const p1 = coords[0]!
        if (Math.abs(py - p1.y) <= 8 || Math.abs(px - p1.x) <= 8) return { drawing: d, handleIndex: null }
      } else if (d.type === 'ray') {
        if (coords.length >= 2) {
          if (distToRay(px, py, coords[0]!.x, coords[0]!.y, coords[1]!.x, coords[1]!.y) <= 8) {
            return { drawing: d, handleIndex: null }
          }
        }
      } else if (d.type === 'extended_line') {
        if (coords.length >= 2) {
          if (distToLine(px, py, coords[0]!.x, coords[0]!.y, coords[1]!.x, coords[1]!.y) <= 8) {
            return { drawing: d, handleIndex: null }
          }
        }
      } else if (
        d.type === 'trendline' ||
        d.type === 'info_line' ||
        d.type === 'trend_angle' ||
        d.type === 'regression_trend'
      ) {
        if (coords.length >= 2) {
          if (distToSegment(px, py, coords[0]!.x, coords[0]!.y, coords[1]!.x, coords[1]!.y) <= 8) {
            return { drawing: d, handleIndex: null }
          }
        }
      } else if (d.type === 'parallel_channel' && coords.length >= 3) {
        const p1 = coords[0]!
        const p2 = coords[1]!
        const p3 = coords[2]!
        const dx = p2.x - p1.x
        const dy = p2.y - p1.y
        const baseLineYAtP3 = p1.y + (dx !== 0 ? (dy / dx) * (p3.x - p1.x) : 0)
        const offset = p3.y - baseLineYAtP3
        if (distToSegment(px, py, p1.x, p1.y, p2.x, p2.y) <= 8) return { drawing: d, handleIndex: null }
        if (distToSegment(px, py, p1.x, p1.y + offset, p2.x, p2.y + offset) <= 8) return { drawing: d, handleIndex: null }
        if (distToSegment(px, py, p1.x, p1.y + offset / 2, p2.x, p2.y + offset / 2) <= 8) return { drawing: d, handleIndex: null }
      } else if (
        d.type === 'pitchfork' ||
        d.type === 'schiff_pitchfork' ||
        d.type === 'modified_schiff' ||
        d.type === 'inside_pitchfork'
      ) {
        if (coords.length >= 3) {
          const p1 = coords[0]!
          const p2 = coords[1]!
          const p3 = coords[2]!
          const midX = (p2.x + p3.x) / 2
          const midY = (p2.y + p3.y) / 2
          if (distToSegment(px, py, p2.x, p2.y, p3.x, p3.y) <= 8) return { drawing: d, handleIndex: null }
          if (distToRay(px, py, p1.x, p1.y, midX, midY) <= 8) return { drawing: d, handleIndex: null }
          const vx = midX - p1.x
          const vy = midY - p1.y
          if (distToRay(px, py, p2.x, p2.y, p2.x + vx, p2.y + vy) <= 8) return { drawing: d, handleIndex: null }
          if (distToRay(px, py, p3.x, p3.y, p3.x + vx, p3.y + vy) <= 8) return { drawing: d, handleIndex: null }
        }
      } else if (d.type === 'rectangle' && coords.length >= 2) {
        const p1 = coords[0]!
        const p2 = coords[1]!
        const minX = Math.min(p1.x, p2.x)
        const maxX = Math.max(p1.x, p2.x)
        const minY = Math.min(p1.y, p2.y)
        const maxY = Math.max(p1.y, p2.y)
        if (px >= minX - 6 && px <= maxX + 6 && py >= minY - 6 && py <= maxY + 6) {
          return { drawing: d, handleIndex: null }
        }
      }
    }
    return null
  }, [drawings, selectedDrawingId, resolveCoord])

  // 5. Canvas Overlay Rendering Function
  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current
    const chart = chartRef.current
    const series = candleSeriesRef.current
    if (!canvas || !chart || !series) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const width = canvas.width
    const height = canvas.height
    ctx.clearRect(0, 0, width, height)

    // 0. Market Sessions - Box/Gradient Zones & Thin Vertical Dashed Lines with Minimalist Top Badges
    if (visibility.marketSessions && (sessionSettings.enabled ?? true)) {
      const isIntraday = !['4h', '1d', '3d', '1w'].includes(timeframe.toLowerCase())
      if (isIntraday) {
        // 0A. Subtle Session Zone Background (Box or Linear Gradient)
        if ((sessionSettings.showZoneBackground ?? true) && sessionZones.length > 0) {
          const zoneStyle = sessionSettings.zoneStyle || 'gradient'
          const zoneOpacity = sessionSettings.zoneOpacity || 0.08

          sessionZones.forEach((zb) => {
            const pStart = resolveCoord(zb.startTime, candles[0]?.close || 1)
            const pEnd = resolveCoord(zb.endTime, candles[0]?.close || 1)
            if (!pStart || !pEnd) return

            const x1 = Math.min(pStart.x, pEnd.x)
            const x2 = Math.max(pStart.x, pEnd.x)
            const zoneW = Math.max(8, x2 - x1)

            if (x1 + zoneW < -50 || x1 > width + 50) return

            ctx.save()
            if (zoneStyle === 'gradient') {
              const grad = ctx.createLinearGradient(0, 0, 0, height)
              grad.addColorStop(0, hexToRgba(zb.session.color, zoneOpacity * 1.5))
              grad.addColorStop(0.35, hexToRgba(zb.session.color, zoneOpacity))
              grad.addColorStop(1, hexToRgba(zb.session.color, zoneOpacity * 0.2))
              ctx.fillStyle = grad
              ctx.fillRect(x1, 0, zoneW, height)
            } else {
              // Soft translucent box
              ctx.fillStyle = hexToRgba(zb.session.color, zoneOpacity)
              ctx.fillRect(x1, 0, zoneW, height)
              ctx.strokeStyle = hexToRgba(zb.session.color, zoneOpacity * 2.2)
              ctx.lineWidth = 1
              ctx.beginPath()
              ctx.moveTo(x1, 0)
              ctx.lineTo(x1 + zoneW, 0)
              ctx.moveTo(x1, height)
              ctx.lineTo(x1 + zoneW, height)
              ctx.stroke()
            }
            ctx.restore()
          })
        }

        // 0B. Thin Vertical Dashed Lines with Minimalist Top Badges
        if ((sessionSettings.showVerticalLines ?? true) && sessionLines.length > 0) {
          const lineStyle = sessionSettings.lineStyle || 'dashed'
          const lineDash = lineStyle === 'dashed' ? [4, 4] : lineStyle === 'dotted' ? [2, 2] : []
          const lineOpacity = sessionSettings.opacity ?? 0.75
          const showBadges = sessionSettings.showSessionBadges ?? true

          sessionLines.forEach((sl) => {
            const p = resolveCoord(sl.candleTime, candles[0]?.close || 1)
            if (!p) return
            const x = p.x
            if (x < -60 || x > width + 60) return

            ctx.save()
            ctx.beginPath()
            ctx.setLineDash(lineDash)
            ctx.lineWidth = sessionSettings.lineWidth || 1
            ctx.strokeStyle = sl.session.color
            ctx.globalAlpha = lineOpacity
            ctx.moveTo(x, 0)
            ctx.lineTo(x, height)
            ctx.stroke()
            ctx.setLineDash([])

            // Minimalist TradingView-Style Badge at top of vertical line
            if (showBadges) {
              ctx.globalAlpha = 1.0
              ctx.font = 'bold 9px monospace'
              const text = sl.label
              const textWidth = ctx.measureText(text).width
              const badgeW = textWidth + 14
              const badgeH = 15
              const badgeX = Math.max(4, Math.min(width - badgeW - 4, x - badgeW / 2))
              const badgeY = 6

              // Badge Background
              ctx.fillStyle = 'rgba(13, 17, 23, 0.90)'
              ctx.fillRect(badgeX, badgeY, badgeW, badgeH)
              ctx.strokeStyle = sl.session.color
              ctx.lineWidth = 1
              ctx.strokeRect(badgeX, badgeY, badgeW, badgeH)

              // Small colored dot inside badge
              ctx.fillStyle = sl.session.color
              ctx.beginPath()
              ctx.arc(badgeX + 6, badgeY + badgeH / 2, 2.5, 0, Math.PI * 2)
              ctx.fill()

              // Badge Text
              ctx.fillStyle = '#f1f5f9'
              ctx.fillText(text, badgeX + 12, badgeY + 11)
            }

            ctx.restore()
          })

          // Draw Next Upcoming Session Vertical Dashed Line into future space
          if (sessionSettings.showUpcomingMarker && activeSessionInfo.nextSession && candles.length > 0) {
            const nextSess = activeSessionInfo.nextSession
            const pFuture = resolveCoord(nextSess.startTimeSec, candles[candles.length - 1].close)
            if (pFuture && pFuture.x > 0 && pFuture.x < width - 10) {
              const x = pFuture.x
              ctx.save()
              ctx.beginPath()
              ctx.setLineDash([3, 3])
              ctx.lineWidth = 1
              ctx.strokeStyle = nextSess.session.color
              ctx.globalAlpha = 0.8
              ctx.moveTo(x, 0)
              ctx.lineTo(x, height)
              ctx.stroke()
              ctx.setLineDash([])

              // Top badge for upcoming session
              ctx.globalAlpha = 1.0
              ctx.font = 'bold 9px monospace'
              const upcomingText = `⏳ ${nextSess.session.label} (${nextSess.countdownStr})`
              const textW = ctx.measureText(upcomingText).width
              const bW = textW + 10
              const bH = 15
              const bX = Math.max(4, Math.min(width - bW - 4, x - bW / 2))
              const bY = 6

              ctx.fillStyle = 'rgba(13, 17, 23, 0.92)'
              ctx.fillRect(bX, bY, bW, bH)
              ctx.strokeStyle = nextSess.session.color
              ctx.lineWidth = 1
              ctx.strokeRect(bX, bY, bW, bH)

              ctx.fillStyle = nextSess.session.color
              ctx.fillText(upcomingText, bX + 5, bY + 11)
              ctx.restore()
            }
          }
        }
      }
    }

    // 0.5. Volume Profile (VPVR - Visible Range Volume Profile + POC, VAH, VAL)
    if (visibility.volumeProfile && candles.length >= 10) {
      const vpConfig: VolumeProfileSettings = vpvrSettings || DEFAULT_VOLUME_PROFILE_SETTINGS
      const maxChartX = Math.max(40, width - 68)

      // 1. Ambil rentang candle (Visible Range di layar saat ini atau Fixed Lookback)
      let vpCandles: Candle[] = []
      if (vpConfig.rangeMode === 'visible') {
        try {
          const logicalRange = chart.timeScale().getVisibleLogicalRange()
          if (logicalRange) {
            const fromIdx = Math.max(0, Math.floor(logicalRange.from))
            const toIdx = Math.min(candles.length - 1, Math.ceil(logicalRange.to))
            if (toIdx >= fromIdx) {
              vpCandles = candles.slice(fromIdx, toIdx + 1)
            }
          }
        } catch {}
        if (vpCandles.length < 5) {
          vpCandles = candles.slice(-150)
        }
      } else {
        const lookback = Math.max(20, vpConfig.fixedLookbackBars || 150)
        vpCandles = candles.slice(-lookback)
      }

      if (vpCandles.length >= 5) {
        let minP = Infinity
        let maxP = -Infinity
        for (let i = 0; i < vpCandles.length; i++) {
          const c = vpCandles[i]
          if (c.low < minP) minP = c.low
          if (c.high > maxP) maxP = c.high
        }

        const priceSpan = maxP - minP
        if (Number.isFinite(priceSpan) && priceSpan > 0) {
          const numRows = Math.max(12, Math.min(120, vpConfig.rowSize || 48))
          const binStep = priceSpan / numRows

          interface VpBin {
            lowPrice: number
            highPrice: number
            midPrice: number
            upVol: number
            downVol: number
            totalVol: number
            inVa: boolean
            isHvn: boolean
          }

          const bins: VpBin[] = Array.from({ length: numRows }, (_, idx) => {
            const lowPrice = minP + idx * binStep
            const highPrice = lowPrice + binStep
            return {
              lowPrice,
              highPrice,
              midPrice: (lowPrice + highPrice) / 2,
              upVol: 0,
              downVol: 0,
              totalVol: 0,
              inVa: false,
              isHvn: false
            }
          })

          // 2. Distribusikan volume tiap candle ke dalam baris-baris harga yang dilewatinya
          for (let i = 0; i < vpCandles.length; i++) {
            const c = vpCandles[i]
            const vol = Number(c.volume) || 0
            if (vol <= 0) continue

            let buyVol = 0
            let sellVol = 0
            if (c.taker_buy_volume && c.taker_buy_volume > 0 && c.taker_buy_volume <= vol) {
              buyVol = c.taker_buy_volume
              sellVol = Math.max(0, vol - c.taker_buy_volume)
            } else {
              const cRange = c.high - c.low
              const buyRatio =
                cRange > 0
                  ? c.close >= c.open
                    ? 0.5 + 0.5 * ((c.close - c.open) / cRange)
                    : 0.5 * ((c.close - c.low) / cRange)
                  : c.close >= c.open
                    ? 1
                    : 0
              buyVol = vol * buyRatio
              sellVol = vol * (1 - buyRatio)
            }

            const startBin = Math.max(0, Math.min(numRows - 1, Math.floor((c.low - minP) / binStep)))
            const endBin = Math.max(0, Math.min(numRows - 1, Math.floor((c.high - minP) / binStep)))
            const spanCount = Math.max(1, endBin - startBin + 1)
            const upPerBin = buyVol / spanCount
            const downPerBin = sellVol / spanCount
            const totPerBin = vol / spanCount

            for (let b = startBin; b <= endBin; b++) {
              bins[b].upVol += upPerBin
              bins[b].downVol += downPerBin
              bins[b].totalVol += totPerBin
            }
          }

          // 3. Cari POC (Point of Control) & Total Volume
          let pocIdx = 0
          let maxBinVol = 0
          let totalProfileVol = 0
          for (let i = 0; i < numRows; i++) {
            totalProfileVol += bins[i].totalVol
            if (bins[i].totalVol > maxBinVol) {
              maxBinVol = bins[i].totalVol
              pocIdx = i
            }
          }

          if (maxBinVol > 0 && totalProfileVol > 0) {
            // 4. Hitung Value Area (Standar 70% dari Total Volume mulai ekspansi dari POC)
            const vaTargetVol = totalProfileVol * ((vpConfig.valueAreaVolumePct || 70) / 100)
            let vaLowIdx = pocIdx
            let vaHighIdx = pocIdx
            let accumVaVol = bins[pocIdx].totalVol

            while (accumVaVol < vaTargetVol && (vaLowIdx > 0 || vaHighIdx < numRows - 1)) {
              const upCandidate = vaHighIdx < numRows - 1 ? bins[vaHighIdx + 1].totalVol : -1
              const downCandidate = vaLowIdx > 0 ? bins[vaLowIdx - 1].totalVol : -1

              if (upCandidate >= downCandidate && vaHighIdx < numRows - 1) {
                vaHighIdx++
                accumVaVol += bins[vaHighIdx].totalVol
              } else if (vaLowIdx > 0) {
                vaLowIdx--
                accumVaVol += bins[vaLowIdx].totalVol
              } else {
                break
              }
            }

            for (let i = vaLowIdx; i <= vaHighIdx; i++) {
              bins[i].inVa = true
            }

            // Deteksi High Volume Nodes (HVN lokal selain POC)
            for (let i = 1; i < numRows - 1; i++) {
              if (
                i !== pocIdx &&
                bins[i].totalVol > bins[i - 1].totalVol &&
                bins[i].totalVol > bins[i + 1].totalVol &&
                bins[i].totalVol >= maxBinVol * 0.58
              ) {
                bins[i].isHvn = true
              }
            }

            const isRight = vpConfig.placement !== 'left'
            const maxBarW = Math.max(36, Math.min(maxChartX * 0.45, (maxChartX * (vpConfig.widthPct || 24)) / 100))

            ctx.save()

            // A. Background Shading Area Nilai (Value Area Box entre VAL & VAH)
            const vahPrice = bins[vaHighIdx].highPrice
            const valPrice = bins[vaLowIdx].lowPrice
            const pocPrice = bins[pocIdx].midPrice
            const yVah = series.priceToCoordinate(vahPrice)
            const yVal = series.priceToCoordinate(valPrice)
            const yPoc = series.priceToCoordinate(pocPrice)

            if (vpConfig.vaBackgroundShading && yVah !== null && yVal !== null) {
              const vaTop = Math.min(yVah, yVal)
              const vaHeight = Math.abs(yVal - yVah)
              const boxX = isRight ? maxChartX - maxBarW - 8 : 0
              const boxW = maxBarW + 8
              ctx.fillStyle = vpConfig.vahColor || '#38bdf8'
              ctx.globalAlpha = vpConfig.vaBackgroundOpacity || 0.06
              ctx.fillRect(boxX, vaTop, boxW, vaHeight)
              ctx.globalAlpha = 1.0
            }

            // B. Render Horizontal Histogram Bars untuk setiap Row
            for (let i = 0; i < numRows; i++) {
              const bin = bins[i]
              if (bin.totalVol <= 0) continue

              const yTop = series.priceToCoordinate(bin.highPrice)
              const yBot = series.priceToCoordinate(bin.lowPrice)
              if (yTop === null || yBot === null) continue

              const barTop = Math.min(yTop, yBot) + 0.5
              const barH = Math.max(1.5, Math.abs(yBot - yTop) - 1)
              if (barTop + barH < 0 || barTop > height) continue

              const totalW = (bin.totalVol / maxBinVol) * maxBarW
              const upW = (bin.upVol / maxBinVol) * maxBarW
              const downW = (bin.downVol / maxBinVol) * maxBarW
              const isPocRow = i === pocIdx

              const alpha = isPocRow
                ? Math.min(0.92, (vpConfig.barOpacity || 0.52) + 0.25)
                : bin.inVa
                  ? vpConfig.barOpacity || 0.52
                  : vpConfig.outsideVaOpacity || 0.22

              ctx.globalAlpha = alpha

              if (vpConfig.volumeType === 'up_down') {
                if (isRight) {
                  // Up/Buy Volume menempel dari kanan (maxChartX) ke kiri
                  ctx.fillStyle = vpConfig.upVolumeColor || '#00c087'
                  ctx.fillRect(maxChartX - upW, barTop, upW, barH)
                  // Down/Sell Volume menyambung di sebelah kirinya
                  ctx.fillStyle = vpConfig.downVolumeColor || '#f6465d'
                  ctx.fillRect(maxChartX - upW - downW, barTop, downW, barH)
                } else {
                  ctx.fillStyle = vpConfig.upVolumeColor || '#00c087'
                  ctx.fillRect(0, barTop, upW, barH)
                  ctx.fillStyle = vpConfig.downVolumeColor || '#f6465d'
                  ctx.fillRect(upW, barTop, downW, barH)
                }
              } else if (vpConfig.volumeType === 'delta') {
                const isBuyDom = bin.upVol >= bin.downVol
                ctx.fillStyle = isBuyDom ? (vpConfig.upVolumeColor || '#00c087') : (vpConfig.downVolumeColor || '#f6465d')
                const xStart = isRight ? maxChartX - totalW : 0
                ctx.fillRect(xStart, barTop, totalW, barH)
              } else {
                ctx.fillStyle = bin.inVa ? (vpConfig.upVolumeColor || '#00c087') : '#64748b'
                const xStart = isRight ? maxChartX - totalW : 0
                ctx.fillRect(xStart, barTop, totalW, barH)
              }

              // Highlight khusus pada baris POC atau HVN
              if (isPocRow) {
                ctx.globalAlpha = 0.95
                ctx.strokeStyle = vpConfig.pocColor || '#f0b90b'
                ctx.lineWidth = 1.2
                const xStart = isRight ? maxChartX - totalW : 0
                ctx.strokeRect(xStart, barTop, totalW, barH)
              } else if (vpConfig.showHvnLvn && bin.isHvn) {
                ctx.globalAlpha = 0.85
                ctx.fillStyle = '#f0b90b'
                const tipX = isRight ? maxChartX - totalW - 2 : totalW
                ctx.fillRect(tipX, barTop, 2, barH)
              }
            }

            ctx.globalAlpha = 1.0

            // Helper untuk menggambar garis level VPVR (POC, VAH, VAL) beserta Pill Badge
            const drawVpLevel = (
              yCoord: number | null,
              priceVal: number,
              tag: string,
              color: string,
              lineW: number,
              isDashed: boolean,
              extendFull: boolean
            ) => {
              if (yCoord === null || yCoord < 0 || yCoord > height) return

              const lineStartX = extendFull
                ? 0
                : isRight
                  ? Math.max(0, maxChartX - maxBarW - 24)
                  : 0
              const lineEndX = extendFull
                ? maxChartX
                : isRight
                  ? maxChartX
                  : Math.min(maxChartX, maxBarW + 24)

              ctx.save()
              ctx.beginPath()
              ctx.strokeStyle = color
              ctx.lineWidth = lineW
              ctx.setLineDash(isDashed ? [4, 3] : [])
              ctx.moveTo(lineStartX, yCoord)
              ctx.lineTo(lineEndX, yCoord)
              ctx.stroke()
              ctx.setLineDash([])

              if (vpConfig.showLabels) {
                const labelStr = `${tag} $${formatPrice(priceVal)}`
                ctx.font = 'bold 9px Inter, monospace'
                const textW = ctx.measureText(labelStr).width
                const padX = 5
                const pillW = textW + padX * 2
                const pillH = 14
                const pillX = isRight
                  ? Math.max(6, maxChartX - pillW - 4)
                  : 6
                const pillY = yCoord - pillH / 2

                ctx.fillStyle = 'rgba(11, 15, 25, 0.90)'
                ctx.strokeStyle = color
                ctx.lineWidth = 1
                ctx.beginPath()
                if (typeof (ctx as any).roundRect === 'function') {
                  ;(ctx as any).roundRect(pillX, pillY, pillW, pillH, 3)
                } else {
                  ctx.rect(pillX, pillY, pillW, pillH)
                }
                ctx.fill()
                ctx.stroke()

                ctx.textAlign = 'left'
                ctx.fillStyle = color
                ctx.fillText(labelStr, pillX + padX, pillY + 10)
              }
              ctx.restore()
            }

            // C. Gambar garis VAH, VAL, dan POC
            if (vpConfig.showVah) {
              drawVpLevel(yVah, vahPrice, 'VAH', vpConfig.vahColor || '#38bdf8', vpConfig.vahLineWidth || 1.2, true, false)
            }
            if (vpConfig.showVal) {
              drawVpLevel(yVal, valPrice, 'VAL', vpConfig.valColor || '#38bdf8', vpConfig.valLineWidth || 1.2, true, false)
            }
            if (vpConfig.showPoc) {
              drawVpLevel(
                yPoc,
                pocPrice,
                'POC',
                vpConfig.pocColor || '#f0b90b',
                vpConfig.pocLineWidth || 1.8,
                false,
                Boolean(vpConfig.pocExtendFull)
              )
            }

            ctx.restore()
          }
        }
      }
    }

    // 0.6. Liquidation Heatmap (25x / 50x / 100x Un-Swept Leverage Liquidity Pools)
    if (visibility.liquidationHeatmap && candles.length >= 20) {
      const ofConfig: OrderflowSettings = orderflowSettings || DEFAULT_ORDERFLOW_SETTINGS
      const maxChartX = Math.max(40, width - 68)
      const lookbackCount = Math.max(40, Math.min(candles.length, ofConfig.liqLookbackBars || 160))
      const sliceStart = candles.length - lookbackCount
      const lbCandles = candles.slice(sliceStart)
      const currentPrice = candles[candles.length - 1].close

      const activeTiers: { label: string; dist: number; weight: number }[] = []
      if (ofConfig.enable100x) activeTiers.push({ label: '100x', dist: 0.0095, weight: 1.35 })
      if (ofConfig.enable50x) activeTiers.push({ label: '50x', dist: 0.0190, weight: 1.18 })
      if (ofConfig.enable25x) activeTiers.push({ label: '25x', dist: 0.0385, weight: 1.0 })
      if (ofConfig.enable10x) activeTiers.push({ label: '10x', dist: 0.0950, weight: 0.85 })

      if (activeTiers.length > 0 && lbCandles.length >= 10) {
        const n = lbCandles.length
        // Suffix max High & min Low untuk cek cepat apakah level likuidasi sudah tersapu (swept)
        const suffixMaxHigh = new Array<number>(n).fill(-Infinity)
        const suffixMinLow = new Array<number>(n).fill(Infinity)
        let runMax = -Infinity
        let runMin = Infinity
        for (let i = n - 1; i >= 0; i--) {
          suffixMaxHigh[i] = runMax
          suffixMinLow[i] = runMin
          if (lbCandles[i].high > runMax) runMax = lbCandles[i].high
          if (lbCandles[i].low < runMin) runMin = lbCandles[i].low
        }

        const minLow = runMin * 0.965
        const maxHigh = runMax * 1.035
        const span = maxHigh - minLow
        const numBuckets = 56
        const bucketStep = span / numBuckets

        if (Number.isFinite(span) && span > 0) {
          interface LiqBucket {
            lowP: number
            highP: number
            midP: number
            intensity: number
            originTime: number
            side: 'SHORT_LIQ' | 'LONG_LIQ'
            tierCounts: Record<string, number>
          }

          const buckets: LiqBucket[] = Array.from({ length: numBuckets }, (_, idx) => {
            const lowP = minLow + idx * bucketStep
            const highP = lowP + bucketStep
            const midP = (lowP + highP) / 2
            return {
              lowP,
              highP,
              midP,
              intensity: 0,
              originTime: lbCandles[n - 1].time,
              side: midP >= currentPrice ? 'SHORT_LIQ' : 'LONG_LIQ',
              tierCounts: {}
            }
          })

          // Hitung rata-rata volume untuk bobot klaster
          let avgVol = 0
          for (let i = 0; i < n; i++) avgVol += lbCandles[i].volume || 0
          avgVol = Math.max(1e-9, avgVol / n)

          for (let i = 0; i < n - 1; i++) {
            const c = lbCandles[i]
            const relVol = Math.min(4.0, (c.volume || 0) / avgVol)
            if (relVol < 0.35) continue

            // Cek apakah candle merupakan lokal swing high/low (bobot likuiditas ekstra)
            const isLocalHigh =
              i >= 2 &&
              i < n - 2 &&
              c.high >= lbCandles[i - 1].high &&
              c.high >= lbCandles[i - 2].high &&
              c.high >= lbCandles[i + 1].high
            const isLocalLow =
              i >= 2 &&
              i < n - 2 &&
              c.low <= lbCandles[i - 1].low &&
              c.low <= lbCandles[i - 2].low &&
              c.low <= lbCandles[i + 1].low

            const pivotBoostHigh = isLocalHigh ? 2.1 : 1.0
            const pivotBoostLow = isLocalLow ? 2.1 : 1.0

            for (let t = 0; t < activeTiers.length; t++) {
              const tier = activeTiers[t]

              // 1. Short Liquidation Pool di atas candle High (Short Squeeze Target)
              const shortLiqPrice = c.high * (1 + tier.dist)
              if (shortLiqPrice > suffixMaxHigh[i] && shortLiqPrice > currentPrice) {
                const bIdx = Math.floor((shortLiqPrice - minLow) / bucketStep)
                if (bIdx >= 0 && bIdx < numBuckets) {
                  const w = relVol * tier.weight * pivotBoostHigh
                  buckets[bIdx].intensity += w
                  buckets[bIdx].side = 'SHORT_LIQ'
                  if (c.time < buckets[bIdx].originTime) buckets[bIdx].originTime = c.time
                  buckets[bIdx].tierCounts[tier.label] = (buckets[bIdx].tierCounts[tier.label] || 0) + w
                }
              }

              // 2. Long Liquidation Pool di bawah candle Low (Long Squeeze Target)
              const longLiqPrice = c.low * (1 - tier.dist)
              if (longLiqPrice < suffixMinLow[i] && longLiqPrice < currentPrice) {
                const bIdx = Math.floor((longLiqPrice - minLow) / bucketStep)
                if (bIdx >= 0 && bIdx < numBuckets) {
                  const w = relVol * tier.weight * pivotBoostLow
                  buckets[bIdx].intensity += w
                  buckets[bIdx].side = 'LONG_LIQ'
                  if (c.time < buckets[bIdx].originTime) buckets[bIdx].originTime = c.time
                  buckets[bIdx].tierCounts[tier.label] = (buckets[bIdx].tierCounts[tier.label] || 0) + w
                }
              }
            }
          }

          let maxIntensity = 0
          for (let i = 0; i < numBuckets; i++) {
            if (buckets[i].intensity > maxIntensity) maxIntensity = buckets[i].intensity
          }

          if (maxIntensity > 0) {
            const getThermalColor = (norm: number): string => {
              const theme = ofConfig.liqTheme || 'coinglass'
              if (theme === 'fire') {
                if (norm >= 0.82) return '#fde047' // Bright Yellow
                if (norm >= 0.58) return '#f97316' // Orange
                return '#dc2626' // Red
              }
              if (theme === 'cyber') {
                if (norm >= 0.82) return '#facc15' // Gold
                if (norm >= 0.55) return '#10b981' // Emerald
                return '#0284c7' // Cyber Blue
              }
              // Default Coinglass Thermal (Purple -> Cyan -> Emerald -> Bright Yellow)
              if (norm >= 0.82) return '#facc15'
              if (norm >= 0.62) return '#10b981'
              if (norm >= 0.42) return '#06b6d4'
              return '#7c3aed'
            }

            const minThresh = ofConfig.minIntensityThreshold || 0.25
            ctx.save()

            // Render pita-pita thermal heatmap
            for (let i = 0; i < numBuckets; i++) {
              const b = buckets[i]
              const norm = b.intensity / maxIntensity
              if (norm < minThresh) continue

              const yTop = series.priceToCoordinate(b.highP)
              const yBot = series.priceToCoordinate(b.lowP)
              if (yTop === null || yBot === null) continue

              const bandY = Math.min(yTop, yBot)
              const bandH = Math.max(2, Math.abs(yBot - yTop) - 0.5)
              if (bandY + bandH < 0 || bandY > height) continue

              const pOrigin = resolveCoord(b.originTime, b.midP)
              const startX = pOrigin ? Math.max(0, Math.min(maxChartX - 40, pOrigin.x)) : 0
              const bandW = Math.max(20, maxChartX - startX)

              const col = getThermalColor(norm)
              ctx.fillStyle = col
              ctx.globalAlpha = Math.min(0.85, (ofConfig.liqOpacity || 0.55) * (0.35 + 0.65 * norm))
              ctx.fillRect(startX, bandY, bandW, bandH)
            }

            ctx.globalAlpha = 1.0

            // Cari Top Magnet Short Liq (di atas harga) & Top Magnet Long Liq (di bawah harga)
            if (ofConfig.showLiqMagnets) {
              const shortPools = buckets
                .filter((b) => b.side === 'SHORT_LIQ' && b.intensity / maxIntensity >= minThresh)
                .sort((a, b) => b.intensity - a.intensity)
                .slice(0, 2)

              const longPools = buckets
                .filter((b) => b.side === 'LONG_LIQ' && b.intensity / maxIntensity >= minThresh)
                .sort((a, b) => b.intensity - a.intensity)
                .slice(0, 2)

              const drawMagnetPool = (pool: LiqBucket, rank: number) => {
                const y = series.priceToCoordinate(pool.midP)
                if (y === null || y < 10 || y > height - 24) return

                const norm = pool.intensity / maxIntensity
                const pOrigin = resolveCoord(pool.originTime, pool.midP)
                const startX = pOrigin ? Math.max(0, Math.min(maxChartX - 80, pOrigin.x)) : 0

                // Cari dominant tier label
                let domTier = '50x'
                let bestW = -1
                Object.entries(pool.tierCounts).forEach(([tName, wVal]) => {
                  if (wVal > bestW) {
                    bestW = wVal
                    domTier = tName
                  }
                })

                const color = rank === 0 ? '#facc15' : '#22d3ee'
                ctx.save()
                ctx.beginPath()
                ctx.strokeStyle = color
                ctx.lineWidth = rank === 0 ? 1.6 : 1.1
                ctx.setLineDash(rank === 0 ? [6, 3] : [3, 3])
                ctx.moveTo(startX, y)
                ctx.lineTo(maxChartX, y)
                ctx.stroke()
                ctx.setLineDash([])

                if (ofConfig.showLiqLabels) {
                  const sideTag = pool.side === 'SHORT_LIQ' ? 'SHORT LIQ' : 'LONG LIQ'
                  const pctDist = Math.abs(((pool.midP - currentPrice) / currentPrice) * 100).toFixed(2)
                  const labelText = `🔥 ${sideTag} [${domTier}] $${formatPrice(pool.midP)} (${pool.side === 'SHORT_LIQ' ? '+' : '-'}${pctDist}%)`
                  ctx.font = 'bold 9px Inter, monospace'
                  const textW = ctx.measureText(labelText).width
                  const padX = 5
                  const pillW = textW + padX * 2
                  const pillH = 14
                  // Tempatkan di sisi kiri pita magnet agar tidak menumpuk dengan label VPVR di kanan
                  const pillX = Math.max(8, Math.min(startX + 6, maxChartX - pillW - 12))
                  const pillY = y - pillH / 2

                  ctx.fillStyle = 'rgba(11, 15, 25, 0.92)'
                  ctx.strokeStyle = color
                  ctx.lineWidth = 1
                  ctx.beginPath()
                  if (typeof (ctx as any).roundRect === 'function') {
                    ;(ctx as any).roundRect(pillX, pillY, pillW, pillH, 3)
                  } else {
                    ctx.rect(pillX, pillY, pillW, pillH)
                  }
                  ctx.fill()
                  ctx.stroke()

                  ctx.textAlign = 'left'
                  ctx.fillStyle = norm >= 0.75 ? '#fde047' : color
                  ctx.fillText(labelText, pillX + padX, pillY + 10)
                }
                ctx.restore()
              }

              shortPools.forEach((p, idx) => drawMagnetPool(p, idx))
              longPools.forEach((p, idx) => drawMagnetPool(p, idx))
            }

            ctx.restore()
          }
        }
      }
    }

    // 0.7. CVD (Cumulative Volume Delta) & Orderflow Divergence Indicator
    if (visibility.cvdOrderflow && candles.length >= 15) {
      const ofConfig: OrderflowSettings = orderflowSettings || DEFAULT_ORDERFLOW_SETTINGS
      const maxChartX = Math.max(40, width - 68)

      // 1. Hitung Per-Bar Volume Delta & Cumulative Volume Delta (CVD)
      const deltas: number[] = new Array(candles.length).fill(0)
      const cvdArr: number[] = new Array(candles.length).fill(0)
      let runningCvd = 0
      let sumAbsDelta = 0

      for (let i = 0; i < candles.length; i++) {
        const c = candles[i]
        const vol = Number(c.volume) || 0
        let buyVol = 0
        let sellVol = 0

        if (c.taker_buy_volume && c.taker_buy_volume > 0 && c.taker_buy_volume <= vol) {
          buyVol = c.taker_buy_volume
          sellVol = Math.max(0, vol - c.taker_buy_volume)
        } else {
          const cRange = c.high - c.low
          const buyRatio =
            cRange > 0
              ? c.close >= c.open
                ? 0.5 + 0.5 * ((c.close - c.open) / cRange)
                : 0.5 * ((c.close - c.low) / cRange)
              : c.close >= c.open
                ? 1
                : 0
          buyVol = vol * buyRatio
          sellVol = vol * (1 - buyRatio)
        }

        const delta = buyVol - sellVol
        deltas[i] = delta
        runningCvd += delta
        cvdArr[i] = runningCvd
        sumAbsDelta += Math.abs(delta)
      }

      const avgAbsDelta = Math.max(1e-9, sumAbsDelta / candles.length)

      // 2. Whale Aggressor Delta Imbalance Markers pada Candle
      if (ofConfig.showDeltaImbalance) {
        const mult = ofConfig.deltaImbalanceMultiplier || 2.2
        const startScan = Math.max(0, candles.length - 120)
        ctx.save()
        for (let i = startScan; i < candles.length; i++) {
          const c = candles[i]
          const d = deltas[i]
          const absD = Math.abs(d)
          const vol = Math.max(1e-9, c.volume || 0)
          const domRatio = absD / vol

          if (absD >= avgAbsDelta * mult && domRatio >= 0.32) {
            const isBuyImb = d > 0
            const coord = resolveCoord(c.time, isBuyImb ? c.low : c.high)
            if (!coord || coord.x < 10 || coord.x > maxChartX - 10) continue

            ctx.fillStyle = isBuyImb ? (ofConfig.cvdBullColor || '#00c087') : (ofConfig.cvdBearColor || '#f6465d')
            ctx.beginPath()
            ctx.arc(coord.x, isBuyImb ? coord.y + 8 : coord.y - 8, 2.8, 0, Math.PI * 2)
            ctx.fill()
          }
        }
        ctx.restore()
      }

      // 3. Deteksi Otomatis CVD Divergence (Bullish Absorption & Bearish Exhaustion)
      if (ofConfig.showCvdDivergence && candles.length >= 30) {
        const lookbackStart = Math.max(3, candles.length - 110)
        const swingLows: { idx: number; time: number; price: number; cvd: number }[] = []
        const swingHighs: { idx: number; time: number; price: number; cvd: number }[] = []

        for (let i = lookbackStart; i < candles.length - 2; i++) {
          const c = candles[i]
          const isLowPivot =
            c.low <= candles[i - 1].low &&
            c.low <= candles[i - 2].low &&
            c.low <= candles[i - 3].low &&
            c.low <= candles[i + 1].low &&
            c.low <= candles[i + 2].low
          if (isLowPivot) {
            swingLows.push({ idx: i, time: c.time, price: c.low, cvd: cvdArr[i] })
          }

          const isHighPivot =
            c.high >= candles[i - 1].high &&
            c.high >= candles[i - 2].high &&
            c.high >= candles[i - 3].high &&
            c.high >= candles[i + 1].high &&
            c.high >= candles[i + 2].high
          if (isHighPivot) {
            swingHighs.push({ idx: i, time: c.time, price: c.high, cvd: cvdArr[i] })
          }
        }

        const drawDivergenceSignal = (
          p1Time: number,
          p1Price: number,
          p2Time: number,
          p2Price: number,
          isBull: boolean,
          label: string
        ) => {
          const c1 = resolveCoord(p1Time, p1Price)
          const c2 = resolveCoord(p2Time, p2Price)
          if (!c1 || !c2 || c2.x < 10 || c1.x > maxChartX) return

          const color = isBull ? (ofConfig.cvdBullColor || '#00c087') : (ofConfig.cvdBearColor || '#f6465d')
          ctx.save()
          ctx.beginPath()
          ctx.strokeStyle = color
          ctx.lineWidth = 2
          ctx.setLineDash([4, 2])
          ctx.moveTo(c1.x, isBull ? c1.y + 4 : c1.y - 4)
          ctx.lineTo(c2.x, isBull ? c2.y + 4 : c2.y - 4)
          ctx.stroke()
          ctx.setLineDash([])

          // Anchor dots
          ;[c1, c2].forEach((pt) => {
            ctx.fillStyle = color
            ctx.beginPath()
            ctx.arc(pt.x, isBull ? pt.y + 4 : pt.y - 4, 3, 0, Math.PI * 2)
            ctx.fill()
          })

          // Pill badge
          ctx.font = 'bold 9px Inter, monospace'
          const textW = ctx.measureText(label).width
          const padX = 5
          const pillW = textW + padX * 2
          const pillH = 14
          const midX = (c1.x + c2.x) / 2
          const pillX = Math.max(6, Math.min(maxChartX - pillW - 4, midX - pillW / 2))
          const pillY = isBull ? Math.max(c1.y, c2.y) + 8 : Math.min(c1.y, c2.y) - pillH - 8

          ctx.fillStyle = 'rgba(11, 15, 25, 0.92)'
          ctx.strokeStyle = color
          ctx.lineWidth = 1
          ctx.beginPath()
          if (typeof (ctx as any).roundRect === 'function') {
            ;(ctx as any).roundRect(pillX, pillY, pillW, pillH, 3)
          } else {
            ctx.rect(pillX, pillY, pillW, pillH)
          }
          ctx.fill()
          ctx.stroke()

          ctx.textAlign = 'left'
          ctx.fillStyle = color
          ctx.fillText(label, pillX + padX, pillY + 10)
          ctx.restore()
        }

        // Cek Bullish CVD Divergence terbaru (Harga Lower Low, CVD Higher Low)
        for (let k = swingLows.length - 1; k >= 1; k--) {
          const l2 = swingLows[k]
          const l1 = swingLows[k - 1]
          if (l2.idx - l1.idx >= 5 && l2.idx - l1.idx <= 55) {
            if (l2.price < l1.price * 0.9995 && l2.cvd > l1.cvd + avgAbsDelta * 0.8) {
              drawDivergenceSignal(l1.time, l1.price, l2.time, l2.price, true, 'CVD Bull Div (Absorption)')
              break
            }
          }
        }

        // Cek Bearish CVD Divergence terbaru (Harga Higher High, CVD Lower High)
        for (let k = swingHighs.length - 1; k >= 1; k--) {
          const h2 = swingHighs[k]
          const h1 = swingHighs[k - 1]
          if (h2.idx - h1.idx >= 5 && h2.idx - h1.idx <= 55) {
            if (h2.price > h1.price * 1.0005 && h2.cvd < h1.cvd - avgAbsDelta * 0.8) {
              drawDivergenceSignal(h1.time, h1.price, h2.time, h2.price, false, 'CVD Bear Div (Exhaustion)')
              break
            }
          }
        }
      }

      // 4. Bottom CVD Cumulative Curve & Per-Bar Delta Histogram Ribbon
      if (ofConfig.showCvdRibbon && height >= 220) {
        let fromIdx = Math.max(0, candles.length - 120)
        let toIdx = candles.length - 1
        try {
          const logicalRange = chart.timeScale().getVisibleLogicalRange()
          if (logicalRange) {
            fromIdx = Math.max(0, Math.floor(logicalRange.from))
            toIdx = Math.min(candles.length - 1, Math.ceil(logicalRange.to))
          }
        } catch {}

        if (toIdx - fromIdx >= 5) {
          const ribbonH = Math.max(42, Math.min(110, Math.round((height * (ofConfig.cvdRibbonHeightPct || 16)) / 100)))
          const ribbonBottom = height - 26
          const ribbonTop = ribbonBottom - ribbonH
          const ribbonMidY = ribbonTop + ribbonH / 2

          let minCvd = Infinity
          let maxCvd = -Infinity
          let maxBarAbsDelta = 1e-9
          for (let i = fromIdx; i <= toIdx; i++) {
            if (cvdArr[i] < minCvd) minCvd = cvdArr[i]
            if (cvdArr[i] > maxCvd) maxCvd = cvdArr[i]
            const ad = Math.abs(deltas[i])
            if (ad > maxBarAbsDelta) maxBarAbsDelta = ad
          }
          const cvdRange = Math.max(1e-9, maxCvd - minCvd)

          ctx.save()
          // Translucent Panel Backdrop
          ctx.fillStyle = 'rgba(11, 14, 20, 0.72)'
          ctx.fillRect(0, ribbonTop, maxChartX, ribbonH)
          ctx.strokeStyle = 'rgba(43, 53, 72, 0.65)'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(0, ribbonTop)
          ctx.lineTo(maxChartX, ribbonTop)
          ctx.stroke()

          // Zero baseline for per-bar Delta Histogram
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.18)'
          ctx.setLineDash([3, 3])
          ctx.beginPath()
          ctx.moveTo(0, ribbonMidY)
          ctx.lineTo(maxChartX, ribbonMidY)
          ctx.stroke()
          ctx.setLineDash([])

          // Per-Candle Delta Histogram Bars
          const approxBarW = Math.max(1.5, Math.min(7, (maxChartX / Math.max(10, toIdx - fromIdx + 1)) * 0.55))
          for (let i = fromIdx; i <= toIdx; i++) {
            const c = candles[i]
            const pt = resolveCoord(c.time, c.close)
            if (!pt || pt.x < 2 || pt.x > maxChartX - 2) continue

            const d = deltas[i]
            const barLen = (Math.abs(d) / maxBarAbsDelta) * (ribbonH * 0.42)
            ctx.fillStyle = d >= 0 ? (ofConfig.cvdBullColor || '#00c087') : (ofConfig.cvdBearColor || '#f6465d')
            ctx.globalAlpha = 0.52
            if (d >= 0) {
              ctx.fillRect(pt.x - approxBarW / 2, ribbonMidY - barLen, approxBarW, Math.max(1, barLen))
            } else {
              ctx.fillRect(pt.x - approxBarW / 2, ribbonMidY, approxBarW, Math.max(1, barLen))
            }
          }
          ctx.globalAlpha = 1.0

          // Smooth Cumulative Volume Delta (CVD) Curve Line
          ctx.beginPath()
          ctx.strokeStyle = ofConfig.cvdLineColor || '#38bdf8'
          ctx.lineWidth = 1.6
          let started = false
          for (let i = fromIdx; i <= toIdx; i++) {
            const c = candles[i]
            const pt = resolveCoord(c.time, c.close)
            if (!pt || pt.x < 0 || pt.x > maxChartX) continue

            const normCvd = (cvdArr[i] - minCvd) / cvdRange
            const yCvd = ribbonBottom - 5 - normCvd * (ribbonH - 12)
            if (!started) {
              ctx.moveTo(pt.x, yCvd)
              started = true
            } else {
              ctx.lineTo(pt.x, yCvd)
            }
          }
          if (started) ctx.stroke()

          // Header Badge inside CVD Ribbon
          const lastDelta = deltas[candles.length - 1] || 0
          const cvdSlopeBull = cvdArr[toIdx] >= cvdArr[Math.max(fromIdx, toIdx - 10)]
          const fmtDelta = (val: number) => {
            const a = Math.abs(val)
            const sign = val >= 0 ? '+' : '-'
            if (a >= 1_000_000) return `${sign}${(a / 1_000_000).toFixed(2)}M`
            if (a >= 1_000) return `${sign}${(a / 1_000).toFixed(1)}K`
            return `${sign}${a.toFixed(1)}`
          }

          const statusText = `CVD ORDERFLOW • Δ Bar: ${fmtDelta(lastDelta)} • Trend: ${cvdSlopeBull ? 'BUY ACCUMULATION' : 'SELL DISTRIBUTION'}`
          ctx.font = 'bold 9px Inter, monospace'
          ctx.fillStyle = cvdSlopeBull ? (ofConfig.cvdBullColor || '#00c087') : (ofConfig.cvdBearColor || '#f6465d')
          ctx.textAlign = 'left'
          ctx.fillText(statusText, 8, ribbonTop + 11)
          ctx.restore()
        }
      }
    }

    // A0. Trend Strength EMA Ribbon (EMA 8, 21, 55, 200) - Ribbon Stack & Trend Corridor
    if (visibility.trendRibbon && trendStrength?.ribbon_series && trendStrength.ribbon_series.length > 1) {
      const seriesPoints = trendStrength.ribbon_series
      const lastPoint = seriesPoints[seriesPoints.length - 1]
      const isBull = trendStrength.direction === 'BULLISH' || (lastPoint && lastPoint.ema8 >= lastPoint.ema55)

      // 1. Soft Fill Corridor between EMA 8 and EMA 55
      const coords8: { x: number; y: number }[] = []
      const coords55: { x: number; y: number }[] = []

      for (let i = 0; i < seriesPoints.length; i++) {
        const pt = seriesPoints[i]
        const p8 = resolveCoord(pt.time, pt.ema8)
        const p55 = resolveCoord(pt.time, pt.ema55)
        if (p8 && p55) {
          coords8.push(p8)
          coords55.push(p55)
        }
      }

      if (coords8.length > 1 && coords55.length > 1) {
        ctx.save()
        ctx.beginPath()
        ctx.moveTo(coords8[0].x, coords8[0].y)
        for (let i = 1; i < coords8.length; i++) {
          ctx.lineTo(coords8[i].x, coords8[i].y)
        }
        for (let i = coords55.length - 1; i >= 0; i--) {
          ctx.lineTo(coords55[i].x, coords55[i].y)
        }
        ctx.closePath()
        ctx.fillStyle = isBull ? 'rgba(0, 192, 135, 0.08)' : 'rgba(246, 70, 93, 0.08)'
        ctx.fill()
        ctx.restore()
      }

      // 2. Render 4 EMA Ribbon Lines: EMA 8 (#38bdf8), EMA 21 (#f59e0b), EMA 55 (#a855f7), EMA 200 (#ec4899)
      const ribbonConfigs = [
        { key: 'ema8' as const, color: 'rgba(56, 189, 248, 0.85)', width: 1.5 },
        { key: 'ema21' as const, color: 'rgba(245, 158, 11, 0.85)', width: 1.5 },
        { key: 'ema55' as const, color: 'rgba(168, 85, 247, 0.80)', width: 1.2 },
        { key: 'ema200' as const, color: 'rgba(236, 72, 153, 0.80)', width: 1.8 }
      ]

      ribbonConfigs.forEach((cfg) => {
        ctx.save()
        ctx.beginPath()
        ctx.strokeStyle = cfg.color
        ctx.lineWidth = cfg.width
        let started = false

        for (let i = 0; i < seriesPoints.length; i++) {
          const pt = seriesPoints[i]
          const val = pt[cfg.key]
          if (typeof val !== 'number') continue
          const coord = resolveCoord(pt.time, val)
          if (!coord) continue

          if (!started) {
            ctx.moveTo(coord.x, coord.y)
            started = true
          } else {
            ctx.lineTo(coord.x, coord.y)
          }
        }

        if (started) {
          ctx.stroke()
        }
        ctx.restore()
      })
    }

    // A. Support & Resistance Levels (Horizontal S/R Lines)
    if (patterns && visibility.srLevels && patterns.support_resistance) {
      patterns.support_resistance.forEach((sr) => {
        const y = series.priceToCoordinate(sr.price)
        if (y === null || y < 0 || y > height) return

        const isRes = sr.type === 'RESISTANCE'
        ctx.strokeStyle = isRes ? 'rgba(246, 70, 93, 0.45)' : 'rgba(0, 192, 135, 0.45)'
        ctx.lineWidth = 1.5
        ctx.setLineDash([4, 4])

        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(width - 65, y)
        ctx.stroke()
        ctx.setLineDash([])

        // Badge
        ctx.fillStyle = isRes ? '#f6465d' : '#00c087'
        ctx.fillRect(8, y - 8, 130, 16)
        ctx.fillStyle = '#000000'
        ctx.font = 'bold 9px monospace'
        ctx.fillText(`${sr.type[0]}: $${formatPrice(sr.price)} (${sr.strength}x)`, 12, y + 4)
      })
    }

    // B1. SMC Liquidity Pools (EQH & EQL - Dotted Lines)
    if (smc && visibility.smcEvents && smc.liquidity_pools) {
      smc.liquidity_pools.forEach((lp) => {
        if (!lp.times || lp.times.length < 2) return
        const t1 = lp.times[0]
        const t2 = lp.times[lp.times.length - 1]
        const p1 = resolveCoord(t1, lp.price)
        const p2 = resolveCoord(t2, lp.price)
        const y = series.priceToCoordinate(lp.price)
        if (!p1 || !p2 || y === null) return

        const isEqh = lp.type === 'EQH'
        const color = isEqh ? '#f6465d' : '#00c087'

        ctx.save()
        ctx.beginPath()
        ctx.setLineDash([2, 3])
        ctx.strokeStyle = color
        ctx.lineWidth = 1.2
        ctx.moveTo(p1.x, y)
        ctx.lineTo(p2.x, y)
        ctx.stroke()
        ctx.setLineDash([])

        ctx.font = 'bold 9px Inter, monospace'
        ctx.fillStyle = color
        const midX = (p1.x + p2.x) / 2
        ctx.fillText(lp.type, midX - 10, isEqh ? y - 5 : y + 12)
        ctx.restore()
      })
    }

    // B2. SMC Market Structure (BOS & CHoCH Horizontal Lines with Centered Badge)
    if (smc && visibility.smcEvents && smc.events) {
      smc.events.forEach((ev) => {
        const pStart = resolveCoord(ev.level_time, ev.level_price)
        const pBreak = resolveCoord(ev.break_time, ev.break_price)
        const yLevel = series.priceToCoordinate(ev.level_price)
        if (!pStart || !pBreak || yLevel === null) return

        const startX = pStart.x
        const endX = pBreak.x
        if (endX < 0 || startX > width - 65 || endX <= startX) return

        const isBull = ev.direction === 'BULLISH'
        const isChoch = ev.type === 'CHoCH'
        const color = isBull ? '#00c087' : '#f6465d'

        ctx.save()

        // 1. If CHoCH, render subtle vertical dashed line at reversal pivot candle
        if (isChoch) {
          let pivotTime = ev.level_time
          if (Array.isArray(smc?.swings) && smc.swings.length > 0) {
            const candidates = smc.swings.filter(s => s && s.time >= ev.level_time && s.time <= ev.break_time)
            if (candidates.length > 0) {
              if (isBull) {
                const minLow = candidates.reduce((prev, curr) => curr.price < prev.price ? curr : prev)
                pivotTime = minLow.time
              } else {
                const maxHigh = candidates.reduce((prev, curr) => curr.price > prev.price ? curr : prev)
                pivotTime = maxHigh.time
              }
            }
          }
          const pPivot = resolveCoord(pivotTime, ev.level_price)
          if (pPivot && pPivot.x >= 0 && pPivot.x <= width - 65) {
            ctx.beginPath()
            ctx.setLineDash([4, 4])
            ctx.strokeStyle = 'rgba(148, 163, 184, 0.4)'
            ctx.lineWidth = 1
            ctx.moveTo(pPivot.x, 0)
            ctx.lineTo(pPivot.x, height - 26)
            ctx.stroke()
            ctx.setLineDash([])
          }
        }

        // 2. Horizontal Structure Line (Solid for CHoCH, Dashed for BOS)
        ctx.beginPath()
        ctx.strokeStyle = color
        ctx.lineWidth = isChoch ? 1.5 : 1.2
        ctx.setLineDash(isChoch ? [] : [5, 4])
        ctx.moveTo(startX, yLevel)
        ctx.lineTo(endX, yLevel)
        ctx.stroke()
        ctx.setLineDash([])

        // 3. Vertical Step Connector at Breakout Candle
        const yBreak = series.priceToCoordinate(ev.break_price)
        if (yBreak !== null && Math.abs(yBreak - yLevel) > 2) {
          ctx.beginPath()
          ctx.strokeStyle = color
          ctx.lineWidth = 1.2
          ctx.setLineDash([3, 3])
          ctx.moveTo(endX, yLevel)
          ctx.lineTo(endX, yBreak)
          ctx.stroke()
          ctx.setLineDash([])
        }

        // 4. Centered Label (BOS / CHoCH)
        const labelText = ev.type
        ctx.font = isChoch ? 'bold 11px Inter, monospace' : 'bold 10px Inter, monospace'
        const textMetrics = ctx.measureText(labelText)
        const textW = textMetrics.width
        const midX = (startX + endX) / 2
        const padX = isChoch ? 6 : 5
        const pillW = textW + padX * 2
        const pillH = isChoch ? 16 : 14
        const pillX = midX - pillW / 2
        const pillY = isBull ? yLevel - pillH - 3 : yLevel + 3

        // Draw pill background for clean readability over candles
        ctx.fillStyle = 'rgba(11, 14, 20, 0.9)'
        ctx.strokeStyle = color
        ctx.lineWidth = 1
        ctx.beginPath()
        if (typeof (ctx as any).roundRect === 'function') {
          (ctx as any).roundRect(pillX, pillY, pillW, pillH, 3)
        } else {
          ctx.rect(pillX, pillY, pillW, pillH)
        }
        ctx.fill()
        ctx.stroke()

        // Text inside badge
        ctx.fillStyle = color
        ctx.fillText(labelText, pillX + padX, pillY + (isChoch ? 12 : 11))

        ctx.restore()
      })
    }

    // B3. SMC Swings (Clean Text Labels: HH, HL, LH, LL)
    if (smc && visibility.smcSwings && smc.swings) {
      smc.swings.forEach((s) => {
        const c = resolveCoord(s.time, s.price)
        if (!c || c.x < 0 || c.x > width - 65) return
        const isHigh = s.type === 'HH' || s.type === 'LH' || s.type === 'H'
        const color = isHigh ? '#f6465d' : '#00c087'

        ctx.save()
        ctx.font = 'bold 9px Inter, monospace'
        ctx.fillStyle = color
        const w = ctx.measureText(s.type).width
        ctx.fillText(s.type, c.x - w / 2, isHigh ? c.y - 7 : c.y + 14)
        ctx.restore()
      })
    }

    // B4. Order Blocks (OB) - Clean, Fresh (Unmitigated) & Non-Overlapping
    if (smc && visibility.orderBlocks && Array.isArray(smc.order_blocks) && smc.order_blocks.length > 0) {
      const currentCandle = candles.length > 0 ? candles[candles.length - 1] : null
      const currentPrice = currentCandle ? currentCandle.close : 0

      // 1. Filter out INVALIDATED order blocks and only keep active, FRESH (Unmitigated) OBs
      // In professional SMC trading, dead / mitigated / breached OBs create heavy visual clutter
      const freshOBs = smc.order_blocks.filter((ob) => {
        // Exclude invalidated OBs
        if (ob.status === 'INVALIDATED') return false
        // Exclude already mitigated (consumed) OBs to avoid visual clutter
        if (ob.mitigated || ob.status === 'MITIGATED') return false

        // Invalidation sanity check against current live price:
        if (currentPrice > 0) {
          // If Bullish OB is above current price (meaning price broke downwards through it), it is violated
          if (ob.direction === 'BULLISH' && currentPrice < ob.bottom) return false
          // If Bearish OB is below current price (meaning price broke upwards through it), it is violated
          if (ob.direction === 'BEARISH' && currentPrice > ob.top) return false
        }
        return true
      })

      // 2. Separate into Bullish (Demand/Support) and Bearish (Supply/Resistance)
      // Sort by recency (newest first)
      const bullOBs = freshOBs
        .filter((ob) => ob.direction === 'BULLISH')
        .sort((a, b) => b.start_time - a.start_time)
      const bearOBs = freshOBs
        .filter((ob) => ob.direction === 'BEARISH')
        .sort((a, b) => b.start_time - a.start_time)

      // 3. Deduplicate overlapping zones of the same direction (prevent stacking boxes)
      const deduplicateOBs = (list: typeof freshOBs) => {
        const result: typeof freshOBs = []
        for (const ob of list) {
          const overlaps = result.some((existing) => {
            const overlapTop = Math.min(ob.top, existing.top)
            const overlapBottom = Math.max(ob.bottom, existing.bottom)
            if (overlapTop > overlapBottom) {
              const overlapHeight = overlapTop - overlapBottom
              const minHeight = Math.min(ob.top - ob.bottom, existing.top - existing.bottom)
              return minHeight > 0 && (overlapHeight / minHeight) > 0.45
            }
            return false
          })
          if (!overlaps) {
            result.push(ob)
          }
        }
        return result
      }

      // Keep at most the 2 cleanest, most relevant fresh Bullish OBs and 2 fresh Bearish OBs
      const cleanBullOBs = deduplicateOBs(bullOBs).slice(0, 2)
      const cleanBearOBs = deduplicateOBs(bearOBs).slice(0, 2)
      const activeDisplayOBs = [...cleanBullOBs, ...cleanBearOBs]

      activeDisplayOBs.forEach((ob) => {
        const pStart = resolveCoord(ob.start_time, ob.top)
        if (!pStart) return

        const startX = Math.max(0, pStart.x)
        const endX = Math.max(startX + 60, width - 68)

        const topY = series.priceToCoordinate(ob.top)
        const botY = series.priceToCoordinate(ob.bottom)
        if (topY === null || botY === null) return

        const isBull = ob.direction === 'BULLISH'
        const obHeight = Math.max(4, Math.abs(botY - topY))
        const obY = Math.min(topY, botY)
        const obW = Math.max(10, endX - startX)

        if (startX + obW < 0 || startX > width) return

        ctx.save()
        // Subtle, elegant semi-transparent fill
        ctx.fillStyle = isBull ? 'rgba(0, 192, 135, 0.12)' : 'rgba(246, 70, 93, 0.12)'
        ctx.strokeStyle = isBull ? 'rgba(0, 192, 135, 0.85)' : 'rgba(246, 70, 93, 0.85)'
        ctx.lineWidth = 1

        ctx.fillRect(startX, obY, obW, obHeight)
        ctx.strokeRect(startX, obY, obW, obHeight)

        // Pill text badge (TradingView style at the top-left of the zone)
        const labelText = `${isBull ? 'Bullish' : 'Bearish'} OB`
        ctx.font = 'bold 9px Inter, sans-serif'
        const textWidth = ctx.measureText(labelText).width
        const badgeX = Math.max(10, startX + 4)
        const badgeY = Math.max(2, obY + 2)

        if (obHeight >= 14) {
          ctx.fillStyle = isBull ? 'rgba(0, 192, 135, 0.25)' : 'rgba(246, 70, 93, 0.25)'
          ctx.fillRect(badgeX, badgeY, textWidth + 8, 12)
          ctx.fillStyle = isBull ? '#00c087' : '#f6465d'
          ctx.fillText(labelText, badgeX + 4, badgeY + 9)
        } else {
          ctx.fillStyle = isBull ? '#00c087' : '#f6465d'
          ctx.fillText(labelText, badgeX, Math.max(12, obY - 3))
        }

        ctx.restore()
      })
    }

    // C. Fair Value Gaps (FVG) - Clean, Unmitigated Only
    if (smc && visibility.fvgs && Array.isArray(smc.fvgs) && smc.fvgs.length > 0) {
      // Filter out mitigated or filled FVGs to prevent stacking old gap boxes
      const activeFvgs = smc.fvgs
        .filter((fvg) => fvg && !fvg.mitigated && fvg.status !== 'FILLED')
        .slice(-4) // Maximum 4 recent active FVGs

      activeFvgs.forEach((fvg) => {
        const pStart = resolveCoord(fvg.time, fvg.top)
        if (!pStart) return

        const startX = pStart.x
        const endX = Math.max(startX + 60, width - 68)
        const topY = series.priceToCoordinate(fvg.top)
        const botY = series.priceToCoordinate(fvg.bottom)
        if (topY === null || botY === null) return

        const isBull = fvg.direction === 'BULLISH'
        const fvgHeight = Math.max(2, Math.abs(botY - topY))
        const fvgY = Math.min(topY, botY)
        const fvgW = Math.max(10, endX - startX)

        if (startX + fvgW < 0 || startX > width) return

        ctx.save()
        ctx.fillStyle = isBull ? 'rgba(6, 182, 212, 0.12)' : 'rgba(245, 158, 11, 0.12)'
        ctx.strokeStyle = isBull ? 'rgba(6, 182, 212, 0.8)' : 'rgba(245, 158, 11, 0.8)'
        ctx.lineWidth = 1
        ctx.setLineDash([3, 3])

        ctx.fillRect(startX, fvgY, fvgW, fvgHeight)
        ctx.strokeRect(startX, fvgY, fvgW, fvgHeight)

        ctx.setLineDash([])
        ctx.font = 'bold 9px Inter, sans-serif'
        ctx.fillStyle = isBull ? '#06b6d4' : '#f59e0b'
        ctx.fillText(`FVG ${isBull ? '↑' : '↓'}`, Math.max(10, startX + 4), fvgY + 10)
        ctx.restore()
      })
    }

    // D. Render Chart Patterns (Clean Vertical Line at Formation Point - No Cluttering Horizontal Lines)
    if (patterns && visibility.patterns && patterns.patterns) {
      patterns.patterns.forEach((pat, patIdx) => {
        const patName = (pat.name || '').toLowerCase()

        // 1. Triangles & Wedges: Separate upper & lower trendlines + shaded polygon
        if (patName.includes('triangle') || patName.includes('wedge')) {
          const h1 = pat.key_points.find(k => k.name === 'H1')
          const h2 = pat.key_points.find(k => k.name === 'H2')
          const l1 = pat.key_points.find(k => k.name === 'L1')
          const l2 = pat.key_points.find(k => k.name === 'L2')

          if (h1 && h2 && l1 && l2) {
            const pH1 = resolveCoord(h1.time, h1.price)
            const pH2 = resolveCoord(h2.time, h2.price)
            const pL1 = resolveCoord(l1.time, l1.price)
            const pL2 = resolveCoord(l2.time, l2.price)

            if (pH1 && pH2 && pL1 && pL2) {
              // Shaded area inside triangle
              ctx.beginPath()
              ctx.moveTo(pH1.x, pH1.y)
              ctx.lineTo(pH2.x, pH2.y)
              ctx.lineTo(pL2.x, pL2.y)
              ctx.lineTo(pL1.x, pL1.y)
              ctx.closePath()
              ctx.fillStyle = 'rgba(240, 185, 11, 0.08)'
              ctx.fill()

              // Upper Trendline (Resistance)
              ctx.beginPath()
              ctx.strokeStyle = '#f6465d'
              ctx.lineWidth = 1.5
              ctx.moveTo(pH1.x, pH1.y)
              ctx.lineTo(pH2.x, pH2.y)
              ctx.stroke()

              // Lower Trendline (Support)
              ctx.beginPath()
              ctx.strokeStyle = '#00c087'
              ctx.lineWidth = 1.5
              ctx.moveTo(pL1.x, pL1.y)
              ctx.lineTo(pL2.x, pL2.y)
              ctx.stroke()

              // Key Anchor Dots
              ;[pH1, pH2, pL1, pL2].forEach(p => {
                ctx.fillStyle = '#f0b90b'
                ctx.beginPath()
                ctx.arc(p.x, p.y, 3, 0, Math.PI * 2)
                ctx.fill()
              })
            }
          }
        } 
        // 2. Head & Shoulders: Connect chronologically along time
        else if (patName.includes('shoulder')) {
          const sortedKps = [...pat.key_points].sort((a, b) => a.time - b.time)
          ctx.beginPath()
          ctx.strokeStyle = pat.type === 'BEARISH' ? '#f6465d' : '#00c087'
          ctx.lineWidth = 1.5

          let started = false
          sortedKps.forEach((kp) => {
            const c = resolveCoord(kp.time, kp.price)
            if (c) {
              if (!started) { ctx.moveTo(c.x, c.y); started = true }
              else { ctx.lineTo(c.x, c.y) }
            }
          })
          if (started) ctx.stroke()

          sortedKps.forEach((kp) => {
            const c = resolveCoord(kp.time, kp.price)
            if (c) {
              ctx.fillStyle = '#f0b90b'
              ctx.beginPath()
              ctx.arc(c.x, c.y, 3, 0, Math.PI * 2)
              ctx.fill()
            }
          })
        }
        // 3. Double Top & Double Bottom: Peak-to-Peak
        else if (patName.includes('double top') || patName.includes('double bottom')) {
          const sortedKps = [...pat.key_points].sort((a, b) => a.time - b.time)
          ctx.beginPath()
          ctx.strokeStyle = pat.type === 'BEARISH' ? '#f6465d' : '#00c087'
          ctx.lineWidth = 1.5

          let started = false
          sortedKps.forEach((kp) => {
            const c = resolveCoord(kp.time, kp.price)
            if (c) {
              if (!started) { ctx.moveTo(c.x, c.y); started = true }
              else { ctx.lineTo(c.x, c.y) }
            }
          })
          if (started) ctx.stroke()

          sortedKps.forEach((kp) => {
            const c = resolveCoord(kp.time, kp.price)
            if (c) {
              ctx.fillStyle = '#f0b90b'
              ctx.beginPath()
              ctx.arc(c.x, c.y, 3, 0, Math.PI * 2)
              ctx.fill()
            }
          })
        }
        // 4. Generic Pattern: Sorted strictly ascending by time to prevent backwards lines
        else {
          const sortedKps = [...pat.key_points].sort((a, b) => a.time - b.time)
          ctx.beginPath()
          ctx.strokeStyle = pat.type === 'BULLISH' ? '#00c087' : (pat.type === 'BEARISH' ? '#f6465d' : '#f0b90b')
          ctx.lineWidth = 1.5

          let started = false
          sortedKps.forEach((kp) => {
            const c = resolveCoord(kp.time, kp.price)
            if (c) {
              if (!started) { ctx.moveTo(c.x, c.y); started = true }
              else { ctx.lineTo(c.x, c.y) }
            }
          })
          if (started) ctx.stroke()

          sortedKps.forEach((kp) => {
            const c = resolveCoord(kp.time, kp.price)
            if (c) {
              ctx.fillStyle = '#f0b90b'
              ctx.beginPath()
              ctx.arc(c.x, c.y, 3, 0, Math.PI * 2)
              ctx.fill()
            }
          })
        }

        // 5. Draw Clean Vertical Formation Line at the exact point/candle where pattern formed
        const sortedKps = pat.key_points && pat.key_points.length > 0
          ? [...pat.key_points].sort((a, b) => a.time - b.time)
          : []
        const formationKp = sortedKps.length > 0 ? sortedKps[sortedKps.length - 1] : null
        const formationTime = pat.breakout_time || pat.end_time || formationKp?.time || pat.start_time
        const formationPrice = pat.breakout_price || formationKp?.price || (candles.length > 0 ? candles[candles.length - 1].close : 0)

        let posX: number | null = null
        let posY: number | null = null
        const c = resolveCoord(formationTime, formationPrice)
        if (c) {
          posX = c.x
          posY = c.y
        } else {
          const rawX = chart.timeScale().timeToCoordinate(formationTime as any)
          if (rawX !== null) {
            posX = rawX
            const rawY = series.priceToCoordinate(formationPrice)
            posY = rawY !== null ? rawY : height / 2
          }
        }

        if (posX !== null && posX >= 0 && posX <= width - 65) {
          const isBull = pat.type === 'BULLISH'
          const isBear = pat.type === 'BEARISH'
          const patColor = isBull ? '#00c087' : (isBear ? '#f6465d' : '#f0b90b')
          const bottomY = height - 26

          ctx.save()

          // Sleek vertical dashed line from top of chart to time axis
          ctx.beginPath()
          ctx.setLineDash([4, 4])
          ctx.strokeStyle = patColor
          ctx.lineWidth = 1.5
          ctx.moveTo(posX, 0)
          ctx.lineTo(posX, bottomY)
          ctx.stroke()
          ctx.setLineDash([])

          // Anchor marker circle at the formation price point
          if (posY !== null && posY >= 0 && posY <= bottomY) {
            ctx.beginPath()
            ctx.arc(posX, posY, 6, 0, Math.PI * 2)
            ctx.fillStyle = isBull ? 'rgba(0, 192, 135, 0.25)' : (isBear ? 'rgba(246, 70, 93, 0.25)' : 'rgba(240, 185, 11, 0.25)')
            ctx.fill()

            ctx.beginPath()
            ctx.arc(posX, posY, 3.5, 0, Math.PI * 2)
            ctx.fillStyle = patColor
            ctx.fill()
            ctx.strokeStyle = '#0b0e14'
            ctx.lineWidth = 1.5
            ctx.stroke()
          }

          // Compact badge at top of the vertical line
          const icon = isBull ? '▲' : (isBear ? '▼' : '◆')
          const badgeText = `${icon} ${pat.name}`
          ctx.font = 'bold 10px Inter, monospace'
          const textMetrics = ctx.measureText(badgeText)
          const badgeW = textMetrics.width + 16
          const badgeH = 20

          // Stagger Y position to avoid overlapping badges if multiple patterns form close together
          const badgeY = 16 + (patIdx % 4) * 24
          const badgeX = Math.max(8, Math.min(width - 70 - badgeW, posX - badgeW / 2))

          // Draw badge pill
          ctx.fillStyle = 'rgba(11, 14, 20, 0.92)'
          ctx.strokeStyle = patColor
          ctx.lineWidth = 1
          ctx.beginPath()
          if (typeof (ctx as any).roundRect === 'function') {
            (ctx as any).roundRect(badgeX, badgeY, badgeW, badgeH, 4)
          } else {
            ctx.rect(badgeX, badgeY, badgeW, badgeH)
          }
          ctx.fill()
          ctx.stroke()

          // Draw badge text
          ctx.fillStyle = patColor
          ctx.fillText(badgeText, badgeX + 8, badgeY + 14)

          ctx.restore()
        }
      })
    }

    // D2. Auto Fibonacci Retracement (Anti-Repaint Algorithm)
    if (visibility.fibonacci && candles.length > 5) {
      const fibConfig = autoFibSettings || DEFAULT_AUTO_FIB_SETTINGS
      const pivotLegs = Math.max(3, fibConfig.pivotLegs || 10)

      let swingHigh: { time: number; price: number } | null = null
      let swingLow: { time: number; price: number } | null = null

      // 1. Pivot Detection Strategy:
      if (fibConfig.source === 'smc_swings' && Array.isArray(smc?.swings) && smc.swings.length >= 2) {
        // Cari Swing High dan Swing Low terkonfirmasi terbaru dari SMC (yang sudah confirmed tanpa repaint)
        const highSwings = smc.swings.filter((s) => s && (s.type === 'H' || s.type === 'HH' || s.type === 'LH'))
        const lowSwings = smc.swings.filter((s) => s && (s.type === 'L' || s.type === 'LL' || s.type === 'HL'))

        if (highSwings.length > 0 && lowSwings.length > 0) {
          const lastHigh = highSwings[highSwings.length - 1]
          const lastLow = lowSwings[lowSwings.length - 1]
          swingHigh = { time: lastHigh.time, price: lastHigh.price }
          swingLow = { time: lastLow.time, price: lastLow.price }
        }
      }

      // Fallback atau jika dipilih zigzag_pivots:
      if (!swingHigh || !swingLow || fibConfig.source === 'zigzag_pivots') {
        // Pure mathematical anti-repaint Zigzag on closed candles:
        // Hanya periksa candle sampai index (candles.length - 1 - pivotLegs)
        // agar kepastian puncak/lembah 100% terkunci oleh penutupan pivotLegs bar di kanannya!
        const maxIdx = candles.length - 1 - pivotLegs
        const L = pivotLegs

        let foundHigh: { time: number; price: number; idx: number } | null = null
        let foundLow: { time: number; price: number; idx: number } | null = null

        for (let i = maxIdx; i >= L; i--) {
          const c = candles[i]
          // Test Swing High
          if (!foundHigh) {
            let isH = true
            for (let k = 1; k <= L; k++) {
              if (candles[i - k].high > c.high || candles[i + k].high >= c.high) {
                isH = false
                break
              }
            }
            if (isH) foundHigh = { time: c.time, price: c.high, idx: i }
          }

          // Test Swing Low
          if (!foundLow) {
            let isL = true
            for (let k = 1; k <= L; k++) {
              if (candles[i - k].low < c.low || candles[i + k].low <= c.low) {
                isL = false
                break
              }
            }
            if (isL) foundLow = { time: c.time, price: c.low, idx: i }
          }

          if (foundHigh && foundLow) break
        }

        if (foundHigh) swingHigh = { time: foundHigh.time, price: foundHigh.price }
        if (foundLow) swingLow = { time: foundLow.time, price: foundLow.price }
      }

      // Jika kedua titik swing berhasil ditemukan:
      if (swingHigh && swingLow && swingHigh.price > swingLow.price) {
        // Tentukan arah tren (Bullish vs Bearish):
        let isBullish: boolean
        if (fibConfig.trendDirection === 'up') {
          isBullish = true
        } else if (fibConfig.trendDirection === 'down') {
          isBullish = false
        } else {
          isBullish = swingHigh.time >= swingLow.time
        }

        // Titik awal dan akhir Fibonacci:
        const origin = isBullish ? swingLow : swingHigh
        const extreme = isBullish ? swingHigh : swingLow

        const pOrigin = resolveCoord(origin.time, origin.price)
        const pExtreme = resolveCoord(extreme.time, extreme.price)

        const highPrice = swingHigh.price
        const lowPrice = swingLow.price
        const priceDiff = highPrice - lowPrice

        // Filter level-level yang aktif
        const rawFibLevels = Array.isArray(fibConfig?.levels) && fibConfig.levels.length > 0
          ? fibConfig.levels
          : DEFAULT_AUTO_FIB_SETTINGS.levels

        const activeLevels = rawFibLevels
          .filter((lvl) => lvl && lvl.enabled)
          .map((lvl) => {
            let effLevel = lvl.level
            if (fibConfig.reverse) {
              effLevel = 1.0 - effLevel
            }

            // Hitung harga level persis
            let levelPrice: number
            if (isBullish) {
              // Bullish: 0.0 di High, 1.0 di Low. Retracement turun dari High
              levelPrice = highPrice - (effLevel * priceDiff)
            } else {
              // Bearish: 0.0 di Low, 1.0 di High. Retracement naik dari Low
              levelPrice = lowPrice + (effLevel * priceDiff)
            }

            const y = series.priceToCoordinate(levelPrice)
            return {
              config: lvl,
              effLevel,
              price: levelPrice,
              y
            }
          })
          .filter((item) => item.y !== null)

        // Urutkan berdasarkan koordinat y (layar) untuk penggambaran background shading antar pita
        const sortedByY = [...activeLevels].sort((a, b) => (a.y as number) - (b.y as number))

        // Batas horizontal garis
        const minAnchorX = pOrigin && pExtreme ? Math.min(pOrigin.x, pExtreme.x) : 0
        const startX = fibConfig.extendLeft ? 0 : Math.max(0, minAnchorX)
        const endX = fibConfig.extendRight ? (width - 65) : Math.max(width - 65, pOrigin && pExtreme ? Math.max(pOrigin.x, pExtreme.x) + 120 : width - 65)

        // 1. Background Shading
        if (fibConfig.backgroundShading && sortedByY.length >= 2) {
          for (let i = 0; i < sortedByY.length - 1; i++) {
            const top = sortedByY[i]
            const bottom = sortedByY[i + 1]
            if (top.y !== null && bottom.y !== null) {
              const bandHeight = Math.abs(bottom.y - top.y)
              if (bandHeight >= 1) {
                const isGoldenPocket =
                  (top.config.level >= 0.618 && top.config.level <= 0.786) ||
                  (bottom.config.level >= 0.618 && bottom.config.level <= 0.786)

                ctx.fillStyle = top.config.color
                ctx.globalAlpha = isGoldenPocket ? Math.min(0.35, (fibConfig.backgroundOpacity || 0.12) * 1.8) : (fibConfig.backgroundOpacity || 0.12)
                ctx.fillRect(startX, Math.min(top.y, bottom.y), endX - startX, bandHeight)
                ctx.globalAlpha = 1.0
              }
            }
          }
        }

        // 2. Garis Baseline Diagonal Penunjuk Swing (Dotted line between Origin and Extreme)
        if (pOrigin && pExtreme) {
          ctx.save()
          ctx.strokeStyle = 'rgba(148, 163, 184, 0.45)'
          ctx.lineWidth = 1
          ctx.setLineDash([3, 3])
          ctx.beginPath()
          ctx.moveTo(pOrigin.x, pOrigin.y)
          ctx.lineTo(pExtreme.x, pExtreme.y)
          ctx.stroke()
          ctx.setLineDash([])

          // Anchor markers
          ;[pOrigin, pExtreme].forEach((pt, pIdx) => {
            ctx.fillStyle = pIdx === 0 ? '#38bdf8' : '#f59e0b'
            ctx.beginPath()
            ctx.arc(pt.x, pt.y, 3.5, 0, Math.PI * 2)
            ctx.fill()
            ctx.strokeStyle = '#0b0e14'
            ctx.lineWidth = 1.5
            ctx.stroke()
          })
          ctx.restore()
        }

        // 3. Level Lines & Labels
        activeLevels.forEach((item) => {
          if (item.y === null) return
          const y = item.y

          ctx.save()
          ctx.strokeStyle = item.config.color
          ctx.lineWidth = fibConfig.lineWidth || 1.2
          if (fibConfig.lineStyle === 'dashed') {
            ctx.setLineDash([5, 4])
          } else if (fibConfig.lineStyle === 'dotted') {
            ctx.setLineDash([2, 2])
          } else {
            ctx.setLineDash([])
          }

          ctx.beginPath()
          ctx.moveTo(startX, y)
          ctx.lineTo(endX, y)
          ctx.stroke()
          ctx.setLineDash([])

          // Format Text Label
          let labelStr = ''
          if (fibConfig.showLevels === 'both') {
            labelStr = `${item.config.level} (${(item.config.level * 100).toFixed(1)}%)`
          } else if (fibConfig.showLevels === 'percent') {
            labelStr = `${(item.config.level * 100).toFixed(1)}%`
          } else {
            labelStr = `${item.config.level}`
          }

          if (fibConfig.showPrices) {
            labelStr += `  $${formatPrice(item.price)}`
          }

          // Posisi Label (Right / Center / Left)
          ctx.font = 'bold 9.5px Inter, monospace'
          const textMetrics = ctx.measureText(labelStr)
          const textW = textMetrics.width
          const padX = 5
          const pillW = textW + padX * 2
          const pillH = 14

          let pillX: number
          if (fibConfig.labelPosition === 'left') {
            pillX = startX + 8
          } else if (fibConfig.labelPosition === 'center') {
            pillX = (startX + endX) / 2 - pillW / 2
          } else {
            pillX = endX - pillW - 6
          }
          const pillY = y - pillH / 2

          // Background pill
          ctx.fillStyle = 'rgba(11, 14, 20, 0.88)'
          ctx.strokeStyle = item.config.color
          ctx.lineWidth = 1
          ctx.beginPath()
          if (typeof (ctx as any).roundRect === 'function') {
            ;(ctx as any).roundRect(pillX, pillY, pillW, pillH, 3)
          } else {
            ctx.rect(pillX, pillY, pillW, pillH)
          }
          ctx.fill()
          ctx.stroke()

          // Text
          ctx.fillStyle = item.config.color
          ctx.fillText(labelStr, pillX + padX, pillY + 10.5)

          ctx.restore()
        })
      }
    }

    // E. Render Forecast Confidence Cone & Trajectory
    if (forecast && visibility.forecastCone && forecast.cone_points.length > 0) {
      const points = forecast.cone_points

      // 95% Confidence Cone Polygon
      ctx.beginPath()
      let firstPoint = true
      points.forEach((pt) => {
        const coord = resolveCoord(pt.time, pt.upper_bound_95)
        if (coord) {
          if (firstPoint) { ctx.moveTo(coord.x, coord.y); firstPoint = false }
          else { ctx.lineTo(coord.x, coord.y) }
        }
      })
      for (let i = points.length - 1; i >= 0; i--) {
        const coord = resolveCoord(points[i].time, points[i].lower_bound_95)
        if (coord) ctx.lineTo(coord.x, coord.y)
      }
      ctx.closePath()
      ctx.fillStyle = 'rgba(240, 185, 11, 0.08)'
      ctx.fill()

      // 80% Confidence Cone Polygon
      ctx.beginPath()
      firstPoint = true
      points.forEach((pt) => {
        const coord = resolveCoord(pt.time, pt.upper_bound_80)
        if (coord) {
          if (firstPoint) { ctx.moveTo(coord.x, coord.y); firstPoint = false }
          else { ctx.lineTo(coord.x, coord.y) }
        }
      })
      for (let i = points.length - 1; i >= 0; i--) {
        const coord = resolveCoord(points[i].time, points[i].lower_bound_80)
        if (coord) ctx.lineTo(coord.x, coord.y)
      }
      ctx.closePath()
      ctx.fillStyle = 'rgba(240, 185, 11, 0.16)'
      ctx.fill()

      // Expected Trajectory Path Line
      ctx.beginPath()
      ctx.setLineDash([4, 3])
      ctx.strokeStyle = '#f0b90b'
      ctx.lineWidth = 2
      firstPoint = true
      points.forEach((pt) => {
        const coord = resolveCoord(pt.time, pt.expected_price)
        if (coord) {
          if (firstPoint) { ctx.moveTo(coord.x, coord.y); firstPoint = false }
          else { ctx.lineTo(coord.x, coord.y) }
        }
      })
      ctx.stroke()
      ctx.setLineDash([])

      // End forecast badge
      const lastPt = points[points.length - 1]
      const endCoord = resolveCoord(lastPt.time, lastPt.expected_price)
      if (endCoord) {
        ctx.fillStyle = '#f0b90b'
        ctx.beginPath()
        ctx.arc(endCoord.x, endCoord.y, 4, 0, Math.PI * 2)
        ctx.fill()

        ctx.fillStyle = '#111620'
        ctx.fillRect(endCoord.x + 8, endCoord.y - 10, 95, 20)
        ctx.strokeStyle = '#f0b90b'
        ctx.strokeRect(endCoord.x + 8, endCoord.y - 10, 95, 20)
        ctx.fillStyle = '#f0b90b'
        ctx.font = 'bold 10px monospace'
        ctx.fillText(`$${formatPrice(lastPt.expected_price)}`, endCoord.x + 12, endCoord.y + 4)
      }
    }

    // F. Render Forecast Scenarios Paths & Targets
    if (forecast && visibility.forecastScenarios && forecast.scenarios) {
      forecast.scenarios.forEach((sc) => {
        if (sc.path && sc.path.length >= 2) {
          ctx.beginPath()
          ctx.strokeStyle = sc.name.includes('Bullish') ? 'rgba(0, 192, 135, 0.7)' : 'rgba(246, 70, 93, 0.7)'
          ctx.lineWidth = 1.5
          ctx.setLineDash([3, 3])

          let started = false
          sc.path.forEach((pt) => {
            const coord = resolveCoord(pt.time, pt.price)
            if (coord) {
              if (!started) { ctx.moveTo(coord.x, coord.y); started = true }
              else { ctx.lineTo(coord.x, coord.y) }
            }
          })
          if (started) ctx.stroke()
          ctx.setLineDash([])
        }
      })
    }

    // F2. Render Valid Entry Box Area (Position Box: Entry Zone, TP Green Box, SL Red Box, R:R Badge)
    // CRITICAL: Strictly draw ONLY when a setup is genuinely VALID (is_valid === true && R:R >= 1.5 && status === 'VALID_ENTRY')
    // NEVER force or draw fallback boxes when setups are invalid (LOW_RR, COUNTER_TREND, etc.)!
    if (forecast && visibility.entryBoxes && Array.isArray(forecast.scenarios) && forecast.scenarios.length > 0) {
      const validSetups = forecast.scenarios.filter(
        (s) => s && s.is_valid === true && (s.risk_reward_ratio || 0) >= 1.5 && s.status === 'VALID_ENTRY'
      )

      // If no valid setup exists, DRAW NOTHING! (Do not force an entry box!)
      if (validSetups.length > 0) {
        validSetups.slice(0, 1).forEach((sc) => {
        const isLocked = Boolean(sc.id?.startsWith('locked_') || sc.name?.includes('[POSISI AKTIF]') || sc.name?.includes('[TERKUNCI]'))
        const isLong = sc.direction === 'LONG' || sc.name.toLowerCase().includes('bullish')
        const currentCandle = candles.length > 0 ? candles[candles.length - 1] : null
        const entryPrice = Number(sc.entry_price || (currentCandle ? currentCandle.close : 0))
        if (!Number.isFinite(entryPrice) || entryPrice <= 0) return

        let targetPrice = Number(sc.target_price || 0)
        let invalidationPrice = Number(sc.invalidation_price || 0)
        if (!Number.isFinite(targetPrice) || targetPrice <= 0) {
          targetPrice = isLong ? entryPrice * 1.03 : entryPrice * 0.97
        }
        if (!Number.isFinite(invalidationPrice) || invalidationPrice <= 0) {
          invalidationPrice = isLong ? entryPrice * 0.985 : entryPrice * 1.015
        }
        const startTime = sc.entry_time || (currentCandle ? currentCandle.time : 0)

        // Live Invalidation Check for uncommitted setup forecasts:
        // (Jika bukan posisi aktif terkunci, candle yang close menembus SL akan menghapus box)
        if (!isLocked && currentCandle) {
          if (isLong && currentCandle.close <= invalidationPrice) return
          if (!isLong && currentCandle.close >= invalidationPrice) return
        }

        // End time diproyeksikan dari candle saat ini ke masa depan (agar box membentang mulus dari entry ke horizon)
        const timeStep = candles.length > 1 ? (candles[1].time - candles[0].time) : 900
        const projectionHorizon = forecast.horizon_candles || 15

        // Titik awal box: jika entry_time adalah candle terbaru, mundurkan 6-8 bar agar
        // box membungkus candle pemicu entry secara rapi, tidak mengambang sendirian di area kosong sebelah kanan
        let effectiveStartTime = sc.entry_time || (currentCandle ? currentCandle.time : 0)
        if (currentCandle && effectiveStartTime >= currentCandle.time) {
          effectiveStartTime = Math.max(candles[0].time, currentCandle.time - 6 * timeStep)
        }

        const futureTime = (currentCandle ? currentCandle.time : effectiveStartTime) + (timeStep * projectionHorizon)
        const pathEndTime = (sc.path && sc.path.length > 0) ? sc.path[sc.path.length - 1].time : 0
        const endTime = Math.max(futureTime, pathEndTime)

        const pStart = resolveCoord(effectiveStartTime, entryPrice)
        const pEnd = resolveCoord(endTime, entryPrice)
        const yEntry = series.priceToCoordinate(entryPrice)
        const yTarget = series.priceToCoordinate(targetPrice)
        const yStop = series.priceToCoordinate(invalidationPrice)

        if (!pStart || yEntry === null || yTarget === null || yStop === null) return

        // Batasi batas horizontal maksimum agar tidak menembus sumbu harga (priceScale) di sisi kanan
        const maxChartX = Math.max(20, width - 68)
        const startX = Math.max(6, pStart.x)

        // Beri alokasi ruang di sebelah kanan luar box untuk label/badge TP, Entry, dan SL
        const estimatedBadgeW = 120
        const maxBoxEndX = Math.max(startX + 35, maxChartX - estimatedBadgeW - 12)
        const rawEndX = pEnd ? Math.max(startX + 50, pEnd.x) : startX + 160
        const endX = Math.min(maxBoxEndX, Math.max(startX + 35, rawEndX))
        const boxWidth = Math.max(20, endX - startX)

        if (startX >= maxChartX || startX + boxWidth < 0) return

        // 1. Take Profit Box (Green Zone)
        const tpY = Math.min(yEntry, yTarget)
        const tpHeight = Math.max(4, Math.abs(yEntry - yTarget))
        ctx.fillStyle = 'rgba(0, 192, 135, 0.16)'
        ctx.strokeStyle = '#00c087'
        ctx.lineWidth = 1.5

        ctx.fillRect(startX, tpY, boxWidth, tpHeight)
        ctx.strokeRect(startX, tpY, boxWidth, tpHeight)

        // 2. Stop Loss Box (Red Zone)
        const slY = Math.min(yEntry, yStop)
        const slHeight = Math.max(4, Math.abs(yEntry - yStop))
        ctx.fillStyle = 'rgba(246, 70, 93, 0.16)'
        ctx.strokeStyle = '#f6465d'
        ctx.lineWidth = 1.5

        ctx.fillRect(startX, slY, boxWidth, slHeight)
        ctx.strokeRect(startX, slY, boxWidth, slHeight)

        // 3. Optional Entry Zone Buffer (High - Low bounds if available)
        if (sc.entry_zone_high && sc.entry_zone_low && sc.entry_zone_high > sc.entry_zone_low) {
          const yZh = series.priceToCoordinate(sc.entry_zone_high)
          const yZl = series.priceToCoordinate(sc.entry_zone_low)
          if (yZh !== null && yZl !== null) {
            const zTop = Math.min(yZh, yZl)
            const zHeight = Math.max(3, Math.abs(yZh - yZl))
            ctx.fillStyle = 'rgba(56, 189, 248, 0.15)'
            ctx.strokeStyle = '#38bdf8'
            ctx.lineWidth = 1
            ctx.setLineDash([3, 3])
            ctx.fillRect(startX, zTop, boxWidth, zHeight)
            ctx.strokeRect(startX, zTop, boxWidth, zHeight)
            ctx.setLineDash([])
          }
        }

        // 4. Center Entry Divider Line
        ctx.beginPath()
        ctx.strokeStyle = '#38bdf8'
        ctx.lineWidth = 2
        ctx.moveTo(startX, yEntry)
        ctx.lineTo(startX + boxWidth, yEntry)
        ctx.stroke()

        // 5. Badges & Text Labels (Di Kanan Luar Kotak / TradingView Style)
        const profitPct = Math.abs(((targetPrice - entryPrice) / entryPrice) * 100)
        const lossPct = Math.abs(((invalidationPrice - entryPrice) / entryPrice) * 100)

        ctx.save()
        ctx.font = 'bold 9.5px Inter, monospace'

        const isCompact = width < 520
        const tpLabel = isCompact
          ? `TP: $${formatPrice(targetPrice)} (+${profitPct.toFixed(1)}%)`
          : `TP: $${formatPrice(targetPrice)} (+${profitPct.toFixed(2)}%)`

        const slLabel = isCompact
          ? `SL: $${formatPrice(invalidationPrice)} (-${lossPct.toFixed(1)}%)`
          : `SL: $${formatPrice(invalidationPrice)} (-${lossPct.toFixed(2)}%)`

        const entryText = isLocked
          ? `🔒 ${isLong ? 'BUY' : 'SELL'}: $${formatPrice(entryPrice)}`
          : `ENTRY: $${formatPrice(entryPrice)}${isCompact ? '' : ` (1:${sc.risk_reward_ratio})`}`

        // Hitung Y posisi vertikal masing-masing badge di kanan luar kotak
        // Agar sejajar dengan level harga masing-masing dan tidak saling bertumpuk
        const minGap = 18
        let tpBadgeY: number = Number(yTarget)
        let entryBadgeY: number = Number(yEntry)
        let slBadgeY: number = Number(yStop)

        if (isLong) {
          // LONG: yTarget < yEntry < yStop (karena koordinat Y canvas 0 di atas)
          if (entryBadgeY - tpBadgeY < minGap) {
            tpBadgeY = entryBadgeY - minGap
          }
          if (slBadgeY - entryBadgeY < minGap) {
            slBadgeY = entryBadgeY + minGap
          }
        } else {
          // SHORT: yStop < yEntry < yTarget
          if (entryBadgeY - slBadgeY < minGap) {
            slBadgeY = entryBadgeY - minGap
          }
          if (tpBadgeY - entryBadgeY < minGap) {
            tpBadgeY = entryBadgeY + minGap
          }
        }

        // Clamp agar tidak keluar dari batas canvas atas dan bawah
        const chartTop = 10
        const chartBottom = height - 25
        tpBadgeY = Math.max(chartTop, Math.min(chartBottom, tpBadgeY))
        entryBadgeY = Math.max(chartTop, Math.min(chartBottom, entryBadgeY))
        slBadgeY = Math.max(chartTop, Math.min(chartBottom, slBadgeY))

        // Helper untuk menggambar rounded pill badge DI KANAN LUAR KOTAK
        const drawSetupBadge = (
          text: string,
          yCenter: number,
          levelY: number,
          textColor: string,
          borderColor: string,
          bgColor = 'rgba(11, 15, 25, 0.94)'
        ) => {
          const textW = ctx.measureText(text).width
          const padX = 6
          const badgeW = textW + padX * 2
          const badgeH = 16

          // Posisi horizontal: PASTI DI KANAN LUAR KOTAK (endX + 8)
          let bX = endX + 8

          // Proteksi: jangan sampai melewati sumbu harga di sisi kanan canvas
          if (bX + badgeW > maxChartX - 2) {
            bX = Math.max(startX + 4, maxChartX - badgeW - 2)
          }

          const bY = yCenter - badgeH / 2

          // Connector line dari ujung kanan kotak (endX, levelY) ke badge luar kotak (bX, yCenter)
          if (bX > endX) {
            ctx.beginPath()
            ctx.strokeStyle = borderColor
            ctx.lineWidth = 1.2
            ctx.moveTo(endX, levelY)
            ctx.lineTo(bX - 2, yCenter)
            ctx.stroke()
          }

          // Background pill
          ctx.fillStyle = bgColor
          ctx.strokeStyle = borderColor
          ctx.lineWidth = 1.2
          ctx.beginPath()
          if (typeof (ctx as any).roundRect === 'function') {
            ;(ctx as any).roundRect(bX, bY, badgeW, badgeH, 3)
          } else {
            ctx.rect(bX, bY, badgeW, badgeH)
          }
          ctx.fill()
          ctx.stroke()

          // Text inside badge
          ctx.textAlign = 'left'
          ctx.fillStyle = textColor
          ctx.fillText(text, bX + padX, bY + 11.5)
        }

        // Gambar ketiga badge secara terpisah di kanan luar kotak
        drawSetupBadge(tpLabel, tpBadgeY, yTarget, '#00c087', '#00c087')
        drawSetupBadge(entryText, entryBadgeY, yEntry, '#38bdf8', '#38bdf8')
        drawSetupBadge(slLabel, slBadgeY, yStop, '#f6465d', '#f6465d')

        ctx.restore()
      })
      }
    }

    // G. Render Manual Drawings
    drawings.forEach((d) => {
      // 1. Trendline
      if (d.type === 'trendline' && d.points.length >= 2) {
        const p1 = resolveCoord(d.points[0].time, d.points[0].price)
        const p2 = resolveCoord(d.points[1].time, d.points[1].price)
        if (p1 && p2) {
          ctx.save()
          ctx.strokeStyle = d.color || '#38bdf8'
          ctx.lineWidth = d.lineWidth || 2
          ctx.setLineDash(d.lineStyle === 'dashed' ? [6, 4] : d.lineStyle === 'dotted' ? [2, 3] : [])
          if (d.id === selectedDrawingId || d.id === hoveredDrawingId) {
            ctx.shadowColor = d.color || '#38bdf8'
            ctx.shadowBlur = 6
          }
          ctx.beginPath()
          ctx.moveTo(p1.x, p1.y)
          ctx.lineTo(p2.x, p2.y)
          ctx.stroke()
          ctx.restore()
        }
      }
      // 2. Ray (One-directional infinite line to future)
      else if (d.type === 'ray' && d.points.length >= 2) {
        const p1 = resolveCoord(d.points[0].time, d.points[0].price)
        const p2 = resolveCoord(d.points[1].time, d.points[1].price)
        if (p1 && p2) {
          ctx.save()
          ctx.strokeStyle = d.color || '#38bdf8'
          ctx.lineWidth = d.lineWidth || 2
          ctx.setLineDash(d.lineStyle === 'dashed' ? [6, 4] : d.lineStyle === 'dotted' ? [2, 3] : [])
          if (d.id === selectedDrawingId || d.id === hoveredDrawingId) {
            ctx.shadowColor = d.color || '#38bdf8'
            ctx.shadowBlur = 6
          }
          ctx.beginPath()
          ctx.moveTo(p1.x, p1.y)
          const dx = p2.x - p1.x
          const dy = p2.y - p1.y
          ctx.lineTo(p1.x + 50 * dx, p1.y + 50 * dy)
          ctx.stroke()
          ctx.restore()
        }
      }
      // 3. Info line (Trendline with quantitative data card)
      else if (d.type === 'info_line' && d.points.length >= 2) {
        const p1 = resolveCoord(d.points[0].time, d.points[0].price)
        const p2 = resolveCoord(d.points[1].time, d.points[1].price)
        if (p1 && p2) {
          ctx.save()
          ctx.strokeStyle = d.color || '#38bdf8'
          ctx.lineWidth = d.lineWidth || 2
          ctx.setLineDash(d.lineStyle === 'dashed' ? [6, 4] : d.lineStyle === 'dotted' ? [2, 3] : [])
          ctx.beginPath()
          ctx.moveTo(p1.x, p1.y)
          ctx.lineTo(p2.x, p2.y)
          ctx.stroke()
          ctx.restore()

          const deltaP = d.points[1].price - d.points[0].price
          const deltaPct = (deltaP / (d.points[0].price || 1)) * 100
          const timeSecs = Math.abs(d.points[1].time - d.points[0].time)
          const days = Math.floor(timeSecs / 86400)
          const hours = Math.floor((timeSecs % 86400) / 3600)
          const mins = Math.floor((timeSecs % 3600) / 60)
          const timeStr = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${mins}m` : `${mins}m`
          const angleDeg = (Math.atan2(-(p2.y - p1.y), p2.x - p1.x) * 180 / Math.PI).toFixed(1)

          const midX = (p1.x + p2.x) / 2
          const midY = (p1.y + p2.y) / 2
          const badgeW = 150
          const badgeH = 34

          ctx.save()
          ctx.fillStyle = '#161a25'
          ctx.strokeStyle = deltaP >= 0 ? '#00c087' : '#f6465d'
          ctx.lineWidth = 1.2
          ctx.beginPath()
          ctx.rect(midX - badgeW / 2, midY - badgeH - 8, badgeW, badgeH)
          ctx.fill()
          ctx.stroke()

          ctx.fillStyle = deltaP >= 0 ? '#00c087' : '#f6465d'
          ctx.font = 'bold 9.5px monospace'
          ctx.fillText(`Δ: ${deltaP >= 0 ? '+' : ''}${formatPrice(deltaP)} (${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(2)}%)`, midX - badgeW / 2 + 6, midY - badgeH + 6)
          ctx.fillStyle = '#94a3b8'
          ctx.font = '8.5px monospace'
          ctx.fillText(`${timeStr} | ∠ ${angleDeg}°`, midX - badgeW / 2 + 6, midY - badgeH + 19)
          ctx.restore()
        }
      }
      // 4. Extended line (Infinite in both directions)
      else if (d.type === 'extended_line' && d.points.length >= 2) {
        const p1 = resolveCoord(d.points[0].time, d.points[0].price)
        const p2 = resolveCoord(d.points[1].time, d.points[1].price)
        if (p1 && p2) {
          ctx.save()
          ctx.strokeStyle = d.color || '#38bdf8'
          ctx.lineWidth = d.lineWidth || 2
          ctx.setLineDash(d.lineStyle === 'dashed' ? [6, 4] : d.lineStyle === 'dotted' ? [2, 3] : [])
          if (d.id === selectedDrawingId || d.id === hoveredDrawingId) {
            ctx.shadowColor = d.color || '#38bdf8'
            ctx.shadowBlur = 6
          }
          ctx.beginPath()
          const dx = p2.x - p1.x
          const dy = p2.y - p1.y
          ctx.moveTo(p1.x - 50 * dx, p1.y - 50 * dy)
          ctx.lineTo(p2.x + 50 * dx, p2.y + 50 * dy)
          ctx.stroke()
          ctx.restore()
        }
      }
      // 5. Trend angle
      else if (d.type === 'trend_angle' && d.points.length >= 2) {
        const p1 = resolveCoord(d.points[0].time, d.points[0].price)
        const p2 = resolveCoord(d.points[1].time, d.points[1].price)
        if (p1 && p2) {
          ctx.save()
          ctx.strokeStyle = d.color || '#f0b90b'
          ctx.lineWidth = d.lineWidth || 2
          ctx.setLineDash(d.lineStyle === 'dashed' ? [6, 4] : d.lineStyle === 'dotted' ? [2, 3] : [])
          ctx.beginPath()
          ctx.moveTo(p1.x, p1.y)
          ctx.lineTo(p2.x, p2.y)
          ctx.stroke()

          ctx.setLineDash([3, 2])
          ctx.strokeStyle = '#64748b'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(p1.x, p1.y)
          ctx.lineTo(p1.x + 40, p1.y)
          ctx.stroke()

          const angleRad = Math.atan2(-(p2.y - p1.y), p2.x - p1.x)
          const degText = `${(angleRad * 180 / Math.PI).toFixed(1)}°`
          ctx.setLineDash([])
          ctx.strokeStyle = d.color || '#f0b90b'
          ctx.beginPath()
          ctx.arc(p1.x, p1.y, 22, 0, -angleRad, angleRad > 0)
          ctx.stroke()

          ctx.fillStyle = d.color || '#f0b90b'
          ctx.font = 'bold 9.5px monospace'
          ctx.fillText(degText, p1.x + 28, p1.y - 6)
          ctx.restore()
        }
      }
      // 6. Horizontal line (Full screen horizontal at fixed price)
      else if (d.type === 'horizontal_line' && d.points.length >= 1) {
        const p = resolveCoord(d.points[0].time, d.points[0].price)
        if (p) {
          ctx.save()
          ctx.strokeStyle = d.color || '#f59e0b'
          ctx.lineWidth = d.lineWidth || 1.5
          ctx.setLineDash(d.lineStyle === 'dashed' ? [6, 4] : d.lineStyle === 'dotted' ? [2, 3] : [5, 4])
          ctx.beginPath()
          ctx.moveTo(0, p.y)
          ctx.lineTo(width - 65, p.y)
          ctx.stroke()
          ctx.setLineDash([])

          ctx.fillStyle = d.color || '#f59e0b'
          ctx.fillRect(width - 64, p.y - 9, 62, 18)
          ctx.fillStyle = '#000000'
          ctx.font = 'bold 9.5px monospace'
          ctx.fillText(`$${formatPrice(d.points[0].price)}`, width - 60, p.y + 3)
          ctx.restore()
        }
      }
      // 7. Horizontal ray (Starts at point, extends right to future)
      else if (d.type === 'horizontal_ray' && d.points.length >= 1) {
        const p = resolveCoord(d.points[0].time, d.points[0].price)
        if (p) {
          ctx.save()
          ctx.strokeStyle = d.color || '#f59e0b'
          ctx.lineWidth = d.lineWidth || 1.5
          ctx.setLineDash(d.lineStyle === 'dashed' ? [6, 4] : d.lineStyle === 'dotted' ? [2, 3] : [5, 4])
          ctx.beginPath()
          ctx.moveTo(p.x, p.y)
          ctx.lineTo(width - 65, p.y)
          ctx.stroke()
          ctx.setLineDash([])

          ctx.fillStyle = '#ffffff'
          ctx.beginPath()
          ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2)
          ctx.fill()

          ctx.fillStyle = d.color || '#f59e0b'
          ctx.fillRect(width - 64, p.y - 9, 62, 18)
          ctx.fillStyle = '#000000'
          ctx.font = 'bold 9.5px monospace'
          ctx.fillText(`$${formatPrice(d.points[0].price)}`, width - 60, p.y + 3)
          ctx.restore()
        }
      }
      // 8. Vertical line (Full height vertical line at timestamp)
      else if (d.type === 'vertical_line' && d.points.length >= 1) {
        const p = resolveCoord(d.points[0].time, d.points[0].price)
        if (p) {
          ctx.save()
          ctx.strokeStyle = d.color || '#a855f7'
          ctx.lineWidth = d.lineWidth || 1.5
          ctx.setLineDash(d.lineStyle === 'dashed' ? [6, 4] : d.lineStyle === 'dotted' ? [2, 3] : [5, 4])
          ctx.beginPath()
          ctx.moveTo(p.x, 0)
          ctx.lineTo(p.x, height - 22)
          ctx.stroke()
          ctx.setLineDash([])

          const date = new Date(d.points[0].time * 1000)
          const dateStr = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
          ctx.fillStyle = d.color || '#a855f7'
          ctx.fillRect(p.x - 22, height - 20, 44, 16)
          ctx.fillStyle = '#ffffff'
          ctx.font = 'bold 9px monospace'
          ctx.fillText(dateStr, p.x - 14, height - 8)

          ctx.fillStyle = '#ffffff'
          ctx.beginPath()
          ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2)
          ctx.fill()
          ctx.restore()
        }
      }
      // 9. Crossline (Simultaneous horizontal & vertical crosshair)
      else if (d.type === 'crossline' && d.points.length >= 1) {
        const p = resolveCoord(d.points[0].time, d.points[0].price)
        if (p) {
          ctx.save()
          ctx.strokeStyle = d.color || '#38bdf8'
          ctx.lineWidth = d.lineWidth || 1.2
          ctx.setLineDash(d.lineStyle === 'dashed' ? [6, 4] : d.lineStyle === 'dotted' ? [2, 3] : [4, 3])
          ctx.beginPath()
          ctx.moveTo(0, p.y)
          ctx.lineTo(width - 65, p.y)
          ctx.moveTo(p.x, 0)
          ctx.lineTo(p.x, height - 22)
          ctx.stroke()
          ctx.setLineDash([])

          ctx.strokeStyle = d.color || '#38bdf8'
          ctx.fillStyle = 'rgba(56, 189, 248, 0.3)'
          ctx.beginPath()
          ctx.arc(p.x, p.y, 4, 0, Math.PI * 2)
          ctx.fill()
          ctx.stroke()

          ctx.fillStyle = d.color || '#38bdf8'
          ctx.fillRect(width - 64, p.y - 9, 62, 18)
          ctx.fillStyle = '#000000'
          ctx.font = 'bold 9.5px monospace'
          ctx.fillText(`$${formatPrice(d.points[0].price)}`, width - 60, p.y + 3)
          ctx.restore()
        }
      }
      // 10. Parallel channel (Base trendline, parallel boundary, dashed 50% midline, and shaded fill)
      else if (d.type === 'parallel_channel' && d.points.length >= 3) {
        const p1 = resolveCoord(d.points[0].time, d.points[0].price)
        const p2 = resolveCoord(d.points[1].time, d.points[1].price)
        const p3 = resolveCoord(d.points[2].time, d.points[2].price)
        if (p1 && p2 && p3) {
          const dx = p2.x - p1.x
          const dy = p2.y - p1.y
          const baseLineYAtP3 = p1.y + (dx !== 0 ? (dy / dx) * (p3.x - p1.x) : 0)
          const offset = p3.y - baseLineYAtP3

          ctx.save()
          const chanColor = d.color || '#38bdf8'
          const chanWidth = d.lineWidth || 1.8
          ctx.fillStyle = chanColor.startsWith('#') ? `${chanColor}20` : 'rgba(56, 189, 248, 0.12)'
          ctx.beginPath()
          ctx.moveTo(p1.x, p1.y)
          ctx.lineTo(p2.x, p2.y)
          ctx.lineTo(p2.x, p2.y + offset)
          ctx.lineTo(p1.x, p1.y + offset)
          ctx.closePath()
          ctx.fill()

          ctx.strokeStyle = chanColor
          ctx.lineWidth = chanWidth
          ctx.setLineDash(d.lineStyle === 'dashed' ? [6, 4] : d.lineStyle === 'dotted' ? [2, 3] : [])
          ctx.beginPath()
          ctx.moveTo(p1.x, p1.y)
          ctx.lineTo(p2.x, p2.y)
          ctx.stroke()

          ctx.beginPath()
          ctx.moveTo(p1.x, p1.y + offset)
          ctx.lineTo(p2.x, p2.y + offset)
          ctx.stroke()

          ctx.setLineDash([4, 3])
          ctx.strokeStyle = '#94a3b8'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(p1.x, p1.y + offset / 2)
          ctx.lineTo(p2.x, p2.y + offset / 2)
          ctx.stroke()
          ctx.restore()

          ctx.fillStyle = '#ffffff'
          ctx.beginPath()
          ctx.arc(p1.x, p1.y, 3, 0, Math.PI * 2)
          ctx.arc(p2.x, p2.y, 3, 0, Math.PI * 2)
          ctx.arc(p3.x, p3.y, 3, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      // 11. Regression trend
      else if (d.type === 'regression_trend' && d.points.length >= 2) {
        const p1 = resolveCoord(d.points[0].time, d.points[0].price)
        const p2 = resolveCoord(d.points[1].time, d.points[1].price)
        if (p1 && p2) {
          const xStart = Math.min(p1.x, p2.x)
          const xEnd = Math.max(p1.x, p2.x)
          const bandHeight = Math.max(Math.abs(p2.y - p1.y), 24)

          ctx.save()
          ctx.fillStyle = 'rgba(168, 85, 247, 0.12)'
          ctx.beginPath()
          ctx.moveTo(p1.x, p1.y - bandHeight)
          ctx.lineTo(p2.x, p2.y - bandHeight)
          ctx.lineTo(p2.x, p2.y + bandHeight)
          ctx.lineTo(p1.x, p1.y + bandHeight)
          ctx.closePath()
          ctx.fill()

          ctx.strokeStyle = '#a855f7'
          ctx.lineWidth = 1.8
          ctx.beginPath()
          ctx.moveTo(p1.x, p1.y)
          ctx.lineTo(p2.x, p2.y)
          ctx.stroke()

          ctx.strokeStyle = '#c084fc'
          ctx.setLineDash([3, 2])
          ctx.beginPath()
          ctx.moveTo(p1.x, p1.y - bandHeight)
          ctx.lineTo(p2.x, p2.y - bandHeight)
          ctx.moveTo(p1.x, p1.y + bandHeight)
          ctx.lineTo(p2.x, p2.y + bandHeight)
          ctx.stroke()
          ctx.restore()
        }
      }
      // 12. Flat top/bottom
      else if (d.type === 'flat_top_bottom' && d.points.length >= 3) {
        const p1 = resolveCoord(d.points[0].time, d.points[0].price)
        const p2 = resolveCoord(d.points[1].time, d.points[1].price)
        const p3 = resolveCoord(d.points[2].time, d.points[2].price)
        if (p1 && p2 && p3) {
          ctx.save()
          ctx.fillStyle = 'rgba(240, 185, 11, 0.12)'
          ctx.beginPath()
          ctx.moveTo(p1.x, p1.y)
          ctx.lineTo(p2.x, p2.y)
          ctx.lineTo(p2.x, p3.y)
          ctx.lineTo(p1.x, p3.y)
          ctx.closePath()
          ctx.fill()

          ctx.strokeStyle = '#f0b90b'
          ctx.lineWidth = 1.8
          ctx.beginPath()
          ctx.moveTo(p1.x, p1.y)
          ctx.lineTo(p2.x, p2.y)
          ctx.stroke()

          ctx.strokeStyle = '#38bdf8'
          ctx.beginPath()
          ctx.moveTo(p1.x, p3.y)
          ctx.lineTo(p2.x, p3.y)
          ctx.stroke()
          ctx.restore()
        }
      }
      // 13. Disjoint channel
      else if (d.type === 'disjoint_channel' && d.points.length >= 3) {
        const p1 = resolveCoord(d.points[0].time, d.points[0].price)
        const p2 = resolveCoord(d.points[1].time, d.points[1].price)
        const p3 = resolveCoord(d.points[2].time, d.points[2].price)
        if (p1 && p2 && p3) {
          ctx.save()
          ctx.fillStyle = 'rgba(56, 189, 248, 0.1)'
          ctx.beginPath()
          ctx.moveTo(p1.x, p1.y)
          ctx.lineTo(p2.x, p2.y)
          ctx.lineTo(p2.x, p3.y)
          ctx.lineTo(p1.x, p3.y - (p2.y - p1.y) * 0.5)
          ctx.closePath()
          ctx.fill()

          ctx.strokeStyle = '#38bdf8'
          ctx.lineWidth = 1.8
          ctx.beginPath()
          ctx.moveTo(p1.x, p1.y)
          ctx.lineTo(p2.x, p2.y)
          ctx.stroke()

          ctx.beginPath()
          ctx.moveTo(p1.x, p3.y - (p2.y - p1.y) * 0.5)
          ctx.lineTo(p2.x, p3.y)
          ctx.stroke()
          ctx.restore()
        }
      }
      // 14. Pitchforks (Andrews, Schiff, Modified Schiff, Inside Pitchfork)
      else if (
        (d.type === 'pitchfork' ||
         d.type === 'schiff_pitchfork' ||
         d.type === 'modified_schiff' ||
         d.type === 'inside_pitchfork') &&
        d.points.length >= 3
      ) {
        let p1 = resolveCoord(d.points[0].time, d.points[0].price)
        const p2 = resolveCoord(d.points[1].time, d.points[1].price)
        const p3 = resolveCoord(d.points[2].time, d.points[2].price)
        if (p1 && p2 && p3) {
          if (d.type === 'schiff_pitchfork') {
            p1 = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 }
          } else if (d.type === 'modified_schiff') {
            p1 = { x: p1.x + (p2.x - p1.x) * 0.5, y: p1.y + (p2.y - p1.y) * 0.5 }
          } else if (d.type === 'inside_pitchfork') {
            p1 = { x: (p2.x + p3.x) / 2, y: (p2.y + p3.y) / 2 }
          }

          const midX = (p2.x + p3.x) / 2
          const midY = (p2.y + p3.y) / 2
          const dx = midX - p1.x
          const dy = midY - p1.y

          const projLen = Math.max(width - p1.x, 240)
          const scale = dx !== 0 ? projLen / Math.abs(dx) : 1
          const endMidX = p1.x + dx * scale
          const endMidY = p1.y + dy * scale

          const endUpperX = p2.x + dx * scale
          const endUpperY = p2.y + dy * scale

          const endLowerX = p3.x + dx * scale
          const endLowerY = p3.y + dy * scale

          ctx.save()
          ctx.fillStyle = 'rgba(56, 189, 248, 0.08)'
          ctx.beginPath()
          ctx.moveTo(p2.x, p2.y)
          ctx.lineTo(endUpperX, endUpperY)
          ctx.lineTo(endLowerX, endLowerY)
          ctx.lineTo(p3.x, p3.y)
          ctx.closePath()
          ctx.fill()

          ctx.setLineDash([3, 3])
          ctx.strokeStyle = '#64748b'
          ctx.lineWidth = 1
          ctx.beginPath()
          ctx.moveTo(p2.x, p2.y)
          ctx.lineTo(p3.x, p3.y)
          ctx.stroke()

          ctx.setLineDash(d.lineStyle === 'dashed' ? [6, 4] : d.lineStyle === 'dotted' ? [2, 3] : [])
          ctx.lineWidth = d.lineWidth || 1.8
          ctx.strokeStyle = d.color || '#f0b90b'
          ctx.beginPath()
          ctx.moveTo(p1.x, p1.y)
          ctx.lineTo(endMidX, endMidY)
          ctx.stroke()

          ctx.strokeStyle = d.color || '#38bdf8'
          ctx.beginPath()
          ctx.moveTo(p2.x, p2.y)
          ctx.lineTo(endUpperX, endUpperY)
          ctx.moveTo(p3.x, p3.y)
          ctx.lineTo(endLowerX, endLowerY)
          ctx.stroke()
          ctx.restore()

          ctx.fillStyle = '#ffffff'
          ctx.beginPath()
          ctx.arc(p1.x, p1.y, 3, 0, Math.PI * 2)
          ctx.arc(p2.x, p2.y, 3, 0, Math.PI * 2)
          ctx.arc(p3.x, p3.y, 3, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      // 15. Rectangle
      else if (d.type === 'rectangle' && d.points.length >= 2) {
        const p1 = resolveCoord(d.points[0].time, d.points[0].price)
        const p2 = resolveCoord(d.points[1].time, d.points[1].price)
        if (p1 && p2) {
          const rx = Math.min(p1.x, p2.x)
          const ry = Math.min(p1.y, p2.y)
          const rw = Math.abs(p2.x - p1.x)
          const rh = Math.abs(p2.y - p1.y)
          const rectColor = d.color || '#38bdf8'
          ctx.fillStyle = rectColor.startsWith('#') ? `${rectColor}26` : 'rgba(56, 189, 248, 0.15)'
          ctx.strokeStyle = rectColor
          ctx.lineWidth = d.lineWidth || 1.5
          ctx.setLineDash(d.lineStyle === 'dashed' ? [6, 4] : d.lineStyle === 'dotted' ? [2, 3] : [])
          ctx.fillRect(rx, ry, rw, rh)
          ctx.strokeRect(rx, ry, rw, rh)
          ctx.setLineDash([])
        }
      }
      // 16. Fibonacci Retracement
      else if (d.type === 'fibonacci' && d.points.length >= 2) {
        const p1 = resolveCoord(d.points[0].time, d.points[0].price)
        const p2 = resolveCoord(d.points[1].time, d.points[1].price)
        if (p1 && p2) {
          const levels = [
            { r: 0.0, label: '0.0%' },
            { r: 0.236, label: '23.6%' },
            { r: 0.382, label: '38.2%' },
            { r: 0.5, label: '50.0%' },
            { r: 0.618, label: '61.8%' },
            { r: 0.786, label: '78.6%' },
            { r: 1.0, label: '100.0%' }
          ]
          const priceDiff = d.points[1].price - d.points[0].price
          levels.forEach((lvl) => {
            const price = d.points[0].price + priceDiff * lvl.r
            const y = series.priceToCoordinate(price)
            if (y !== null) {
              ctx.strokeStyle = lvl.r === 0.5 || lvl.r === 0.618 ? '#f59e0b' : '#64748b'
              ctx.lineWidth = lvl.r === 0.618 ? 1.5 : 1
              ctx.beginPath()
              ctx.moveTo(0, y)
              ctx.lineTo(width - 65, y)
              ctx.stroke()
              ctx.fillStyle = ctx.strokeStyle
              ctx.font = '9px monospace'
              ctx.fillText(`${lvl.label} ($${formatPrice(price)})`, 10, y - 3)
            }
          })
        }
      }
      // 17. Measure (Ruler)
      else if (d.type === 'measure' && d.points.length >= 2) {
        const p1 = resolveCoord(d.points[0].time, d.points[0].price)
        const p2 = resolveCoord(d.points[1].time, d.points[1].price)
        if (p1 && p2) {
          const deltaPrice = d.points[1].price - d.points[0].price
          const deltaPct = (deltaPrice / (d.points[0].price || 1)) * 100
          const rx = Math.min(p1.x, p2.x)
          const ry = Math.min(p1.y, p2.y)
          const rw = Math.abs(p2.x - p1.x)
          const rh = Math.abs(p2.y - p1.y)

          ctx.fillStyle = deltaPrice >= 0 ? 'rgba(0, 192, 135, 0.15)' : 'rgba(246, 70, 93, 0.15)'
          ctx.strokeStyle = deltaPrice >= 0 ? '#00c087' : '#f6465d'
          ctx.lineWidth = 1
          ctx.fillRect(rx, ry, rw, rh)
          ctx.strokeRect(rx, ry, rw, rh)

          ctx.fillStyle = '#111620'
          ctx.fillRect(p2.x + 8, p2.y - 15, 125, 30)
          ctx.strokeStyle = ctx.strokeStyle
          ctx.strokeRect(p2.x + 8, p2.y - 15, 125, 30)
          ctx.fillStyle = deltaPrice >= 0 ? '#00c087' : '#f6465d'
          ctx.font = 'bold 10px monospace'
          ctx.fillText(`Δ: ${deltaPrice >= 0 ? '+' : ''}${formatPrice(deltaPrice)} (${deltaPct.toFixed(2)}%)`, p2.x + 12, p2.y)
        }
      }

      // Render prominent anchor handles if this drawing is currently selected
      if (d.id === selectedDrawingId) {
        d.points.forEach((pt, pIdx) => {
          const cp = resolveCoord(pt.time, pt.price)
          if (cp) {
            ctx.save()
            const isHandleHovered = hoveredDrawingId === d.id && hoveredHandleIndex === pIdx
            ctx.shadowColor = 'rgba(0, 0, 0, 0.7)'
            ctx.shadowBlur = 6
            ctx.shadowOffsetY = 1

            ctx.fillStyle = '#ffffff'
            ctx.strokeStyle = isHandleHovered ? '#f0b90b' : (d.color || '#38bdf8')
            ctx.lineWidth = 2.5
            ctx.beginPath()
            ctx.arc(cp.x, cp.y, isHandleHovered ? 6.5 : 4.5, 0, Math.PI * 2)
            ctx.fill()
            ctx.stroke()
            ctx.restore()
          }
        })
      }
    })

    // H. Render active preview while dragging / clicking points
    if (isDrawing && (drawingStart || pendingPoints.length > 0) && currentMouse) {
      const pStartRaw = pendingPoints[0] || drawingStart
      if (pStartRaw) {
        const pStart = resolveCoord(pStartRaw.time, pStartRaw.price) || { x: pStartRaw.x, y: pStartRaw.y }
        if (
          activeTool === 'trendline' ||
          activeTool === 'ray' ||
          activeTool === 'info_line' ||
          activeTool === 'extended_line' ||
          activeTool === 'trend_angle'
        ) {
          ctx.strokeStyle = '#f0b90b'
          ctx.lineWidth = 2
          ctx.setLineDash([4, 2])
          ctx.beginPath()
          ctx.moveTo(pStart.x, pStart.y)
          ctx.lineTo(currentMouse.x, currentMouse.y)
          ctx.stroke()
          ctx.setLineDash([])

          // Info Line live floating preview badge
          if (activeTool === 'info_line') {
            const deltaP = currentMouse.price - pStartRaw.price
            const deltaPct = (deltaP / (pStartRaw.price || 1)) * 100
            const timeSecs = Math.abs(currentMouse.time - pStartRaw.time)
            const days = Math.floor(timeSecs / 86400)
            const hours = Math.floor((timeSecs % 86400) / 3600)
            const mins = Math.floor((timeSecs % 3600) / 60)
            const timeStr = days > 0 ? `${days}d ${hours}h` : hours > 0 ? `${hours}h ${mins}m` : `${mins}m`
            const angleDeg = (Math.atan2(-(currentMouse.y - pStart.y), currentMouse.x - pStart.x) * 180 / Math.PI).toFixed(1)
            const midX = (pStart.x + currentMouse.x) / 2
            const midY = (pStart.y + currentMouse.y) / 2
            const badgeW = 150
            const badgeH = 34

            ctx.save()
            ctx.fillStyle = '#161a25'
            ctx.strokeStyle = deltaP >= 0 ? '#00c087' : '#f6465d'
            ctx.lineWidth = 1.2
            ctx.beginPath()
            ctx.rect(midX - badgeW / 2, midY - badgeH - 8, badgeW, badgeH)
            ctx.fill()
            ctx.stroke()

            ctx.fillStyle = deltaP >= 0 ? '#00c087' : '#f6465d'
            ctx.font = 'bold 9.5px monospace'
            ctx.fillText(`Δ: ${deltaP >= 0 ? '+' : ''}${formatPrice(deltaP)} (${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(2)}%)`, midX - badgeW / 2 + 6, midY - badgeH + 6)
            ctx.fillStyle = '#94a3b8'
            ctx.font = '8.5px monospace'
            ctx.fillText(`${timeStr} | ∠ ${angleDeg}°`, midX - badgeW / 2 + 6, midY - badgeH + 19)
            ctx.restore()
          } else if (activeTool === 'trend_angle') {
            // Trend angle live baseline & arc
            ctx.save()
            ctx.setLineDash([3, 2])
            ctx.strokeStyle = '#64748b'
            ctx.lineWidth = 1
            ctx.beginPath()
            ctx.moveTo(pStart.x, pStart.y)
            ctx.lineTo(pStart.x + 40, pStart.y)
            ctx.stroke()

            const angleRad = Math.atan2(-(currentMouse.y - pStart.y), currentMouse.x - pStart.x)
            const degText = `${(angleRad * 180 / Math.PI).toFixed(1)}°`
            ctx.setLineDash([])
            ctx.strokeStyle = '#f0b90b'
            ctx.beginPath()
            ctx.arc(pStart.x, pStart.y, 22, 0, -angleRad, angleRad > 0)
            ctx.stroke()

            ctx.fillStyle = '#f0b90b'
            ctx.font = 'bold 9.5px monospace'
            ctx.fillText(degText, pStart.x + 28, pStart.y - 6)
            ctx.restore()
          }
        } else if (
          activeTool === 'parallel_channel' ||
          activeTool === 'flat_top_bottom' ||
          activeTool === 'disjoint_channel'
        ) {
          if (pendingPoints.length <= 1) {
            ctx.strokeStyle = '#f0b90b'
            ctx.lineWidth = 2
            ctx.setLineDash([4, 2])
            ctx.beginPath()
            ctx.moveTo(pStart.x, pStart.y)
            ctx.lineTo(currentMouse.x, currentMouse.y)
            ctx.stroke()
            ctx.setLineDash([])
          } else {
            const p1 = resolveCoord(pendingPoints[0].time, pendingPoints[0].price) || { x: pendingPoints[0].x, y: pendingPoints[0].y }
            const p2 = resolveCoord(pendingPoints[1].time, pendingPoints[1].price) || { x: pendingPoints[1].x, y: pendingPoints[1].y }
            const dx = p2.x - p1.x
            const dy = p2.y - p1.y
            const baseLineY = p1.y + (dx !== 0 ? (dy / dx) * (currentMouse.x - p1.x) : 0)
            const offset = currentMouse.y - baseLineY

            ctx.save()
            ctx.fillStyle = 'rgba(240, 185, 11, 0.12)'
            ctx.beginPath()
            ctx.moveTo(p1.x, p1.y)
            ctx.lineTo(p2.x, p2.y)
            ctx.lineTo(p2.x, p2.y + offset)
            ctx.lineTo(p1.x, p1.y + offset)
            ctx.closePath()
            ctx.fill()

            ctx.strokeStyle = '#f0b90b'
            ctx.lineWidth = 1.5
            ctx.setLineDash([3, 3])
            ctx.stroke()
            ctx.restore()
          }
        } else if (
          activeTool === 'pitchfork' ||
          activeTool === 'schiff_pitchfork' ||
          activeTool === 'modified_schiff' ||
          activeTool === 'inside_pitchfork'
        ) {
          if (pendingPoints.length <= 1) {
            ctx.strokeStyle = '#f0b90b'
            ctx.setLineDash([4, 2])
            ctx.beginPath()
            ctx.moveTo(pStart.x, pStart.y)
            ctx.lineTo(currentMouse.x, currentMouse.y)
            ctx.stroke()
            ctx.setLineDash([])
          } else {
            const p1 = resolveCoord(pendingPoints[0].time, pendingPoints[0].price) || { x: pendingPoints[0].x, y: pendingPoints[0].y }
            const p2 = resolveCoord(pendingPoints[1].time, pendingPoints[1].price) || { x: pendingPoints[1].x, y: pendingPoints[1].y }
            const p3 = currentMouse
            const midX = (p2.x + p3.x) / 2
            const midY = (p2.y + p3.y) / 2
            ctx.strokeStyle = '#f0b90b'
            ctx.setLineDash([3, 3])
            ctx.beginPath()
            ctx.moveTo(p1.x, p1.y)
            ctx.lineTo(midX, midY)
            ctx.moveTo(p2.x, p2.y)
            ctx.lineTo(p3.x, p3.y)
            ctx.stroke()
            ctx.setLineDash([])
          }
        } else if (activeTool === 'rectangle' || activeTool === 'measure') {
          const rx = Math.min(pStart.x, currentMouse.x)
          const ry = Math.min(pStart.y, currentMouse.y)
          const rw = Math.abs(currentMouse.x - pStart.x)
          const rh = Math.abs(currentMouse.y - pStart.y)
          ctx.strokeStyle = '#f0b90b'
          ctx.setLineDash([3, 3])
          ctx.strokeRect(rx, ry, rw, rh)
          ctx.setLineDash([])
        }
      }
    }

    // I. Live Placement Guides for 1-Point Tools (Alt+H, Alt+J, Alt+V, Alt+C)
    if (!isDrawing && currentMouse && (
      activeTool === 'horizontal_line' ||
      activeTool === 'horizontal_ray' ||
      activeTool === 'vertical_line' ||
      activeTool === 'crossline'
    )) {
      if (activeTool === 'horizontal_line') {
        ctx.save()
        ctx.strokeStyle = '#f59e0b'
        ctx.lineWidth = 1.5
        ctx.setLineDash([4, 4])
        ctx.beginPath()
        ctx.moveTo(0, currentMouse.y)
        ctx.lineTo(width - 65, currentMouse.y)
        ctx.stroke()
        ctx.fillStyle = '#f59e0b'
        ctx.fillRect(width - 64, currentMouse.y - 9, 62, 18)
        ctx.fillStyle = '#000000'
        ctx.font = 'bold 9.5px monospace'
        ctx.fillText(`$${formatPrice(currentMouse.price)}`, width - 60, currentMouse.y + 3)
        ctx.restore()
      } else if (activeTool === 'horizontal_ray') {
        ctx.save()
        ctx.strokeStyle = '#f59e0b'
        ctx.lineWidth = 1.5
        ctx.setLineDash([4, 4])
        ctx.beginPath()
        ctx.moveTo(currentMouse.x, currentMouse.y)
        ctx.lineTo(width - 65, currentMouse.y)
        ctx.stroke()
        ctx.fillStyle = '#f59e0b'
        ctx.fillRect(width - 64, currentMouse.y - 9, 62, 18)
        ctx.fillStyle = '#000000'
        ctx.font = 'bold 9.5px monospace'
        ctx.fillText(`$${formatPrice(currentMouse.price)}`, width - 60, currentMouse.y + 3)
        ctx.restore()
      } else if (activeTool === 'vertical_line') {
        ctx.save()
        ctx.strokeStyle = '#a855f7'
        ctx.lineWidth = 1.5
        ctx.setLineDash([4, 4])
        ctx.beginPath()
        ctx.moveTo(currentMouse.x, 0)
        ctx.lineTo(currentMouse.x, height - 22)
        ctx.stroke()
        const date = new Date(currentMouse.time * 1000)
        const dateStr = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`
        ctx.fillStyle = '#a855f7'
        ctx.fillRect(currentMouse.x - 22, height - 20, 44, 16)
        ctx.fillStyle = '#ffffff'
        ctx.font = 'bold 9px monospace'
        ctx.fillText(dateStr, currentMouse.x - 14, height - 8)
        ctx.restore()
      } else if (activeTool === 'crossline') {
        ctx.save()
        ctx.strokeStyle = '#38bdf8'
        ctx.lineWidth = 1.2
        ctx.setLineDash([4, 3])
        ctx.beginPath()
        ctx.moveTo(0, currentMouse.y)
        ctx.lineTo(width - 65, currentMouse.y)
        ctx.moveTo(currentMouse.x, 0)
        ctx.lineTo(currentMouse.x, height - 22)
        ctx.stroke()
        ctx.fillStyle = '#38bdf8'
        ctx.fillRect(width - 64, currentMouse.y - 9, 62, 18)
        ctx.fillStyle = '#000000'
        ctx.font = 'bold 9.5px monospace'
        ctx.fillText(`$${formatPrice(currentMouse.price)}`, width - 60, currentMouse.y + 3)
        ctx.restore()
      }
    }
  }, [
    smc,
    patterns,
    visibility,
    htfOverlay,
    forecast,
    drawings,
    selectedDrawingId,
    hoveredDrawingId,
    hoveredHandleIndex,
    isDrawing,
    drawingStart,
    pendingPoints,
    currentMouse,
    activeTool,
    resolveCoord,
    sessionLines,
    sessionZones,
    sessionSettings,
    activeSessionInfo,
    timeframe,
    candles,
    autoFibSettings,
    vpvrSettings,
    orderflowSettings
  ])

  // Always update the ref with the latest redraw function
  useEffect(() => {
    redrawCanvasRef.current = redrawCanvas
    try {
      redrawCanvas()
    } catch (err) {
      console.warn('Canvas redraw caught error:', err)
    }
  }, [redrawCanvas])

  // Keyboard listener: Delete/Backspace removes selected drawing, Ctrl+Z undoes, Escape deselects
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(target?.tagName)) return

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedDrawingId) {
          e.preventDefault()
          onRemoveDrawing(selectedDrawingId)
          setSelectedDrawingId(null)
        }
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        e.preventDefault()
        onUndoDrawing?.()
      } else if (e.key === 'Escape') {
        if (isDrawing) {
          setIsDrawing(false)
          setPendingPoints([])
          setDrawingStart(null)
        }
        if (selectedDrawingId) {
          setSelectedDrawingId(null)
        }
        if (activeTool !== 'cursor') {
          onSelectTool?.('cursor')
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedDrawingId, isDrawing, activeTool, onRemoveDrawing, onUndoDrawing, onSelectTool])

  // Mouse Handlers for Drawing Toolbar & Interactive Selection
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.button === 2) {
      if (isDrawing) {
        setIsDrawing(false)
        setPendingPoints([])
        setDrawingStart(null)
        onSelectTool?.('cursor')
      }
      setSelectedDrawingId(null)
      return
    }

    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const time = getTimeFromCoordinate(x)
    const price = getPriceFromCoordinate(y)
    if (time === null || price === null) return

    const point = { time, price, x, y }

    // In Cursor mode: Select drawing or start dragging handle/body
    if (activeTool === 'cursor') {
      const hit = findDrawingAt(x, y)
      if (hit) {
        setSelectedDrawingId(hit.drawing.id)
        setHoveredDrawingId(hit.drawing.id)
        setHoveredHandleIndex(hit.handleIndex)
        setDragMode(hit.handleIndex !== null ? 'handle' : 'move')
        dragStartRef.current = {
          x,
          y,
          time,
          price,
          points: hit.drawing.points.map((p) => ({ ...p }))
        }
      } else {
        setSelectedDrawingId(null)
      }
      return
    }

    // Eraser mode: remove clicked drawing
    if (activeTool === 'eraser') {
      const hit = findDrawingAt(x, y)
      if (hit) onRemoveDrawing(hit.drawing.id)
      return
    }

    // 1-Point Instant Placement Tools
    if (
      activeTool === 'horizontal_line' ||
      activeTool === 'horizontal_ray' ||
      activeTool === 'vertical_line' ||
      activeTool === 'crossline'
    ) {
      const newId = `${activeTool}_${Date.now()}`
      onAddDrawing({
        id: newId,
        type: activeTool,
        points: [{ time, price }],
        color:
          activeTool === 'crossline'
            ? '#38bdf8'
            : activeTool === 'vertical_line'
              ? '#a855f7'
              : '#f59e0b',
        lineWidth: 2,
        lineStyle: 'solid'
      })
      setSelectedDrawingId(newId)
      onSelectTool?.('cursor')
      return
    }

    // 3-Point Multi-Click Tools
    const isThreePointTool = [
      'parallel_channel',
      'flat_top_bottom',
      'disjoint_channel',
      'pitchfork',
      'schiff_pitchfork',
      'modified_schiff',
      'inside_pitchfork'
    ].includes(activeTool)

    if (isThreePointTool) {
      if (pendingPoints.length === 0) {
        setPendingPoints([point])
        setIsDrawing(true)
        setDrawingStart(point)
      } else if (pendingPoints.length === 1) {
        setPendingPoints([pendingPoints[0], point])
        setDrawingStart(point)
      } else if (pendingPoints.length >= 2) {
        const newId = `${activeTool}_${Date.now()}`
        onAddDrawing({
          id: newId,
          type: activeTool,
          points: [
            { time: pendingPoints[0].time, price: pendingPoints[0].price },
            { time: pendingPoints[1].time, price: pendingPoints[1].price },
            { time: point.time, price: point.price }
          ],
          color: '#38bdf8',
          lineWidth: 2,
          lineStyle: 'solid'
        })
        setSelectedDrawingId(newId)
        setPendingPoints([])
        setIsDrawing(false)
        setDrawingStart(null)
        onSelectTool?.('cursor')
      }
      return
    }

    // 2-Point Tools (Trendline, Ray, Extended line, Info line, etc.)
    if (pendingPoints.length === 0) {
      setPendingPoints([point])
      setIsDrawing(true)
      setDrawingStart(point)
    } else {
      const newId = `${activeTool}_${Date.now()}`
      onAddDrawing({
        id: newId,
        type: activeTool,
        points: [
          { time: pendingPoints[0].time, price: pendingPoints[0].price },
          { time: point.time, price: point.price }
        ],
        color: activeTool === 'trendline' ? '#38bdf8' : '#f0b90b',
        lineWidth: 2,
        lineStyle: 'solid'
      })
      setSelectedDrawingId(newId)
      setPendingPoints([])
      setIsDrawing(false)
      setDrawingStart(null)
      onSelectTool?.('cursor')
    }
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!chartRef.current || !candleSeriesRef.current) return
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const time = getTimeFromCoordinate(x)
    const price = getPriceFromCoordinate(y)
    if (time !== null && price !== null) {
      setCurrentMouse({ x, y, time, price })

      // Dragging an existing drawing or handle
      if (dragMode && dragStartRef.current && selectedDrawingId) {
        const drawing = drawings.find((d) => d.id === selectedDrawingId)
        if (drawing) {
          const initPoints = dragStartRef.current.points
          if (dragMode === 'handle' && hoveredHandleIndex !== null && hoveredHandleIndex < initPoints.length) {
            const newPoints = [...initPoints]
            newPoints[hoveredHandleIndex] = { time, price }
            onUpdateDrawing?.({ ...drawing, points: newPoints })
          } else if (dragMode === 'move') {
            const dTime = time - dragStartRef.current.time
            const dPrice = price - dragStartRef.current.price
            const newPoints = initPoints.map((p) => ({
              time: p.time + dTime,
              price: p.price + dPrice
            }))
            onUpdateDrawing?.({ ...drawing, points: newPoints })
          }
        }
        return
      }

      if (activeTool !== 'cursor') {
        redrawCanvas()
      } else {
        const hit = findDrawingAt(x, y)
        if (hit) {
          setHoveredDrawingId(hit.drawing.id)
          setHoveredHandleIndex(hit.handleIndex)
          setIsHoveringDrawing(true)
        } else {
          if (isHoveringDrawing) {
            setIsHoveringDrawing(false)
            setHoveredDrawingId(null)
            setHoveredHandleIndex(null)
          }
        }
      }

      if (syncCrosshairRef.current) {
        window.dispatchEvent(
          new CustomEvent('cp_sync_crosshair_move', {
            detail: {
              sourceId: chartIdRef.current,
              time: time as Time,
              price: price
            }
          })
        )
      }
    }
  }

  const handleMouseUp = () => {
    if (dragMode) {
      setDragMode(null)
      dragStartRef.current = null
      redrawCanvas()
    }

    if (!isDrawing || !drawingStart || !currentMouse) return

    // Drag-to-draw release for 2-point tools
    const dist = Math.hypot(currentMouse.x - drawingStart.x, currentMouse.y - drawingStart.y)
    if (dist > 12) {
      const isThreePointTool = [
        'parallel_channel',
        'flat_top_bottom',
        'disjoint_channel',
        'pitchfork',
        'schiff_pitchfork',
        'modified_schiff',
        'inside_pitchfork'
      ].includes(activeTool)

      if (!isThreePointTool) {
        const newId = `${activeTool}_${Date.now()}`
        onAddDrawing({
          id: newId,
          type: activeTool,
          points: [
            { time: drawingStart.time, price: drawingStart.price },
            { time: currentMouse.time, price: currentMouse.price }
          ],
          color: activeTool === 'trendline' ? '#38bdf8' : '#f0b90b',
          lineWidth: 2,
          lineStyle: 'solid'
        })
        setSelectedDrawingId(newId)
        setIsDrawing(false)
        setDrawingStart(null)
        setPendingPoints([])
        setCurrentMouse(null)
        onSelectTool?.('cursor')
      }
    }
  }

  const handleContainerMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (activeTool !== 'cursor' || dragMode !== null) return
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const hit = findDrawingAt(x, y)
    if (hit) {
      setHoveredDrawingId(hit.drawing.id)
      setHoveredHandleIndex(hit.handleIndex)
      setIsHoveringDrawing(true)
    } else {
      if (isHoveringDrawing) {
        setIsHoveringDrawing(false)
        setHoveredDrawingId(null)
        setHoveredHandleIndex(null)
      }
    }
  }

  const handleContainerMouseDown = () => {
    if (activeTool === 'cursor' && selectedDrawingId && !isHoveringDrawing) {
      setSelectedDrawingId(null)
    }
  }

  // Floating Action Toolbar screen position calculator for selected drawing
  const selectedFloatingPos = useMemo(() => {
    if (!selectedDrawingId) return null
    const d = drawings.find((item) => item.id === selectedDrawingId)
    if (!d || d.points.length === 0) return null

    let minX = Infinity
    let maxX = -Infinity
    let minY = Infinity
    for (const pt of d.points) {
      const c = resolveCoord(pt.time, pt.price)
      if (c) {
        if (c.x < minX) minX = c.x
        if (c.x > maxX) maxX = c.x
        if (c.y < minY) minY = c.y
      }
    }
    if (minX === Infinity) return null

    const midX = (minX + maxX) / 2
    const canvasW = canvasRef.current?.width || 800
    const posX = Math.max(140, Math.min(canvasW - 160, midX))
    const posY = Math.max(38, minY - 16)

    return { x: posX, y: posY, drawing: d }
  }, [selectedDrawingId, drawings, resolveCoord])

  const getCanvasCursor = () => {
    if (activeTool !== 'cursor') {
      if (activeTool === 'eraser') return 'cursor-pointer'
      return 'cursor-crosshair'
    }
    if (dragMode === 'handle' || hoveredHandleIndex !== null) {
      return 'cursor-crosshair'
    }
    if (dragMode === 'move' || hoveredDrawingId !== null) {
      return 'cursor-grab'
    }
    return 'cursor-default'
  }

  const isCanvasInteractive = activeTool !== 'cursor' || isHoveringDrawing || dragMode !== null

  const handleInteraction = () => {
    requestAnimationFrame(() => redrawCanvasRef.current())
  }

  const handleContainerMouseLeave = () => {
    if (syncCrosshairRef.current) {
      window.dispatchEvent(
        new CustomEvent('cp_sync_crosshair_clear', {
          detail: { sourceId: chartIdRef.current }
        })
      )
    }
  }

  return (
    <div 
      className="relative w-full h-full flex flex-col overflow-hidden select-none"
      onWheel={handleInteraction}
      onMouseMove={handleInteraction}
      onMouseLeave={handleContainerMouseLeave}
    >
      {/* Main Candlestick Chart Area */}
      <div 
        className="relative flex-1 w-full min-h-0 overflow-hidden"
        onMouseMove={handleContainerMouseMove}
        onMouseDown={handleContainerMouseDown}
      >
        <div ref={containerRef} className="w-full h-full" />
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onContextMenu={(e) => {
            e.preventDefault()
            if (isDrawing) {
              setIsDrawing(false)
              setPendingPoints([])
              setDrawingStart(null)
              onSelectTool?.('cursor')
            }
            setSelectedDrawingId(null)
          }}
          className={`absolute inset-0 z-10 ${getCanvasCursor()} ${
            isCanvasInteractive ? 'pointer-events-auto' : 'pointer-events-none'
          }`}
        />

        {/* Floating Action Toolbar for Selected Drawing (TradingView Style) */}
        {selectedFloatingPos && (
          <div
            style={{
              left: `${selectedFloatingPos.x}px`,
              top: `${selectedFloatingPos.y}px`,
              transform: 'translate(-50%, -100%)'
            }}
            className="absolute z-30 flex items-center space-x-2 px-2.5 py-1.5 rounded-lg bg-[#181d26]/95 border border-[#2e3646] shadow-2xl backdrop-blur-md font-mono select-none"
          >
            {/* Tool Name Badge */}
            <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider pr-1 border-r border-[#2e3646]">
              {selectedFloatingPos.drawing.type.replace('_', ' ')}
            </span>

            {/* Quick Color Swatches */}
            <div className="flex items-center space-x-1 border-r border-[#2e3646] pr-2">
              {[
                { name: 'Cyan', color: '#38bdf8' },
                { name: 'Gold', color: '#f0b90b' },
                { name: 'Green', color: '#10b981' },
                { name: 'Red', color: '#f43f5e' },
                { name: 'Purple', color: '#a855f7' },
                { name: 'White', color: '#ffffff' }
              ].map((c) => (
                <button
                  key={c.color}
                  type="button"
                  onClick={() => onUpdateDrawing?.({ ...selectedFloatingPos.drawing, color: c.color })}
                  title={`Warna: ${c.name}`}
                  className={`w-3.5 h-3.5 rounded-full border transition-transform hover:scale-125 ${
                    (selectedFloatingPos.drawing.color || '#38bdf8') === c.color
                      ? 'border-white ring-1 ring-white/50 scale-110'
                      : 'border-transparent opacity-80 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: c.color }}
                />
              ))}
            </div>

            {/* Line Thickness Picker */}
            <div className="flex items-center space-x-1 border-r border-[#2e3646] pr-2 text-[10px]">
              {[1, 2, 3, 4].map((w) => (
                <button
                  key={w}
                  type="button"
                  onClick={() => onUpdateDrawing?.({ ...selectedFloatingPos.drawing, lineWidth: w })}
                  title={`Ketebalan: ${w}px`}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                    (selectedFloatingPos.drawing.lineWidth || 2) === w
                      ? 'bg-[#38bdf8]/20 text-[#38bdf8] border border-[#38bdf8]/40'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-[#222836]'
                  }`}
                >
                  {w}px
                </button>
              ))}
            </div>

            {/* Line Style (Solid / Dashed / Dotted) */}
            <div className="flex items-center space-x-1 border-r border-[#2e3646] pr-2">
              <button
                type="button"
                onClick={() => onUpdateDrawing?.({ ...selectedFloatingPos.drawing, lineStyle: 'solid' })}
                title="Garis Solid"
                className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${
                  (!selectedFloatingPos.drawing.lineStyle || selectedFloatingPos.drawing.lineStyle === 'solid')
                    ? 'bg-[#38bdf8]/20 text-[#38bdf8] border border-[#38bdf8]/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                —
              </button>
              <button
                type="button"
                onClick={() => onUpdateDrawing?.({ ...selectedFloatingPos.drawing, lineStyle: 'dashed' })}
                title="Garis Putus-Putus (Dashed)"
                className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${
                  selectedFloatingPos.drawing.lineStyle === 'dashed'
                    ? 'bg-[#38bdf8]/20 text-[#38bdf8] border border-[#38bdf8]/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                - -
              </button>
              <button
                type="button"
                onClick={() => onUpdateDrawing?.({ ...selectedFloatingPos.drawing, lineStyle: 'dotted' })}
                title="Garis Titik-Titik (Dotted)"
                className={`px-1.5 py-0.5 rounded text-[10px] transition-colors ${
                  selectedFloatingPos.drawing.lineStyle === 'dotted'
                    ? 'bg-[#38bdf8]/20 text-[#38bdf8] border border-[#38bdf8]/40'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                ···
              </button>
            </div>

            {/* Delete Button */}
            <button
              type="button"
              onClick={() => {
                onRemoveDrawing(selectedFloatingPos.drawing.id)
                setSelectedDrawingId(null)
              }}
              title="Hapus Garis (Delete / Backspace)"
              className="p-1 rounded text-rose-400 hover:text-rose-200 hover:bg-rose-500/20 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>

            {/* Deselect / Close */}
            <button
              type="button"
              onClick={() => setSelectedDrawingId(null)}
              title="Tutup (Esc)"
              className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-[#222836] transition-colors"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Floating Trend Strength Meter HUD Badge (TSI) */}
        {visibility.trendStrengthMeter && trendStrength && (
          <div
            className="absolute top-2 left-2 sm:left-4 z-20 flex items-center space-x-2 px-2.5 py-1 rounded-md bg-[#0d1117]/90 border border-[#21262d] backdrop-blur-sm shadow-md font-mono text-[11px] select-none pointer-events-auto"
            title={`Kekuatan Tren: ${trendStrength.label} | Skor: ${trendStrength.score.toFixed(0)}% | ADX: ${trendStrength.adx.toFixed(1)} (${trendStrength.adx_trend_power}) | MTF: ${trendStrength.mtf_consensus}`}
          >
            <div className="flex items-center space-x-1.5">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">TSI</span>
              <div className="flex items-center space-x-1">
                <span
                  className={`w-2 h-2 rounded-full ${
                    trendStrength.score >= 65
                      ? 'bg-emerald-400 animate-pulse'
                      : trendStrength.score >= 40
                      ? 'bg-amber-400'
                      : 'bg-slate-500'
                  }`}
                />
                <span
                  className={`font-black text-xs ${
                    trendStrength.direction === 'BULLISH'
                      ? 'text-[#00c087]'
                      : trendStrength.direction === 'BEARISH'
                      ? 'text-[#f6465d]'
                      : 'text-slate-400'
                  }`}
                >
                  {trendStrength.score.toFixed(0)}%
                </span>
              </div>
            </div>

            <span className="text-slate-600">|</span>

            <span
              className={`font-bold text-[10.5px] ${
                trendStrength.direction === 'BULLISH'
                  ? 'text-emerald-400'
                  : trendStrength.direction === 'BEARISH'
                  ? 'text-rose-400'
                  : 'text-slate-400'
              }`}
            >
              {trendStrength.label.split('(')[0].trim()}
            </span>

            <span className="hidden md:inline-flex text-slate-600">|</span>

            <span className="hidden md:inline-flex items-center space-x-1 text-[10px] text-slate-300">
              <span className="text-slate-500 font-normal">ADX</span>
              <span className="font-semibold text-amber-400">{trendStrength.adx.toFixed(1)}</span>
            </span>

            <span className="hidden lg:inline-flex text-slate-600">|</span>

            <span className="hidden lg:inline-flex items-center space-x-1 text-[10px] text-slate-300">
              <span className="text-slate-500 font-normal">MTF</span>
              <span className="font-semibold text-cyan-400">{trendStrength.mtf_consensus}</span>
            </span>
          </div>
        )}

        {/* Floating Active Market Session Indicator */}
        {visibility.marketSessions && (sessionSettings.showHudBar ?? true) && (
          <div
            className="absolute top-2 right-14 z-20 hidden sm:flex items-center space-x-2 px-2.5 py-1 rounded-md bg-[#0d1117]/90 border border-[#21262d] backdrop-blur-sm shadow-md font-mono text-[11px] select-none pointer-events-auto"
            title="Sesi Pasar: Klik ikon pengaturan untuk mengatur jam dan warna sesi"
          >
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-slate-300 font-semibold text-[10.5px]">
              {activeSessionInfo.clockTimeString || activeSessionInfo.utcTimeString}:
            </span>
            <span
              className={`font-semibold flex items-center space-x-1 ${
                activeSessionInfo.activeSessions.length > 0 ? 'text-amber-400' : 'text-slate-400'
              }`}
            >
              {activeSessionInfo.activeSessions.length > 0 ? (
                <>
                  <span
                    className="w-1.5 h-1.5 rounded-full animate-pulse inline-block mr-1"
                    style={{ backgroundColor: activeSessionInfo.activeSessions[0]?.color || '#10b981' }}
                  />
                  <span>{activeSessionInfo.label}</span>
                </>
              ) : (
                <span>{activeSessionInfo.label}</span>
              )}
            </span>

            {/* Next Upcoming Session Countdown */}
            {activeSessionInfo.nextSession && (
              <span className="text-slate-400 text-[10px] border-l border-[#21262d] pl-2 flex items-center space-x-1">
                <span className="text-slate-500">Berikutnya:</span>
                <span className="font-bold" style={{ color: activeSessionInfo.nextSession.session.color }}>
                  {activeSessionInfo.nextSession.session.label}
                </span>
                <span className="text-amber-400/90 font-mono font-medium">
                  {activeSessionInfo.nextSession.formattedTime}
                </span>
                <span className="text-slate-300 font-bold">
                  ({activeSessionInfo.nextSession.countdownStr})
                </span>
              </span>
            )}

            {/* Quick Settings Button */}
            {onOpenMarketSessionSettings && (
              <button
                type="button"
                onClick={onOpenMarketSessionSettings}
                className="ml-1 p-0.5 rounded hover:bg-[#1f2637] text-slate-400 hover:text-amber-400 transition-colors"
                title="Buka Pengaturan Sesi Pasar"
              >
                <Sliders className="w-3 h-3" />
              </button>
            )}
          </div>
        )}

        {/* Loading state indicator when candles are empty */}
        {candles.length === 0 && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#0b0e14]/80 text-slate-400 font-mono text-xs space-y-3 pointer-events-none">
            <div className="w-6 h-6 border-2 border-[#f0b90b] border-t-transparent rounded-full animate-spin" />
            <div className="text-center space-y-1">
              <p className="text-slate-200 font-semibold">Sinkronisasi Data Candlestick {symbol}...</p>
              <p className="text-[11px] text-slate-500">Menghubungkan ke upstream Binance...</p>
            </div>
          </div>
        )}

        {/* Floating Action: Snap View On Point to the latest price & setup */}
        {candles.length > 0 && (
          <button
            type="button"
            onClick={() => focusRecentBars(candles.length)}
            title="Fokus ke harga terbaru & area setup (On Point)"
            className="absolute bottom-8 right-16 z-20 flex items-center space-x-1.5 px-2 py-1 rounded bg-[#161b22]/90 hover:bg-[#1f2634] border border-[#30363d] hover:border-[#f0b90b]/60 text-slate-300 hover:text-[#f0b90b] text-[10px] font-mono font-semibold shadow-lg backdrop-blur-sm transition-all"
          >
            <Crosshair className="w-3 h-3 text-[#f0b90b]" />
            <span>On Point</span>
          </button>
        )}
      </div>

      {/* Sub-Chart Pane: Open Interest Indicator Graph at the bottom */}
      {visibility.openInterest && market === 'futures' && (
        <OpenInterestPane
          symbol={symbol}
          timeframe={timeframe}
          candles={candles}
          openInterest={openInterest}
          mainChart={chartRef.current}
          onClose={() => onToggleLayer?.('openInterest')}
        />
      )}

      {/* Sub-Chart Pane: Funding Rate Indicator Graph at the bottom */}
      {visibility.fundingRate && market === 'futures' && (
        <FundingRatePane
          symbol={symbol}
          timeframe={timeframe}
          candles={candles}
          fundingRate={fundingRate}
          mainChart={chartRef.current}
          onClose={() => onToggleLayer?.('fundingRate')}
        />
      )}
    </div>
  )
}
