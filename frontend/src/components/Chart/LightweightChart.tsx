import React, { useEffect, useRef, useState, useCallback } from 'react'
import {
  createChart,
  IChartApi,
  ISeriesApi,
  Time,
  SeriesMarker,
  ColorType
} from 'lightweight-charts'
import {
  Candle,
  SmcAnalysisResult,
  PatternAnalysisResult,
  ForecastResult,
  LayerVisibility,
  DrawingToolType,
  DrawingItem
} from '../../types/analysis'
import { formatPrice, getPricePrecision } from '../../utils/formatters'
import { Crosshair } from 'lucide-react'

interface LightweightChartProps {
  symbol: string
  timeframe: string
  candles: Candle[]
  smc?: SmcAnalysisResult
  patterns?: PatternAnalysisResult
  forecast?: ForecastResult
  htfOverlay?: any
  visibility: LayerVisibility
  activeTool: DrawingToolType
  drawings: DrawingItem[]
  onAddDrawing: (item: DrawingItem) => void
  onRemoveDrawing: (id: string) => void
}

export const LightweightChart: React.FC<LightweightChartProps> = ({
  symbol,
  timeframe,
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
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null)

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

  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false)
  const [drawingStart, setDrawingStart] = useState<{ time: number; price: number; x: number; y: number } | null>(null)
  const [currentMouse, setCurrentMouse] = useState<{ x: number; y: number; time: number; price: number } | null>(null)

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
      priceScaleId: 'volume'
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

    handleResize()

    return () => {
      window.removeEventListener('resize', handleResize)
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

  // 3. Update Candle & Volume Data with Dynamic Price Precision & Smooth Live Ticks
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

    // Smooth real-time update: ONLY if it's NOT a new series and count & time match
    const isIncrementalUpdate =
      !isNewSeries &&
      prevCandlesCountRef.current === formattedCandles.length &&
      prevLastTimeRef.current === lastTimeNum

    if (isIncrementalUpdate) {
      candleSeriesRef.current.update(lastCandle)
      if (visibility.volume) {
        volumeSeriesRef.current.update(lastVolume)
      }
    } else {
      candleSeriesRef.current.setData(formattedCandles)
      volumeSeriesRef.current.setData(visibility.volume ? formattedVolumes : [])
      prevCandlesCountRef.current = formattedCandles.length
      prevLastTimeRef.current = lastTimeNum

      if (isNewSeries) {
        focusRecentBars(formattedCandles.length)
      }
    }

    // Markers for Swings and BOS/CHoCH with strict deduplication and time ordering
    const markerMap = new Map<string, SeriesMarker<Time>>()

    if (smc && visibility.smcSwings) {
      smc.swings.forEach((s) => {
        const isHigh = s.type === 'HH' || s.type === 'LH' || s.type === 'H'
        const key = `${s.time}_swing`
        markerMap.set(key, {
          time: s.time as Time,
          position: isHigh ? 'aboveBar' : 'belowBar',
          color: isHigh ? '#a855f7' : '#3b82f6',
          shape: isHigh ? 'arrowDown' : 'arrowUp',
          text: s.type,
          size: 1
        })
      })
    }

    if (smc && visibility.smcEvents) {
      smc.events.forEach((ev) => {
        const key = `${ev.break_time}_event`
        markerMap.set(key, {
          time: ev.break_time as Time,
          position: ev.direction === 'BULLISH' ? 'aboveBar' : 'belowBar',
          color: ev.type === 'CHoCH' ? '#ec4899' : '#f59e0b',
          shape: 'circle',
          text: `${ev.type} (${ev.direction[0]})`,
          size: 1
        })
      })
    }

    const sortedMarkers = Array.from(markerMap.values()).sort((a, b) => Number(a.time) - Number(b.time))
    candleSeriesRef.current.setMarkers(sortedMarkers)

    redrawCanvasRef.current()
  }, [candles, smc, visibility, symbol, timeframe, focusRecentBars])

  // 4. Robust Coordinate Resolver
  const resolveCoord = useCallback((time: number, price: number): { x: number; y: number } | null => {
    if (!chartRef.current || !candleSeriesRef.current) return null
    const timeScale = chartRef.current.timeScale()

    let x = timeScale.timeToCoordinate(time as Time)

    if (x === null && candles.length > 0) {
      const firstTime = candles[0].time
      const lastTime = candles[candles.length - 1].time
      const timeStep = candles.length > 1 ? (candles[1].time - candles[0].time) : 900

      if (time >= lastTime) {
        const futureBars = (time - lastTime) / timeStep
        const logicalIndex = (candles.length - 1) + futureBars
        x = timeScale.logicalToCoordinate(logicalIndex as any)
      } else if (time <= firstTime) {
        const pastBars = (firstTime - time) / timeStep
        const logicalIndex = 0 - pastBars
        x = timeScale.logicalToCoordinate(logicalIndex as any)
      } else {
        let closestIdx = 0
        let minDiff = Infinity
        for (let i = 0; i < candles.length; i++) {
          const diff = Math.abs(candles[i].time - time)
          if (diff < minDiff) {
            minDiff = diff
            closestIdx = i
          }
        }
        x = timeScale.logicalToCoordinate(closestIdx as any)
      }
    }

    const y = candleSeriesRef.current.priceToCoordinate(price)
    if (x === null || y === null) return null
    return { x, y }
  }, [candles])

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

    // B. Order Blocks (OB)
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

    // D. Render Chart Patterns (Fixed: Non-criss-cross geometry for Triangles, H&S, and Double Tops)
    if (patterns && visibility.patterns && patterns.patterns) {
      patterns.patterns.forEach((pat) => {
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
              ctx.lineWidth = 2
              ctx.moveTo(pH1.x, pH1.y)
              ctx.lineTo(pH2.x, pH2.y)
              ctx.stroke()

              // Lower Trendline (Support)
              ctx.beginPath()
              ctx.strokeStyle = '#00c087'
              ctx.lineWidth = 2
              ctx.moveTo(pL1.x, pL1.y)
              ctx.lineTo(pL2.x, pL2.y)
              ctx.stroke()

              // Key Anchor Dots
              ;[pH1, pH2, pL1, pL2].forEach(p => {
                ctx.fillStyle = '#f0b90b'
                ctx.beginPath()
                ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2)
                ctx.fill()
              })

              // Pattern Label
              ctx.fillStyle = '#f0b90b'
              ctx.font = 'bold 9px monospace'
              ctx.fillText(pat.name, Math.min(pH2.x, pL2.x) + 8, (pH2.y + pL2.y) / 2)
            }
          }
        } 
        // 2. Head & Shoulders: Connect chronologically along time
        else if (patName.includes('shoulder')) {
          const sortedKps = [...pat.key_points].sort((a, b) => a.time - b.time)
          ctx.beginPath()
          ctx.strokeStyle = pat.type === 'BEARISH' ? '#f6465d' : '#00c087'
          ctx.lineWidth = 2

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
              ctx.arc(c.x, c.y, 3.5, 0, Math.PI * 2)
              ctx.fill()
            }
          })

          // Neckline
          if (pat.neckline) {
            const y = series.priceToCoordinate(pat.neckline)
            if (y !== null && sortedKps.length >= 2) {
              const startC = resolveCoord(sortedKps[0].time, pat.neckline)
              const endC = resolveCoord(sortedKps[sortedKps.length - 1].time, pat.neckline)
              if (startC && endC) {
                ctx.setLineDash([4, 3])
                ctx.strokeStyle = '#cbd5e1'
                ctx.lineWidth = 1.5
                ctx.beginPath()
                ctx.moveTo(startC.x - 15, y)
                ctx.lineTo(endC.x + 40, y)
                ctx.stroke()
                ctx.setLineDash([])
                ctx.fillStyle = '#cbd5e1'
                ctx.font = '9px monospace'
                ctx.fillText(`Neckline: $${formatPrice(pat.neckline)}`, endC.x + 10, y - 4)
              }
            }
          }
        }
        // 3. Double Top & Double Bottom: Peak-to-Peak with Horizontal Neckline
        else if (patName.includes('double top') || patName.includes('double bottom')) {
          const sortedKps = [...pat.key_points].sort((a, b) => a.time - b.time)
          ctx.beginPath()
          ctx.strokeStyle = pat.type === 'BEARISH' ? '#f6465d' : '#00c087'
          ctx.lineWidth = 2

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
              ctx.arc(c.x, c.y, 3.5, 0, Math.PI * 2)
              ctx.fill()
            }
          })

          // Neckline
          if (pat.neckline) {
            const y = series.priceToCoordinate(pat.neckline)
            if (y !== null && sortedKps.length >= 2) {
              const startC = resolveCoord(sortedKps[0].time, pat.neckline)
              const endC = resolveCoord(sortedKps[sortedKps.length - 1].time, pat.neckline)
              if (startC && endC) {
                ctx.setLineDash([4, 3])
                ctx.strokeStyle = '#cbd5e1'
                ctx.lineWidth = 1.5
                ctx.beginPath()
                ctx.moveTo(startC.x - 20, y)
                ctx.lineTo(endC.x + 50, y)
                ctx.stroke()
                ctx.setLineDash([])
                ctx.fillStyle = '#cbd5e1'
                ctx.font = '9px monospace'
                ctx.fillText(`Neckline: $${formatPrice(pat.neckline)}`, endC.x + 10, y - 4)
              }
            }
          }
        }
        // 4. Generic Pattern: Sorted strictly ascending by time to prevent backwards lines
        else {
          const sortedKps = [...pat.key_points].sort((a, b) => a.time - b.time)
          ctx.beginPath()
          ctx.strokeStyle = pat.type === 'BULLISH' ? '#00c087' : (pat.type === 'BEARISH' ? '#f6465d' : '#f0b90b')
          ctx.lineWidth = 2

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
              ctx.arc(c.x, c.y, 3.5, 0, Math.PI * 2)
              ctx.fill()
            }
          })
        }

        // Draw Target Line if present
        if (pat.target_price) {
          const lastKp = pat.key_points[pat.key_points.length - 1]
          const coordStart = resolveCoord(lastKp.time, pat.target_price)
          const targetY = series.priceToCoordinate(pat.target_price)
          if (targetY !== null && coordStart) {
            ctx.strokeStyle = '#00c087'
            ctx.lineWidth = 1.5
            ctx.setLineDash([4, 2])
            ctx.beginPath()
            ctx.moveTo(coordStart.x, targetY)
            ctx.lineTo(width - 65, targetY)
            ctx.stroke()
            ctx.setLineDash([])

            ctx.fillStyle = '#00c087'
            ctx.font = 'bold 9px monospace'
            ctx.fillText(`TP (${pat.name}): $${formatPrice(pat.target_price)}`, coordStart.x + 8, targetY - 4)
          }
        }

        // Draw Stop Loss Line if present
        if (pat.stop_loss) {
          const lastKp = pat.key_points[pat.key_points.length - 1]
          const coordStart = resolveCoord(lastKp.time, pat.stop_loss)
          const slY = series.priceToCoordinate(pat.stop_loss)
          if (slY !== null && coordStart) {
            ctx.strokeStyle = '#f6465d'
            ctx.lineWidth = 1.5
            ctx.setLineDash([4, 2])
            ctx.beginPath()
            ctx.moveTo(coordStart.x, slY)
            ctx.lineTo(width - 65, slY)
            ctx.stroke()
            ctx.setLineDash([])

            ctx.fillStyle = '#f6465d'
            ctx.font = 'bold 9px monospace'
            ctx.fillText(`SL: $${formatPrice(pat.stop_loss)}`, coordStart.x + 8, slY - 4)
          }
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
        const isLocked = Boolean(sc.id?.startsWith('locked_') || sc.name?.includes('[POSISI AKTIF]'))
        const isLong = sc.direction === 'LONG' || sc.name.toLowerCase().includes('bullish')
        const currentCandle = candles.length > 0 ? candles[candles.length - 1] : null
        const entryPrice = sc.entry_price || (currentCandle ? currentCandle.close : 0)
        if (entryPrice <= 0) return

        const targetPrice = sc.target_price
        const invalidationPrice = sc.invalidation_price
        const startTime = sc.entry_time || (currentCandle ? currentCandle.time : 0)

        // Live Invalidation Check for uncommitted setup forecasts:
        // (Jika bukan posisi aktif terkunci, candle yang menembus SL akan menghapus box)
        if (!isLocked && currentCandle) {
          if (isLong && currentCandle.low <= invalidationPrice) return
          if (!isLong && currentCandle.high >= invalidationPrice) return
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
        const endX = pEnd ? Math.max(startX + 120, pEnd.x) : Math.min(width - 65, startX + 220)
        const boxWidth = Math.max(100, endX - startX)

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

        // 5. Badges & Text Labels
        const profitPct = Math.abs(((targetPrice - entryPrice) / entryPrice) * 100)
        const lossPct = Math.abs(((invalidationPrice - entryPrice) / entryPrice) * 100)

        // TP Label
        ctx.fillStyle = '#00c087'
        ctx.font = 'bold 10px monospace'
        const tpLabel = `TP: $${formatPrice(targetPrice)} (+${profitPct.toFixed(2)}%)`
        ctx.fillText(tpLabel, startX + 8, isLong ? tpY + 12 : tpY + tpHeight - 4)

        // SL Label
        ctx.fillStyle = '#f6465d'
        ctx.font = 'bold 10px monospace'
        const slLabel = `SL: $${formatPrice(invalidationPrice)} (-${lossPct.toFixed(2)}%)`
        ctx.fillText(slLabel, startX + 8, isLong ? slY + slHeight - 4 : slY + 12)

        // Entry Level Label
        ctx.fillStyle = '#38bdf8'
        ctx.font = 'bold 10px monospace'
        const entryText = isLocked
          ? `🔒 POSISI AKTIF: $${formatPrice(entryPrice)} (R:R 1:${sc.risk_reward_ratio})`
          : `ENTRY: $${formatPrice(entryPrice)} (R:R 1:${sc.risk_reward_ratio})`
        ctx.fillText(entryText, startX + 8, yEntry - 4)

        // If locked position, render status banner above the entry line
        if (isLocked) {
          ctx.fillStyle = isLong ? 'rgba(0, 192, 135, 0.92)' : 'rgba(246, 70, 93, 0.92)'
          const bannerY = isLong ? Math.max(tpY + 2, yEntry - 22) : Math.min(slY + slHeight - 16, yEntry + 8)
          ctx.fillRect(startX + 8, bannerY, 155, 14)
          ctx.fillStyle = '#0b0e14'
          ctx.font = 'bold 9px sans-serif'
          ctx.fillText(`● POSISI AKTIF (${isLong ? 'BUY' : 'SELL'})`, startX + 14, bannerY + 10)
        }
      })
      }
    }

    // G. Render Manual Drawings
    drawings.forEach((d) => {
      if (d.type === 'trendline' && d.points.length >= 2) {
        const p1 = resolveCoord(d.points[0].time, d.points[0].price)
        const p2 = resolveCoord(d.points[1].time, d.points[1].price)
        if (p1 && p2) {
          ctx.strokeStyle = d.color || '#38bdf8'
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.moveTo(p1.x, p1.y)
          ctx.lineTo(p2.x, p2.y)
          ctx.stroke()
        }
      } else if (d.type === 'horizontal_line' && d.points.length >= 1) {
        const p = resolveCoord(d.points[0].time, d.points[0].price)
        if (p) {
          ctx.strokeStyle = d.color || '#f59e0b'
          ctx.lineWidth = 1.5
          ctx.setLineDash([5, 5])
          ctx.beginPath()
          ctx.moveTo(0, p.y)
          ctx.lineTo(width - 65, p.y)
          ctx.stroke()
          ctx.setLineDash([])
          ctx.fillStyle = '#f59e0b'
          ctx.font = '10px monospace'
          ctx.fillText(`$${formatPrice(d.points[0].price)}`, 10, p.y - 4)
        }
      } else if (d.type === 'rectangle' && d.points.length >= 2) {
        const p1 = resolveCoord(d.points[0].time, d.points[0].price)
        const p2 = resolveCoord(d.points[1].time, d.points[1].price)
        if (p1 && p2) {
          const rx = Math.min(p1.x, p2.x)
          const ry = Math.min(p1.y, p2.y)
          const rw = Math.abs(p2.x - p1.x)
          const rh = Math.abs(p2.y - p1.y)
          ctx.fillStyle = 'rgba(56, 189, 248, 0.15)'
          ctx.strokeStyle = '#38bdf8'
          ctx.lineWidth = 1.5
          ctx.fillRect(rx, ry, rw, rh)
          ctx.strokeRect(rx, ry, rw, rh)
        }
      } else if (d.type === 'fibonacci' && d.points.length >= 2) {
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
      } else if (d.type === 'measure' && d.points.length >= 2) {
        const p1 = resolveCoord(d.points[0].time, d.points[0].price)
        const p2 = resolveCoord(d.points[1].time, d.points[1].price)
        if (p1 && p2) {
          const deltaPrice = d.points[1].price - d.points[0].price
          const deltaPct = (deltaPrice / d.points[0].price) * 100
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
          ctx.fillRect(p2.x + 8, p2.y - 15, 120, 30)
          ctx.strokeStyle = ctx.strokeStyle
          ctx.strokeRect(p2.x + 8, p2.y - 15, 120, 30)
          ctx.fillStyle = deltaPrice >= 0 ? '#00c087' : '#f6465d'
          ctx.font = 'bold 10px monospace'
          ctx.fillText(`Δ: ${deltaPrice >= 0 ? '+' : ''}${formatPrice(deltaPrice)} (${deltaPct.toFixed(2)}%)`, p2.x + 12, p2.y)
        }
      }
    })

    // H. Render active preview while dragging drawing
    if (isDrawing && drawingStart && currentMouse) {
      if (activeTool === 'trendline') {
        ctx.strokeStyle = '#f0b90b'
        ctx.lineWidth = 2
        ctx.setLineDash([4, 2])
        ctx.beginPath()
        ctx.moveTo(drawingStart.x, drawingStart.y)
        ctx.lineTo(currentMouse.x, currentMouse.y)
        ctx.stroke()
        ctx.setLineDash([])
      } else if (activeTool === 'rectangle' || activeTool === 'measure') {
        const rx = Math.min(drawingStart.x, currentMouse.x)
        const ry = Math.min(drawingStart.y, currentMouse.y)
        const rw = Math.abs(currentMouse.x - drawingStart.x)
        const rh = Math.abs(currentMouse.y - drawingStart.y)
        ctx.strokeStyle = '#f0b90b'
        ctx.setLineDash([3, 3])
        ctx.strokeRect(rx, ry, rw, rh)
        ctx.setLineDash([])
      }
    }
  }, [smc, patterns, visibility, htfOverlay, forecast, drawings, isDrawing, drawingStart, currentMouse, activeTool, resolveCoord])

  // Always update the ref with the latest redraw function
  useEffect(() => {
    redrawCanvasRef.current = redrawCanvas
    redrawCanvas()
  }, [redrawCanvas])

  // Mouse Handlers for Drawing Toolbar
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (activeTool === 'cursor' || !chartRef.current || !candleSeriesRef.current) return

    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const time = chartRef.current.timeScale().coordinateToTime(x)
    const price = candleSeriesRef.current.coordinateToPrice(y)
    if (!time || !price) return

    if (activeTool === 'eraser') {
      const hit = drawings.find((d) => {
        if (!d.points[0]) return false
        const coord = resolveCoord(d.points[0].time, d.points[0].price)
        if (coord) {
          return Math.hypot(coord.x - x, coord.y - y) < 25
        }
        return false
      })
      if (hit) onRemoveDrawing(hit.id)
      return
    }

    if (activeTool === 'horizontal_line') {
      onAddDrawing({
        id: `hline_${Date.now()}`,
        type: 'horizontal_line',
        points: [{ time: Number(time), price }],
        color: '#f59e0b'
      })
      return
    }

    setIsDrawing(true)
    setDrawingStart({ time: Number(time), price, x, y })
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!chartRef.current || !candleSeriesRef.current) return
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const time = chartRef.current.timeScale().coordinateToTime(x)
    const price = candleSeriesRef.current.coordinateToPrice(y)
    if (time && price) {
      setCurrentMouse({ x, y, time: Number(time), price })
      if (isDrawing) redrawCanvas()
    }
  }

  const handleMouseUp = () => {
    if (!isDrawing || !drawingStart || !currentMouse) return

    onAddDrawing({
      id: `draw_${Date.now()}`,
      type: activeTool,
      points: [
        { time: drawingStart.time, price: drawingStart.price },
        { time: currentMouse.time, price: currentMouse.price }
      ]
    })

    setIsDrawing(false)
    setDrawingStart(null)
    setCurrentMouse(null)
  }

  const handleInteraction = () => {
    requestAnimationFrame(() => redrawCanvasRef.current())
  }

  return (
    <div 
      className="relative w-full h-full overflow-hidden select-none group"
      onWheel={handleInteraction}
      onMouseMove={handleInteraction}
    >
      <div ref={containerRef} className="w-full h-full" />
      <canvas
        ref={canvasRef}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        className={`absolute inset-0 z-10 ${
          activeTool !== 'cursor' ? 'cursor-crosshair pointer-events-auto' : 'pointer-events-none'
        }`}
      />

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
  )
}
