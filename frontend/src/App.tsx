import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { TopNavbar, StreamStatusType } from './components/Navigation/TopNavbar'
import { SymbolSelector } from './components/Navigation/SymbolSelector'
import { DrawingToolbar } from './components/Chart/DrawingToolbar'
import { LayerToggles } from './components/Chart/LayerToggles'
import { ChartContainer } from './components/Chart/ChartContainer'
import { RightSidebar } from './components/HUD/RightSidebar'
import { SettingsDrawer } from './components/Settings/SettingsDrawer'
import { TelegramAlertModal } from './components/Settings/TelegramAlertModal'
import { fetchTelegramSettings } from './services/api'
import { OpenPositionModal, SetupTradeTarget } from './components/Trade/OpenPositionModal'
import { TradingDashboardDrawer } from './components/Trade/TradingDashboardDrawer'
import { ToastNotification, ToastData } from './components/UI/ToastNotification'
import { ErrorBoundary } from './components/UI/ErrorBoundary'
import { fetchAnalysis, fetchOpenPositions, fetchServerCredentials, saveServerCredentials } from './services/api'
import { BinanceWsClient } from './services/binanceWs'
import {
  Candle,
  FullAnalysisResponse,
  LayerVisibility,
  DrawingToolType,
  DrawingItem,
  AppSettings,
  LockedTradeSetup,
  ForecastScenario,
  ForecastResult,
  SetupMode
} from './types/analysis'

const DEFAULT_VISIBILITY: LayerVisibility = {
  smcSwings: true,
  smcEvents: true,
  orderBlocks: true,
  fvgs: true,
  patterns: true,
  srLevels: true,
  marketSessions: true,
  forecastCone: true,
  forecastScenarios: true,
  entryBoxes: true,
  htfOverlay: true,
  volume: true,
  openInterest: true,
  fundingRate: true
}

const DEFAULT_SETTINGS: AppSettings = {
  swingLength: 5,
  fvgMinPct: 0.05,
  forecastHorizon: 20,
  htf: '4h',
  setupMode: 'standard'
}

function readStoredJson<T>(key: string, fallback: T, mergeWithDefaults = false): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    if (mergeWithDefaults && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { ...fallback, ...parsed }
    }
    return parsed as T
  } catch {
    return fallback
  }
}

function readStoredString<T extends string>(key: string, fallback: T, allowed?: readonly string[]): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    if (allowed && !allowed.includes(raw)) return fallback
    return raw as T
  } catch {
    return fallback
  }
}

function writeStorage(key: string, value: unknown) {
  try {
    const str = typeof value === 'string' ? value : JSON.stringify(value)
    localStorage.setItem(key, str)
  } catch {
    // ignore quota errors
  }
}

export function App() {
  // Navigation & Config States (Persisted across sessions & pairs)
  const [symbol, setSymbol] = useState<string>(() => readStoredString('cp_active_symbol', 'BTCUSDT'))
  const [timeframe, setTimeframe] = useState<string>(() => readStoredString('cp_timeframe', '15m'))
  const [market, setMarket] = useState<'spot' | 'futures'>(() =>
    readStoredString('cp_market', 'futures', ['spot', 'futures'])
  )
  const [layout, setLayout] = useState<'single' | 'split-vertical' | 'split-horizontal' | 'grid-4'>(() =>
    readStoredString('cp_layout', 'single', ['single', 'split-vertical', 'split-horizontal', 'grid-4'])
  )
  const [setupMode, setSetupMode] = useState<SetupMode>(() =>
    readStoredString('cp_setup_mode', 'standard', ['standard', 'pro_shield']) as SetupMode
  )

  // Analysis & Candle Data
  const [analysis, setAnalysis] = useState<FullAnalysisResponse | null>(null)
  const [candles, setCandles] = useState<Candle[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [streamStatus, setStreamStatus] = useState<StreamStatusType>('OFFLINE')

  // Layer Visibility (Global persistent across all pairs)
  const [visibility, setVisibility] = useState<LayerVisibility>(() =>
    readStoredJson<LayerVisibility>('cp_layer_visibility', DEFAULT_VISIBILITY, true)
  )

  // Drawing Toolbar (Persistent per-symbol)
  const [activeTool, setActiveTool] = useState<DrawingToolType>('cursor')
  const [drawingsBySymbol, setDrawingsBySymbol] = useState<Record<string, DrawingItem[]>>(() =>
    readStoredJson<Record<string, DrawingItem[]>>('cp_drawings_by_symbol', {})
  )

  // Settings (Global persistent across all pairs)
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = readStoredJson<AppSettings>('cp_app_settings', DEFAULT_SETTINGS, true)
    const mode = readStoredString('cp_setup_mode', 'standard', ['standard', 'pro_shield']) as SetupMode
    return { ...saved, setupMode: mode }
  })

  // Persist global preferences & tools automatically
  useEffect(() => { writeStorage('cp_active_symbol', symbol) }, [symbol])
  useEffect(() => { writeStorage('cp_timeframe', timeframe) }, [timeframe])
  useEffect(() => { writeStorage('cp_market', market) }, [market])
  useEffect(() => { writeStorage('cp_layout', layout) }, [layout])
  useEffect(() => { writeStorage('cp_setup_mode', setupMode) }, [setupMode])
  useEffect(() => { writeStorage('cp_layer_visibility', visibility) }, [visibility])
  useEffect(() => { writeStorage('cp_app_settings', settings) }, [settings])
  useEffect(() => { writeStorage('cp_drawings_by_symbol', drawingsBySymbol) }, [drawingsBySymbol])

  // Modals / Drawers
  const [isSymbolModalOpen, setIsSymbolModalOpen] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)
  const [isTelegramModalOpen, setIsTelegramModalOpen] = useState(false)
  const [isTelegramActive, setIsTelegramActive] = useState(false)

  const checkTelegramStatus = useCallback(() => {
    fetchTelegramSettings().then(cfg => {
      if (cfg) setIsTelegramActive(Boolean(cfg.enabled && cfg.has_token && cfg.chat_id))
    }).catch(() => {})
  }, [])

  useEffect(() => {
    checkTelegramStatus()
  }, [checkTelegramStatus])

  const [isTradeModalOpen, setIsTradeModalOpen] = useState(false)
  const [selectedTradeTarget, setSelectedTradeTarget] = useState<SetupTradeTarget | null>(null)
  const [isDashboardDrawerOpen, setIsDashboardDrawerOpen] = useState(false)
  const [tradeRefreshSeq, setTradeRefreshSeq] = useState(0)

  // Notification Toast Stack
  const [toasts, setToasts] = useState<ToastData[]>([])
  const addToast = useCallback((toast: Omit<ToastData, 'id'>) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
    setToasts((prev) => [...prev, { ...toast, id }])
  }, [])
  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const handleSetupModeChange = useCallback((mode: SetupMode) => {
    setSetupMode(mode)
    setSettings((prev) => {
      const next = { ...prev, setupMode: mode }
      writeStorage('cp_app_settings', next)
      return next
    })
    addToast({
      type: 'info',
      title: mode === 'pro_shield' ? '🛡️ Mode Pro Shield Aktif' : '⚡ Mode Standar Aktif',
      message: mode === 'pro_shield'
        ? 'Engine proteksi aktif: Buffer SL diperlebar (0.8 ATR) dan validasi candle penolakan diaktifkan.'
        : 'Engine standar aktif: Setup agresif momentum dan breakout langsung dievaluasi.',
      duration: 3500
    })
  }, [addToast])

  // Locked Trade Setups: Box Setup terkunci untuk posisi aktif / open order (tidak boleh berubah sampai close/TP/SL)
  const [lockedSetups, setLockedSetups] = useState<Record<string, LockedTradeSetup>>(() =>
    readStoredJson<Record<string, LockedTradeSetup>>('cp_locked_trade_setups', {})
  )

  useEffect(() => {
    writeStorage('cp_locked_trade_setups', lockedSetups)
  }, [lockedSetups])

  const manuallyUnlockedRef = useRef<Set<string>>(new Set())

  const lockSetup = useCallback((setup: LockedTradeSetup) => {
    const symKey = setup.symbol.toUpperCase()
    manuallyUnlockedRef.current.delete(symKey)
    setLockedSetups((prev) => {
      const next = { ...prev, [symKey]: setup }
      writeStorage('cp_locked_trade_setups', next)
      try {
        window.dispatchEvent(new CustomEvent('cp_locked_setups_reconciled', { detail: next }))
      } catch {}
      return next
    })
  }, [])

  const unlockSetup = useCallback((sym: string, notifyReason?: string) => {
    const symKey = sym.toUpperCase()
    manuallyUnlockedRef.current.add(symKey)
    setLockedSetups((prev) => {
      if (!prev[symKey]) return prev
      const next = { ...prev }
      delete next[symKey]
      writeStorage('cp_locked_trade_setups', next)
      try {
        window.dispatchEvent(new CustomEvent('cp_locked_setups_reconciled', { detail: next }))
      } catch {}
      return next
    })
    if (notifyReason) {
      addToast({
        type: 'info',
        title: `Kunci Setup Dilepas (${symKey})`,
        message: notifyReason,
        duration: 4000
      })
    }
  }, [addToast])

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
      onStatusChange: (connected) => {
        setIsConnected(connected)
        if (!connected) setStreamStatus('OFFLINE')
      },
      onUpstreamStatus: (status) => {
        if (status === 'CONNECTED') setStreamStatus('LIVE')
        else if (status === 'DATA_STALE') setStreamStatus('STALE')
        else if (status === 'RECONNECTING') setStreamStatus('RECONNECTING')
        else if (status === 'CONNECTING') setStreamStatus('CONNECTING')
        else setStreamStatus('OFFLINE')
      },
      onCandle: (liveCandle, isClosed, candleSym) => {
        // Discard any ticks from previous or mismatched pair
        if (candleSym.toUpperCase() !== activeSymbolRef.current) {
          return
        }

        setCandles((prev) => {
          // Do not append a single tick until full historical candles are loaded
          if (prev.length === 0) return prev
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

  const handleSetAllLayers = (enabled: boolean) => {
    setVisibility({
      smcSwings: enabled,
      smcEvents: enabled,
      orderBlocks: enabled,
      fvgs: enabled,
      patterns: enabled,
      srLevels: enabled,
      marketSessions: enabled,
      forecastCone: enabled,
      forecastScenarios: enabled,
      entryBoxes: enabled,
      htfOverlay: enabled,
      volume: enabled,
      openInterest: enabled,
      fundingRate: enabled
    })
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

  // Current symbol active locked trade setup (if any)
  const currentLockedSetup = lockedSetups[symbol.toUpperCase()]

  // Effective Forecast: When trade is active/open (baik limit order maupun market order), setup box is LOCKED and immune to background recalculation
  const effectiveForecast: ForecastResult | undefined = useMemo(() => {
    if (!currentLockedSetup) return analysis?.forecast || undefined

    const lockedScenario: ForecastScenario = {
      id: `locked_${currentLockedSetup.symbol}`,
      name: `${currentLockedSetup.name || 'Setup Posisi Terkunci'} [TERKUNCI]`,
      direction: currentLockedSetup.direction,
      status: 'VALID_ENTRY',
      is_valid: true,
      probability: 0.99,
      confluence_weight: currentLockedSetup.confluence_score || 95,
      risk_reward_ratio: currentLockedSetup.risk_reward_ratio || 2.0,
      entry_price: currentLockedSetup.entry_price,
      entry_zone_high: currentLockedSetup.entry_price,
      entry_zone_low: currentLockedSetup.entry_price,
      invalidation_price: currentLockedSetup.invalidation_price,
      target_price: currentLockedSetup.target_price,
      entry_time: currentLockedSetup.entry_time,
      path: []
    }

    if (analysis?.forecast) {
      return {
        ...analysis.forecast,
        predicted_trend: currentLockedSetup.direction === 'LONG' ? 'BULLISH' : 'BEARISH',
        scenarios: [lockedScenario]
      }
    }

    return {
      horizon_candles: 25,
      predicted_trend: currentLockedSetup.direction === 'LONG' ? 'BULLISH' : 'BEARISH',
      confluence_score: currentLockedSetup.confluence_score || 95,
      cone_points: [],
      scenarios: [lockedScenario]
    }
  }, [analysis?.forecast, currentLockedSetup])

  // Reconcile and synchronize locked setups with active positions
  useEffect(() => {
    const handleReconcile = (e: any) => {
      if (e.detail) {
        setLockedSetups(e.detail)
      }
    }
    window.addEventListener('cp_locked_setups_reconciled', handleReconcile)

    // Periodic check: Auto-sync active positions onto chart AND cleanly release closed setups
    const syncPositionsWithChart = async () => {
      try {
        const credsRaw = localStorage.getItem('cp_trade_credentials')
        const creds = credsRaw ? JSON.parse(credsRaw) : {}
        const mode = (localStorage.getItem('cp_trade_active_mode') === 'live') ? 'live' : 'demo'
        const key = mode === 'live' ? creds.liveApiKey : creds.demoApiKey
        const secret = mode === 'live' ? creds.liveApiSecret : creds.demoApiSecret

        const res = await fetchOpenPositions(market, mode, key, secret)
        if (res && res.success && Array.isArray(res.positions)) {
          const activeSyms = new Set(
            res.positions
              .filter((p: any) => Number(p.positionAmt || 0) !== 0)
              .map((p: any) => (p.symbol || '').toUpperCase())
          )

          // Clean up manually unlocked set for symbols that no longer have positions
          for (const s of manuallyUnlockedRef.current) {
            if (!activeSyms.has(s)) {
              manuallyUnlockedRef.current.delete(s)
            }
          }

          setLockedSetups((prev) => {
            let changed = false
            const next = { ...prev }

            // A. Auto-sync active position into locked setup if not yet present and not manually unlocked
            for (const pos of res.positions) {
              const symUpper = (pos.symbol || '').toUpperCase()
              const amt = Number(pos.positionAmt || 0)
              if (symUpper && amt !== 0 && !next[symUpper] && !manuallyUnlockedRef.current.has(symUpper)) {
                const isLong = amt > 0 || pos.side === 'LONG'
                const entryP = Number(pos.entryPrice || 0)
                const rawSl = Number(pos.stopLoss || 0)
                const rawTp = Number(pos.takeProfit || 0)
                const slP = rawSl > 0 ? rawSl : (isLong ? entryP * 0.985 : entryP * 1.015)
                const tpP = rawTp > 0 ? rawTp : (isLong ? entryP * 1.03 : entryP * 0.97)

                next[symUpper] = {
                  symbol: symUpper,
                  market: market,
                  mode: mode,
                  direction: isLong ? 'LONG' : 'SHORT',
                  name: 'Setup Posisi Aktif',
                  entry_price: entryP,
                  invalidation_price: slP,
                  target_price: tpP,
                  risk_reward_ratio: 2.0,
                  order_id: pos.id,
                  leverage: pos.leverage || 10,
                  entry_time: pos.time || Math.floor(Date.now() / 1000),
                  status: 'ACTIVE',
                  created_at: Date.now()
                }
                changed = true
              }
            }

            // B. Box tetap terkunci aman dan tidak dihapus sembarangan oleh timer 10 detik.
            // Pelepasan kunci (unlock) hanya dilakukan ketika posisi ditutup di dashboard,
            // menyentuh target TP/SL, atau dilepas manual oleh user via tombol buka kunci di TopNavbar.

            if (changed) {
              writeStorage('cp_locked_trade_setups', next)
              return next
            }
            return prev
          })
        }
      } catch {}
    }

    syncPositionsWithChart()
    const timer = setInterval(syncPositionsWithChart, 20000)

    const handleSyncTrigger = () => syncPositionsWithChart()
    window.addEventListener('cp_trade_mode_change', handleSyncTrigger)
    window.addEventListener('cp_position_closed', handleSyncTrigger)
    window.addEventListener('cp_credentials_updated', handleSyncTrigger)

    return () => {
      window.removeEventListener('cp_locked_setups_reconciled', handleReconcile)
      window.removeEventListener('cp_trade_mode_change', handleSyncTrigger)
      window.removeEventListener('cp_position_closed', handleSyncTrigger)
      window.removeEventListener('cp_credentials_updated', handleSyncTrigger)
      clearInterval(timer)
    }
  }, [market])

  // Active chart setup if valid (observes locked setup first)
  const activeValidScenario = useMemo(() => {
    return effectiveForecast?.scenarios?.find(
      (s) => s.is_valid === true && (s.risk_reward_ratio || 0) >= 1.5 && s.status === 'VALID_ENTRY'
    )
  }, [effectiveForecast])

  const activeSetupTarget: SetupTradeTarget | undefined = useMemo(() => {
    if (!activeValidScenario) return undefined
    return {
      symbol,
      market,
      direction: (activeValidScenario.direction as 'LONG' | 'SHORT') || 'LONG',
      name: activeValidScenario.name,
      entry_price: activeValidScenario.entry_price || lastCandle?.close || 0,
      invalidation_price: activeValidScenario.invalidation_price,
      target_price: activeValidScenario.target_price,
      risk_reward_ratio: activeValidScenario.risk_reward_ratio,
      confluence_score: effectiveForecast?.confluence_score
    }
  }, [activeValidScenario, symbol, market, lastCandle?.close, effectiveForecast?.confluence_score])

  // Auto-detection: Unlock box when price hits Take Profit or Stop Loss
  useEffect(() => {
    if (!currentLockedSetup || !lastCandle) return
    const price = lastCandle.close
    if (price <= 0) return

    // Grace period 10 detik: cegah auto-unlock instan saat baru klik Open Posisi
    if (Date.now() - (currentLockedSetup.created_at || 0) < 10000) return

    const isLong = currentLockedSetup.direction === 'LONG'

    // 1. Take Profit hit
    const tp = currentLockedSetup.target_price
    const hitTp = isLong ? price >= tp : price <= tp
    if (tp > 0 && hitTp) {
      unlockSetup(symbol)
      addToast({
        type: 'success',
        title: `🎯 Target TP Tercapai (${symbol})!`,
        message: `Harga pasar ($${price}) telah menyentuh target Take Profit ($${tp}). Posisi selesai & box chart kembali ke analisa dinamis.`,
        details: {
          symbol,
          side: currentLockedSetup.direction as any,
          price,
          takeProfit: tp
        },
        duration: 9000
      })
      loadAnalysis(symbol, timeframe, market, settings)
      return
    }

    // 2. Stop Loss hit
    const sl = currentLockedSetup.invalidation_price
    const hitSl = isLong ? price <= sl : price >= sl
    if (sl > 0 && hitSl) {
      unlockSetup(symbol)
      addToast({
        type: 'warning',
        title: `🛑 Stop Loss Tersentuh (${symbol})`,
        message: `Harga pasar ($${price}) telah menembus batas Stop Loss ($${sl}). Posisi ditutup & box dilepas.`,
        details: {
          symbol,
          side: currentLockedSetup.direction as any,
          price,
          stopLoss: sl
        },
        duration: 9000
      })
      loadAnalysis(symbol, timeframe, market, settings)
    }
  }, [
    currentLockedSetup,
    lastCandle?.close,
    symbol,
    timeframe,
    market,
    settings,
    unlockSetup,
    addToast,
    loadAnalysis
  ])

  const handleOpenTrade = useCallback((setup: any) => {
    if (!setup) return
    const symUpper = String(setup.symbol || symbol).toUpperCase()
    const targetEntry = Number(setup.entry_price || lastCandle?.close || 0)
    const targetDir = (setup.direction || 'LONG') as 'LONG' | 'SHORT'
    const targetSl = Number(setup.invalidation_price || (targetDir === 'LONG' ? targetEntry * 0.985 : targetEntry * 1.015))
    const targetTp = Number(setup.target_price || (targetDir === 'LONG' ? targetEntry * 1.03 : targetEntry * 0.97))
    const targetRr = Number(setup.risk_reward_ratio || 2.0)
    const targetConf = Number(setup.confluence_score || setup.confluence_weight || 90)

    // KUNCI BOX SETUP SEKETIKA saat tombol Open Posisi ditekan
    // Mencegah box bergeser / hilang saat analisa dinamis background berjalan
    lockSetup({
      symbol: symUpper,
      market: setup.market || market,
      mode: (localStorage.getItem('cp_trade_active_mode') === 'live') ? 'live' : 'demo',
      direction: targetDir,
      name: setup.name || 'Setup Posisi Terpilih',
      entry_price: targetEntry,
      invalidation_price: targetSl,
      target_price: targetTp,
      risk_reward_ratio: targetRr,
      confluence_score: targetConf,
      entry_time: setup.entry_time || lastCandle?.time || Math.floor(Date.now() / 1000),
      status: 'ACTIVE',
      created_at: Date.now()
    })

    setSelectedTradeTarget({
      symbol: symUpper,
      market: setup.market || market,
      direction: targetDir,
      name: setup.name,
      entry_price: targetEntry,
      invalidation_price: targetSl,
      target_price: targetTp,
      risk_reward_ratio: targetRr,
      confluence_score: targetConf,
      planned_risk: setup.planned_risk,
      planned_risk_mode: setup.planned_risk_mode,
      planned_leverage: setup.planned_leverage,
      setup_mode: setup.setup_mode || setupMode
    })
    setIsTradeModalOpen(true)
  }, [symbol, market, lastCandle?.close, lastCandle?.time, lockSetup, setupMode])

  return (
    <div className="flex flex-col h-full h-[100dvh] max-h-[100dvh] w-full overflow-hidden bg-[#0b0e14] text-slate-100 select-none">
      {/* 1. Top Navbar */}
      <TopNavbar
        symbol={symbol}
        timeframe={timeframe}
        market={market}
        layout={layout}
        isConnected={isConnected}
        streamStatus={streamStatus}
        isLoading={isLoading}
        lastPrice={lastCandle?.close}
        activeSetup={activeSetupTarget}
        isDashboardOpen={isDashboardDrawerOpen}
        onToggleDashboard={() => setIsDashboardDrawerOpen((prev) => !prev)}
        onSymbolClick={() => setIsSymbolModalOpen(true)}
        onTimeframeChange={handleTimeframeChange}
        onMarketChange={handleMarketChange}
        onLayoutChange={(l) => setLayout(l)}
        onRefresh={() => loadAnalysis(symbol, timeframe, market, settings)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenTelegram={() => setIsTelegramModalOpen(true)}
        isTelegramActive={isTelegramActive}
        onOpenTrade={handleOpenTrade}
        isSetupLocked={Boolean(currentLockedSetup)}
        onUnlockSetup={() => unlockSetup(symbol, 'Kunci box setup chart dilepas manual.')}
        setupMode={setupMode}
        onModeChange={handleSetupModeChange}
      />

      {/* 2. Layer Toggles Bar (TradingView Dropdown Style) */}
      <LayerToggles
        visibility={visibility}
        onToggle={handleToggleLayer}
        hasHtf={Boolean(analysis?.htf_overlay)}
        market={market}
        openInterest={analysis?.open_interest}
        onSetAll={handleSetAllLayers}
      />

      {/* 3. Main Workspace */}
      <div className="flex flex-1 w-full min-h-0 overflow-hidden relative">
        {/* Left: Drawing Toolbar */}
        <DrawingToolbar
          activeTool={activeTool}
          onSelectTool={(tool) => setActiveTool(tool)}
          onClearAll={handleClearDrawings}
          drawingCount={currentDrawings.length}
        />

        {/* Center: Interactive Chart Workspace with Bottom Trading Dashboard */}
        <main className="flex-1 h-full min-h-0 relative overflow-hidden bg-[#0b0e14] flex flex-col">
          <div className="flex-1 w-full h-full min-h-0 relative overflow-hidden">
            <ChartContainer
              symbol={symbol}
              timeframe={timeframe}
              market={market}
              settings={settings}
              layout={layout}
              candles={candles}
              smc={analysis?.smc}
              patterns={analysis?.patterns}
              forecast={effectiveForecast}
              htfOverlay={analysis?.htf_overlay}
              visibility={visibility}
              activeTool={activeTool}
              drawings={currentDrawings}
              onAddDrawing={handleAddDrawing}
              onRemoveDrawing={handleRemoveDrawing}
              openInterest={analysis?.open_interest}
              fundingRate={analysis?.funding_rate}
              onToggleLayer={handleToggleLayer}
            />
          </div>

          {/* Bottom Dock: Trading Dashboard Drawer (Monitor Posisi Terbuka & Order Limit) */}
          <ErrorBoundary fallbackTitle="Dashboard Monitor Terkendala">
            <TradingDashboardDrawer
              isOpen={isDashboardDrawerOpen}
              onToggle={() => setIsDashboardDrawerOpen((prev) => !prev)}
              market={market}
              currentSymbol={symbol}
              onSelectSymbol={handleSelectSymbol}
              refreshTrigger={tradeRefreshSeq}
              onPositionClosed={(closedSym) => {
                unlockSetup(closedSym, 'Posisi ditutup. Box setup chart kembali ke analisa dinamis.')
                setTradeRefreshSeq((prev) => prev + 1)
                loadAnalysis(symbol, timeframe, market, settings)
              }}
            />
          </ErrorBoundary>
        </main>

        {/* Right: Collapsible Navigation Sidebar (Indeks, Setup Valid, Kalkulator, Watchlist) */}
        <ErrorBoundary fallbackTitle="Sidebar Terkendala">
          <RightSidebar
            symbol={symbol}
            timeframe={timeframe}
            market={market}
            settings={settings}
            candles={candles}
            movement={analysis?.movement}
            smc={analysis?.smc}
            forecast={effectiveForecast}
            patterns={analysis?.patterns?.patterns}
            currentPrice={lastCandle?.close}
            lockedSetups={lockedSetups}
            openInterest={analysis?.open_interest}
            fundingRate={analysis?.funding_rate}
            onSelectSymbol={handleSelectSymbol}
            onOpenTrade={handleOpenTrade}
            onPositionClosed={(closedSym) => {
              unlockSetup(closedSym, 'Posisi ditutup. Box setup chart kembali ke analisa dinamis.')
              setTradeRefreshSeq((prev) => prev + 1)
              loadAnalysis(symbol, timeframe, market, settings)
            }}
            onUnlockSetup={(symToUnlock) => unlockSetup(symToUnlock || symbol, 'Kunci box setup chart dilepas manual.')}
          />
        </ErrorBoundary>
      </div>

      {/* Symbol Search Modal */}
      <SymbolSelector
        isOpen={isSymbolModalOpen}
        market={market}
        currentSymbol={symbol}
        onClose={() => setIsSymbolModalOpen(false)}
        onSelectSymbol={handleSelectSymbol}
      />

      {/* Telegram Alert Modal */}
      <TelegramAlertModal
        isOpen={isTelegramModalOpen}
        onClose={() => setIsTelegramModalOpen(false)}
        onSaved={checkTelegramStatus}
      />
      {/* Settings Drawer */}
      <SettingsDrawer
        isOpen={isSettingsOpen}
        settings={settings}
        onClose={() => setIsSettingsOpen(false)}
        onSave={(newSettings) => setSettings(newSettings)}
      />

      {/* Open Position (Binance API Execution) Modal */}
      <OpenPositionModal
        isOpen={isTradeModalOpen}
        target={selectedTradeTarget}
        currentPrice={lastCandle?.close}
        onClose={() => setIsTradeModalOpen(false)}
        onSuccess={(orderRes) => {
          setTradeRefreshSeq((prev) => prev + 1)
          setIsDashboardDrawerOpen(true)

          const sym = String(orderRes.symbol || selectedTradeTarget?.symbol || symbol || 'BTCUSDT').toUpperCase()
          const dir = (orderRes.side === 'BUY' || selectedTradeTarget?.direction === 'LONG') ? 'LONG' : 'SHORT'
          const entryP = Number(orderRes.avg_price || selectedTradeTarget?.entry_price || lastCandle?.close || 0)

          const parsePriceSafe = (val: any) => {
            if (typeof val === 'number' && Number.isFinite(val) && val > 0) return val
            if (typeof val === 'string') {
              const p = parseFloat(val)
              if (Number.isFinite(p) && p > 0) return p
            }
            if (typeof val === 'object' && val !== null) {
              const p = parseFloat(val.stopPrice || val.price || val.triggerPrice)
              if (Number.isFinite(p) && p > 0) return p
            }
            return 0
          }

          const rawSl = parsePriceSafe(orderRes.stop_loss) || parsePriceSafe(orderRes.bracket_orders?.stop_loss) || parsePriceSafe(selectedTradeTarget?.invalidation_price)
          const slP = rawSl > 0 ? rawSl : (dir === 'LONG' ? entryP * 0.985 : entryP * 1.015)

          const rawTp = parsePriceSafe(orderRes.take_profit) || parsePriceSafe(orderRes.bracket_orders?.take_profit) || parsePriceSafe(selectedTradeTarget?.target_price)
          const tpP = rawTp > 0 ? rawTp : (dir === 'LONG' ? entryP * 1.03 : entryP * 0.97)

          const rr = Number(selectedTradeTarget?.risk_reward_ratio || 2.0)

          // Lock Box Setup on chart immediately!
          lockSetup({
            symbol: sym,
            market: (orderRes.market as any) || selectedTradeTarget?.market || market,
            mode: (orderRes.mode as any) || 'demo',
            direction: dir,
            name: selectedTradeTarget?.name || 'Setup Posisi Aktif',
            entry_price: entryP,
            invalidation_price: slP,
            target_price: tpP,
            risk_reward_ratio: rr,
            confluence_score: selectedTradeTarget?.confluence_score,
            order_id: orderRes.order_id,
            leverage: orderRes.leverage || 10,
            entry_time: lastCandle?.time || Math.floor(Date.now() / 1000),
            status: 'ACTIVE',
            created_at: Date.now()
          })

          const hasSlError = Boolean(orderRes.bracket_orders?.stop_loss_error)
          const hasTpError = Boolean(orderRes.bracket_orders?.take_profit_error)

          if (hasSlError || hasTpError) {
            addToast({
              type: 'warning',
              title: 'Posisi Terbuka, SL/TP Perlu Perhatian ⚠️',
              message: `Order utama berhasil, namun order pelindung Binance menolak: ${orderRes.bracket_orders?.stop_loss_error || orderRes.bracket_orders?.take_profit_error}.`,
              duration: 8000
            })
          } else {
            addToast({
              type: 'success',
              title: 'Posisi & SL/TP Berhasil Dibuka! 🚀',
              message: `Order utama aktif dengan SL ($${slP}) & TP ($${tpP}) terpasang di Binance. Box terkunci.`,
              details: {
                symbol: sym,
                side: (orderRes.side as any) || (dir === 'LONG' ? 'BUY' : 'SELL'),
                quantity: orderRes.executed_qty,
                price: entryP,
                leverage: orderRes.leverage,
                mode: orderRes.mode as 'demo' | 'live',
                orderId: orderRes.order_id,
                stopLoss: slP,
                takeProfit: tpP
              },
              duration: 7000
            })
          }
        }}
      />

      {/* Floating System Toasts */}
      <ToastNotification toasts={toasts} onDismiss={removeToast} />
    </div>
  )
}
