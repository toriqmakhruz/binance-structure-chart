import { Candle } from '../types/analysis'
import {
  SingleSessionConfig,
  MarketSessionSettings,
  DEFAULT_MARKET_SESSION_SETTINGS,
  SessionLinePoint,
  SessionZoneBlock,
  NextSessionInfo,
  ActiveSessionResult,
  MarketTimezone,
  TIMEZONE_OFFSETS
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
 * Convert hex color to rgba string
 */
export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '')
  const r = parseInt(clean.substring(0, 2), 16) || 0
  const g = parseInt(clean.substring(2, 4), 16) || 0
  const b = parseInt(clean.substring(4, 6), 16) || 0
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

/**
 * Convert UTC hour to selected timezone hour
 */
export function utcHourToLocalHour(utcHour: number, tz: MarketTimezone = 'WIB'): number {
  const offset = TIMEZONE_OFFSETS[tz] || 0
  return (utcHour + offset + 24) % 24
}

/**
 * Convert selected timezone hour to UTC hour
 */
export function localHourToUtcHour(localHour: number, tz: MarketTimezone = 'WIB'): number {
  const offset = TIMEZONE_OFFSETS[tz] || 0
  return (localHour - offset + 24) % 24
}

/**
 * Format a Date object to HH:MM in chosen timezone (WIB, WIT, WITA, UTC)
 */
export function formatTimezoneClock(date: Date, tz: MarketTimezone = 'WIB'): string {
  const offset = TIMEZONE_OFFSETS[tz] || 0
  const utcMs = date.getTime() + date.getTimezoneOffset() * 60000
  const targetDate = new Date(utcMs + offset * 3600000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(targetDate.getHours())}:${pad(targetDate.getMinutes())} ${tz}`
}

/**
 * Check if a given UTC decimal hour falls inside the session's active window.
 */
export function isSessionActiveAt(decHour: number, startHour: number, endHour: number): boolean {
  if (startHour < endHour) {
    return decHour >= startHour && decHour < endHour
  } else if (startHour > endHour) {
    // Crosses midnight (e.g. 21:00 to 05:00 UTC)
    return decHour >= startHour || decHour < endHour
  } else {
    return true
  }
}

/**
 * Extract vertical transition line markers for session starts from candlestick data.
 * Produces crisp timestamps and timezone-aware labels for thin vertical dashed line rendering.
 */
export function extractSessionLines(
  candles: Candle[],
  settings: MarketSessionSettings = DEFAULT_MARKET_SESSION_SETTINGS,
  timeframe?: string
): SessionLinePoint[] {
  if (!candles || candles.length === 0 || !settings || !settings.enabled || !settings.showVerticalLines) {
    return []
  }

  const sessionsList = Array.isArray(settings?.sessions) && settings.sessions.length > 0
    ? settings.sessions
    : DEFAULT_MARKET_SESSION_SETTINGS.sessions

  const enabledSessions = sessionsList.filter((s) => s && s.enabled)
  if (enabledSessions.length === 0) return []

  const tf = (timeframe || '').toLowerCase()
  const timeStep = candles.length > 1 ? (candles[1].time - candles[0].time) : 900

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

  const allDayKeys = Array.from(dayBuckets.keys())
  if (allDayKeys.length === 0) return []

  // Lookback filter: prevent cluttering higher timeframes with dozens of historical lines
  // 4h: only last 2 days (today + yesterday, max 6 lines total)
  // 1h: last 4 days
  // lower timeframes: last 7 days
  const maxDays = tf === '4h' ? 2 : tf === '1h' ? 4 : 7
  const targetDayKeys = allDayKeys.slice(-maxDays)
  const latestDayKey = allDayKeys[allDayKeys.length - 1]

  const tz = settings.timezone || 'WIB'
  const lines: SessionLinePoint[] = []

  targetDayKeys.forEach((dayKey) => {
    const dayCandles = dayBuckets.get(dayKey) || []
    const [y, m, d] = dayKey.split('-').map(Number)
    const isLatestDay = dayKey === latestDayKey

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
        const localHour = utcHourToLocalHour(sess.startHourUtc, tz)
        const pad = (n: number) => String(n).padStart(2, '0')
        // On 4h, snap line timestamp to the candle boundary so lines never slice through candle bodies
        const effectiveLineTime = tf === '4h' ? closestCandle.time : sessStartSec

        lines.push({
          session: sess,
          startTime: effectiveLineTime,
          candleTime: closestCandle.time,
          label: `${sess.label} ${pad(localHour)}:00 ${tz}`,
          dayKey,
          isLatestDay
        })
      }
    }
  })

  lines.sort((a, b) => a.startTime - b.startTime)
  return lines
}

/**
 * Extract session span zones (start to end time) for subtle box/gradient rendering.
 */
export function extractSessionZones(
  candles: Candle[],
  settings: MarketSessionSettings = DEFAULT_MARKET_SESSION_SETTINGS,
  timeframe?: string
): SessionZoneBlock[] {
  if (!candles || candles.length === 0 || !settings || !settings.enabled || !settings.showZoneBackground) {
    return []
  }

  const sessionsList = Array.isArray(settings?.sessions) && settings.sessions.length > 0
    ? settings.sessions
    : DEFAULT_MARKET_SESSION_SETTINGS.sessions

  const enabledSessions = sessionsList.filter((s) => s && s.enabled)
  if (enabledSessions.length === 0) return []

  const tf = (timeframe || '').toLowerCase()
  const timeStep = candles.length > 1 ? (candles[1].time - candles[0].time) : 900
  const dayBuckets: Map<string, Candle[]> = new Map()

  for (const c of candles) {
    const d = new Date(c.time * 1000)
    const dayKey = `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}`
    if (!dayBuckets.has(dayKey)) {
      dayBuckets.set(dayKey, [])
    }
    dayBuckets.get(dayKey)!.push(c)
  }

  const allDayKeys = Array.from(dayBuckets.keys())
  if (allDayKeys.length === 0) return []

  // Lookback filter: prevent drawing dozens of overlapping gradient slabs across the whole chart
  const maxDays = tf === '4h' ? 2 : tf === '1h' ? 4 : 7
  const targetDayKeys = allDayKeys.slice(-maxDays)
  const latestDayKey = allDayKeys[allDayKeys.length - 1]

  const zones: SessionZoneBlock[] = []

  targetDayKeys.forEach((dayKey) => {
    const dayCandles = dayBuckets.get(dayKey) || []
    const [y, m, d] = dayKey.split('-').map(Number)
    const isLatestDay = dayKey === latestDayKey

    for (const sess of enabledSessions) {
      const sessStartSec = Date.UTC(y, m - 1, d, sess.startHourUtc, 0, 0) / 1000
      let sessEndSec: number

      if (sess.startHourUtc < sess.endHourUtc) {
        sessEndSec = Date.UTC(y, m - 1, d, sess.endHourUtc, 0, 0) / 1000
      } else {
        // Crosses midnight
        sessEndSec = Date.UTC(y, m - 1, d + 1, sess.endHourUtc, 0, 0) / 1000
      }

      // Check candles that fall within or intersect this session
      const inSessCandles = dayCandles.filter(
        (c) => c.time < sessEndSec && (c.time + timeStep) > sessStartSec
      )

      if (inSessCandles.length > 0) {
        // On 4h, snap the zone start and end to candle boundaries so no candle is sliced in half
        const zoneStart = tf === '4h' ? inSessCandles[0].time : sessStartSec
        const zoneEnd = tf === '4h'
          ? (inSessCandles[inSessCandles.length - 1].time + timeStep)
          : sessEndSec

        zones.push({
          session: sess,
          dayKey,
          startTime: zoneStart,
          endTime: zoneEnd,
          isLatestDay
        })
      }
    }
  })

  return zones
}

/**
 * Backward compatible extractSessionBlocks function.
 */
export function extractSessionBlocks(
  candles: Candle[],
  settings: MarketSessionSettings = DEFAULT_MARKET_SESSION_SETTINGS
): SessionBlock[] {
  if (!candles || candles.length === 0) return []

  const sessionsList = Array.isArray(settings?.sessions) && settings.sessions.length > 0
    ? settings.sessions
    : DEFAULT_MARKET_SESSION_SETTINGS.sessions

  const enabledSessions = sessionsList.filter((s) => s && s.enabled)
  const timeStep = candles.length > 1 ? (candles[1].time - candles[0].time) : 900
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
        sessEndSec = Date.UTC(y, m - 1, d + 1, sess.endHourUtc, 0, 0) / 1000
      }

      const inSess = dayCandles.filter(
        (c) => c.time < sessEndSec && (c.time + timeStep) > sessStartSec
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
 * Supports selected timezone (WIB, WIT, WITA, UTC).
 */
export function getCurrentActiveSessions(
  settings: MarketSessionSettings = DEFAULT_MARKET_SESSION_SETTINGS
): ActiveSessionResult {
  const now = new Date()
  const utcHours = now.getUTCHours()
  const utcMinutes = now.getUTCMinutes()
  const decTime = utcHours + utcMinutes / 60
  const nowSec = Math.floor(now.getTime() / 1000)
  const tz = settings?.timezone || 'WIB'

  const sessionsList = Array.isArray(settings?.sessions) && settings.sessions.length > 0
    ? settings.sessions
    : DEFAULT_MARKET_SESSION_SETTINGS.sessions

  const enabledSessions = sessionsList.filter((s) => s && s.enabled)
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

      const localHour = utcHourToLocalHour(sess.startHourUtc, tz)
      const pad = (n: number) => String(n).padStart(2, '0')
      nextSession = {
        session: sess,
        startTimeSec: nextStartSec,
        hoursUntil,
        minutesUntil,
        countdownStr,
        formattedTime: `${pad(localHour)}:00 ${tz}`
      }
    }
  }

  const pad = (n: number) => String(n).padStart(2, '0')
  const utcTimeString = `${pad(utcHours)}:${pad(utcMinutes)} UTC`
  const clockTimeString = formatTimezoneClock(now, tz)

  return {
    activeSessions: active,
    isOverlap,
    label,
    clockTimeString,
    utcTimeString,
    timezone: tz,
    nextSession
  }
}
