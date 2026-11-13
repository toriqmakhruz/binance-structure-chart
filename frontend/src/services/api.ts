import {
  FullAnalysisResponse,
  AppSettings,
  ValidSetupsResponse,
  TradeBalanceResponse,
  TradeOrderRequest,
  TradeOrderResponse
} from '../types/analysis'

const API_BASE = '/api'

export const defaultAppSettings: AppSettings = {
  swingLength: 5,
  fvgMinPct: 0.05,
  forecastHorizon: 20,
  htf: '4h'
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

  const resp = await fetch(`${API_BASE}/analysis?${params.toString()}`)
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }))
    throw new Error(typeof err.detail === 'string' ? err.detail : (err.detail?.message || 'Analysis request failed'))
  }

  return await resp.json()
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
