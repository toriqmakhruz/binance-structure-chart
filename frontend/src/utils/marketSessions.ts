import { Candle } from '../types/analysis'
import {
  SingleSessionConfig,
  MarketSessionSettings,
  DEFAULT_MARKET_SESSION_SETTINGS,
  SessionLinePoint,
  NextSessionInfo,
  ActiveSessionResult
} from '../types/marketSessions'

export * from '../types/marketSessions'

// Backward compatibility interface
export interface MarketSessionDef extends SingleSessionConfig {
  hoursUtc: string
  fillColor: string
  borderStroke: string
  badgeBg: string
}

export interface SessionBlock {
  session: SingleSessionConfig
  dayKey: string
  startTime: number
  endTime: number
  high: number
  low: number
  open: number
  close: number
}

/**
 * Check if a given UTC decimal hour falls inside the session's active window.
 * Handles both regular sessions (e.g. 07:00 to 16:00) and midnight-crossing sessions (e.g. 21:00 to 05:00).
 */
export function isSessionActiveAt(decHour: number, startHour: number, endHour: number): boolean {
  if (startHour < endHour) {
    return decHour >= startHour && decHour < endHour
  } else if (startHour > endHour) {
    // Crosses midnight (e.g. 21:00 to 05:00)
    return decHour >= startHour || decHour < endHour
  } else {
    // 24 hours if start == end
    return true
  }
}

/**
 * Extract vertical transition line markers for session starts from candlestick data.
 * Produces crisp timestamps for thin vertical dashed line rendering.
 */
export function extractSessionLines(
  candles: Candle[],
  settings: MarketSessionSettings = DEFAULT_MARKET_SESSION_SETTINGS
): SessionLinePoint[] {
  if (!candles || candles.length === 0 || !settings.enabled || !settings.showVerticalLines) {
    return []
  }

  const enabledSessions = settings.sessions.filter((s) => s.enabled)
  if (enabledSessions.length === 0) return []

  const lines: SessionLinePoint[] = []
  const timeStep = candles.length > 1 ? (candles[1].time - candles[0].time) : 900
  const halfStep = timeStep / 2

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

  dayBuckets.forEach((dayCandles, dayKey) => {
    const [y, m, d] = dayKey.split('-').map(Number)

    for (const sess of enabledSessions) {
      const sessStartSec = Date.UTC(y, m - 1, d, sess.startHourUtc, 0, 0) / 1000

      // Find the closest candle to the session start
      let closestCandle: Candle | null = null
      let minDiff = Infinity

      for (const c of dayCandles) {
        const diff = Math.abs(c.time - sessStartSec)
        if (diff < minDiff && diff <= Math.max(timeStep * 1.5, 3600)) {
          minDiff = diff
          closestCandle = c
        }
      }

      if (closestCandle) {
        const pad = (n: number) => String(n).padStart(2, '0')
        lines.push({
          session: sess,
          startTime: sessStartSec,
          candleTime: closestCandle.time,
          label: `${sess.label} ${pad(sess.startHourUtc)}:00`
        })
      }
    }
  })

  // Deduplicate and sort by time
  lines.sort((a, b) => a.candleTime - b.candleTime)
  return lines
}

/**
 * Backward compatible extractSessionBlocks function.
 */
export function extractSessionBlocks(
  candles: Candle[],
  settings: MarketSessionSettings = DEFAULT_MARKET_SESSION_SETTINGS
): SessionBlock[] {
  if (!candles || candles.length === 0) return []

  const enabledSessions = settings.sessions.filter((s) => s.enabled)
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

    for (const sess of enabledSessions) {
      const sessStartSec = Date.UTC(y, m - 1, d, sess.startHourUtc, 0, 0) / 1000
      let sessEndSec: number

      if (sess.startHourUtc < sess.endHourUtc) {
        sessEndSec = Date.UTC(y, m - 1, d, sess.endHourUtc, 0, 0) / 1000
      } else {
        // Crosses midnight
        sessEndSec = Date.UTC(y, m - 1, d + 1, sess.endHourUtc, 0, 0) / 1000
      }

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
 * Determine which market session(s) are active right now, and calculate countdown to next session.
 */
export function getCurrentActiveSessions(
  settings: MarketSessionSettings = DEFAULT_MARKET_SESSION_SETTINGS
): ActiveSessionResult {
  const now = new Date()
  const utcHours = now.getUTCHours()
  const utcMinutes = now.getUTCMinutes()
  const decTime = utcHours + utcMinutes / 60
  const nowSec = Math.floor(now.getTime() / 1000)

  const enabledSessions = settings.sessions.filter((s) => s.enabled)
  const active: SingleSessionConfig[] = []

  for (const sess of enabledSessions) {
    if (isSessionActiveAt(decTime, sess.startHourUtc, sess.endHourUtc)) {
      active.push(sess)
    }
  }

  const isOverlap = active.length > 1
  let label = 'Inter-Session (Off-Hours)'
  if (active.length === 1) {
    label = `${active[0].label} Aktif`
  } else if (active.length > 1) {
    label = `${active.map((s) => s.label).join(' + ')} Overlap`
  }

  // Calculate Next Upcoming Session
  let nextSession: NextSessionInfo | null = null
  let minDiffSec = Infinity

  for (const sess of enabledSessions) {
    // Compute next start timestamp today or tomorrow
    let nextStart = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      sess.startHourUtc,
      0,
      0
    ))

    let nextStartSec = Math.floor(nextStart.getTime() / 1000)
    if (nextStartSec <= nowSec) {
      // It has already started today, so next occurrence is tomorrow
      nextStartSec += 86400
    }

    const diffSec = nextStartSec - nowSec
    if (diffSec > 0 && diffSec < minDiffSec) {
      minDiffSec = diffSec
      const hoursUntil = Math.floor(diffSec / 3600)
      const minutesUntil = Math.floor((diffSec % 3600) / 60)

      let countdownStr = ''
      if (hoursUntil > 0) {
        countdownStr = `${hoursUntil}j ${minutesUntil}m`
      } else {
        countdownStr = `${minutesUntil}m`
      }

      const pad = (n: number) => String(n).padStart(2, '0')
      nextSession = {
        session: sess,
        startTimeSec: nextStartSec,
        hoursUntil,
        minutesUntil,
        countdownStr,
        formattedTime: `${pad(sess.startHourUtc)}:00 UTC`
      }
    }
  }

  const pad = (n: number) => String(n).padStart(2, '0')
  const utcTimeString = `${pad(utcHours)}:${pad(utcMinutes)} UTC`

  return {
    activeSessions: active,
    isOverlap,
    label,
    utcTimeString,
    nextSession
  }
}
