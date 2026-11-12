import React, { useState, useEffect, useRef, useCallback } from 'react'
import { TopNavbar } from './components/Navigation/TopNavbar'
import { SymbolSelector } from './components/Navigation/SymbolSelector'
import { DrawingToolbar } from './components/Chart/DrawingToolbar'
import { LayerToggles } from './components/Chart/LayerToggles'
import { ChartContainer } from './components/Chart/ChartContainer'
import { ConfluenceSidebar } from './components/HUD/ConfluenceSidebar'
import { SettingsDrawer } from './components/Settings/SettingsDrawer'
import { fetchAnalysis } from './services/api'
import { BinanceWsClient } from './services/binanceWs'
import {
  Candle,
  FullAnalysisResponse,
  LayerVisibility,
  DrawingToolType,
  DrawingItem,
  AppSettings
} from './types/analysis'

export function App() {
  // Navigation & Config States
  const [symbol, setSymbol] = useState('BTCUSDT')
  const [timeframe, setTimeframe] = useState('15m')
  const [market, setMarket] = useState<'spot' | 'futures'>('futures')
  const [layout, setLayout] = useState<'single' | 'split-vertical' | 'split-horizontal' | 'grid-4'>('single')

  // Analysis & Candle Data
  const [analysis, setAnalysis] = useState<FullAnalysisResponse | null>(null)
  const [candles, setCandles] = useState<Candle[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isConnected, setIsConnected] = useState(false)

  // Layer Visibility
  const [visibility, setVisibility] = useState<LayerVisibility>({
    smcSwings: true,
    smcEvents: true,
    orderBlocks: true,
    fvgs: true,
    patterns: true,
    srLevels: true,
    forecastCone: true,
    forecastScenarios: true,
    htfOverlay: true,
    volume: true
  })

  // Drawing Toolbar (Persistent per-symbol)
  const [activeTool, setActiveTool] = useState<DrawingToolType>('cursor')
  const [drawingsBySymbol, setDrawingsBySymbol] = useState<Record<string, DrawingItem[]>>({})

  // Settings
  const [settings, setSettings] = useState<AppSettings>({
    swingLength: 5,
    fvgMinPct: 0.05,
    forecastHorizon: 20,
    htf: '4h'
  })

  // Modals / Drawers
  const [isSymbolModalOpen, setIsSymbolModalOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  const wsClientRef = useRef<BinanceWsClient | null>(null)
  const activeSymbolRef = useRef(symbol)
  const requestSeqRef = useRef(0)

  // Synchronize active symbol ref
  useEffect(() => {
    activeSymbolRef.current = symbol.toUpperCase()
  }, [symbol])

  // Fetch Full Analysis with Race-Condition Guard
  const loadAnalysis = useCallback(async (sym = symbol, tf = timeframe, mkt = market, sett = settings) => {
    requestSeqRef.current += 1
    const currentSeq = requestSeqRef.current
    setIsLoading(true)

    try {
      const data = await fetchAnalysis(sym, tf, mkt, sett)
      // Commit only if this response matches the latest user request and active symbol
      if (currentSeq === requestSeqRef.current && sym.toUpperCase() === activeSymbolRef.current) {
        setAnalysis(data)
        setCandles(data.candles)
      }
    } catch (err) {
      if (currentSeq === requestSeqRef.current) {
        console.error('Error fetching analysis:', err)
      }
    } finally {
      if (currentSeq === requestSeqRef.current) {
        setIsLoading(false)
      }
    }
  }, [symbol, timeframe, market, settings])

  // Initial and reactive load on symbol/timeframe/market/settings change
  useEffect(() => {
    loadAnalysis(symbol, timeframe, market, settings)
  }, [symbol, timeframe, market, settings, loadAnalysis])

  // Setup WebSocket Stream
  useEffect(() => {
    if (wsClientRef.current) {
      wsClientRef.current.disconnect()
    }

    const wsClient = new BinanceWsClient(symbol, timeframe, market, {
      onStatusChange: (connected) => setIsConnected(connected),
      onCandle: (liveCandle, isClosed, candleSym) => {
        // Discard any ticks from previous or mismatched pair
        if (candleSym.toUpperCase() !== activeSymbolRef.current) {
          return
        }

        setCandles((prev) => {
          if (prev.length === 0) return [liveCandle]
          const last = prev[prev.length - 1]

          if (last.time === liveCandle.time) {
            // Update ticking candle
            const updated = [...prev]
            updated[updated.length - 1] = liveCandle
            return updated
          } else if (liveCandle.time > last.time) {
            // New candle started
            return [...prev.slice(1), liveCandle]
          }
          return prev
        })

        // Re-analyze on candle close without full screen reload
        if (isClosed) {
          loadAnalysis(symbol, timeframe, market, settings)
        }
      }
    })

    wsClient.connect()
    wsClientRef.current = wsClient

    return () => {
      wsClient.disconnect()
    }
  }, [symbol, timeframe, market, settings, loadAnalysis])

  // Pair & Config Switchers (clean slate to avoid artifact collision)
  const handleSelectSymbol = (newSymbol: string) => {
    const cleanSym = newSymbol.toUpperCase()
    if (cleanSym === symbol) return
    activeSymbolRef.current = cleanSym
    setCandles([])
    setAnalysis(null)
    setSymbol(cleanSym)
  }

  const handleTimeframeChange = (newTf: string) => {
    if (newTf === timeframe) return
    setCandles([])
    setAnalysis(null)
    setTimeframe(newTf)
  }

  const handleMarketChange = (newMarket: 'spot' | 'futures') => {
    if (newMarket === market) return
    setCandles([])
    setAnalysis(null)
    setMarket(newMarket)
  }

  const handleToggleLayer = (key: keyof LayerVisibility) => {
    setVisibility((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  // Per-symbol drawings
  const currentDrawings = drawingsBySymbol[symbol] || []

  const handleAddDrawing = (item: DrawingItem) => {
    setDrawingsBySymbol((prev) => ({
      ...prev,
      [symbol]: [...(prev[symbol] || []), item]
    }))
    setActiveTool('cursor')
  }

  const handleRemoveDrawing = (id: string) => {
    setDrawingsBySymbol((prev) => ({
      ...prev,
      [symbol]: (prev[symbol] || []).filter((d) => d.id !== id)
    }))
  }

  const handleClearDrawings = () => {
    setDrawingsBySymbol((prev) => ({
      ...prev,
      [symbol]: []
    }))
  }

  const lastCandle = candles.length > 0 ? candles[candles.length - 1] : undefined

  return (
    <div className="flex flex-col h-screen w-screen bg-[#0b0e14] text-slate-100 overflow-hidden">
      {/* 1. Top Navbar */}
      <TopNavbar
        symbol={symbol}
        timeframe={timeframe}
        market={market}
        layout={layout}
        isConnected={isConnected}
        isLoading={isLoading}
        lastPrice={lastCandle?.close}
        onSymbolClick={() => setIsSymbolModalOpen(true)}
        onTimeframeChange={handleTimeframeChange}
        onMarketChange={handleMarketChange}
        onLayoutChange={(l) => setLayout(l)}
        onRefresh={() => loadAnalysis(symbol, timeframe, market, settings)}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      {/* 2. Layer Toggles Bar */}
      <LayerToggles
        visibility={visibility}
        onToggle={handleToggleLayer}
        hasHtf={Boolean(analysis?.htf_overlay)}
      />

      {/* 3. Main Workspace */}
      <div className="flex flex-1 w-full overflow-hidden relative">
        {/* Left: Drawing Toolbar */}
        <DrawingToolbar
          activeTool={activeTool}
          onSelectTool={(tool) => setActiveTool(tool)}
          onClearAll={handleClearDrawings}
          drawingCount={currentDrawings.length}
        />

        {/* Center: Interactive Chart Workspace */}
        <main className="flex-1 h-full relative overflow-hidden bg-[#0b0e14]">
          <ChartContainer
            symbol={symbol}
            timeframe={timeframe}
            layout={layout}
            candles={candles}
            smc={analysis?.smc}
            patterns={analysis?.patterns}
            forecast={analysis?.forecast}
            htfOverlay={analysis?.htf_overlay}
            visibility={visibility}
            activeTool={activeTool}
            drawings={currentDrawings}
            onAddDrawing={handleAddDrawing}
            onRemoveDrawing={handleRemoveDrawing}
          />
        </main>

        {/* Right: Confluence & Dynamics HUD Sidebar */}
        <ConfluenceSidebar
          movement={analysis?.movement}
          smc={analysis?.smc}
          forecast={analysis?.forecast}
          patterns={analysis?.patterns?.patterns}
          currentPrice={lastCandle?.close}
        />
      </div>

      {/* Symbol Search Modal */}
      <SymbolSelector
        isOpen={isSymbolModalOpen}
        market={market}
        currentSymbol={symbol}
        onClose={() => setIsSymbolModalOpen(false)}
        onSelectSymbol={handleSelectSymbol}
      />

      {/* Settings Drawer */}
      <SettingsDrawer
        isOpen={isSettingsOpen}
        settings={settings}
        onClose={() => setIsSettingsOpen(false)}
        onSave={(newSettings) => setSettings(newSettings)}
      />
    </div>
  )
}
