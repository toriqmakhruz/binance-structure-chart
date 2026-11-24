import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { LeftSidebar, StreamStatusType } from './components/Navigation/LeftSidebar'
import { SymbolSelector } from './components/Navigation/SymbolSelector'
import { ChartContainer } from './components/Chart/ChartContainer'
import { RightSidebar } from './components/HUD/RightSidebar'
import { SettingsDrawer } from './components/Settings/SettingsDrawer'
import { TelegramAlertModal } from './components/Settings/TelegramAlertModal'
import { AutoFibModal } from './components/Settings/AutoFibModal'
import { VpvrModal } from './components/Settings/VpvrModal'
import { OrderflowModal } from './components/Settings/OrderflowModal'
import { MarketSessionsModal } from './components/Settings/MarketSessionsModal'
import { LiquidityMatrixModal } from './components/HUD/LiquidityMatrixModal'
import { fetchTelegramSettings } from './services/api'
import { OpenPositionModal, SetupTradeTarget } from './components/Trade/OpenPositionModal'
import { TradingDashboardDrawer } from './components/Trade/TradingDashboardDrawer'
import { ToastNotification, ToastData } from './components/UI/ToastNotification'
import { ErrorBoundary } from './components/UI/ErrorBoundary'
import {
  fetchAnalysis,
  fetchOpenPositions,
  fetchOpenOrders,
  fetchServerCredentials,
  saveServerCredentials,
  fetchUserPreferences,
  saveUserPreferences,
  UserPreferencesPayload
} from './services/api'
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
  SetupMode,
  ValidSetupItem
} from './types/analysis'
import { AutoFibSettings, DEFAULT_AUTO_FIB_SETTINGS } from './types/fibonacci'
import { VolumeProfileSettings, DEFAULT_VOLUME_PROFILE_SETTINGS } from './types/volumeProfile'
import { OrderflowSettings, DEFAULT_ORDERFLOW_SETTINGS } from './types/orderflow'
import { MarketSessionSettings, DEFAULT_MARKET_SESSION_SETTINGS } from './types/marketSessions'

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
  fundingRate: true,
  fibonacci: true,
  volumeProfile: true,
  liquidationHeatmap: true,
  cvdOrderflow: true,
  trendRibbon: true,
  trendStrengthMeter: true,
  anchoredVwap: true,
  deltaAbsorption: true,
  judasSwing: true,
  marketXray: true,
  smartDivergence: true,
  sniperEntry: true,
  whaleSentimentMatrix: true,
  countdownBar: true
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
    readStoredString('cp_setup_mode', 'standard', ['standard', 'smart_risk', 'pro_shield', 'craig_10x', 'apex_quant']) as SetupMode
  )
  const [syncCrosshair, setSyncCrosshair] = useState<boolean>(() =>
    readStoredJson<boolean>('cp_sync_crosshair', true)
  )
  const [syncSetup, setSyncSetup] = useState<boolean>(() =>
    readStoredJson<boolean>('cp_sync_setup_box', true)
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

  // Active Pane ID in multi-chart layout ('chart-1', 'chart-2', 'chart-3', 'chart-4')
  const [activePaneId, setActivePaneId] = useState<string>('chart-1')

  // Per-Pane Layer Visibility (Independent per chart pane, persistent in localStorage)
  const [paneVisibility, setPaneVisibility] = useState<Record<string, LayerVisibility>>(() => {
    try {
      const saved = localStorage.getItem('cp_pane_visibility')
      if (saved) {
        const parsed = JSON.parse(saved)
        return {
          'chart-1': { ...DEFAULT_VISIBILITY, ...(parsed['chart-1'] || {}) },
          'chart-2': { ...DEFAULT_VISIBILITY, entryBoxes: false, ...(parsed['chart-2'] || {}) },
          'chart-3': { ...DEFAULT_VISIBILITY, ...(parsed['chart-3'] || {}) },
          'chart-4': { ...DEFAULT_VISIBILITY, ...(parsed['chart-4'] || {}) }
        }
      }
    } catch {}
    return {
      'chart-1': { ...DEFAULT_VISIBILITY },
      'chart-2': { ...DEFAULT_VISIBILITY, entryBoxes: false }, // Default matching user request: Chart 1 has entry box ON, Chart 2 has entry box OFF
      'chart-3': { ...DEFAULT_VISIBILITY },
      'chart-4': { ...DEFAULT_VISIBILITY }
    }
  })

  // Drawing Toolbar (Persistent per-symbol)
  const [activeTool, setActiveTool] = useState<DrawingToolType>('cursor')
  const [drawingsBySymbol, setDrawingsBySymbol] = useState<Record<string, DrawingItem[]>>(() =>
    readStoredJson<Record<string, DrawingItem[]>>('cp_drawings_by_symbol', {})
  )

  // Settings (Global persistent across all pairs)
  const [settings, setSettings] = useState<AppSettings>(() => {
    const saved = readStoredJson<AppSettings>('cp_app_settings', DEFAULT_SETTINGS, true)
    const mode = readStoredString('cp_setup_mode', 'standard', ['standard', 'smart_risk', 'pro_shield', 'craig_10x', 'apex_quant']) as SetupMode
    return { ...saved, setupMode: mode }
  })

  // Persist global preferences & tools automatically
  useEffect(() => { writeStorage('cp_active_symbol', symbol) }, [symbol])
  useEffect(() => { writeStorage('cp_timeframe', timeframe) }, [timeframe])
  useEffect(() => { writeStorage('cp_market', market) }, [market])
  useEffect(() => { writeStorage('cp_layout', layout) }, [layout])
  useEffect(() => { writeStorage('cp_setup_mode', setupMode) }, [setupMode])
  useEffect(() => { writeStorage('cp_sync_crosshair', syncCrosshair) }, [syncCrosshair])
  useEffect(() => { writeStorage('cp_sync_setup_box', syncSetup) }, [syncSetup])
  useEffect(() => { writeStorage('cp_layer_visibility', visibility) }, [visibility])
  useEffect(() => { writeStorage('cp_pane_visibility', paneVisibility) }, [paneVisibility])
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
  const [selectedRadarSetup, setSelectedRadarSetup] = useState<ValidSetupItem | null>(null)
  const [isDashboardDrawerOpen, setIsDashboardDrawerOpen] = useState(false)
  const [tradeRefreshSeq, setTradeRefreshSeq] = useState(0)

  // Auto Fibonacci Retracement Configuration (TradingView Style)
  const [autoFibSettings, setAutoFibSettings] = useState<AutoFibSettings>(() => {
    const stored = readStoredJson<AutoFibSettings>('cp_auto_fib_settings', DEFAULT_AUTO_FIB_SETTINGS, true)
    return {
      ...DEFAULT_AUTO_FIB_SETTINGS,
      ...(stored || {}),
      levels: Array.isArray(stored?.levels) && stored.levels.length > 0
        ? stored.levels
        : DEFAULT_AUTO_FIB_SETTINGS.levels
    }
  })
  const [isAutoFibModalOpen, setIsAutoFibModalOpen] = useState(false)

  // Volume Profile (VPVR) Configuration (TradingView Style)
  const [vpvrSettings, setVpvrSettings] = useState<VolumeProfileSettings>(() =>
    readStoredJson<VolumeProfileSettings>('cp_vpvr_settings', DEFAULT_VOLUME_PROFILE_SETTINGS, true)
  )
  const [isVpvrModalOpen, setIsVpvrModalOpen] = useState(false)

  // Orderflow & Derivatives Intelligence (Liquidation Heatmap & CVD) Configuration
  const [orderflowSettings, setOrderflowSettings] = useState<OrderflowSettings>(() =>
    readStoredJson<OrderflowSettings>('cp_orderflow_settings', DEFAULT_ORDERFLOW_SETTINGS, true)
  )
  const [isOrderflowModalOpen, setIsOrderflowModalOpen] = useState(false)
  const [orderflowModalTab, setOrderflowModalTab] = useState<'liquidation' | 'cvd'>('liquidation')
  const [isLiquidityMatrixOpen, setIsLiquidityMatrixOpen] = useState(false)

  // Market Sessions Configuration (Thin Vertical Lines & Active/Upcoming Sessions)
  const [marketSessionSettings, setMarketSessionSettings] = useState<MarketSessionSettings>(() => {
    const stored = readStoredJson<MarketSessionSettings>('cp_market_session_settings', DEFAULT_MARKET_SESSION_SETTINGS, true)
    return {
      ...DEFAULT_MARKET_SESSION_SETTINGS,
      ...(stored || {}),
      sessions: Array.isArray(stored?.sessions) && stored.sessions.length > 0
        ? stored.sessions
        : DEFAULT_MARKET_SESSION_SETTINGS.sessions
    }
  })
  const [isMarketSessionsModalOpen, setIsMarketSessionsModalOpen] = useState(false)

  // Notification Toast Stack
  const [toasts, setToasts] = useState<ToastData[]>([])
  const addToast = useCallback((toast: Omit<ToastData, 'id'>) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
    setToasts((prev) => [...prev, { ...toast, id }])
  }, [])
  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  // Cloud Sync Engine (Cross-device PC, Mobile & Browser Synchronization)
  const [isCloudSyncReady, setIsCloudSyncReady] = useState(false)
  const [isCloudSyncing, setIsCloudSyncing] = useState(false)
  const syncTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 1. Initial Load from Server on App Mount
  useEffect(() => {
    let isMounted = true
    async function initCloudPreferences() {
      try {
        const prefs = await fetchUserPreferences()
        if (!isMounted) return

        if (prefs && Object.keys(prefs).length > 0) {
          // Sync states from server to client
          if (prefs.layout && ['single', 'split-vertical', 'split-horizontal', 'grid-4'].includes(prefs.layout)) {
            setLayout(prefs.layout as any)
            writeStorage('cp_layout', prefs.layout)
          }
          if (prefs.market && ['spot', 'futures'].includes(prefs.market)) {
            setMarket(prefs.market as any)
            writeStorage('cp_market', prefs.market)
          }
          if (prefs.timeframe) {
            setTimeframe(prefs.timeframe)
            writeStorage('cp_timeframe', prefs.timeframe)
          }
          if (prefs.symbol) {
            setSymbol(prefs.symbol)
            writeStorage('cp_active_symbol', prefs.symbol)
          }
          if (prefs.setupMode && ['standard', 'smart_risk', 'pro_shield', 'craig_10x', 'apex_quant'].includes(prefs.setupMode)) {
            setSetupMode(prefs.setupMode as any)
            writeStorage('cp_setup_mode', prefs.setupMode)
          }
          if (prefs.visibility) {
            setVisibility((prev) => ({ ...prev, ...prefs.visibility }))
            writeStorage('cp_layer_visibility', { ...DEFAULT_VISIBILITY, ...prefs.visibility })
          }
          if (prefs.paneVisibility) {
            setPaneVisibility(prefs.paneVisibility as any)
            writeStorage('cp_pane_visibility', prefs.paneVisibility)
          }
          if (prefs.appSettings) {
            setSettings(prefs.appSettings)
            writeStorage('cp_app_settings', prefs.appSettings)
          }
          if (prefs.marketSessionSettings) {
            const mergedSessions: MarketSessionSettings = {
              ...DEFAULT_MARKET_SESSION_SETTINGS,
              ...prefs.marketSessionSettings,
              sessions: Array.isArray(prefs.marketSessionSettings.sessions) && prefs.marketSessionSettings.sessions.length > 0
                ? prefs.marketSessionSettings.sessions
                : DEFAULT_MARKET_SESSION_SETTINGS.sessions
            }
            setMarketSessionSettings(mergedSessions)
            writeStorage('cp_market_session_settings', mergedSessions)
          }
          if (prefs.autoFibSettings) {
            const mergedFib: AutoFibSettings = {
              ...DEFAULT_AUTO_FIB_SETTINGS,
              ...prefs.autoFibSettings,
              levels: Array.isArray(prefs.autoFibSettings.levels) && prefs.autoFibSettings.levels.length > 0
                ? prefs.autoFibSettings.levels
                : DEFAULT_AUTO_FIB_SETTINGS.levels
            }
            setAutoFibSettings(mergedFib)
            writeStorage('cp_auto_fib_settings', mergedFib)
          }
          if (prefs.vpvrSettings) {
            const mergedVpvr: VolumeProfileSettings = {
              ...DEFAULT_VOLUME_PROFILE_SETTINGS,
              ...prefs.vpvrSettings
            }
            setVpvrSettings(mergedVpvr)
            writeStorage('cp_vpvr_settings', mergedVpvr)
          }
          if (prefs.orderflowSettings) {
            const mergedOf: OrderflowSettings = {
              ...DEFAULT_ORDERFLOW_SETTINGS,
              ...prefs.orderflowSettings
            }
            setOrderflowSettings(mergedOf)
            writeStorage('cp_orderflow_settings', mergedOf)
          }
          if (prefs.drawingsBySymbol) {
            setDrawingsBySymbol(prefs.drawingsBySymbol)
            writeStorage('cp_chart_drawings', prefs.drawingsBySymbol)
          }

          addToast({
            type: 'info',
            title: 'Tersinkronkan dari Cloud Server ☁️',
            message: 'Layout, sesi pasar, dan konfigurasi indikator Anda telah dimuat otomatis.',
            duration: 3500
          })
        }
      } catch (err) {
        console.warn('Failed to load initial cloud preferences:', err)
      } finally {
        if (isMounted) setIsCloudSyncReady(true)
      }
    }

    initCloudPreferences()
    return () => {
      isMounted = false
    }
  }, [addToast])

  // 2. Debounced push to server whenever any configuration or layout changes
  const pushPreferencesToServer = useCallback(
    (customPatch?: Partial<UserPreferencesPayload>) => {
      if (!isCloudSyncReady) return
      if (syncTimeoutRef.current) clearTimeout(syncTimeoutRef.current)
      setIsCloudSyncing(true)

      syncTimeoutRef.current = setTimeout(async () => {
        try {
          const payload: UserPreferencesPayload = {
            layout,
            market,
            symbol,
            timeframe,
            setupMode,
            visibility,
            paneVisibility,
            appSettings: settings,
            marketSessionSettings,
            autoFibSettings,
            vpvrSettings,
            orderflowSettings,
            drawingsBySymbol,
            ...(customPatch || {})
          }
          await saveUserPreferences(payload)
        } catch (e) {
          console.warn('Auto sync to server error:', e)
        } finally {
          setIsCloudSyncing(false)
        }
      }, 1200)
    },
    [
      isCloudSyncReady,
      layout,
      market,
      symbol,
      timeframe,
      setupMode,
      visibility,
      paneVisibility,
      settings,
      marketSessionSettings,
      autoFibSettings,
      vpvrSettings,
      orderflowSettings,
      drawingsBySymbol
    ]
  )

  // Trigger auto save when settings change
  useEffect(() => {
    if (!isCloudSyncReady) return
    pushPreferencesToServer()
  }, [
    isCloudSyncReady,
    layout,
    market,
    timeframe,
    setupMode,
    visibility,
    paneVisibility,
    settings,
    marketSessionSettings,
    autoFibSettings,
    vpvrSettings,
    orderflowSettings
  ])

  // 3. Manual Cloud Sync Action
  const handleManualCloudSync = useCallback(async () => {
    setIsCloudSyncing(true)
    try {
      const payload: UserPreferencesPayload = {
        layout,
        market,
        symbol,
        timeframe,
        setupMode,
        visibility,
        paneVisibility,
        appSettings: settings,
        marketSessionSettings,
        autoFibSettings,
        vpvrSettings,
        orderflowSettings,
        drawingsBySymbol
      }
      const res = await saveUserPreferences(payload)
      if (res.success) {
        addToast({
          type: 'success',
          title: 'Konfigurasi Tersimpan di Cloud! ☁️',
          message: 'Layout, sesi pasar, dan indikator berhasil disimpan di server. Buka di HP atau browser lain akan langsung sama persis!',
          duration: 4000
        })
      } else {
        addToast({
          type: 'error',
          title: 'Gagal Menyimpan ke Cloud ⚠️',
          message: 'Periksa koneksi jaringan ke server VPS.',
          duration: 4000
        })
      }
    } catch {
      addToast({
        type: 'error',
        title: 'Gagal Menyimpan ke Cloud ⚠️',
        message: 'Koneksi ke server terputus.',
        duration: 4000
      })
    } finally {
      setIsCloudSyncing(false)
    }
  }, [
    layout,
    market,
    symbol,
    timeframe,
    setupMode,
    visibility,
    paneVisibility,
    settings,
    marketSessionSettings,
    autoFibSettings,
    vpvrSettings,
    orderflowSettings,
    drawingsBySymbol,
    addToast
  ])

  const handleSetupModeChange = useCallback((mode: SetupMode) => {
    setSetupMode(mode)
    setSettings((prev) => {
      const next = { ...prev, setupMode: mode }
      writeStorage('cp_app_settings', next)
      return next
    })
    const title =
      mode === 'smart_risk'
        ? '🏛️ Mode Smart Risk SMC Aktif'
        : mode === 'apex_quant'
          ? '💎 Mode Apex Quant A++ Aktif'
          : mode === 'craig_10x'
            ? '🎯 Mode Craig 10x Aktif'
            : mode === 'pro_shield'
              ? '🛡️ Mode Pro Shield Aktif'
              : '⚡ Mode Standar Aktif'
    const message =
      mode === 'smart_risk'
        ? 'Engine Smart Risk SMC aktif: Candlestick Sweep OB, Inducement Trap Protection, 50% Mean Threshold Entry & R:R min 1:2.'
        : mode === 'apex_quant'
          ? 'Engine Ultimate Hybrid aktif: Unicorn OB+FVG, Fibonacci OTE (0.618-0.786), Volume Absorption, Adaptive SL 0.35 ATR & Structural TP.'
          : mode === 'craig_10x'
            ? 'Engine Craig 10x aktif: Asymmetric R:R (min 3R - 10R), Liquidity Sweep, FVG 50% Retest, Micro-SL & Auto-BE.'
            : mode === 'pro_shield'
              ? 'Engine proteksi aktif: Buffer SL diperlebar (0.8 ATR) dan validasi candle penolakan diaktifkan.'
              : 'Engine standar aktif: Setup agresif momentum dan breakout langsung dievaluasi.'
    addToast({
      type: 'info',
      title,
      message,
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
  const handleSelectSymbol = (newSymbol: string, setupItem?: ValidSetupItem) => {
    const cleanSym = newSymbol.toUpperCase()
    const tfChanged = Boolean(setupItem?.timeframe && setupItem.timeframe.toLowerCase() !== timeframe.toLowerCase())
    const symChanged = cleanSym !== symbol
    const mktChanged = Boolean(setupItem?.market && setupItem.market !== market)

    if (setupItem) {
      setSelectedRadarSetup(setupItem)
      if (mktChanged && setupItem.market) {
        setMarket(setupItem.market)
      }
      if (tfChanged && setupItem.timeframe) {
        setTimeframe(setupItem.timeframe.toLowerCase())
      }
    } else if (symChanged) {
      setSelectedRadarSetup(null)
    }

    if (!symChanged && !tfChanged && !mktChanged) return

    activeSymbolRef.current = cleanSym
    setCandles([])
    setAnalysis(null)
    if (symChanged) {
      setSymbol(cleanSym)
      try {
        localStorage.setItem('cp_symbol', cleanSym)
      } catch {}
    }
  }

  const handleTimeframeChange = (newTf: string) => {
    if (!newTf) return
    const cleanTf = newTf.toLowerCase()
    if (cleanTf === timeframe.toLowerCase()) return
    try {
      localStorage.setItem('cp_timeframe', cleanTf)
    } catch {}
    setCandles([])
    setAnalysis(null)
    setTimeframe(cleanTf)
  }

  const handleMarketChange = (newMarket: 'spot' | 'futures') => {
    if (newMarket === market) return
    setCandles([])
    setAnalysis(null)
    setMarket(newMarket)
  }

  const handleTogglePaneLayer = useCallback((paneId: string, key: keyof LayerVisibility) => {
    setPaneVisibility((prev) => {
      const currentPaneVis = prev[paneId] || visibility
      const next = {
        ...prev,
        [paneId]: {
          ...currentPaneVis,
          [key]: !currentPaneVis[key]
        }
      }
      return next
    })
    if (paneId === 'chart-1') {
      setVisibility((prev) => ({ ...prev, [key]: !prev[key] }))
    }
  }, [visibility])

  const handleSetAllPaneLayers = useCallback((paneId: string, enabled: boolean) => {
    setPaneVisibility((prev) => {
      const currentPaneVis = prev[paneId] || visibility
      const allKeys: (keyof LayerVisibility)[] = [
        'smcSwings', 'smcEvents', 'orderBlocks', 'fvgs', 'patterns',
        'srLevels', 'marketSessions', 'forecastCone', 'forecastScenarios',
        'entryBoxes', 'htfOverlay', 'volume', 'openInterest', 'fundingRate',
        'fibonacci', 'volumeProfile', 'liquidationHeatmap', 'cvdOrderflow',
        'trendRibbon', 'trendStrengthMeter', 'anchoredVwap', 'deltaAbsorption', 'judasSwing', 'marketXray', 'smartDivergence', 'sniperEntry', 'whaleSentimentMatrix', 'countdownBar'
      ]
      const updatedVis = { ...currentPaneVis }
      allKeys.forEach((k) => {
        updatedVis[k] = enabled
      })
      return {
        ...prev,
        [paneId]: updatedVis
      }
    })
    if (paneId === 'chart-1') {
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
        fundingRate: enabled,
        fibonacci: enabled,
        volumeProfile: enabled,
        liquidationHeatmap: enabled,
        cvdOrderflow: enabled,
        trendRibbon: enabled,
        trendStrengthMeter: enabled,
        anchoredVwap: enabled,
        deltaAbsorption: enabled,
        judasSwing: enabled,
        marketXray: enabled,
        smartDivergence: enabled,
        sniperEntry: enabled,
        whaleSentimentMatrix: enabled,
        countdownBar: enabled
      })
    }
  }, [visibility])

  const handleToggleLayer = (key: keyof LayerVisibility) => {
    if (layout !== 'single') {
      handleTogglePaneLayer(activePaneId, key)
    } else {
      setVisibility((prev) => ({ ...prev, [key]: !prev[key] }))
      handleTogglePaneLayer('chart-1', key)
    }
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
      fundingRate: enabled,
      fibonacci: enabled,
      volumeProfile: enabled,
      liquidationHeatmap: enabled,
      cvdOrderflow: enabled,
      trendRibbon: enabled,
      trendStrengthMeter: enabled,
      anchoredVwap: enabled,
      deltaAbsorption: enabled,
      judasSwing: enabled,
      marketXray: enabled,
      smartDivergence: enabled,
      sniperEntry: enabled
    })
    if (layout !== 'single') {
      handleSetAllPaneLayers(activePaneId, enabled)
    } else {
      handleSetAllPaneLayers('chart-1', enabled)
    }
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

  const handleUpdateDrawing = (item: DrawingItem) => {
    setDrawingsBySymbol((prev) => ({
      ...prev,
      [symbol]: (prev[symbol] || []).map((d) => (d.id === item.id ? item : d))
    }))
  }

  const handleUndoDrawing = () => {
    setDrawingsBySymbol((prev) => {
      const list = prev[symbol] || []
      if (list.length === 0) return prev
      return {
        ...prev,
        [symbol]: list.slice(0, list.length - 1)
      }
    })
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
    if (currentLockedSetup) {
      const lockedScenario: ForecastScenario = {
        id: `locked_${currentLockedSetup.symbol}`,
        name: `${currentLockedSetup.name || 'Setup Posisi'} [${currentLockedSetup.status === 'PENDING_LIMIT' ? 'PENDING LIMIT' : 'TERKUNCI'}]`,
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
    }

    // Jika user memilih setup dari panel Radar, pastikan box setup SELALU muncul di chart
    if (selectedRadarSetup && selectedRadarSetup.symbol.toUpperCase() === symbol.toUpperCase()) {
      const radarScenario: ForecastScenario = {
        id: `radar_${selectedRadarSetup.symbol}`,
        name: selectedRadarSetup.name,
        direction: selectedRadarSetup.direction,
        status: 'VALID_ENTRY',
        is_valid: true,
        probability: 0.95,
        confluence_weight: selectedRadarSetup.confluence_weight || 75,
        risk_reward_ratio: selectedRadarSetup.risk_reward_ratio || 2.0,
        entry_price: selectedRadarSetup.entry_price,
        entry_zone_high: selectedRadarSetup.entry_zone_high ?? selectedRadarSetup.entry_price,
        entry_zone_low: selectedRadarSetup.entry_zone_low ?? selectedRadarSetup.entry_price,
        invalidation_price: selectedRadarSetup.invalidation_price,
        target_price: selectedRadarSetup.target_price,
        entry_time: selectedRadarSetup.entry_time,
        path: []
      }

      if (analysis?.forecast) {
        // ALWAYS put radarScenario FIRST so Pane 1 (left execution chart) prioritizes the selected setup box!
        const existingWithoutRadar = (analysis.forecast.scenarios || []).filter(
          (s) => s.id !== radarScenario.id && s.direction === selectedRadarSetup.direction
        )
        return {
          ...analysis.forecast,
          predicted_trend: selectedRadarSetup.direction === 'LONG' ? 'BULLISH' : 'BEARISH',
          confluence_score: selectedRadarSetup.confluence_score || analysis.forecast.confluence_score,
          scenarios: [radarScenario, ...existingWithoutRadar]
        }
      }

      return {
        horizon_candles: 25,
        predicted_trend: selectedRadarSetup.direction === 'LONG' ? 'BULLISH' : 'BEARISH',
        confluence_score: selectedRadarSetup.confluence_score || 80,
        cone_points: [],
        scenarios: [radarScenario]
      }
    }

    return analysis?.forecast || undefined
  }, [analysis?.forecast, currentLockedSetup, selectedRadarSetup, symbol])

  // Reconcile and synchronize locked setups with active positions
  useEffect(() => {
    const handleReconcile = (e: any) => {
      if (e.detail) {
        setLockedSetups(e.detail)
      }
    }
    window.addEventListener('cp_locked_setups_reconciled', handleReconcile)

    // Periodic check: Auto-sync active positions & pending limit orders onto chart
    const syncPositionsWithChart = async () => {
      try {
        const credsRaw = localStorage.getItem('cp_trade_credentials')
        const creds = credsRaw ? JSON.parse(credsRaw) : {}
        const mode = (localStorage.getItem('cp_trade_active_mode') === 'live') ? 'live' : 'demo'
        const key = mode === 'live' ? creds.liveApiKey : creds.demoApiKey
        const secret = mode === 'live' ? creds.liveApiSecret : creds.demoApiSecret

        const [res, ordRes] = await Promise.all([
          fetchOpenPositions(market, mode, key, secret),
          fetchOpenOrders(market, mode, key, secret)
        ])

        if (!res?.success && !ordRes?.success) {
          // Koneksi API sementara bermasalah, lewati sync putaran ini agar chart setup tidak hilang
          return
        }

        const activePositions = (res && res.success && Array.isArray(res.positions)) ? res.positions : []
        const openOrders = (ordRes && ordRes.success && Array.isArray(ordRes.orders)) ? ordRes.orders : []

        const activeFilledSyms = new Set(
          activePositions
            .filter((p: any) => Number(p.positionAmt || 0) !== 0)
            .map((p: any) => (p.symbol || '').toUpperCase())
        )

        // Identify pending entry orders (orders that are NOT reduceOnly / closePosition)
        const pendingEntryOrders = openOrders.filter((o: any) => {
          const isExit = Boolean(o.reduceOnly || o.closePosition || o.is_algo || String(o.type || '').includes('STOP') || String(o.type || '').includes('PROFIT'))
          return !isExit && o.status === 'NEW'
        })

        const activeOrderSyms = new Set(
          pendingEntryOrders.map((o: any) => (o.symbol || '').toUpperCase())
        )

        const allActiveSyms = new Set([...activeFilledSyms, ...activeOrderSyms])

        // Clean up manually unlocked set for symbols that no longer have positions or orders
        for (const s of manuallyUnlockedRef.current) {
          if (!allActiveSyms.has(s)) {
            manuallyUnlockedRef.current.delete(s)
          }
        }

        setLockedSetups((prev) => {
          let changed = false
          const next = { ...prev }

          // 1. Auto-sync active filled positions into locked setup
          for (const pos of activePositions) {
            const symUpper = (pos.symbol || '').toUpperCase()
            const amt = Number(pos.positionAmt || 0)
            if (symUpper && amt !== 0 && !manuallyUnlockedRef.current.has(symUpper)) {
              const isLong = amt > 0 || pos.side === 'LONG'
              const entryP = Number(pos.entryPrice || 0)
              const rawSl = Number(pos.stopLoss || 0)
              const rawTp = Number(pos.takeProfit || 0)

              if (!next[symUpper]) {
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
              } else if (next[symUpper].status === 'PENDING_LIMIT') {
                // Transition from PENDING_LIMIT to ACTIVE once position filled on Binance!
                next[symUpper] = {
                  ...next[symUpper],
                  status: 'ACTIVE',
                  name: 'Setup Posisi Aktif',
                  entry_price: entryP > 0 ? entryP : next[symUpper].entry_price,
                  invalidation_price: rawSl > 0 ? rawSl : next[symUpper].invalidation_price,
                  target_price: rawTp > 0 ? rawTp : next[symUpper].target_price
                }
                changed = true
              }
            }
          }

          // 2. Auto-sync pending entry orders (e.g. LIMIT orders) if not already tracked
          for (const ord of pendingEntryOrders) {
            const symUpper = (ord.symbol || '').toUpperCase()
            if (symUpper && !activeFilledSyms.has(symUpper) && !manuallyUnlockedRef.current.has(symUpper)) {
              if (!next[symUpper]) {
                const isLong = ord.side === 'BUY'
                const entryP = Number(ord.price || 0)
                if (entryP > 0) {
                  // Search for associated trigger bracket orders in openOrders
                  const slOrd = openOrders.find((o: any) => (o.symbol || '').toUpperCase() === symUpper && String(o.type || '').includes('STOP'))
                  const tpOrd = openOrders.find((o: any) => (o.symbol || '').toUpperCase() === symUpper && String(o.type || '').includes('PROFIT'))
                  const rawSl = Number(slOrd?.stopPrice || 0)
                  const rawTp = Number(tpOrd?.stopPrice || 0)
                  const slP = rawSl > 0 ? rawSl : (isLong ? entryP * 0.985 : entryP * 1.015)
                  const tpP = rawTp > 0 ? rawTp : (isLong ? entryP * 1.03 : entryP * 0.97)

                  next[symUpper] = {
                    symbol: symUpper,
                    market: market,
                    mode: mode,
                    direction: isLong ? 'LONG' : 'SHORT',
                    name: `Setup Limit Pending [${ord.side}]`,
                    entry_price: entryP,
                    invalidation_price: slP,
                    target_price: tpP,
                    risk_reward_ratio: 2.0,
                    order_id: ord.orderId,
                    entry_time: ord.time || Math.floor(Date.now() / 1000),
                    status: 'PENDING_LIMIT',
                    created_at: Date.now()
                  }
                  changed = true
                }
              }
            }
          }

          if (changed) {
            writeStorage('cp_locked_trade_setups', next)
            return next
          }
          return prev
        })
      } catch {}
    }

    syncPositionsWithChart()
    const timer = setInterval(syncPositionsWithChart, 20000)

    const handleSyncTrigger = () => syncPositionsWithChart()
    window.addEventListener('cp_trade_mode_change', handleSyncTrigger)
    window.addEventListener('cp_position_closed', handleSyncTrigger)
    window.addEventListener('cp_credentials_updated', handleSyncTrigger)
    window.addEventListener('cp_user_data_update', handleSyncTrigger)

    return () => {
      window.removeEventListener('cp_locked_setups_reconciled', handleReconcile)
      window.removeEventListener('cp_trade_mode_change', handleSyncTrigger)
      window.removeEventListener('cp_position_closed', handleSyncTrigger)
      window.removeEventListener('cp_credentials_updated', handleSyncTrigger)
      window.removeEventListener('cp_user_data_update', handleSyncTrigger)
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

    // Jangan auto-unlock TP/SL jika order masih berupa pending LIMIT yang belum terisi (FILLED)!
    if (currentLockedSetup.status === 'PENDING_LIMIT') return

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
      {/* Main Workspace (Full-height chart with Left Sidebar) */}
      <div className="flex flex-1 w-full min-h-0 overflow-hidden relative">
        <LeftSidebar
          symbol={symbol}
        lastPrice={lastCandle?.close}
        onSymbolClick={() => setIsSymbolModalOpen(true)}
        timeframe={timeframe}
        onTimeframeChange={handleTimeframeChange}
        market={market}
        onMarketChange={handleMarketChange}
        setupMode={setupMode}
        onModeChange={handleSetupModeChange}
        layout={layout}
        onLayoutChange={(l) => setLayout(l)}
        syncCrosshair={syncCrosshair}
        onToggleSyncCrosshair={() => setSyncCrosshair((prev) => !prev)}
        syncSetup={syncSetup}
        onToggleSyncSetup={() => setSyncSetup((prev) => !prev)}
        isSetupLocked={Boolean(currentLockedSetup)}
        onUnlockSetup={() => unlockSetup(symbol, 'Kunci box setup chart dilepas manual.')}
        activeSetup={activeSetupTarget}
        onOpenTrade={handleOpenTrade}
        activeTool={activeTool}
        onSelectTool={(tool) => setActiveTool(tool)}
        onClearAll={handleClearDrawings}
        drawingCount={currentDrawings.length}
        isLoading={isLoading}
        onRefresh={() => loadAnalysis(symbol, timeframe, market, settings)}
        isDashboardOpen={isDashboardDrawerOpen}
        onToggleDashboard={() => setIsDashboardDrawerOpen((prev) => !prev)}
        isTelegramActive={isTelegramActive}
        onOpenTelegram={() => setIsTelegramModalOpen(true)}
        isCloudSyncing={isCloudSyncing}
        onCloudSync={handleManualCloudSync}
        onOpenSettings={() => setIsSettingsOpen(true)}
        streamStatus={streamStatus}
        onOpenLiquidityMatrix={() => setIsLiquidityMatrixOpen(true)}
      />

      {/* 2. Interactive Chart Workspace with Bottom Trading Dashboard */}
      <main className="flex-1 h-full min-h-0 relative overflow-hidden bg-[#0b0e14] flex flex-col">
        <div className="flex-1 w-full h-full min-h-0 relative overflow-hidden">
          <ErrorBoundary fallbackTitle="Chart Workspace Terkendala">
            <ChartContainer
              symbol={symbol}
              onSymbolClick={() => setIsSymbolModalOpen(true)}
              timeframe={timeframe}
              market={market}
              settings={settings}
              layout={layout}
              syncCrosshair={syncCrosshair}
              onToggleSyncCrosshair={() => setSyncCrosshair((prev) => !prev)}
              syncSetup={syncSetup}
              onToggleSyncSetup={() => setSyncSetup((prev) => !prev)}
              candles={candles}
              smc={analysis?.smc}
              patterns={analysis?.patterns}
              forecast={
                (analysis?.symbol?.toUpperCase() === symbol.toUpperCase() || Boolean(currentLockedSetup) || Boolean(selectedRadarSetup))
                  ? effectiveForecast
                  : undefined
              }
              htfOverlay={analysis?.htf_overlay}
              visibility={visibility}
              paneVisibility={paneVisibility}
              autoFibSettings={autoFibSettings}
              onOpenAutoFibSettings={() => setIsAutoFibModalOpen(true)}
              vpvrSettings={vpvrSettings}
              onOpenVpvrSettings={() => setIsVpvrModalOpen(true)}
              orderflowSettings={orderflowSettings}
              onOpenOrderflowSettings={(tab) => {
                setOrderflowModalTab(tab)
                setIsOrderflowModalOpen(true)
              }}
              marketSessionSettings={marketSessionSettings}
              onOpenMarketSessionSettings={() => setIsMarketSessionsModalOpen(true)}
              trendStrength={analysis?.trend_strength}
              onTogglePaneLayer={handleTogglePaneLayer}
              onSetAllPaneLayers={handleSetAllPaneLayers}
              activePaneId={activePaneId}
              onSelectPane={setActivePaneId}
              activeTool={activeTool}
              onSelectTool={setActiveTool}
              drawings={currentDrawings}
              onAddDrawing={handleAddDrawing}
              onUpdateDrawing={handleUpdateDrawing}
              onUndoDrawing={handleUndoDrawing}
              onRemoveDrawing={handleRemoveDrawing}
              openInterest={analysis?.open_interest}
              fundingRate={analysis?.funding_rate}
              onToggleLayer={handleToggleLayer}
              onTimeframeChange={handleTimeframeChange}
              onOpenLiquidityMatrix={() => setIsLiquidityMatrixOpen(true)}
            />
          </ErrorBoundary>
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
            trendStrength={analysis?.trend_strength}
            smc={analysis?.smc}
            forecast={
              (analysis?.symbol?.toUpperCase() === symbol.toUpperCase() || Boolean(currentLockedSetup) || Boolean(selectedRadarSetup))
                ? effectiveForecast
                : undefined
            }
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
            name: (orderRes.type === 'LIMIT' && orderRes.status === 'NEW')
              ? `Setup Limit Pending [${dir}]`
              : (selectedTradeTarget?.name || 'Setup Posisi Aktif'),
            entry_price: entryP,
            invalidation_price: slP,
            target_price: tpP,
            risk_reward_ratio: rr,
            confluence_score: selectedTradeTarget?.confluence_score,
            order_id: orderRes.order_id,
            leverage: orderRes.leverage || 10,
            entry_time: lastCandle?.time || Math.floor(Date.now() / 1000),
            status: (orderRes.type === 'LIMIT' && orderRes.status === 'NEW') ? 'PENDING_LIMIT' : 'ACTIVE',
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

      {/* Auto Fibonacci Retracement Settings Modal (TradingView Style) */}
      <AutoFibModal
        isOpen={isAutoFibModalOpen}
        settings={autoFibSettings}
        onClose={() => setIsAutoFibModalOpen(false)}
        onSave={(newSettings) => {
          setAutoFibSettings(newSettings)
          writeStorage('cp_auto_fib_settings', newSettings)
          addToast({
            type: 'success',
            title: 'Pengaturan Auto Fibonacci Disimpan ⚙️',
            message: 'Konfigurasi level, gaya visual, dan parameter anti-repaint berhasil diperbarui.',
            duration: 4000
          })
        }}
      />

      {/* Volume Profile (VPVR) Settings Modal (TradingView Style) */}
      <VpvrModal
        isOpen={isVpvrModalOpen}
        settings={vpvrSettings}
        onClose={() => setIsVpvrModalOpen(false)}
        onSave={(newSettings) => {
          setVpvrSettings(newSettings)
          writeStorage('cp_vpvr_settings', newSettings)
          addToast({
            type: 'success',
            title: 'Pengaturan Volume Profile (VPVR) Disimpan 📊',
            message: `Resolusi ${newSettings.rowSize} rows, Value Area ${newSettings.valueAreaVolumePct}%, dan level POC/VAH/VAL berhasil diperbarui.`,
            duration: 4000
          })
        }}
      />

      {/* Orderflow & Derivatives Intelligence Settings Modal (Liquidation Heatmap & CVD) */}
      <OrderflowModal
        isOpen={isOrderflowModalOpen}
        initialTab={orderflowModalTab}
        settings={orderflowSettings}
        onClose={() => setIsOrderflowModalOpen(false)}
        onSave={(newSettings) => {
          setOrderflowSettings(newSettings)
          writeStorage('cp_orderflow_settings', newSettings)
          addToast({
            type: 'success',
            title: 'Konfigurasi Orderflow & Liquidation Disimpan 🔥',
            message: 'Parameter Liquidation Heatmap (25x/50x/100x) dan CVD Divergence berhasil diperbarui.',
            duration: 4000
          })
        }}
      />

      {/* Market Sessions Settings Modal (Thin Vertical Lines & Active/Upcoming Sessions) */}
      <MarketSessionsModal
        isOpen={isMarketSessionsModalOpen}
        settings={marketSessionSettings}
        onClose={() => setIsMarketSessionsModalOpen(false)}
        onSave={(newSettings) => {
          setMarketSessionSettings(newSettings)
          writeStorage('cp_market_session_settings', newSettings)
          addToast({
            type: 'success',
            title: 'Pengaturan Sesi Pasar Disimpan ⏰',
            message: 'Konfigurasi garis vertikal tipis, jam sesi UTC, dan penanda sesi berhasil diperbarui.',
            duration: 4000
          })
        }}
      />

      {/* Real-time Order & Stop Loss Matrix Modal (Non-Chart DOM) */}
      <LiquidityMatrixModal
        isOpen={isLiquidityMatrixOpen}
        onClose={() => setIsLiquidityMatrixOpen(false)}
        symbol={symbol}
        market={market}
      />

      {/* Floating System Toasts */}
      <ToastNotification toasts={toasts} onDismiss={removeToast} />
    </div>
  )
}
