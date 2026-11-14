import React from 'react'
import { 
  TrendingUp,
  Send, 
  Settings as SettingsIcon, 
  RefreshCw, 
  LayoutGrid, 
  Columns, 
  Rows, 
  Square,
  Search,
  Wifi,
  WifiOff,
  Zap,
  Activity
} from 'lucide-react'
import { formatPrice } from '../../utils/formatters'

export type StreamStatusType = 'LIVE' | 'CONNECTING' | 'RECONNECTING' | 'STALE' | 'OFFLINE'

interface TopNavbarProps {
  symbol: string
  timeframe: string
  market: 'spot' | 'futures'
  layout: 'single' | 'split-vertical' | 'split-horizontal' | 'grid-4'
  isConnected: boolean
  streamStatus?: StreamStatusType
  isLoading: boolean
  lastPrice?: number
  activeSetup?: any
  isDashboardOpen?: boolean
  onToggleDashboard?: () => void
  onSymbolClick: () => void
  onTimeframeChange: (tf: string) => void
  onMarketChange: (m: 'spot' | 'futures') => void
  onLayoutChange: (l: 'single' | 'split-vertical' | 'split-horizontal' | 'grid-4') => void
  onRefresh: () => void
  onOpenSettings: () => void
  onOpenTelegram?: () => void
  isTelegramActive?: boolean
  onOpenTrade?: (setup: any) => void
  isSetupLocked?: boolean
  onUnlockSetup?: () => void
}

const TIMEFRAMES = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d']

export const TopNavbar: React.FC<TopNavbarProps> = ({
  symbol,
  timeframe,
  market,
  layout,
  isConnected,
  streamStatus = 'OFFLINE',
  isLoading,
  lastPrice,
  activeSetup,
  isDashboardOpen,
  onToggleDashboard,
  onSymbolClick,
  onTimeframeChange,
  onMarketChange,
  onLayoutChange,
  onRefresh,
  onOpenSettings,
  onOpenTelegram,
  isTelegramActive = false,
  onOpenTrade,
  isSetupLocked = false,
  onUnlockSetup
}) => {
  const getBadgeConfig = () => {
    switch (streamStatus) {
      case 'LIVE':
        return {
          title: 'Binance WebSocket Terhubung & Real-time Live',
          className: 'bg-emerald-950/60 text-emerald-400 border border-emerald-800/50',
          dot: 'bg-emerald-400 animate-pulse',
          label: 'LIVE'
        }
      case 'STALE':
        return {
          title: 'DATA STALE: Tidak ada tick baru dari Binance dalam 45 detik',
          className: 'bg-amber-950/60 text-amber-400 border border-amber-800/50',
          dot: 'bg-amber-400',
          label: 'STALE'
        }
      case 'RECONNECTING':
        return {
          title: 'Upstream terputus, mencoba menghubungkan ulang...',
          className: 'bg-yellow-950/60 text-yellow-300 border border-yellow-800/50',
          dot: 'bg-yellow-400 animate-ping',
          label: 'RECONNECTING'
        }
      case 'CONNECTING':
        return {
          title: 'Menghubungkan ke upstream Binance...',
          className: 'bg-blue-950/60 text-blue-300 border border-blue-800/50',
          dot: 'bg-blue-400 animate-pulse',
          label: 'CONNECTING'
        }
      default:
        return {
          title: 'WebSocket Terputus',
          className: 'bg-rose-950/60 text-rose-400 border border-rose-800/50',
          dot: 'bg-rose-400',
          label: 'OFFLINE'
        }
    }
  }

  const badge = getBadgeConfig()

    return (
    <header className="h-12 md:h-14 shrink-0 bg-[#111620] border-b border-[#21262d] flex items-center justify-between px-2 md:px-3 z-30 select-none overflow-x-hidden">
      {/* Left: Branding & Symbol Search */}
      <div className="flex items-center space-x-1.5 md:space-x-3 shrink-0">
        <div className="flex items-center space-x-1.5 md:space-x-2 mr-0.5 md:mr-2">
          <div className="w-7 h-7 md:w-8 md:h-8 rounded-lg bg-gradient-to-tr from-[#f0b90b] to-[#fcd535] flex items-center justify-center shadow-lg shadow-yellow-500/10 shrink-0">
            <TrendingUp className="w-4 h-4 md:w-5 md:h-5 text-black stroke-[2.5]" />
          </div>
          <div className="hidden md:block">
            <span className="font-bold text-sm tracking-wide text-white">STRUKTUR</span>
            <span className="font-bold text-sm text-[#f0b90b] ml-1">AI</span>
          </div>
        </div>

        {/* Market Toggle (Spot vs Futures) */}
        <div className="flex bg-[#0b0e14] rounded-md p-0.5 border border-[#21262d] text-[10px] md:text-xs shrink-0">
          <button
            onClick={() => onMarketChange('futures')}
            className={`px-1.5 md:px-2.5 py-0.5 md:py-1 rounded font-medium transition-all ${
              market === 'futures'
                ? 'bg-[#f0b90b] text-black shadow font-bold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            FUT
          </button>
          <button
            onClick={() => onMarketChange('spot')}
            className={`px-1.5 md:px-2.5 py-0.5 md:py-1 rounded font-medium transition-all ${
              market === 'spot'
                ? 'bg-[#f0b90b] text-black shadow font-bold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            SPOT
          </button>
        </div>

        {/* Symbol Button */}
        <button
          onClick={onSymbolClick}
          className="flex items-center space-x-1 md:space-x-2 bg-[#1a202c] hover:bg-[#222a3a] px-2 md:px-3 py-1 md:py-1.5 rounded-lg border border-[#2d3748] transition-all group shrink-0"
        >
          <Search className="w-3 h-3 md:w-3.5 md:h-3.5 text-slate-400 group-hover:text-[#f0b90b]" />
          <span className="font-bold text-xs md:text-sm text-white tracking-wider">{symbol}</span>
          {lastPrice && (
            <span className="hidden sm:inline text-xs font-mono font-medium text-[#00c087] ml-1">
              ${formatPrice(lastPrice)}
            </span>
          )}
        </button>

        {/* Mobile Timeframe Dropdown (Only visible on screens < lg) */}
        <div className="flex lg:hidden items-center shrink-0">
          <select
            value={timeframe}
            onChange={(e) => onTimeframeChange(e.target.value)}
            className="bg-[#0b0e14] border border-[#263040] text-[#f0b90b] text-[11px] font-bold rounded-lg px-2 py-1 outline-none cursor-pointer"
            title="Pilih Timeframe"
          >
            {TIMEFRAMES.map((tf) => (
              <option key={tf} value={tf} className="bg-[#121824] text-white">
                {tf.toUpperCase()}
              </option>
            ))}
          </select>
        </div>

        {/* Quick Open Position Button or Locked Active Setup Indicator */}
        {isSetupLocked ? (
          <div className="flex items-center space-x-1 px-1.5 md:px-2.5 py-1 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-[10px] md:text-xs font-semibold shrink-0">
            <span className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-amber-400 animate-ping shrink-0" />
            <span className="hidden sm:inline">Box Terkunci</span>
            <span className="sm:hidden font-mono text-[9px]">LOCKED</span>
            {onUnlockSetup && (
              <button
                type="button"
                onClick={onUnlockSetup}
                title="Lepas Kunci Setup (Kembali ke Analisa Dinamis)"
                className="ml-0.5 px-1 py-0.5 hover:bg-amber-400/20 rounded text-amber-400 text-[9px] font-bold transition-colors"
              >
                ✕
              </button>
            )}
          </div>
        ) : (
          activeSetup && onOpenTrade && (
            <button
              type="button"
              onClick={() => onOpenTrade(activeSetup)}
              className={`flex items-center space-x-1 px-2 md:px-3 py-1 md:py-1.5 rounded-lg font-bold text-[10px] md:text-xs shadow-md transition-all shrink-0 ${
                activeSetup.direction === 'LONG'
                  ? 'bg-emerald-500 hover:bg-emerald-400 text-black shadow-emerald-950/40'
                  : 'bg-rose-500 hover:bg-rose-400 text-white shadow-rose-950/40'
              }`}
              title={`Buka Posisi ${activeSetup.direction} untuk setup aktif ini`}
            >
              <Zap className="w-3 h-3 md:w-3.5 md:h-3.5" />
              <span className="hidden md:inline">Open Posisi</span>
            </button>
          )
        )}
      </div>

      {/* Middle: Timeframe Selector (Desktop) */}
      <div className="hidden lg:flex items-center space-x-1 bg-[#0b0e14] p-1 rounded-lg border border-[#21262d]">
        {TIMEFRAMES.map((tf) => (
          <button
            key={tf}
            onClick={() => onTimeframeChange(tf)}
            className={`px-2.5 py-1 text-xs rounded-md font-semibold transition-all ${
              timeframe === tf
                ? 'bg-[#252d3d] text-[#f0b90b] shadow-sm'
                : 'text-slate-400 hover:text-white hover:bg-[#161b22]'
            }`}
          >
            {tf.toUpperCase()}
          </button>
        ))}
      </div>

      {/* Right: Layout Switcher, Refresh, WS Status, Settings */}
      <div className="flex items-center space-x-1 md:space-x-2 shrink-0">
        {/* Multi-Chart Layouts */}
        <div className="hidden sm:flex items-center bg-[#0b0e14] p-0.5 rounded-lg border border-[#21262d]">
          <button
            title="Single Chart"
            onClick={() => onLayoutChange('single')}
            className={`p-1.5 rounded ${layout === 'single' ? 'bg-[#252d3d] text-[#f0b90b]' : 'text-slate-400 hover:text-white'}`}
          >
            <Square className="w-3.5 h-3.5" />
          </button>
          <button
            title="Split Vertical (Side-by-side)"
            onClick={() => onLayoutChange('split-vertical')}
            className={`p-1.5 rounded ${layout === 'split-vertical' ? 'bg-[#252d3d] text-[#f0b90b]' : 'text-slate-400 hover:text-white'}`}
          >
            <Columns className="w-3.5 h-3.5" />
          </button>
          <button
            title="Split Horizontal (Stacked)"
            onClick={() => onLayoutChange('split-horizontal')}
            className={`p-1.5 rounded ${layout === 'split-horizontal' ? 'bg-[#252d3d] text-[#f0b90b]' : 'text-slate-400 hover:text-white'}`}
          >
            <Rows className="w-3.5 h-3.5" />
          </button>
          <button
            title="Grid 4 Charts"
            onClick={() => onLayoutChange('grid-4')}
            className={`p-1.5 rounded ${layout === 'grid-4' ? 'bg-[#252d3d] text-[#f0b90b]' : 'text-slate-400 hover:text-white'}`}
          >
            <LayoutGrid className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Live WS Status Badge */}
        <div 
          title={badge.title}
          className={`flex items-center space-x-1 px-1.5 md:px-2.5 py-1 rounded-md text-xs font-mono font-medium ${badge.className}`}
        >
          <span className={`w-2 h-2 rounded-full ${badge.dot}`}></span>
          <span className="hidden xl:inline">{badge.label}</span>
        </div>

        {/* Toggle Dashboard Monitor */}
        {onToggleDashboard && (
          <button
            type="button"
            onClick={onToggleDashboard}
            title="Buka / Tutup Dashboard Monitor Posisi & Order"
            className={`p-1.5 md:p-2 rounded-lg transition-all border ${
              isDashboardOpen
                ? 'bg-[#1b2230] text-[#f0b90b] border-[#f0b90b]/50 shadow-sm'
                : 'bg-[#1a202c] hover:bg-[#252d3d] text-slate-300 hover:text-white border-[#2d3748]'
            }`}
          >
            <Activity className="w-3.5 h-3.5 md:w-4 md:h-4" />
          </button>
        )}

        {/* Refresh / Re-analyze Button */}
        <button
          onClick={onRefresh}
          disabled={isLoading}
          title="Analisa Ulang Struktur & Forecast"
          className="p-1.5 md:p-2 rounded-lg bg-[#1a202c] hover:bg-[#252d3d] text-slate-300 hover:text-[#f0b90b] transition-all border border-[#2d3748] disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 md:w-4 md:h-4 ${isLoading ? 'animate-spin text-[#f0b90b]' : ''}`} />
        </button>

        {/* Telegram Alert Settings Button */}
        {onOpenTelegram && (
          <button
            type="button"
            onClick={onOpenTelegram}
            title={isTelegramActive ? "Notifikasi Telegram Aktif (Klik untuk ubah)" : "Atur Notifikasi Telegram"}
            className={`p-1.5 md:p-2 rounded-lg transition-all border flex items-center gap-1.5 ${
              isTelegramActive
                ? 'bg-[#0088cc]/15 text-[#0088cc] border-[#0088cc]/50 shadow-sm'
                : 'bg-[#1a202c] hover:bg-[#252d3d] text-slate-300 hover:text-[#0088cc] border-[#2d3748]'
            }`}
          >
            <Send className="w-3.5 h-3.5 md:w-4 md:h-4" />
            {isTelegramActive && (
              <span className="w-1.5 h-1.5 rounded-full bg-[#0088cc] animate-pulse" />
            )}
          </button>
        )}

        {/* Settings Drawer Button */}
        <button
          onClick={onOpenSettings}
          title="Pengaturan Sensitivitas Analisa & Parameter"
          className="p-1.5 md:p-2 rounded-lg bg-[#1a202c] hover:bg-[#252d3d] text-slate-300 hover:text-[#f0b90b] transition-all border border-[#2d3748]"
        >
          <SettingsIcon className="w-3.5 h-3.5 md:w-4 md:h-4" />
        </button>
      </div>
    </header>
  )
}
