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
  FundingRateData
} from '../../types/analysis'
import { formatPrice, getPricePrecision, formatOpenInterestValue, formatOpenInterest } from '../../utils/formatters'
import { Crosshair, Clock, Trash2, Move, Palette, Check, X } from 'lucide-react'
import { OpenInterestPane } from './OpenInterestPane'
import { FundingRatePane } from './FundingRatePane'
import { extractSessionBlocks, getCurrentActiveSessions, SessionBlock } from '../../utils/marketSessions'

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
  const sessionBlocks = useMemo(() => extractSessionBlocks(candles), [candles])
  const [activeSessionInfo, setActiveSessionInfo] = useState(getCurrentActiveSessions)

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveSessionInfo(getCurrentActiveSessions())
    }, 20000)
    return () => clearInterval(timer)
  }, [])

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

    // 0. Market Sessions (Asia, London, New York background shading & High/Low range levels)
    if (visibility.marketSessions && sessionBlocks.length > 0) {
      const isIntraday = !['4h', '1d', '3d', '1w'].includes(timeframe.toLowerCase())
      if (isIntraday) {
        sessionBlocks.forEach((sb: SessionBlock) => {
          const pStart = resolveCoord(sb.startTime, sb.high)
          const pEnd = resolveCoord(sb.endTime, sb.low)
          if (!pStart || !pEnd) return

          let x1 = pStart.x
          let x2 = pEnd.x
          if (x2 < x1) {
            const tmp = x1
            x1 = x2
            x2 = tmp
          }
          const boxWidth = Math.max(14, x2 - x1)

          // Offscreen culling
          if (x1 + boxWidth < 0 || x1 > width) return

          const yHigh = series.priceToCoordinate(sb.high)
          const yLow = series.priceToCoordinate(sb.low)
          if (yHigh === null || yLow === null) return

          const boxTop = Math.min(yHigh, yLow)
          const boxHeight = Math.abs(yLow - yHigh)

          ctx.save()
          // A. Subtle full-height vertical session column
          ctx.fillStyle = sb.session.fillColor
          ctx.fillRect(x1, 0, boxWidth, height)

          // B. Session Range Box (High to Low)
          ctx.fillStyle = sb.session.fillColor
          ctx.fillRect(x1, boxTop, boxWidth, boxHeight)
          ctx.strokeStyle = sb.session.borderStroke
          ctx.lineWidth = 1
          ctx.strokeRect(x1, boxTop, boxWidth, boxHeight)

          // C. Session High line
          ctx.beginPath()
          ctx.setLineDash([3, 3])
          ctx.strokeStyle = sb.session.color
          ctx.lineWidth = 1.2
          ctx.moveTo(x1, yHigh)
          ctx.lineTo(x1 + boxWidth, yHigh)
          ctx.stroke()

          // Session High label
          ctx.fillStyle = sb.session.color
          ctx.font = 'bold 9px monospace'
          ctx.fillText(`${sb.session.label} H: $${formatPrice(sb.high)}`, x1 + 4, yHigh > 18 ? yHigh - 3 : yHigh + 11)

          // D. Session Low line
          ctx.beginPath()
          ctx.moveTo(x1, yLow)
          ctx.lineTo(x1 + boxWidth, yLow)
          ctx.stroke()
          ctx.setLineDash([])

          // Session Low label
          ctx.fillText(`${sb.session.label} L: $${formatPrice(sb.low)}`, x1 + 4, yLow + 11)

          // E. Session Title Badge at the top
          const badgeWidth = Math.min(boxWidth, 54)
          ctx.fillStyle = sb.session.badgeBg
          ctx.fillRect(x1, 4, badgeWidth, 14)
          ctx.fillStyle = '#ffffff'
          ctx.font = 'bold 8.5px monospace'
          ctx.fillText(sb.session.label, x1 + 4, 14)

          ctx.restore()
        })
      }
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
          if (smc.swings && smc.swings.length > 0) {
            const candidates = smc.swings.filter(s => s.time >= ev.level_time && s.time <= ev.break_time)
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

    // B4. Order Blocks (OB)
    if (smc && visibility.orderBlocks) {
      smc.order_blocks.forEach((ob) => {
        const pStart = resolveCoord(ob.start_time, ob.top)
        if (!pStart) return

        const startX = pStart.x
        let endX = width - 65
        if (ob.mitigated && ob.mitigated_time) {
          const pMit = resolveCoord(ob.mitigated_time, ob.top)
          if (pMit) endX = Math.min(endX, pMit.x)
        }

        const topY = series.priceToCoordinate(ob.top)
        const botY = series.priceToCoordinate(ob.bottom)
        if (topY === null || botY === null) return

        const isBull = ob.direction === 'BULLISH'
        const obHeight = Math.max(3, Math.abs(botY - topY))
        const obY = Math.min(topY, botY)
        const obW = Math.max(10, endX - startX)

        if (startX + obW < 0 || startX > width) return

        ctx.fillStyle = isBull 
          ? (ob.mitigated ? 'rgba(0, 192, 135, 0.08)' : 'rgba(0, 192, 135, 0.22)')
          : (ob.mitigated ? 'rgba(246, 70, 93, 0.08)' : 'rgba(246, 70, 93, 0.22)')
        ctx.strokeStyle = isBull ? '#00c087' : '#f6465d'
        ctx.lineWidth = 1
        ctx.setLineDash(ob.mitigated ? [3, 3] : [])

        ctx.fillRect(startX, obY, obW, obHeight)
        ctx.strokeRect(startX, obY, obW, obHeight)

        ctx.setLineDash([])
        ctx.font = '9px Inter, sans-serif'
        ctx.fillStyle = isBull ? '#00c087' : '#f6465d'
        ctx.fillText(
          `${isBull ? 'Bullish' : 'Bearish'} OB ${ob.mitigated ? '(Mitigated)' : ''}`,
          Math.max(10, startX + 4),
          obY + 11
        )
      })
    }

    // C. Fair Value Gaps (FVG)
    if (smc && visibility.fvgs) {
      smc.fvgs.forEach((fvg) => {
        const pStart = resolveCoord(fvg.time, fvg.top)
        if (!pStart) return

        const startX = pStart.x
        const endX = fvg.mitigated ? startX + 80 : width - 65
        const topY = series.priceToCoordinate(fvg.top)
        const botY = series.priceToCoordinate(fvg.bottom)
        if (topY === null || botY === null) return

        const isBull = fvg.direction === 'BULLISH'
        const fvgHeight = Math.max(2, Math.abs(botY - topY))
        const fvgY = Math.min(topY, botY)
        const fvgW = Math.max(10, endX - startX)

        if (startX + fvgW < 0 || startX > width) return

        ctx.fillStyle = isBull ? 'rgba(6, 182, 212, 0.18)' : 'rgba(245, 158, 11, 0.18)'
        ctx.strokeStyle = isBull ? '#06b6d4' : '#f59e0b'
        ctx.lineWidth = 1
        ctx.setLineDash([3, 3])

        ctx.fillRect(startX, fvgY, fvgW, fvgHeight)
        ctx.strokeRect(startX, fvgY, fvgW, fvgHeight)

        ctx.setLineDash([])
        ctx.font = '9px Inter, sans-serif'
        ctx.fillStyle = isBull ? '#06b6d4' : '#f59e0b'
        ctx.fillText(`FVG ${isBull ? '↑' : '↓'}`, Math.max(10, startX + 4), fvgY + 10)
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
    if (forecast && visibility.entryBoxes && forecast.scenarios && forecast.scenarios.length > 0) {
      const validSetups = forecast.scenarios.filter(
        (s) => s.is_valid === true && (s.risk_reward_ratio || 0) >= 1.5 && s.status === 'VALID_ENTRY'
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
        const futureTime = (currentCandle ? currentCandle.time : startTime) + (timeStep * projectionHorizon)
        const pathEndTime = (sc.path && sc.path.length > 0) ? sc.path[sc.path.length - 1].time : 0
        const endTime = Math.max(futureTime, pathEndTime)

        const pStart = resolveCoord(startTime, entryPrice)
        const pEnd = resolveCoord(endTime, entryPrice)
        const yEntry = series.priceToCoordinate(entryPrice)
        const yTarget = series.priceToCoordinate(targetPrice)
        const yStop = series.priceToCoordinate(invalidationPrice)

        if (!pStart || yEntry === null || yTarget === null || yStop === null) return

        const startX = Math.max(10, pStart.x)
        const endX = pEnd ? Math.max(startX + 140, pEnd.x) : Math.min(width - 65, startX + 220)
        const boxWidth = Math.max(120, endX - startX)

        if (startX > width || startX + boxWidth < 0) return

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

        // 5. Badges & Text Labels (Ditempatkan rapi di sisi kanan box agar tidak menghalangi candlestick)
        const profitPct = Math.abs(((targetPrice - entryPrice) / entryPrice) * 100)
        const lossPct = Math.abs(((invalidationPrice - entryPrice) / entryPrice) * 100)

        ctx.save()
        ctx.font = 'bold 10px monospace'
        const labelX = Math.max(startX + 60, Math.min(startX + boxWidth - 8, width - 70))
        ctx.textAlign = 'right'

        // TP Label (Di sisi kanan zona TP)
        ctx.fillStyle = '#00c087'
        const tpLabel = `TP: $${formatPrice(targetPrice)} (+${profitPct.toFixed(2)}%)`
        ctx.fillText(tpLabel, labelX, isLong ? tpY + 12 : tpY + tpHeight - 4)

        // SL Label (Di sisi kanan zona SL)
        ctx.fillStyle = '#f6465d'
        const slLabel = `SL: $${formatPrice(invalidationPrice)} (-${lossPct.toFixed(2)}%)`
        ctx.fillText(slLabel, labelX, isLong ? slY + slHeight - 4 : slY + 12)

        // Entry Level Label (Di sisi kanan garis entry - tidak ada banner solid yang menutupi candle)
        ctx.fillStyle = '#38bdf8'
        const entryText = isLocked
          ? `🔒 ${isLong ? 'BUY' : 'SELL'}: $${formatPrice(entryPrice)} (R:R 1:${sc.risk_reward_ratio})`
          : `ENTRY: $${formatPrice(entryPrice)} (R:R 1:${sc.risk_reward_ratio})`
        ctx.fillText(entryText, labelX, yEntry - 4)

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
    sessionBlocks,
    timeframe
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

        {/* Floating Active Market Session Indicator */}
        {visibility.marketSessions && (
          <div
            className="absolute top-2 right-14 z-20 hidden sm:flex items-center space-x-2 px-2.5 py-1 rounded-md bg-[#0d1117]/85 border border-[#21262d] backdrop-blur-sm shadow-md font-mono text-[11px] select-none pointer-events-auto"
            title="Sesi Pasar: Asia (00:00-08:00 UTC), London (07:00-16:00 UTC), New York (13:00-21:00 UTC)"
          >
            <Clock className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-slate-400 text-[10px]">{activeSessionInfo.utcTimeString}:</span>
            <span className={`font-semibold flex items-center space-x-1 ${
              activeSessionInfo.activeSessions.length > 0 ? 'text-amber-400' : 'text-slate-400'
            }`}>
              {activeSessionInfo.activeSessions.length > 0 && (
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse inline-block mr-1" />
              )}
              <span>{activeSessionInfo.label}</span>
            </span>
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
