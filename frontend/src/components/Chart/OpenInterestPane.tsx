import React, { useEffect, useRef, useState, useMemo } from 'react'
import {
  createChart,
  IChartApi,
  ISeriesApi,
  Time,
  ColorType,
  LogicalRange
} from 'lightweight-charts'
import { Candle, OpenInterestData } from '../../types/analysis'
import { formatOpenInterestValue, formatOpenInterest } from '../../utils/formatters'
import { X, DollarSign, Coins, BarChart2, Activity } from 'lucide-react'

interface OpenInterestPaneProps {
  symbol: string
  timeframe: string
  candles: Candle[]
  openInterest?: OpenInterestData | null
  mainChart: IChartApi | null
  onClose: () => void
}

export const OpenInterestPane: React.FC<OpenInterestPaneProps> = ({
  symbol,
  timeframe,
  candles,
  openInterest,
  mainChart,
  onClose
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Area'> | ISeriesApi<'Histogram'> | null>(null)

  const [mode, setMode] = useState<'usd' | 'token'>('usd')
  const [chartType, setChartType] = useState<'area' | 'histogram'>('area')

  // Map OI history to candle times so each candle has an aligned OI point
  const oiPoints = useMemo(() => {
    if (!candles || candles.length === 0 || !openInterest) return []

    const history = openInterest.history || []
    if (history.length === 0) {
      const fallbackVal = mode === 'usd'
        ? (openInterest.open_interest_value || openInterest.open_interest || 0)
        : (openInterest.open_interest || 0)
      return candles.map((c) => ({
        time: c.time as Time,
        value: fallbackVal
      }))
    }

    const sorted = [...history]
      .map((h) => ({
        timeSec: Math.floor(h.timestamp / 1000),
        val: mode === 'usd'
          ? (h.open_interest_value > 0 ? h.open_interest_value : h.open_interest)
          : h.open_interest
      }))
      .sort((a, b) => a.timeSec - b.timeSec)

    let idx = 0
    let currentVal = sorted[0].val

    return candles.map((c) => {
      const cTime = Number(c.time)
      while (idx < sorted.length - 1 && sorted[idx + 1].timeSec <= cTime) {
        idx++
        currentVal = sorted[idx].val
      }

      if (cTime < sorted[0].timeSec) {
        return { time: c.time as Time, value: sorted[0].val }
      }

      if (idx === sorted.length - 1) {
        const latestVal = mode === 'usd'
          ? (openInterest.open_interest_value > 0 ? openInterest.open_interest_value : sorted[idx].val)
          : openInterest.open_interest
        return { time: c.time as Time, value: latestVal }
      }

      return { time: c.time as Time, value: currentVal }
    })
  }, [candles, openInterest, mode])

  // 1. Initialize Lightweight Chart for Open Interest
  useEffect(() => {
    if (!chartContainerRef.current) return

    const container = chartContainerRef.current
    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: '#090d13' },
        textColor: '#8b949e',
        fontSize: 10,
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
        scaleMargins: { top: 0.15, bottom: 0.1 }
      },
      timeScale: {
        borderColor: '#21262d',
        timeVisible: true,
        secondsVisible: false,
        visible: false // Header or main chart handles dates
      }
    })

    let series: ISeriesApi<'Area'> | ISeriesApi<'Histogram'>
    if (chartType === 'area') {
      series = chart.addAreaSeries({
        topColor: 'rgba(6, 182, 212, 0.35)',
        bottomColor: 'rgba(6, 182, 212, 0.02)',
        lineColor: '#06b6d4',
        lineWidth: 2,
        priceFormat: {
          type: 'custom',
          formatter: (p: number) => mode === 'usd' ? formatOpenInterestValue(p) : formatOpenInterest(p)
        }
      })
    } else {
      series = chart.addHistogramSeries({
        color: '#06b6d4',
        priceFormat: {
          type: 'custom',
          formatter: (p: number) => mode === 'usd' ? formatOpenInterestValue(p) : formatOpenInterest(p)
        }
      })
    }

    chartRef.current = chart
    seriesRef.current = series

    const handleResize = () => {
      if (container && chart) {
        chart.applyOptions({
          width: container.clientWidth,
          height: container.clientHeight
        })
      }
    }

    handleResize()
    const resizeObserver = new ResizeObserver(() => handleResize())
    resizeObserver.observe(container)

    return () => {
      resizeObserver.disconnect()
      chart.remove()
      chartRef.current = null
      seriesRef.current = null
    }
  }, [chartType, mode])

  // 2. Feed data into series
  useEffect(() => {
    if (seriesRef.current && oiPoints.length > 0) {
      seriesRef.current.setData(oiPoints)
    }
  }, [oiPoints])

  // 3. Synchronize TimeScale with main candlestick chart
  useEffect(() => {
    if (!mainChart || !chartRef.current) return

    let isSyncing = false
    const mainTimeScale = mainChart.timeScale()
    const oiTimeScale = chartRef.current.timeScale()

    const syncToOi = (range: LogicalRange | null) => {
      if (isSyncing || !range || !chartRef.current) return
      isSyncing = true
      try {
        oiTimeScale.setVisibleLogicalRange(range)
      } catch (e) {
        // Range may be out of bounds during fast transition
      } finally {
        isSyncing = false
      }
    }

    const syncToMain = (range: LogicalRange | null) => {
      if (isSyncing || !range || !mainChart) return
      isSyncing = true
      try {
        mainTimeScale.setVisibleLogicalRange(range)
      } catch (e) {
        // Range may be out of bounds
      } finally {
        isSyncing = false
      }
    }

    mainTimeScale.subscribeVisibleLogicalRangeChange(syncToOi)
    oiTimeScale.subscribeVisibleLogicalRangeChange(syncToMain)

    // Initial sync
    const initialRange = mainTimeScale.getVisibleLogicalRange()
    if (initialRange) {
      try {
        oiTimeScale.setVisibleLogicalRange(initialRange)
      } catch (e) {}
    }

    return () => {
      try {
        mainTimeScale.unsubscribeVisibleLogicalRangeChange(syncToOi)
        oiTimeScale.unsubscribeVisibleLogicalRangeChange(syncToMain)
      } catch (e) {}
    }
  }, [mainChart, oiPoints])

  const coinSymbol = symbol.replace('USDT', '')

  return (
    <div className="w-full h-36 bg-[#090d13] border-t border-[#21262d] flex flex-col relative select-none">
      {/* Pane Header */}
      <div className="h-7 px-3 bg-[#0d1219] border-b border-[#1c222b] flex items-center justify-between text-[11px] font-mono z-10">
        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-1.5 text-sky-400 font-bold">
            <Activity className="w-3.5 h-3.5 text-sky-400" />
            <span>Open Interest ({timeframe.toUpperCase()})</span>
          </div>

          <span className="text-[10px] px-1.5 py-0.2 rounded bg-sky-950/60 text-sky-300 border border-sky-800/40">
            Indikator Murni
          </span>

          {openInterest && (
            <div className="hidden sm:flex items-center space-x-2 ml-1">
              <span className="text-white font-semibold">
                {mode === 'usd'
                  ? formatOpenInterestValue(openInterest.open_interest_value)
                  : `${formatOpenInterest(openInterest.open_interest)} ${coinSymbol}`}
              </span>
              <span className={`text-[10px] font-bold ${openInterest.change_pct_1h >= 0 ? 'text-[#00c087]' : 'text-[#f6465d]'}`}>
                1h: {openInterest.change_pct_1h >= 0 ? '+' : ''}{openInterest.change_pct_1h}%
              </span>
              <span className={`text-[10px] font-bold hidden md:inline ${openInterest.change_pct_24h >= 0 ? 'text-[#00c087]' : 'text-[#f6465d]'}`}>
                24h: {openInterest.change_pct_24h >= 0 ? '+' : ''}{openInterest.change_pct_24h}%
              </span>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center space-x-1.5">
          {/* Unit Switcher */}
          <div className="flex items-center bg-[#161c26] rounded p-0.5 border border-[#212836]">
            <button
              type="button"
              onClick={() => setMode('usd')}
              title="Tampilkan Nilai Notional USD ($)"
              className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                mode === 'usd' ? 'bg-sky-500 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <DollarSign className="w-2.5 h-2.5 inline mr-0.5" />
              USD
            </button>
            <button
              type="button"
              onClick={() => setMode('token')}
              title={`Tampilkan Jumlah Kontrak (${coinSymbol})`}
              className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${
                mode === 'token' ? 'bg-sky-500 text-white font-bold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Coins className="w-2.5 h-2.5 inline mr-0.5" />
              {coinSymbol}
            </button>
          </div>

          {/* Chart Type Switcher */}
          <button
            type="button"
            onClick={() => setChartType(prev => prev === 'area' ? 'histogram' : 'area')}
            title={`Ganti gaya grafik (${chartType === 'area' ? 'Area' : 'Histogram'})`}
            className="p-1 rounded bg-[#161c26] hover:bg-[#1f2634] border border-[#212836] text-slate-300 hover:text-white transition-colors"
          >
            <BarChart2 className="w-3 h-3 text-sky-400" />
          </button>

          {/* Close Pane Button */}
          <button
            type="button"
            onClick={onClose}
            title="Tutup Panel Indikator Open Interest"
            className="p-1 rounded bg-[#161c26] hover:bg-rose-950/50 hover:text-rose-400 border border-[#212836] hover:border-rose-800/40 text-slate-400 transition-colors"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Chart Canvas Area */}
      <div ref={chartContainerRef} className="flex-1 w-full relative" />
    </div>
  )
}
