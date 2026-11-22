import {
  FullAnalysisResponse,
  AppSettings,
  ValidSetupsResponse,
  TradeBalanceResponse,
  TradeOrderRequest,
  TradeOrderResponse,
  OpenInterestData,
  FundingRateData
} from '../types/analysis'

const API_BASE = '/api'

export const defaultAppSettings: AppSettings = {
  swingLength: 5,
  fvgMinPct: 0.05,
  forecastHorizon: 20,
  htf: '4h',
  setupMode: 'standard'
}

export async function fetchSymbols(market: 'spot' | 'futures' = 'futures') {
  const resp = await fetch(`${API_BASE}/symbols?market=${market}`)
  if (!resp.ok) {
    throw new Error(`Failed to fetch symbols: ${resp.statusText}`)
  }
  const data = await resp.json()
  return data.symbols || []
}

export async function fetchAnalysis(
  symbol: string,
  timeframe: string,
  market: 'spot' | 'futures' = 'futures',
  settings: AppSettings = defaultAppSettings
): Promise<FullAnalysisResponse> {
  const activeSettings = settings || defaultAppSettings
  const params = new URLSearchParams({
    symbol,
    timeframe,
    market,
    swing_length: (activeSettings.swingLength || 5).toString(),
    fvg_min_pct: (activeSettings.fvgMinPct || 0.05).toString(),
    forecast_horizon: (activeSettings.forecastHorizon || 20).toString(),
  })

  if (activeSettings.htf && activeSettings.htf !== 'none') {
    params.append('htf', activeSettings.htf)
  }

  if (activeSettings.setupMode) {
    params.append('setup_mode', activeSettings.setupMode)
  }

  const resp = await fetch(`${API_BASE}/analysis?${params.toString()}`)
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }))
    throw new Error(typeof err.detail === 'string' ? err.detail : (err.detail?.message || 'Analysis request failed'))
  }

  return await resp.json()
}

export async function fetchOpenInterest(symbol: string, timeframe: string = '15m'): Promise<OpenInterestData | null> {
  try {
    const resp = await fetch(`${API_BASE}/open-interest?symbol=${encodeURIComponent(symbol.toUpperCase())}&timeframe=${encodeURIComponent(timeframe)}`)
    if (!resp.ok) return null
    return await resp.json()
  } catch (err) {
    console.debug('Failed to fetch open interest:', err)
    return null
  }
}

export async function fetchFundingRate(symbol: string): Promise<FundingRateData | null> {
  try {
    const resp = await fetch(`${API_BASE}/funding-rate?symbol=${encodeURIComponent(symbol.toUpperCase())}`)
    if (!resp.ok) return null
    return await resp.json()
  } catch (err) {
    console.debug('Failed to fetch funding rate:', err)
    return null
  }
}

export async function fetchValidSetups(
  timeframe: string,
  market: 'spot' | 'futures' = 'futures',
  settings: AppSettings = defaultAppSettings,
  forceRefresh = false
): Promise<ValidSetupsResponse> {
  const activeSettings = settings || defaultAppSettings
  const params = new URLSearchParams({
    timeframe,
    market,
    swing_length: (activeSettings.swingLength || 5).toString(),
    fvg_min_pct: (activeSettings.fvgMinPct || 0.05).toString(),
    forecast_horizon: (activeSettings.forecastHorizon || 20).toString(),
    scan_limit: '24',
    force_refresh: forceRefresh ? 'true' : 'false'
  })

  if (activeSettings.htf && activeSettings.htf !== 'none') {
    params.append('htf', activeSettings.htf)
  }

  if (activeSettings.setupMode) {
    params.append('setup_mode', activeSettings.setupMode)
  }

  const resp = await fetch(`${API_BASE}/setups?${params.toString()}`)
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }))
    throw new Error(typeof err.detail === 'string' ? err.detail : (err.detail?.message || 'Setup scan failed'))
  }

  return await resp.json()
}

export async function testTradeConnection(
  market: 'spot' | 'futures',
  mode: 'demo' | 'live',
  apiKey?: string,
  apiSecret?: string
): Promise<{ success: boolean; message: string; canTrade?: boolean }> {
  const resp = await fetch(`${API_BASE}/trade/test-connection`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      market,
      mode,
      api_key: apiKey || '',
      api_secret: apiSecret || ''
    })
  })
  return await resp.json()
}

export async function fetchTradeBalance(
  market: 'spot' | 'futures',
  mode: 'demo' | 'live',
  apiKey?: string,
  apiSecret?: string
): Promise<TradeBalanceResponse> {
  const resp = await fetch(`${API_BASE}/trade/balance`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      market,
      mode,
      api_key: apiKey || '',
      api_secret: apiSecret || ''
    })
  })
  return await resp.json()
}

export async function fetchTradeRules(
  symbol: string,
  market: 'spot' | 'futures' = 'futures',
  mode: 'demo' | 'live' = 'demo'
) {
  const params = new URLSearchParams({ symbol, market, mode })
  const resp = await fetch(`${API_BASE}/trade/rules?${params.toString()}`)
  if (!resp.ok) return null
  return await resp.json()
}

export async function executeTradeOrder(req: TradeOrderRequest): Promise<TradeOrderResponse> {
  const resp = await fetch(`${API_BASE}/trade/order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req)
  })
  return await resp.json()
}

export async function fetchOpenPositions(
  market: 'spot' | 'futures',
  mode: 'demo' | 'live',
  apiKey?: string,
  apiSecret?: string,
  symbol?: string
): Promise<{ success: boolean; total_unrealized_pnl: number; positions: any[]; message?: string }> {
  const resp = await fetch(`${API_BASE}/trade/positions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      market,
      mode,
      api_key: apiKey || '',
      api_secret: apiSecret || '',
      symbol: symbol || undefined
    })
  })
  return await resp.json()
}

export async function fetchOpenOrders(
  market: 'spot' | 'futures',
  mode: 'demo' | 'live',
  apiKey?: string,
  apiSecret?: string,
  symbol?: string
): Promise<{ success: boolean; orders: any[]; message?: string }> {
  const resp = await fetch(`${API_BASE}/trade/open-orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      market,
      mode,
      api_key: apiKey || '',
      api_secret: apiSecret || '',
      symbol: symbol || undefined
    })
  })
  return await resp.json()
}

export async function closeTradePosition(
  symbol: string,
  market: 'spot' | 'futures',
  mode: 'demo' | 'live',
  apiKey?: string,
  apiSecret?: string
): Promise<{ success: boolean; message: string }> {
  const resp = await fetch(`${API_BASE}/trade/close-position`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbol,
      market,
      mode,
      api_key: apiKey || '',
      api_secret: apiSecret || ''
    })
  })
  return await resp.json()
}

export async function cancelTradeOrder(
  symbol: string,
  orderId: number,
  market: 'spot' | 'futures',
  mode: 'demo' | 'live',
  apiKey?: string,
  apiSecret?: string
): Promise<{ success: boolean; message: string }> {
  const resp = await fetch(`${API_BASE}/trade/cancel-order`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbol,
      order_id: orderId,
      market,
      mode,
      api_key: apiKey || '',
      api_secret: apiSecret || ''
    })
  })
  return await resp.json()
}

export async function setPositionBrackets(
  symbol: string,
  stopLoss: number | null,
  takeProfit: number | null,
  market: 'spot' | 'futures',
  mode: 'demo' | 'live',
  apiKey?: string,
  apiSecret?: string
): Promise<{ success: boolean; message: string; bracket_orders?: any }> {
  const resp = await fetch(`${API_BASE}/trade/set-brackets`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbol,
      stop_loss: stopLoss,
      take_profit: takeProfit,
      market,
      mode,
      api_key: apiKey || '',
      api_secret: apiSecret || ''
    })
  })
  return await resp.json()
}

export interface ServerCredentialsData {
  demoApiKey?: string
  demoApiSecret?: string
  liveApiKey?: string
  liveApiSecret?: string
  mode?: 'demo' | 'live'
  useSimulatedDemo?: boolean
}

export async function fetchServerCredentials(): Promise<ServerCredentialsData> {
  try {
    const resp = await fetch(`${API_BASE}/trade/credentials`)
    if (resp.ok) {
      return await resp.json()
    }
  } catch (err) {
    console.warn('Failed to fetch server credentials:', err)
  }
  return {}
}

export async function saveServerCredentials(data: ServerCredentialsData): Promise<{ success: boolean; credentials?: ServerCredentialsData }> {
  try {
    const resp = await fetch(`${API_BASE}/trade/credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
    if (resp.ok) {
      return await resp.json()
    }
  } catch (err) {
    console.warn('Failed to save server credentials:', err)
  }
  return { success: false }
}

export interface UserPreferencesPayload {
  layout?: string
  market?: 'spot' | 'futures'
  symbol?: string
  timeframe?: string
  setupMode?: string
  visibility?: any
  paneVisibility?: any
  appSettings?: any
  marketSessionSettings?: any
  autoFibSettings?: any
  vpvrSettings?: any
  orderflowSettings?: any
  drawingsBySymbol?: any
  updated_at?: number
  [key: string]: any
}

export async function fetchUserPreferences(): Promise<UserPreferencesPayload> {
  try {
    const resp = await fetch(`${API_BASE}/user-preferences`)
    if (resp.ok) {
      return await resp.json()
    }
  } catch (err) {
    console.warn('Failed to fetch user preferences from server:', err)
  }
  return {}
}

export async function saveUserPreferences(data: UserPreferencesPayload): Promise<{ success: boolean; updated_at?: number }> {
  try {
    const resp = await fetch(`${API_BASE}/user-preferences`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    })
    if (resp.ok) {
      return await resp.json()
    }
  } catch (err) {
    console.warn('Failed to save user preferences to server:', err)
  }
  return { success: false }
}


export interface TradeHistoryItem {
  id: string
  symbol: string
  side: 'LONG' | 'SHORT' | 'BUY' | 'SELL' | 'PROFIT' | 'LOSS' | 'WIN'
  entryPrice?: number | null
  closePrice?: number | null
  price?: number | null
  quantity?: number
  margin?: number
  leverage?: number
  realizedPnl: number
  grossPnl?: number
  fee?: number
  netPnl?: number
  roePct?: number | null
  commission?: number
  time: number
  reason?: string
  is_simulated?: boolean
}

export interface TradeHistoryResponse {
  success: boolean
  mode: string
  market: string
  is_simulated?: boolean
  total_realized_pnl: number
  total_fee?: number
  net_realized_pnl?: number
  win_rate_pct: number
  total_trades: number
  winning_trades: number
  losing_trades: number
  trades: TradeHistoryItem[]
  warning?: string
  message?: string
}

export async function fetchTradeHistory(
  market: 'spot' | 'futures',
  mode: 'demo' | 'live',
  apiKey?: string,
  apiSecret?: string,
  symbol?: string,
  limit: number = 50
): Promise<TradeHistoryResponse> {
  try {
    const resp = await fetch(`${API_BASE}/trade/history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        market,
        mode,
        api_key: apiKey || '',
        api_secret: apiSecret || '',
        symbol: symbol || undefined,
        limit
      })
    })
    return await resp.json()
  } catch (err: any) {
    return {
      success: false,
      mode,
      market,
      total_realized_pnl: 0,
      win_rate_pct: 0,
      total_trades: 0,
      winning_trades: 0,
      losing_trades: 0,
      trades: [],
      message: err?.message || 'Gagal mengambil riwayat trade'
    }
  }
}

export async function clearTradeHistory(): Promise<{ success: boolean; message?: string }> {
  try {
    const resp = await fetch(`${API_BASE}/trade/history/clear`, {
      method: 'POST'
    })
    return await resp.json()
  } catch (err: any) {
    return { success: false, message: err?.message || 'Gagal membersihkan riwayat trade' }
  }
}


export interface TelegramSettings {
  enabled: boolean
  bot_token?: string
  bot_token_masked?: string
  has_token?: boolean
  chat_id: string
  min_rr: number
  market: 'spot' | 'futures'
  timeframe: string
  scan_interval_seconds: number
  min_confluence_score: number
  is_running?: boolean
}

export async function fetchTelegramSettings(): Promise<TelegramSettings | null> {
  try {
    const resp = await fetch(`${API_BASE}/telegram/settings`)
    if (!resp.ok) return null
    return await resp.json()
  } catch (err) {
    console.error('Failed to fetch Telegram settings:', err)
    return null
  }
}

export async function saveTelegramSettings(settings: Partial<TelegramSettings>): Promise<{ status: string; message: string; data?: TelegramSettings }> {
  const resp = await fetch(`${API_BASE}/telegram/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings)
  })
  const data = await resp.json()
  if (!resp.ok) {
    throw new Error(data?.detail || 'Gagal menyimpan pengaturan Telegram')
  }
  return data
}

export async function testTelegramNotification(params: { bot_token?: string; chat_id?: string }): Promise<{ status: string; message: string }> {
  const resp = await fetch(`${API_BASE}/telegram/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  })
  const data = await resp.json()
  if (!resp.ok) {
    throw new Error(data?.detail || 'Gagal mengirim pesan uji coba Telegram')
  }
  return data
}

import { LiquidityMatrixResponse } from '../types/liquidityMatrix'
import { MarketXrayData } from '../types/marketXray'
import { ITITelemetryResponse, ITIDataHealth } from '../types/iti'

export async function fetchLiquidityMatrix(
  symbol: string,
  market: 'spot' | 'futures' = 'futures',
  bins: number = 24
): Promise<LiquidityMatrixResponse> {
  const resp = await fetch(`${API_BASE}/market/liquidity-matrix?symbol=${encodeURIComponent(symbol)}&market=${market}&bins=${bins}`)
  if (!resp.ok) {
    throw new Error(`Failed to fetch liquidity matrix: ${resp.statusText}`)
  }
  return resp.json()
}

export async function fetchMarketXray(
  symbol: string,
  market: 'spot' | 'futures' = 'futures'
): Promise<MarketXrayData> {
  const resp = await fetch(`${API_BASE}/market/xray?symbol=${encodeURIComponent(symbol)}&market=${market}`)
  if (!resp.ok) {
    throw new Error(`Failed to fetch market xray: ${resp.statusText}`)
  }
  return resp.json()
}

export async function fetchItiTelemetry(
  symbol?: string,
  market: 'spot' | 'futures' = 'futures'
): Promise<ITITelemetryResponse> {
  const query = symbol ? `?symbol=${encodeURIComponent(symbol)}&market=${market}` : `?market=${market}`
  const resp = await fetch(`${API_BASE}/iti/telemetry${query}`)
  if (!resp.ok) {
    throw new Error(`Failed to fetch ITI telemetry: ${resp.statusText}`)
  }
  return resp.json()
}

export async function selectItiPair(
  symbol: string,
  market: 'spot' | 'futures' = 'futures'
): Promise<{ status: string; active_symbol: string; generation_id: number }> {
  const resp = await fetch(`${API_BASE}/iti/select-pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ symbol, market })
  })
  if (!resp.ok) {
    throw new Error(`Failed to switch active ITI pair: ${resp.statusText}`)
  }
  return resp.json()
}

export async function fetchItiDataHealth(): Promise<ITIDataHealth> {
  const resp = await fetch(`${API_BASE}/iti/data-health`)
  if (!resp.ok) {
    throw new Error(`Failed to fetch ITI data health: ${resp.statusText}`)
  }
  return resp.json()
}


