export interface UserDataWsCallbacks {
  onAccountUpdate?: (data: any) => void
  onOrderUpdate?: (data: any) => void
  onStatusChange?: (connected: boolean) => void
}

export class UserDataWsClient {
  private ws: WebSocket | null = null
  private pingInterval: any = null
  private reconnectTimeout: any = null
  private shouldReconnect = true
  private backoff = 1000

  constructor(
    private market: 'spot' | 'futures',
    private mode: 'demo' | 'live',
    private callbacks: UserDataWsCallbacks = {}
  ) {}

  public connect(apiKey?: string, apiSecret?: string) {
    this.shouldReconnect = true
    this.cleanup()

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const host = window.location.host
    const url = `${protocol}//${host}/ws/user-data/${this.market}/${this.mode}`

    try {
      this.ws = new WebSocket(url)

      this.ws.onopen = () => {
        this.backoff = 1000
        this.callbacks.onStatusChange?.(true)
        this.startPing()

        // If credentials provided, authenticate
        if (apiKey || apiSecret) {
          this.sendAuth(apiKey || '', apiSecret || '')
        }
      }

      this.ws.onmessage = (event) => {
        if (event.data === 'pong') return
        try {
          const payload = JSON.parse(event.data)

          if (payload.type === 'USER_STREAM_STATUS') {
            const isConnected = payload.status === 'CONNECTED'
            this.callbacks.onStatusChange?.(isConnected)
            return
          }

          if (payload.type === 'ACCOUNT_UPDATE') {
            this.callbacks.onAccountUpdate?.(payload)
            // Emit global event for other components (Sidebar, App, Radar)
            window.dispatchEvent(
              new CustomEvent('cp_user_data_update', {
                detail: { type: 'ACCOUNT_UPDATE', data: payload }
              })
            )
            return
          }

          if (payload.type === 'ORDER_TRADE_UPDATE') {
            this.callbacks.onOrderUpdate?.(payload)
            window.dispatchEvent(
              new CustomEvent('cp_user_data_update', {
                detail: { type: 'ORDER_TRADE_UPDATE', data: payload }
              })
            )
            return
          }
        } catch (err) {
          console.warn('Failed parsing user data stream event:', err)
        }
      }

      this.ws.onerror = (err) => {
        console.warn('UserDataWs error:', err)
        this.callbacks.onStatusChange?.(false)
      }

      this.ws.onclose = () => {
        this.callbacks.onStatusChange?.(false)
        this.stopPing()
        if (this.shouldReconnect) {
          this.scheduleReconnect(apiKey, apiSecret)
        }
      }
    } catch (err) {
      console.warn('Failed establishing UserDataWs connection:', err)
      this.scheduleReconnect(apiKey, apiSecret)
    }
  }

  public sendAuth(apiKey: string, apiSecret: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'AUTH', apiKey, apiSecret }))
    }
  }

  private startPing() {
    this.stopPing()
    this.pingInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send('ping')
      }
    }, 20000)
  }

  private stopPing() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval)
      this.pingInterval = null
    }
  }

  private scheduleReconnect(apiKey?: string, apiSecret?: string) {
    if (!this.shouldReconnect) return
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout)
    this.reconnectTimeout = setTimeout(() => {
      this.connect(apiKey, apiSecret)
    }, this.backoff)
    this.backoff = min(this.backoff * 1.5, 15000)
  }

  public disconnect() {
    this.shouldReconnect = false
    this.cleanup()
  }

  private cleanup() {
    this.stopPing()
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout)
      this.reconnectTimeout = null
    }
    if (this.ws) {
      try {
        this.ws.close()
      } catch {}
      this.ws = null
    }
  }
}

function min(a: number, b: number) {
  return a < b ? a : b
}
