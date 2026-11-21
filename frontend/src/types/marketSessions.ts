export type MarketTimezone = 'UTC' | 'WIB' | 'WITA' | 'WIT'

export const TIMEZONE_OFFSETS: Record<MarketTimezone, number> = {
  UTC: 0,
  WIB: 7,
  WITA: 8,
  WIT: 9
}

export const TIMEZONE_LABELS: Record<MarketTimezone, string> = {
  WIB: 'WIB (Jakarta / UTC+7)',
  WIT: 'WIT (Jayapura / UTC+9)',
  WITA: 'WITA (Bali / UTC+8)',
  UTC: 'UTC (London / GMT+0)'
}

export interface SingleSessionConfig {
  id: string
  name: string
  label: string
  enabled: boolean
  startHourUtc: number // 0 - 23 (disimpan dalam basis standar UTC)
  endHourUtc: number   // 0 - 23
  color: string        // Hex color for dashed vertical line, badge, & zone
}

export interface MarketSessionSettings {
  enabled: boolean
  timezone: MarketTimezone     // 'WIB' | 'WIT' | 'WITA' | 'UTC'
  sessions: SingleSessionConfig[]
  showVerticalLines: boolean   // Garis vertikal putus-putus tipis
  showSessionBadges: boolean   // Badge / teks nama sesi di bagian atas garis
  showUpcomingMarker: boolean  // Proyeksi garis vertikal sesi berikutnya
  showHudBar: boolean          // Widget floating status sesi di sudut chart
  showZoneBackground: boolean  // Box atau gradien zona sesi aktif
  zoneStyle: 'gradient' | 'box' // Gaya zona: gradien halus atau kotak transparan
  zoneOpacity: number          // Opasitas box/gradien (0.02 - 0.20, default: 0.08)
  lineStyle: 'dashed' | 'dotted' | 'solid'
  lineWidth: number            // Default: 1
  opacity: number              // 0.2 - 1.0, Default: 0.75
}

export const DEFAULT_MARKET_SESSION_SETTINGS: MarketSessionSettings = {
  enabled: true,
  timezone: 'WIB',             // Default WIB sesuai permintaan pengguna
  showVerticalLines: true,
  showSessionBadges: true,
  showUpcomingMarker: true,
  showHudBar: true,
  showZoneBackground: true,    // Default aktif dengan gradien halus elegan
  zoneStyle: 'gradient',
  zoneOpacity: 0.08,
  lineStyle: 'dashed',
  lineWidth: 1,
  opacity: 0.75,
  sessions: [
    {
      id: 'asia',
      name: 'Asia / Tokyo',
      label: 'ASIA',
      enabled: true,
      startHourUtc: 0,
      endHourUtc: 8,
      color: '#f59e0b' // Amber / Golden Orange (07:00 - 15:00 WIB)
    },
    {
      id: 'london',
      name: 'London / Eropa',
      label: 'LONDON',
      enabled: true,
      startHourUtc: 7,
      endHourUtc: 16,
      color: '#38bdf8' // Sky Blue (14:00 - 23:00 WIB)
    },
    {
      id: 'newyork',
      name: 'New York / US',
      label: 'NEW YORK',
      enabled: true,
      startHourUtc: 13,
      endHourUtc: 21,
      color: '#10b981' // Emerald Green (20:00 - 04:00 WIB)
    },
    {
      id: 'sydney',
      name: 'Sydney / Pasifik',
      label: 'SYDNEY',
      enabled: false,
      startHourUtc: 21,
      endHourUtc: 5,
      color: '#a855f7' // Purple (04:00 - 12:00 WIB)
    }
  ]
}

export interface SessionLinePoint {
  session: SingleSessionConfig
  startTime: number
  candleTime: number
  label: string
}

export interface SessionZoneBlock {
  session: SingleSessionConfig
  dayKey: string
  startTime: number
  endTime: number
}

export interface NextSessionInfo {
  session: SingleSessionConfig
  startTimeSec: number
  hoursUntil: number
  minutesUntil: number
  countdownStr: string
  formattedTime: string
}

export interface ActiveSessionResult {
  activeSessions: SingleSessionConfig[]
  isOverlap: boolean
  label: string
  clockTimeString: string
  utcTimeString?: string
  timezone: MarketTimezone
  nextSession: NextSessionInfo | null
}
