import { FullAnalysisResponse, AppSettings } from '../types/analysis'

const API_BASE = '/api'

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
  market: 'spot' | 'futures',
  settings: AppSettings
): Promise<FullAnalysisResponse> {
  const params = new URLSearchParams({
    symbol,
    timeframe,
    market,
    swing_length: settings.swingLength.toString(),
    fvg_min_pct: settings.fvgMinPct.toString(),
    forecast_horizon: settings.forecastHorizon.toString(),
  })

  if (settings.htf && settings.htf !== 'none') {
    params.append('htf', settings.htf)
  }

  const resp = await fetch(`${API_BASE}/analysis?${params.toString()}`)
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: resp.statusText }))
    throw new Error(err.detail || 'Analysis request failed')
  }

  return await resp.json()
}
