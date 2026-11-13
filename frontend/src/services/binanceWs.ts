import { Candle } from '../types/analysis'

export interface WsCallback {
  onCandle: (candle: Candle, isClosed: boolean, symbol: string) => void
  onStatusChange?: (connected: boolean) => void
  onUpstreamStatus?: (status: string, message?: string) => void
}

export class BinanceWsClient {
  private ws: WebSocket | null = null
  private pingInterval: any = null
  private shouldReconnect = true
  private reconnectTimeout: any = null
  private activeSymbol: string

  constructor(
    private symbol: string,
    private timeframe: string,
    private market: 'spot' | 'futures',
    private callbacks: WsCallback
  ) {
    this.activeSymbol = symbol.toUpperCase()
  }

  public connect() {
    this.shouldReconnect = true
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    const url = `${protocol}//${host}/ws/${this.symbol}/${this.timeframe}/${this.market}`

    try {
      this.ws = new WebSocket(url)

      this.ws.onopen = () => {
        if (!this.shouldReconnect) {
          this.ws?.close()
          return
        }
        this.callbacks.onStatusChange?.(true)
        this.startPing()
      }

      this.ws.onmessage = (event) => {
        if (!this.shouldReconnect) return
        try {
          if (event.data === 'pong') return
          const payload = JSON.parse(event.data)

          // Handle explicit upstream connection and stale status
          if (payload.type === 'UPSTREAM_STATUS') {
            this.callbacks.onUpstreamStatus?.(payload.status, payload.message)
            if (payload.status === 'CONNECTED') {
              this.callbacks.onStatusChange?.(true)
            } else if (payload.status === 'RECONNECTING' || payload.status === 'DATA_STALE') {
              this.callbacks.onStatusChange?.(false)
            }
            return
          }

          // Filter strictly for the active symbol
          if (payload.type === 'CANDLE_TICK' && payload.candle) {
            if (payload.symbol && payload.symbol.toUpperCase() !== this.activeSymbol) {
              return
            }
            this.callbacks.onCandle(payload.candle, payload.is_closed, this.activeSymbol)
          }
        } catch (e) {
          console.error('Error parsing WS message:', e)
        }
      }

      this.ws.onclose = () => {
        this.stopPing()
        if (this.shouldReconnect) {
          this.callbacks.onStatusChange?.(false)
          this.callbacks.onUpstreamStatus?.('DISCONNECTED', 'Backend socket disconnected')
          this.reconnectTimeout = setTimeout(() => this.connect(), 2000)
        }
      }

      this.ws.onerror = (err) => {
        console.warn('WS error:', err)
        this.ws?.close()
      }
    } catch (e) {
      console.error('Failed to instantiate WebSocket:', e)
    }
  }

  private startPing() {
    this.stopPing()
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send('ping')
      }
    }, 15000)
  }

  private stopPing() {
    if (this.pingInterval) clearInterval(this.pingInterval)
  }

  public disconnect() {
    this.shouldReconnect = false
    this.stopPing()
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout)
    if (this.ws) {
      this.ws.onmessage = null
      this.ws.onclose = null
      this.ws.onerror = null
      this.ws.close()
      this.ws = null
    }
  }
}

export interface TickerTick {
  s: string
  c: number
  P: number
  q: number
}

export interface WatchlistWsCallback {
  onTickers: (tickers: TickerTick[]) => void
  onStatusChange?: (connected: boolean) => void
}

export class WatchlistWsClient {
  private ws: WebSocket | null = null
  private pingInterval: any = null
  private reconnectTimeout: any = null
  private shouldReconnect = true

  constructor(
    private market: 'spot' | 'futures',
    private callbacks: WatchlistWsCallback
  ) {}

  public connect() {
    this.shouldReconnect = true
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${protocol}//${window.location.host}/ws/tickers/${this.market}`

    try {
      this.ws = new WebSocket(url)

      this.ws.onopen = () => {
        if (!this.shouldReconnect) {
          this.ws?.close()
          return
        }
        this.callbacks.onStatusChange?.(true)
        this.startPing()
      }

      this.ws.onmessage = (event) => {
        if (!this.shouldReconnect) return
        try {
          if (event.data === 'pong') return
          const payload = JSON.parse(event.data)

          if (payload.type === 'UPSTREAM_STATUS') {
            if (payload.status === 'CONNECTED') {
              this.callbacks.onStatusChange?.(true)
            } else if (payload.status === 'RECONNECTING' || payload.status === 'ERROR') {
              this.callbacks.onStatusChange?.(false)
            }
            return
          }

          if (payload.type === 'TICKER_BATCH' && Array.isArray(payload.tickers)) {
            this.callbacks.onTickers(payload.tickers)
          }
        } catch (e) {
          console.error('Error parsing Watchlist WS message:', e)
        }
      }

      this.ws.onclose = () => {
        this.stopPing()
        if (this.shouldReconnect) {
          this.callbacks.onStatusChange?.(false)
          this.reconnectTimeout = setTimeout(() => this.connect(), 2500)
        }
      }

      this.ws.onerror = () => {
        this.ws?.close()
      }
    } catch (e) {
      console.error('Failed to instantiate Watchlist WebSocket:', e)
    }
  }

  private startPing() {
    this.stopPing()
    this.pingInterval = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send('ping')
      }
    }, 15000)
  }

  private stopPing() {
    if (this.pingInterval) clearInterval(this.pingInterval)
  }

  public disconnect() {
    this.shouldReconnect = false
    this.stopPing()
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout)
    if (this.ws) {
      this.ws.onmessage = null
      this.ws.onclose = null
      this.ws.onerror = null
      this.ws.close()
      this.ws = null
    }
  }
}
