export interface SingleSessionConfig {
  id: string
  name: string
  label: string
  enabled: boolean
  startHourUtc: number // 0 - 23
  endHourUtc: number   // 0 - 23
  color: string        // Hex color for dashed vertical line and badge
}

export interface MarketSessionSettings {
  enabled: boolean
  sessions: SingleSessionConfig[]
  showVerticalLines: boolean   // Garis vertikal putus-putus tipis
  showSessionBadges: boolean   // Badge / teks nama sesi di bagian atas garis
  showUpcomingMarker: boolean  // Proyeksi garis vertikal sesi berikutnya
  showHudBar: boolean          // Widget floating status sesi di sudut chart
  lineStyle: 'dashed' | 'dotted' | 'solid'
  lineWidth: number            // Default: 1
  opacity: number              // 0.2 - 1.0, Default: 0.75
}

export const DEFAULT_MARKET_SESSION_SETTINGS: MarketSessionSettings = {
  enabled: true,
  showVerticalLines: true,
  showSessionBadges: true,
  showUpcomingMarker: true,
  showHudBar: true,
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
      color: '#f59e0b' // Amber / Golden Orange
    },
    {
      id: 'london',
      name: 'London / Eropa',
      label: 'LONDON',
      enabled: true,
      startHourUtc: 7,
      endHourUtc: 16,
      color: '#38bdf8' // Sky Blue
    },
    {
      id: 'newyork',
      name: 'New York / US',
      label: 'NEW YORK',
      enabled: true,
      startHourUtc: 13,
      endHourUtc: 21,
      color: '#10b981' // Emerald Green
    },
    {
      id: 'sydney',
      name: 'Sydney / Pasifik',
      label: 'SYDNEY',
      enabled: false,
      startHourUtc: 21,
      endHourUtc: 5,
      color: '#a855f7' // Purple
    }
  ]
}

export interface SessionLinePoint {
  session: SingleSessionConfig
  startTime: number
  candleTime: number
  label: string
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
  utcTimeString: string
  nextSession: NextSessionInfo | null
}
