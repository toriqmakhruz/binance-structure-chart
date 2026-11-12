import { Candle } from '../types/analysis'

export interface WsCallback {
  onCandle: (candle: Candle, isClosed: boolean, symbol: string) => void
  onStatusChange?: (connected: boolean) => void
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
