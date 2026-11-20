import React, { useState } from 'react'
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
  Zap,
  Shield,
  Target,
  Activity,
  Lock,
  Unlock,
  Crosshair,
  Layers,
  Sparkles,
  Menu,
  X,
  Radio,
  Clock
} from 'lucide-react'
import { formatPrice } from '../../utils/formatters'
import { SetupMode } from '../../types/analysis'

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
  setupMode?: SetupMode
  onModeChange?: (mode: SetupMode) => void
  syncCrosshair?: boolean
  onToggleSyncCrosshair?: () => void
  syncSetup?: boolean
  onToggleSyncSetup?: () => void
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
  onUnlockSetup,
  setupMode = 'standard',
  onModeChange,
  syncCrosshair = true,
  onToggleSyncCrosshair,
  syncSetup = true,
  onToggleSyncSetup
}) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

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
    <>
      <header className="h-11 md:h-14 shrink-0 bg-[#111620] border-b border-[#21262d] z-30 select-none flex items-center justify-between px-2 md:px-3">
        {/* ========================================================================= */}
        {/* --- LEFT SECTION: Logo, Market, Trading Module, Symbol, Timeframe & Action --- */}
        {/* ========================================================================= */}
        <div className="flex items-center space-x-1.5 md:space-x-2.5 min-w-0 shrink-0">
          {/* Logo (Icon only, website name removed as requested) */}
          <div className="w-6 h-6 md:w-7 md:h-7 rounded-md bg-gradient-to-tr from-[#f0b90b] to-[#fcd535] flex items-center justify-center shadow-md shadow-yellow-500/10 shrink-0">
            <TrendingUp className="w-3.5 h-3.5 md:w-4 md:h-4 text-black stroke-[2.5]" />
          </div>

          {/* Market Toggle (Spot vs Futures) */}
          <div className="hidden sm:flex bg-[#0b0e14] rounded-md p-0.5 border border-[#21262d] text-xs shrink-0">
            <button
              onClick={() => onMarketChange('futures')}
              className={`px-2 py-0.5 md:px-2.5 md:py-1 rounded font-medium transition-all ${
                market === 'futures'
                  ? 'bg-[#f0b90b] text-black shadow font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              FUT
            </button>
            <button
              onClick={() => onMarketChange('spot')}
              className={`px-2 py-0.5 md:px-2.5 md:py-1 rounded font-medium transition-all ${
                market === 'spot'
                  ? 'bg-[#f0b90b] text-black shadow font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              SPOT
            </button>
          </div>

          {/* Trading Module Dropdown (Std, Apex, Pro Shield, Craig 10x) */}
          {onModeChange && (
            <div
              className="hidden sm:flex items-center space-x-1 bg-[#0b0e14] px-1.5 py-0.5 md:px-2 md:py-1 rounded-md border border-[#21262d] text-xs shrink-0"
              title="Pilih Engine Setup / Modul Trading"
            >
              <Zap className="w-3 h-3 md:w-3.5 md:h-3.5 text-[#f0b90b] shrink-0" />
              <select
                value={setupMode}
                onChange={(e) => onModeChange(e.target.value as SetupMode)}
                className="bg-transparent text-[#f0b90b] font-bold text-[11px] md:text-xs outline-none cursor-pointer pr-0.5"
              >
                <option value="standard" className="bg-[#121824] text-white">Standard</option>
                <option value="pro_shield" className="bg-[#121824] text-white">Pro Shield</option>
                <option value="craig_10x" className="bg-[#121824] text-white">Craig 10x</option>
                <option value="apex_quant" className="bg-[#121824] text-white">Apex Quant</option>
              </select>
            </div>
          )}

          {/* Active Pair Symbol & Live Price (Clickable to switch symbol) */}
          <button
            type="button"
            onClick={onSymbolClick}
            className="flex items-center space-x-1 md:space-x-1.5 px-1.5 py-0.5 md:px-2 md:py-1 rounded-md hover:bg-[#1a2230] transition-colors cursor-pointer group shrink-0"
            title="Klik untuk mencari / ganti koin"
          >
            <span className="font-bold text-xs md:text-sm text-white tracking-wider font-mono group-hover:text-[#f0b90b] transition-colors">
              {symbol}
            </span>
            {lastPrice && (
              <span className="text-[10px] md:text-xs font-mono font-semibold text-[#00c087]">
                ${formatPrice(lastPrice)}
              </span>
            )}
            <Search className="w-3 h-3 text-slate-500 group-hover:text-[#f0b90b] transition-colors hidden sm:inline" />
          </button>

          {/* Universal Timeframe Dropdown (Replaces 8 buttons & mobile select) */}
          <div className="flex items-center space-x-1 bg-[#0b0e14] px-1.5 py-0.5 md:px-2 md:py-1 rounded-md border border-[#21262d] text-xs shrink-0">
            <Clock className="w-3 h-3 md:w-3.5 md:h-3.5 text-[#f0b90b] shrink-0" />
            <select
              value={timeframe}
              onChange={(e) => onTimeframeChange(e.target.value)}
              className="bg-transparent text-[#f0b90b] font-bold text-[11px] md:text-xs outline-none cursor-pointer pr-0.5"
              title="Pilih Timeframe"
            >
              {TIMEFRAMES.map((tf) => (
                <option key={tf} value={tf} className="bg-[#121824] text-white font-bold">
                  {tf.toUpperCase()}
                </option>
              ))}
            </select>
          </div>

          {/* Setup Action Button (Setup Terkunci / Open Posisi) */}
          <div className="hidden md:flex items-center shrink-0">
            {isSetupLocked ? (
              <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs font-semibold shrink-0">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
                <span className="font-bold flex items-center space-x-1">
                  <Lock className="w-3 h-3 text-amber-400 shrink-0" />
                  <span>Setup Terkunci</span>
                </span>
                {onUnlockSetup && (
                  <button
                    type="button"
                    onClick={onUnlockSetup}
                    title="Lepas Kunci Setup Manual"
                    className="flex items-center space-x-1 px-2 py-0.5 bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 rounded text-rose-300 hover:text-white text-[10px] font-bold transition-all shadow-sm cursor-pointer ml-1"
                  >
                    <Unlock className="w-3 h-3 text-rose-300 shrink-0" />
                    <span>Lepas Kunci</span>
                  </button>
                )}
              </div>
            ) : (
              activeSetup && onOpenTrade && (
                <button
                  type="button"
                  onClick={() => onOpenTrade(activeSetup)}
                  className={`flex items-center space-x-1 px-2.5 py-1 rounded-lg font-bold text-xs shadow-md transition-all shrink-0 ${
                    activeSetup.direction === 'LONG'
                      ? 'bg-emerald-500 hover:bg-emerald-400 text-black shadow-emerald-950/40'
                      : 'bg-rose-500 hover:bg-rose-400 text-white shadow-rose-950/40'
                  }`}
                  title={`Buka Posisi ${activeSetup.direction} untuk setup aktif ini`}
                >
                  <Zap className="w-3.5 h-3.5" />
                  <span>Open Posisi</span>
                </button>
              )
            )}
          </div>
        </div>


        {/* ========================================================================= */}
        {/* --- RIGHT SECTION: Actions & Mobile Menu Trigger --- */}
        {/* ========================================================================= */}
        <div className="flex items-center space-x-1 md:space-x-2 shrink-0">
          {/* Mobile Quick Trade Button (If active setup exists) */}
          <div className="flex md:hidden items-center shrink-0">
            {isSetupLocked ? (
              <div 
                className="flex items-center px-1.5 py-1 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[10px] font-bold"
                title="Setup Terkunci"
              >
                <Lock className="w-3 h-3 text-amber-400" />
              </div>
            ) : (
              activeSetup && onOpenTrade && (
                <button
                  type="button"
                  onClick={() => onOpenTrade(activeSetup)}
                  className={`flex items-center space-x-1 px-2 py-1 rounded font-bold text-[10px] shadow-sm shrink-0 ${
                    activeSetup.direction === 'LONG'
                      ? 'bg-emerald-500 text-black'
                      : 'bg-rose-500 text-white'
                  }`}
                  title={`Open ${activeSetup.direction}`}
                >
                  <Zap className="w-3 h-3" />
                  <span>{activeSetup.direction}</span>
                </button>
              )
            )}
          </div>

          {/* Multi-Chart Layouts + Sync Toggles (Unified Clean Group) */}
          <div className="hidden sm:flex items-center bg-[#0b0e14] p-0.5 rounded-lg border border-[#21262d] space-x-0.5">
            <button
              title="Single Chart"
              onClick={() => onLayoutChange('single')}
              className={`p-1.5 rounded transition-colors ${layout === 'single' ? 'bg-[#252d3d] text-[#f0b90b]' : 'text-slate-400 hover:text-white'}`}
            >
              <Square className="w-3.5 h-3.5" />
            </button>
            <button
              title="Split Vertical (2 Chart)"
              onClick={() => onLayoutChange('split-vertical')}
              className={`p-1.5 rounded transition-colors ${layout === 'split-vertical' ? 'bg-[#252d3d] text-[#f0b90b]' : 'text-slate-400 hover:text-white'}`}
            >
              <Columns className="w-3.5 h-3.5" />
            </button>
            <button
              title="Split Horizontal (2 Chart)"
              onClick={() => onLayoutChange('split-horizontal')}
              className={`p-1.5 rounded transition-colors ${layout === 'split-horizontal' ? 'bg-[#252d3d] text-[#f0b90b]' : 'text-slate-400 hover:text-white'}`}
            >
              <Rows className="w-3.5 h-3.5" />
            </button>
            <button
              title="Grid 4 Charts"
              onClick={() => onLayoutChange('grid-4')}
              className={`p-1.5 rounded transition-colors ${layout === 'grid-4' ? 'bg-[#252d3d] text-[#f0b90b]' : 'text-slate-400 hover:text-white'}`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
            </button>

            {/* Sync Toggles (Sleek Icon-Only Buttons inside Multi-Chart Group) */}
            {layout !== 'single' && (
              <>
                <div className="w-[1px] h-3.5 bg-[#21262d] mx-0.5" />
                {onToggleSyncCrosshair && (
                  <button
                    type="button"
                    onClick={onToggleSyncCrosshair}
                    title={syncCrosshair ? 'Sinkronisasi Kursor: AKTIF' : 'Sinkronisasi Kursor: NONAKTIF'}
                    className={`p-1.5 rounded transition-all ${
                      syncCrosshair
                        ? 'bg-cyan-500/20 text-cyan-300'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    <Crosshair className={`w-3.5 h-3.5 ${syncCrosshair ? 'text-cyan-400' : 'text-slate-500'}`} />
                  </button>
                )}
                {onToggleSyncSetup && (
                  <button
                    type="button"
                    onClick={onToggleSyncSetup}
                    title={syncSetup ? 'Sinkronisasi Setup Box: AKTIF' : 'Sinkronisasi Setup Box: NONAKTIF'}
                    className={`p-1.5 rounded transition-all ${
                      syncSetup
                        ? 'bg-amber-500/20 text-amber-300'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}
                  >
                    <Layers className={`w-3.5 h-3.5 ${syncSetup ? 'text-amber-400' : 'text-slate-500'}`} />
                  </button>
                )}
              </>
            )}
          </div>

          {/* Desktop Live WS Status (Minimalist Pulse Dot) */}
          <div 
            title={badge.title}
            className="hidden md:flex items-center space-x-1 px-1.5 py-1 text-xs font-mono font-medium text-slate-300"
          >
            <span className={`w-2 h-2 rounded-full ${badge.dot}`}></span>
            <span className="hidden xl:inline text-[11px] font-mono text-slate-300">{badge.label}</span>
          </div>

          {/* Quick Tools & Utilities (Unified Pill Toolbar) */}
          <div className="flex items-center bg-[#0b0e14] p-0.5 rounded-lg border border-[#21262d] space-x-0.5">
            {/* Refresh */}
            <button
              onClick={onRefresh}
              disabled={isLoading}
              title="Analisa Ulang Struktur"
              className="p-1.5 rounded text-slate-400 hover:text-[#f0b90b] hover:bg-[#1a202c] transition-all disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-[#f0b90b]' : ''}`} />
            </button>

            {/* Dashboard Posisi */}
            {onToggleDashboard && (
              <button
                type="button"
                onClick={onToggleDashboard}
                title="Buka Dashboard Posisi & Order"
                className={`p-1.5 rounded transition-all cursor-pointer ${
                  isDashboardOpen
                    ? 'bg-[#1b2230] text-[#f0b90b]'
                    : 'text-slate-400 hover:text-white hover:bg-[#1a202c]'
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
              </button>
            )}

            {/* Telegram */}
            {onOpenTelegram && (
              <button
                type="button"
                onClick={onOpenTelegram}
                title={isTelegramActive ? "Notifikasi Telegram Aktif" : "Atur Notifikasi Telegram"}
                className={`p-1.5 rounded transition-all relative cursor-pointer ${
                  isTelegramActive
                    ? 'text-[#0088cc] bg-[#0088cc]/10'
                    : 'text-slate-400 hover:text-[#0088cc] hover:bg-[#1a202c]'
                }`}
              >
                <Send className="w-3.5 h-3.5" />
                {isTelegramActive && (
                  <span className="w-1.5 h-1.5 rounded-full bg-[#0088cc] animate-pulse absolute top-1 right-1" />
                )}
              </button>
            )}

            {/* Settings */}
            <button
              onClick={onOpenSettings}
              title="Pengaturan"
              className="p-1.5 rounded text-slate-400 hover:text-[#f0b90b] hover:bg-[#1a202c] transition-all cursor-pointer"
            >
              <SettingsIcon className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* ================================================================= */}
          {/* Mobile Master Menu Button (Opens Full Mobile Action Sheet) */}
          {/* ================================================================= */}
          <button
            type="button"
            onClick={() => setIsMobileMenuOpen(true)}
            className="flex md:hidden items-center justify-center p-1.5 rounded-md bg-[#1a202c] hover:bg-[#252d3d] text-slate-200 border border-[#2d3748] transition-all shrink-0 relative"
            title="Buka Menu Kontrol"
          >
            <Menu className="w-4 h-4 text-slate-200" />
            <span className={`absolute top-1 right-1 w-1.5 h-1.5 rounded-full ${badge.dot}`} />
          </button>
        </div>
      </header>

      {/* ========================================================================= */}
      {/* --- MOBILE ACTION SHEET MODAL (Clean, Modern, Thumb-Friendly) --- */}
      {/* ========================================================================= */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm animate-in fade-in duration-150"
          onClick={() => setIsMobileMenuOpen(false)}
        >
          <div 
            className="w-full max-w-md bg-[#111620] border-t sm:border border-[#2d3748] rounded-t-2xl sm:rounded-xl shadow-2xl p-4 text-slate-100 max-h-[85vh] overflow-y-auto space-y-4 animate-in slide-in-from-bottom duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Sheet Header */}
            <div className="flex items-center justify-between border-b border-[#21262d] pb-3">
              <div className="flex items-center space-x-2">
                <div className="w-6 h-6 rounded-md bg-gradient-to-tr from-[#f0b90b] to-[#fcd535] flex items-center justify-center shadow-md">
                  <TrendingUp className="w-3.5 h-3.5 text-black stroke-[2.5]" />
                </div>
                <span className="font-bold text-sm text-white">Menu Kontrol & Pengaturan</span>
              </div>
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen(false)}
                className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-[#1a202c]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Section 1: Market Selection (Futures vs Spot) */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Pasar Binance</label>
              <div className="grid grid-cols-2 gap-2 bg-[#0b0e14] p-1 rounded-lg border border-[#21262d]">
                <button
                  type="button"
                  onClick={() => {
                    onMarketChange('futures')
                  }}
                  className={`py-2 rounded-md font-bold text-xs transition-all flex items-center justify-center space-x-1.5 ${
                    market === 'futures'
                      ? 'bg-[#f0b90b] text-black shadow-md font-extrabold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <span>USDT-M FUTURES</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onMarketChange('spot')
                  }}
                  className={`py-2 rounded-md font-bold text-xs transition-all flex items-center justify-center space-x-1.5 ${
                    market === 'spot'
                      ? 'bg-[#f0b90b] text-black shadow-md font-extrabold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <span>SPOT MARKET</span>
                </button>
              </div>
            </div>

            {/* Section 2: Setup Engine Mode */}
            {onModeChange && (
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Mode Engine Analisa & Setup</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => onModeChange('standard')}
                    className={`p-2.5 rounded-lg border text-left transition-all ${
                      setupMode === 'standard'
                        ? 'bg-amber-500/15 border-amber-500/50 text-amber-300'
                        : 'bg-[#161c28] border-[#252f44] text-slate-300'
                    }`}
                  >
                    <div className="flex items-center space-x-1.5 font-bold text-xs">
                      <Zap className="w-3.5 h-3.5 text-amber-400" />
                      <span>Standar</span>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">SMC + FVG klasik</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => onModeChange('pro_shield')}
                    className={`p-2.5 rounded-lg border text-left transition-all ${
                      setupMode === 'pro_shield'
                        ? 'bg-indigo-600/20 border-indigo-500/60 text-indigo-300'
                        : 'bg-[#161c28] border-[#252f44] text-slate-300'
                    }`}
                  >
                    <div className="flex items-center space-x-1.5 font-bold text-xs">
                      <Shield className="w-3.5 h-3.5 text-indigo-400" />
                      <span>Pro Shield</span>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">Proteksi buffer SL 0.8 ATR</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => onModeChange('craig_10x')}
                    className={`p-2.5 rounded-lg border text-left transition-all ${
                      setupMode === 'craig_10x'
                        ? 'bg-emerald-600/20 border-emerald-500/60 text-emerald-300'
                        : 'bg-[#161c28] border-[#252f44] text-slate-300'
                    }`}
                  >
                    <div className="flex items-center space-x-1.5 font-bold text-xs">
                      <Target className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Craig 10x</span>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">Target asimetris 3R - 10R</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => onModeChange('apex_quant')}
                    className={`p-2.5 rounded-lg border text-left transition-all ${
                      setupMode === 'apex_quant'
                        ? 'bg-cyan-500/20 border-cyan-400/60 text-cyan-200'
                        : 'bg-[#161c28] border-[#252f44] text-slate-300'
                    }`}
                  >
                    <div className="flex items-center space-x-1.5 font-bold text-xs">
                      <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Apex Quant</span>
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">Hybrid OTE Fibonacci</div>
                  </button>
                </div>
              </div>
            )}

            {/* Section 2.5: Multi-Chart Split Layout Selector */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Tata Letak Chart (Multi-View)</label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onLayoutChange('single')
                    setIsMobileMenuOpen(false)
                  }}
                  className={`p-2.5 rounded-lg border text-center transition-all flex flex-col items-center justify-center space-y-1 ${
                    layout === 'single'
                      ? 'bg-amber-500/20 border-amber-500/60 text-amber-300 font-bold'
                      : 'bg-[#161c28] border-[#252f44] text-slate-300 hover:text-white'
                  }`}
                >
                  <Square className="w-4 h-4" />
                  <span className="text-[11px]">1 Layar (Single)</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onLayoutChange('split-horizontal')
                    setIsMobileMenuOpen(false)
                  }}
                  className={`p-2.5 rounded-lg border text-center transition-all flex flex-col items-center justify-center space-y-1 ${
                    layout === 'split-horizontal'
                      ? 'bg-amber-500/20 border-amber-500/60 text-amber-300 font-bold'
                      : 'bg-[#161c28] border-[#252f44] text-slate-300 hover:text-white'
                  }`}
                >
                  <Rows className="w-4 h-4" />
                  <span className="text-[11px]">2 Baris (Horizontal)</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onLayoutChange('split-vertical')
                    setIsMobileMenuOpen(false)
                  }}
                  className={`p-2.5 rounded-lg border text-center transition-all flex flex-col items-center justify-center space-y-1 ${
                    layout === 'split-vertical'
                      ? 'bg-amber-500/20 border-amber-500/60 text-amber-300 font-bold'
                      : 'bg-[#161c28] border-[#252f44] text-slate-300 hover:text-white'
                  }`}
                >
                  <Columns className="w-4 h-4" />
                  <span className="text-[11px]">2 Kolom (Vertikal)</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onLayoutChange('grid-4')
                    setIsMobileMenuOpen(false)
                  }}
                  className={`p-2.5 rounded-lg border text-center transition-all flex flex-col items-center justify-center space-y-1 ${
                    layout === 'grid-4'
                      ? 'bg-amber-500/20 border-amber-500/60 text-amber-300 font-bold'
                      : 'bg-[#161c28] border-[#252f44] text-slate-300 hover:text-white'
                  }`}
                >
                  <LayoutGrid className="w-4 h-4" />
                  <span className="text-[11px]">4 Layar (Grid 2x2)</span>
                </button>
              </div>

              {/* Multi-Chart Sync Toggles when split */}
              {layout !== 'single' && (
                <div className="grid grid-cols-2 gap-2 pt-1">
                  {onToggleSyncCrosshair && (
                    <button
                      type="button"
                      onClick={onToggleSyncCrosshair}
                      className={`p-2.5 rounded-lg border text-xs font-semibold flex items-center justify-between transition-all ${
                        syncCrosshair
                          ? 'bg-cyan-500/15 border-cyan-500/50 text-cyan-300'
                          : 'bg-[#161c28] border-[#252f44] text-slate-400'
                      }`}
                    >
                      <div className="flex items-center space-x-1.5">
                        <Crosshair className="w-3.5 h-3.5 text-cyan-400" />
                        <span className="text-[11px]">Sync Kursor</span>
                      </div>
                      <span className="text-[9.5px] font-mono font-bold px-1.5 py-0.5 rounded bg-[#0b0e14]">
                        {syncCrosshair ? 'ON' : 'OFF'}
                      </span>
                    </button>
                  )}

                  {onToggleSyncSetup && (
                    <button
                      type="button"
                      onClick={onToggleSyncSetup}
                      className={`p-2.5 rounded-lg border text-xs font-semibold flex items-center justify-between transition-all ${
                        syncSetup
                          ? 'bg-amber-500/15 border-amber-500/50 text-amber-300'
                          : 'bg-[#161c28] border-[#252f44] text-slate-400'
                      }`}
                    >
                      <div className="flex items-center space-x-1.5">
                        <Layers className="w-3.5 h-3.5 text-amber-400" />
                        <span className="text-[11px]">Sync Setup</span>
                      </div>
                      <span className="text-[9.5px] font-mono font-bold px-1.5 py-0.5 rounded bg-[#0b0e14]">
                        {syncSetup ? 'ON' : 'OFF'}
                      </span>
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Section 3: Navigation & Tools */}
            <div className="space-y-1.5">
              <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Fitur & Alat Bantu</label>
              <div className="space-y-2">
                {/* Buka Dashboard Monitor */}
                {onToggleDashboard && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsMobileMenuOpen(false)
                      onToggleDashboard()
                    }}
                    className="w-full flex items-center justify-between p-3 rounded-lg bg-[#161c28] hover:bg-[#1e2738] border border-[#252f44] text-xs font-semibold"
                  >
                    <div className="flex items-center space-x-2.5">
                      <Activity className="w-4 h-4 text-[#f0b90b]" />
                      <span>Monitor Posisi Terbuka & Pending Order</span>
                    </div>
                    <span className="text-[10px] text-slate-400">Buka ▾</span>
                  </button>
                )}

                {/* Notifikasi Telegram */}
                {onOpenTelegram && (
                  <button
                    type="button"
                    onClick={() => {
                      setIsMobileMenuOpen(false)
                      onOpenTelegram()
                    }}
                    className="w-full flex items-center justify-between p-3 rounded-lg bg-[#161c28] hover:bg-[#1e2738] border border-[#252f44] text-xs font-semibold"
                  >
                    <div className="flex items-center space-x-2.5">
                      <Send className="w-4 h-4 text-[#0088cc]" />
                      <span>Notifikasi & Bot Telegram</span>
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded font-mono font-bold ${isTelegramActive ? 'bg-sky-500/20 text-sky-300' : 'text-slate-400'}`}>
                      {isTelegramActive ? 'AKTIF' : 'OFF'}
                    </span>
                  </button>
                )}

                {/* Pengaturan Analisa */}
                <button
                  type="button"
                  onClick={() => {
                    setIsMobileMenuOpen(false)
                    onOpenSettings()
                  }}
                  className="w-full flex items-center justify-between p-3 rounded-lg bg-[#161c28] hover:bg-[#1e2738] border border-[#252f44] text-xs font-semibold"
                >
                  <div className="flex items-center space-x-2.5">
                    <SettingsIcon className="w-4 h-4 text-slate-300" />
                    <span>Pengaturan Sensitivitas Analisa</span>
                  </div>
                  <span className="text-[10px] text-slate-400">Ubah ▾</span>
                </button>
              </div>
            </div>

            {/* Status Live Footer */}
            <div className="pt-2 border-t border-[#21262d] flex items-center justify-between text-xs text-slate-400 font-mono">
              <span className="flex items-center space-x-2">
                <span className={`w-2.5 h-2.5 rounded-full ${badge.dot}`} />
                <span>Status Server: {badge.label}</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  setIsMobileMenuOpen(false)
                  onRefresh()
                }}
                className="text-[#f0b90b] font-bold hover:underline"
              >
                Refresh Data
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
