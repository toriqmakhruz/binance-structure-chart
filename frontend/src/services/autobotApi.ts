const API_BASE = '/api'

export interface AutoBotConfig {
  enabled: boolean
  mode: 'demo' | 'live'
  risk_per_trade_usd: number
  max_daily_loss_usd: number
  max_concurrent_positions: number
  leverage: number
  timeframe: string
  market: 'futures' | 'spot'
  api_key?: string
  api_secret?: string
}

export interface AutoBotState {
  enabled: boolean
  today_utc: string
  daily_realized_pnl: number
  circuit_breaker_triggered: boolean
  active_positions_count: number
  pending_orders_count: number
  last_scan_time: number
  active_positions: any[]
  pending_orders: any[]
}

export interface AutoBotLogEntry {
  timestamp: number
  time_str: string
  level: string
  message: string
}

export interface AutoBotStatusResponse {
  config: AutoBotConfig
  state: AutoBotState
  recent_logs: AutoBotLogEntry[]
}

export async function fetchAutoBotStatus(): Promise<AutoBotStatusResponse | null> {
  try {
    const res = await fetch(`${API_BASE}/api/bot/status`)
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export async function updateAutoBotConfig(config: Partial<AutoBotConfig>): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/bot/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config)
    })
    return res.ok
  } catch {
    return false
  }
}

export async function startAutoBot(): Promise<{ success: boolean; message: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/bot/start`, {
      method: 'POST'
    })
    const data = await res.json()
    if (!res.ok) {
      return { success: false, message: data.detail || 'Gagal menyalakan bot' }
    }
    return { success: true, message: data.message || 'Bot berhasil dinyalakan' }
  } catch (err: any) {
    return { success: false, message: err?.message || 'Error koneksi bot' }
  }
}

export async function stopAutoBot(): Promise<{ success: boolean; message: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/bot/stop`, {
      method: 'POST'
    })
    const data = await res.json()
    return { success: true, message: data.message || 'Bot dimatikan' }
  } catch (err: any) {
    return { success: false, message: err?.message || 'Error koneksi bot' }
  }
}

export async function resetAutoBotCircuitBreaker(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/api/bot/reset-circuit-breaker`, {
      method: 'POST'
    })
    return res.ok
  } catch {
    return false
  }
}

export async function panicCloseAllAutoBot(): Promise<{ success: boolean; message: string }> {
  try {
    const res = await fetch(`${API_BASE}/api/bot/panic-close-all`, {
      method: 'POST'
    })
    const data = await res.json()
    return { success: true, message: data.message || 'Panic close selesai' }
  } catch (err: any) {
    return { success: false, message: err?.message || 'Error eksekusi panic close' }
  }
}
