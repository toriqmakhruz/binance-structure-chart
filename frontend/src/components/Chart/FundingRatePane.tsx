import React, { useEffect, useRef, useState, useMemo } from 'react'
import {
  createChart,
  IChartApi,
  ISeriesApi,
  Time,
  ColorType,
  LogicalRange
} from 'lightweight-charts'
import { Candle, FundingRateData } from '../../types/analysis'
import { formatFundingRate, formatFundingCountdown } from '../../utils/formatters'
import { X, BarChart2, Activity, Clock, Percent } from 'lucide-react'

interface FundingRatePaneProps {
  symbol: string
  timeframe: string
  candles: Candle[]
  fundingRate?: FundingRateData | null
  mainChart: IChartApi | null
  onClose: () => void
}

export const FundingRatePane: React.FC<FundingRatePaneProps> = ({
  symbol,
  timeframe,
  candles,
  fundingRate,
  mainChart,
  onClose
}) => {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Histogram'> | ISeriesApi<'Baseline'> | null>(null)

  const [chartType, setChartType] = useState<'histogram' | 'baseline'>('histogram')
  const [countdownStr, setCountdownStr] = useState<string>('--:--:--')

  // Live countdown to next funding settlement
  useEffect(() => {
    if (!fundingRate?.next_funding_time) return
    const updateCountdown = () => {
      setCountdownStr(formatFundingCountdown(fundingRate.next_funding_time))
    }
    updateCountdown()
    const timer = setInterval(updateCountdown, 1000)
    return () => clearInterval(timer)
  }, [fundingRate?.next_funding_time])

  // Map Funding Rate history to candle times so each candle has an aligned rate point
  const fundingPoints = useMemo(() => {
    if (!candles || candles.length === 0 || !fundingRate) return []

    const history = fundingRate.history || []
    if (history.length === 0) {
      const fallbackVal = fundingRate.current_rate_pct || 0
      return candles.map((c) => ({
        time: c.time as Time,
        value: fallbackVal,
        color: fallbackVal >= 0 ? 'rgba(0, 192, 135, 0.65)' : 'rgba(246, 70, 93, 0.65)'
      }))
    }

    const sorted = [...history]
      .map((h) => ({
        timeSec: Math.floor(h.timestamp / 1000),
        val: h.funding_rate_pct
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

      let val = currentVal
      if (cTime < sorted[0].timeSec) {
        val = sorted[0].val
      } else if (idx === sorted.length - 1) {
        val = fundingRate.current_rate_pct !== undefined ? fundingRate.current_rate_pct : sorted[idx].val
      }

      return {
        time: c.time as Time,
        value: val,
        color: val >= 0 ? 'rgba(0, 192, 135, 0.65)' : 'rgba(246, 70, 93, 0.65)'
      }
    })
  }, [candles, fundingRate])

  // 1. Initialize Lightweight Chart for Funding Rate
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
        visible: false
      }
    })

    let series: ISeriesApi<'Histogram'> | ISeriesApi<'Baseline'>
    if (chartType === 'histogram') {
      series = chart.addHistogramSeries({
        priceFormat: {
          type: 'custom',
          formatter: (p: number) => formatFundingRate(p)
        }
      })
    } else {
      series = chart.addBaselineSeries({
        baseValue: { type: 'price', price: 0 },
        topLineColor: '#00c087',
        topFillColor1: 'rgba(0, 192, 135, 0.28)',
        topFillColor2: 'rgba(0, 192, 135, 0.02)',
        bottomLineColor: '#f6465d',
        bottomFillColor1: 'rgba(246, 70, 93, 0.02)',
        bottomFillColor2: 'rgba(246, 70, 93, 0.28)',
        lineWidth: 2,
        priceFormat: {
          type: 'custom',
          formatter: (p: number) => formatFundingRate(p)
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
  }, [chartType])

  // 2. Feed data into series
  useEffect(() => {
    if (seriesRef.current && fundingPoints.length > 0) {
      seriesRef.current.setData(fundingPoints)
    }
  }, [fundingPoints])

  // 3. Synchronize TimeScale with main candlestick chart
  useEffect(() => {
    if (!mainChart || !chartRef.current) return

    let isSyncing = false
    const mainTimeScale = mainChart.timeScale()
    const fundingTimeScale = chartRef.current.timeScale()

    const syncToFunding = (range: LogicalRange | null) => {
      if (isSyncing || !range || !chartRef.current) return
      isSyncing = true
      try {
        fundingTimeScale.setVisibleLogicalRange(range)
      } catch (e) {
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
      } finally {
        isSyncing = false
      }
    }

    mainTimeScale.subscribeVisibleLogicalRangeChange(syncToFunding)
    fundingTimeScale.subscribeVisibleLogicalRangeChange(syncToMain)

    // Initial sync
    const initialRange = mainTimeScale.getVisibleLogicalRange()
    if (initialRange) {
      try {
        fundingTimeScale.setVisibleLogicalRange(initialRange)
      } catch (e) {}
    }

    return () => {
      try {
        mainTimeScale.unsubscribeVisibleLogicalRangeChange(syncToFunding)
        fundingTimeScale.unsubscribeVisibleLogicalRangeChange(syncToMain)
      } catch (e) {}
    }
  }, [mainChart, fundingPoints])

  const ratePct = fundingRate?.current_rate_pct ?? 0
  const isPositive = ratePct > 0
  const isNegative = ratePct < 0

  return (
    <div className="w-full h-36 bg-[#090d13] border-t border-[#21262d] flex flex-col relative select-none">
      {/* Pane Header */}
      <div className="h-7 px-3 bg-[#0d1219] border-b border-[#1c222b] flex items-center justify-between text-[11px] font-mono z-10">
        <div className="flex items-center space-x-2">
          <div className="flex items-center space-x-1.5 text-purple-400 font-bold">
            <Percent className="w-3.5 h-3.5 text-purple-400" />
            <span>Funding Rate</span>
          </div>

          <span className="text-[10px] px-1.5 py-0.2 rounded bg-purple-950/60 text-purple-300 border border-purple-800/40">
            Indikator Murni
          </span>

          {fundingRate && (
            <div className="hidden sm:flex items-center space-x-2.5 ml-1">
              <span className={`font-bold ${isPositive ? 'text-[#00c087]' : isNegative ? 'text-[#f6465d]' : 'text-slate-300'}`}>
                {formatFundingRate(ratePct)}
              </span>

              {fundingRate.annualized_rate_pct !== undefined && (
                <span className="text-slate-400 text-[10px]">
                  (APR: <span className="text-slate-200 font-semibold">{fundingRate.annualized_rate_pct}%</span>)
                </span>
              )}

              {fundingRate.next_funding_time > 0 && (
                <span className="text-slate-400 text-[10px] flex items-center space-x-1">
                  <Clock className="w-3 h-3 text-amber-400" />
                  <span>Settlement:</span>
                  <span className="text-amber-300 font-semibold">{countdownStr}</span>
                </span>
              )}
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center space-x-1.5">
          {/* Chart Type Switcher */}
          <button
            type="button"
            onClick={() => setChartType(prev => prev === 'histogram' ? 'baseline' : 'histogram')}
            title={`Ganti gaya grafik (${chartType === 'histogram' ? 'Histogram Bar' : 'Baseline Area'})`}
            className="px-2 py-0.5 rounded bg-[#161c26] hover:bg-[#1f2634] border border-[#212836] text-slate-300 hover:text-white transition-colors text-[10px] flex items-center space-x-1"
          >
            <BarChart2 className="w-3 h-3 text-purple-400" />
            <span>{chartType === 'histogram' ? 'Bar' : 'Area'}</span>
          </button>

          {/* Close Pane Button */}
          <button
            type="button"
            onClick={onClose}
            title="Tutup Panel Indikator Funding Rate"
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
