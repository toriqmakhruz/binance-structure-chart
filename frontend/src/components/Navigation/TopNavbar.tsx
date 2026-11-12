import React from 'react'
import { 
  TrendingUp, 
  Settings as SettingsIcon, 
  RefreshCw, 
  LayoutGrid, 
  Columns, 
  Rows, 
  Square,
  Search,
  Wifi,
  WifiOff
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
  onSymbolClick: () => void
  onTimeframeChange: (tf: string) => void
  onMarketChange: (m: 'spot' | 'futures') => void
  onLayoutChange: (l: 'single' | 'split-vertical' | 'split-horizontal' | 'grid-4') => void
  onRefresh: () => void
  onOpenSettings: () => void
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
  onSymbolClick,
  onTimeframeChange,
  onMarketChange,
  onLayoutChange,
  onRefresh,
  onOpenSettings
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
    <header className="h-14 bg-[#111620] border-b border-[#21262d] flex items-center justify-between px-3 z-30 select-none">
      {/* Left: Branding & Symbol Search */}
      <div className="flex items-center space-x-3">
        <div className="flex items-center space-x-2 mr-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-[#f0b90b] to-[#fcd535] flex items-center justify-center shadow-lg shadow-yellow-500/10">
            <TrendingUp className="w-5 h-5 text-black stroke-[2.5]" />
          </div>
          <div className="hidden md:block">
            <span className="font-bold text-sm tracking-wide text-white">STRUKTUR</span>
            <span className="font-bold text-sm text-[#f0b90b] ml-1">AI</span>
          </div>
        </div>

        {/* Market Toggle (Spot vs Futures) */}
        <div className="flex bg-[#0b0e14] rounded-lg p-0.5 border border-[#21262d] text-xs">
          <button
            onClick={() => onMarketChange('futures')}
            className={`px-2.5 py-1 rounded-md font-medium transition-all ${
              market === 'futures'
                ? 'bg-[#f0b90b] text-black shadow font-bold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            FUTURES
          </button>
          <button
            onClick={() => onMarketChange('spot')}
            className={`px-2.5 py-1 rounded-md font-medium transition-all ${
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
          className="flex items-center space-x-2 bg-[#1a202c] hover:bg-[#222a3a] px-3 py-1.5 rounded-lg border border-[#2d3748] transition-all group"
        >
          <Search className="w-3.5 h-3.5 text-slate-400 group-hover:text-[#f0b90b]" />
          <span className="font-bold text-sm text-white tracking-wider">{symbol}</span>
          {lastPrice && (
            <span className="text-xs font-mono font-medium text-[#00c087] ml-1">
              ${formatPrice(lastPrice)}
            </span>
          )}
        </button>
      </div>

      {/* Middle: Timeframe Selector */}
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
      <div className="flex items-center space-x-2">
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
          className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md text-xs font-mono font-medium ${badge.className}`}
        >
          <span className={`w-2 h-2 rounded-full ${badge.dot}`}></span>
          <span className="hidden xl:inline">{badge.label}</span>
        </div>

        {/* Refresh / Re-analyze Button */}
        <button
          onClick={onRefresh}
          disabled={isLoading}
          title="Analisa Ulang Struktur & Forecast"
          className="p-2 rounded-lg bg-[#1a202c] hover:bg-[#252d3d] text-slate-300 hover:text-[#f0b90b] transition-all border border-[#2d3748] disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-[#f0b90b]' : ''}`} />
        </button>

        {/* Settings Drawer Button */}
        <button
          onClick={onOpenSettings}
          title="Pengaturan Sensitivitas Analisa & Parameter"
          className="p-2 rounded-lg bg-[#1a202c] hover:bg-[#252d3d] text-slate-300 hover:text-[#f0b90b] transition-all border border-[#2d3748]"
        >
          <SettingsIcon className="w-4 h-4" />
        </button>
      </div>
    </header>
  )
}
