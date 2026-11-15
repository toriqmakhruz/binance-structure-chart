import { Candle } from '../types/analysis'

export interface MarketSessionDef {
  id: 'asia' | 'london' | 'newyork'
  name: string
  label: string
  hoursUtc: string
  startHourUtc: number
  endHourUtc: number
  color: string
  fillColor: string
  borderStroke: string
  badgeBg: string
}

export const MARKET_SESSIONS: MarketSessionDef[] = [
  {
    id: 'asia',
    name: 'Asia / Tokyo',
    label: 'ASIA',
    hoursUtc: '00:00 - 08:00 UTC',
    startHourUtc: 0,
    endHourUtc: 8,
    color: '#f59e0b', // Amber-500
    fillColor: 'rgba(245, 158, 11, 0.06)',
    borderStroke: 'rgba(245, 158, 11, 0.35)',
    badgeBg: 'rgba(245, 158, 11, 0.85)'
  },
  {
    id: 'london',
    name: 'London / Eropa',
    label: 'LONDON',
    hoursUtc: '07:00 - 16:00 UTC',
    startHourUtc: 7,
    endHourUtc: 16,
    color: '#38bdf8', // Sky-400
    fillColor: 'rgba(56, 189, 248, 0.06)',
    borderStroke: 'rgba(56, 189, 248, 0.35)',
    badgeBg: 'rgba(56, 189, 248, 0.85)'
  },
  {
    id: 'newyork',
    name: 'New York / US',
    label: 'NEW YORK',
    hoursUtc: '13:00 - 21:00 UTC',
    startHourUtc: 13,
    endHourUtc: 21,
    color: '#10b981', // Emerald-500
    fillColor: 'rgba(16, 185, 129, 0.06)',
    borderStroke: 'rgba(16, 185, 129, 0.35)',
    badgeBg: 'rgba(16, 185, 129, 0.85)'
  }
]

export interface SessionBlock {
  session: MarketSessionDef
  dayKey: string
  startTime: number
  endTime: number
  high: number
  low: number
  open: number
  close: number
}

/**
 * Identify all market session periods and their High/Low price ranges from candles.
 */
export function extractSessionBlocks(candles: Candle[]): SessionBlock[] {
  if (!candles || candles.length === 0) return []

  // Group candles by calendar UTC date
  const dayBuckets: Map<string, Candle[]> = new Map()

  for (const c of candles) {
    const d = new Date(c.time * 1000)
    const dayKey = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`
    if (!dayBuckets.has(dayKey)) {
      dayBuckets.set(dayKey, [])
    }
    dayBuckets.get(dayKey)!.push(c)
  }

  const blocks: SessionBlock[] = []

  dayBuckets.forEach((dayCandles, dayKey) => {
    const [y, m, d] = dayKey.split('-').map(Number)

    for (const sess of MARKET_SESSIONS) {
      const sessStartSec = Date.UTC(y, m - 1, d, sess.startHourUtc, 0, 0) / 1000
      const sessEndSec = Date.UTC(y, m - 1, d, sess.endHourUtc, 0, 0) / 1000

      // Find candles within this session window
      const inSess = dayCandles.filter(
        (c) => c.time >= sessStartSec && c.time < sessEndSec
      )

      if (inSess.length > 0) {
        let high = -Infinity
        let low = Infinity
        for (const c of inSess) {
          if (c.high > high) high = c.high
          if (c.low < low) low = c.low
        }

        blocks.push({
          session: sess,
          dayKey,
          startTime: inSess[0].time,
          endTime: inSess[inSess.length - 1].time,
          high,
          low,
          open: inSess[0].open,
          close: inSess[inSess.length - 1].close
        })
      }
    }
  })

  return blocks
}

/**
 * Determine which market session(s) are active right now based on current UTC time.
 */
export function getCurrentActiveSessions(): {
  activeSessions: MarketSessionDef[]
  isOverlap: boolean
  label: string
  utcTimeString: string
} {
  const now = new Date()
  const utcHours = now.getUTCHours()
  const utcMinutes = now.getUTCMinutes()
  const decTime = utcHours + utcMinutes / 60

  const active: MarketSessionDef[] = []

  // Asia: 00:00 - 08:00 UTC
  if (decTime >= 0 && decTime < 8) {
    active.push(MARKET_SESSIONS[0])
  }
  // London: 07:00 - 16:00 UTC
  if (decTime >= 7 && decTime < 16) {
    active.push(MARKET_SESSIONS[1])
  }
  // New York: 13:00 - 21:00 UTC
  if (decTime >= 13 && decTime < 21) {
    active.push(MARKET_SESSIONS[2])
  }

  const isOverlap = active.length > 1
  let label = 'Off-Hours (Inter-Session)'
  if (active.length === 1) {
    label = `${active[0].label} Active`
  } else if (active.length > 1) {
    label = `${active.map((s) => s.label).join(' + ')} Overlap (Peak Vol)`
  }

  const pad = (n: number) => String(n).padStart(2, '0')
  const utcTimeString = `${pad(utcHours)}:${pad(utcMinutes)} UTC`

  return {
    activeSessions: active,
    isOverlap,
    label,
    utcTimeString
  }
}
