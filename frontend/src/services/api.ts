import { FullAnalysisResponse, AppSettings } from '../types/analysis'

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
