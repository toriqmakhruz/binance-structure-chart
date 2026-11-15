import React, { useState, useEffect, useMemo } from 'react'
import {
  Candle,
  MovementMetrics,
  SmcAnalysisResult,
  ForecastResult,
  ChartPattern,
  AppSettings
} from '../../types/analysis'
import { ConfluenceSidebar } from './ConfluenceSidebar'
import { PositionCalculator } from './PositionCalculator'
import { CoinWatchlist } from './CoinWatchlist'
import { SetupRadarPanel } from './SetupRadarPanel'
import { PositionsSidebarPanel } from './PositionsSidebarPanel'
import {
  Gauge,
  Target,
  Calculator,
  Coins,
  PanelRightClose,
  PanelRightOpen,
  Activity
} from 'lucide-react'

type RightTab = 'index' | 'setup' | 'positions' | 'calculator' | 'watchlist'

interface RightSidebarProps {
  symbol: string
  timeframe: string
  market: 'spot' | 'futures'
  settings: AppSettings
  candles: Candle[]
  movement?: MovementMetrics
  smc?: SmcAnalysisResult
  forecast?: ForecastResult
  patterns?: ChartPattern[]
  currentPrice?: number
  lockedSetups?: Record<string, any>
  onSelectSymbol: (symbol: string) => void
  onOpenTrade?: (setup: any) => void
  onPositionClosed?: (symbol: string) => void
  onUnlockSetup?: (symbol?: string) => void
}

export const RightSidebar: React.FC<RightSidebarProps> = ({
  symbol,
  timeframe,
  market,
  settings,
  candles,
  movement,
  smc,
  forecast,
  patterns = [],
  currentPrice,
  lockedSetups,
  onSelectSymbol,
  onOpenTrade,
  onPositionClosed,
  onUnlockSetup
}) => {
  const [isOpen, setIsOpen] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('cp_right_sidebar_open')
      return saved === null ? true : saved === 'true'
    } catch {
      return true
    }
  })

  const [activeTab, setActiveTab] = useState<RightTab>(() => {
    try {
      const saved = localStorage.getItem('cp_right_sidebar_tab')
      if (saved === 'calculator' || saved === 'watchlist' || saved === 'setup' || saved === 'index' || saved === 'positions') {
        return saved
      }
      return 'index'
    } catch {
      return 'index'
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem('cp_right_sidebar_open', String(isOpen))
    } catch {
      // ignore
    }
  }, [isOpen])

  useEffect(() => {
    try {
      localStorage.setItem('cp_right_sidebar_tab', activeTab)
    } catch {
      // ignore
    }
  }, [activeTab])

  const hasActiveBox = useMemo(() => {
    return Boolean(
      forecast?.scenarios?.some(
        (s) => s.is_valid === true && (s.risk_reward_ratio || 0) >= 1.5 && s.status === 'VALID_ENTRY'
      )
    )
  }, [forecast])

  const hasLockedPositions = useMemo(() => {
    return Boolean(lockedSetups && Object.keys(lockedSetups).length > 0)
  }, [lockedSetups])

  // Collapsed State
  if (!isOpen) {
    return (
      <>
        {/* Mobile Floating Button */}
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="md:hidden fixed bottom-14 right-3 z-30 flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-[#161c28]/95 hover:bg-[#1f2738] text-[#00c087] border border-emerald-700/60 shadow-2xl text-xs font-bold backdrop-blur-sm transition-all"
          title="Buka Setup & Posisi"
        >
          <Target className="w-4 h-4 text-[#00c087]" />
          <span>Setup & Posisi</span>
          {(hasActiveBox || hasLockedPositions) && (
            <span className="w-2 h-2 rounded-full bg-[#00c087] animate-pulse" />
          )}
        </button>

        {/* Slim Right Dock Rail (Desktop Only) */}
        <aside className="hidden md:flex w-11 bg-[#111620] border-l border-[#21262d] flex-col items-center py-2.5 space-y-2 shrink-0 select-none">
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          title="Buka Sidebar Kanan"
          className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-[#1e2533] transition-colors"
        >
          <PanelRightOpen className="w-4 h-4" />
        </button>

        <div className="w-6 h-px bg-[#21262d]" />

        <button
          type="button"
          onClick={() => {
            setActiveTab('index')
            setIsOpen(true)
          }}
          title="Buka Indeks & SMC"
          className={`p-2 rounded-lg transition-colors ${
            activeTab === 'index'
              ? 'bg-[#1b2230] text-[#f0b90b] border border-[#30394b]'
              : 'text-slate-400 hover:text-white hover:bg-[#1e2533]'
          }`}
        >
          <Gauge className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab('setup')
            setIsOpen(true)
          }}
          title="Buka Setup Terbaru (Masih Valid)"
          className={`relative p-2 rounded-lg transition-colors ${
            activeTab === 'setup'
              ? 'bg-[#1b2230] text-[#f0b90b] border border-[#30394b]'
              : 'text-slate-400 hover:text-white hover:bg-[#1e2533]'
          }`}
        >
          <Target className="w-4 h-4" />
          {(hasActiveBox || hasLockedPositions) && (
            <span className={`absolute top-1.5 right-1.5 w-2 h-2 rounded-full ${hasLockedPositions ? 'bg-[#00c087] animate-pulse ring-1 ring-[#00c087]' : 'bg-[#00c087] ring-2 ring-[#111620]'}`} />
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab('positions')
            setIsOpen(true)
          }}
          title="Buka Monitor Posisi & Order"
          className={`p-2 rounded-lg transition-colors ${
            activeTab === 'positions'
              ? 'bg-[#1b2230] text-[#00c087] border border-[#30394b]'
              : 'text-slate-400 hover:text-white hover:bg-[#1e2533]'
          }`}
        >
          <Activity className="w-4 h-4" />
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab('calculator')
            setIsOpen(true)
          }}
          title="Buka Kalkulator Posisi"
          className={`relative p-2 rounded-lg transition-colors ${
            activeTab === 'calculator'
              ? 'bg-[#1b2230] text-[#f0b90b] border border-[#30394b]'
              : 'text-slate-400 hover:text-white hover:bg-[#1e2533]'
          }`}
        >
          <Calculator className="w-4 h-4" />
          {hasActiveBox && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#00c087] ring-2 ring-[#111620]" />
          )}
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab('watchlist')
            setIsOpen(true)
          }}
          title="Buka Daftar Koin (Watchlist)"
          className={`p-2 rounded-lg transition-colors ${
            activeTab === 'watchlist'
              ? 'bg-[#1b2230] text-[#f0b90b] border border-[#30394b]'
              : 'text-slate-400 hover:text-white hover:bg-[#1e2533]'
          }`}
        >
          <Coins className="w-4 h-4" />
        </button>
      </aside>
      </>
    )
  }

  // Expanded State (Off-canvas drawer on mobile, side rail on desktop)
  return (
    <>
      {/* Mobile Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-[2px] z-40 md:hidden"
        onClick={() => setIsOpen(false)}
      />

      <aside className="fixed inset-y-0 right-0 z-50 w-full sm:w-85 max-w-[85vw] md:relative md:inset-auto md:z-20 md:w-80 md:max-w-none bg-[#111620] border-l border-[#21262d] flex flex-col h-full min-h-0 shrink-0 overflow-hidden shadow-2xl md:shadow-none animate-in slide-in-from-right duration-200 md:animate-none">
      {/* Sidebar Navigation Bar + Collapse Toggle */}
      <div className="flex items-center justify-between px-1 py-1.5 bg-[#0d1117] border-b border-[#21262d] shrink-0">
        <div className="grid grid-cols-5 gap-0.5 flex-1 mr-1">
          <button
            type="button"
            onClick={() => setActiveTab('index')}
            className={`flex items-center justify-center space-x-0.5 py-1.5 px-0.5 rounded-md text-[10px] font-bold transition-all ${
              activeTab === 'index'
                ? 'bg-[#1b2230] text-white border border-[#2f394c] shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#151b26]'
            }`}
          >
            <Gauge className={`w-3 h-3 shrink-0 ${activeTab === 'index' ? 'text-[#f0b90b]' : ''}`} />
            <span>Indeks</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('setup')}
            className={`relative flex items-center justify-center space-x-0.5 py-1.5 px-0.5 rounded-md text-[10px] font-bold transition-all ${
              activeTab === 'setup'
                ? 'bg-[#1b2230] text-white border border-[#2f394c] shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#151b26]'
            }`}
          >
            <Target className={`w-3 h-3 shrink-0 ${activeTab === 'setup' ? 'text-[#00c087]' : ''}`} />
            <span>Setup</span>
            {hasLockedPositions && (
              <span className="w-1.5 h-1.5 rounded-full bg-[#00c087] animate-pulse ml-0.5" title="Ada Posisi Aktif" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('positions')}
            className={`relative flex items-center justify-center space-x-0.5 py-1.5 px-0.5 rounded-md text-[10px] font-bold transition-all ${
              activeTab === 'positions'
                ? 'bg-[#1b2230] text-white border border-[#2f394c] shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#151b26]'
            }`}
          >
            <Activity className={`w-3 h-3 shrink-0 ${activeTab === 'positions' ? 'text-[#00c087]' : ''}`} />
            <span>Posisi</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('calculator')}
            className={`relative flex items-center justify-center space-x-0.5 py-1.5 px-0.5 rounded-md text-[10px] font-bold transition-all ${
              activeTab === 'calculator'
                ? 'bg-[#1b2230] text-white border border-[#2f394c] shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#151b26]'
            }`}
          >
            <Calculator className={`w-3 h-3 shrink-0 ${activeTab === 'calculator' ? 'text-[#f0b90b]' : ''}`} />
            <span>Hitung</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('watchlist')}
            className={`flex items-center justify-center space-x-0.5 py-1.5 px-0.5 rounded-md text-[10px] font-bold transition-all ${
              activeTab === 'watchlist'
                ? 'bg-[#1b2230] text-white border border-[#2f394c] shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#151b26]'
            }`}
          >
            <Coins className={`w-3 h-3 shrink-0 ${activeTab === 'watchlist' ? 'text-[#f0b90b]' : ''}`} />
            <span>Koin</span>
          </button>
        </div>

        <button
          type="button"
          onClick={() => setIsOpen(false)}
          title="Tutup Sidebar"
          className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-[#1b2230] transition-colors shrink-0"
        >
          <PanelRightClose className="w-4 h-4" />
        </button>
      </div>

      {/* Tab Content */}
      {activeTab === 'index' && (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <ConfluenceSidebar
            movement={movement}
            smc={smc}
            forecast={forecast}
            patterns={patterns}
            currentPrice={currentPrice}
            isLocked={Boolean(lockedSetups && lockedSetups[symbol.toUpperCase()])}
            onUnlockSetup={() => onUnlockSetup?.(symbol)}
          />
        </div>
      )}

      {activeTab === 'setup' && (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <SetupRadarPanel
            symbol={symbol}
            timeframe={timeframe}
            market={market}
            settings={settings}
            forecast={forecast}
            currentPrice={currentPrice}
            lockedSetups={lockedSetups}
            onSelectSymbol={onSelectSymbol}
            onOpenTrade={onOpenTrade}
            onUnlockSetup={onUnlockSetup}
          />
        </div>
      )}

      {activeTab === 'positions' && (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <PositionsSidebarPanel
            currentSymbol={symbol}
            market={market}
            onSelectSymbol={onSelectSymbol}
            onOpenTradeModal={() => onOpenTrade?.({ symbol, market, direction: 'LONG', entry_price: currentPrice || 0 })}
            onPositionClosed={onPositionClosed}
          />
        </div>
      )}

      {activeTab === 'calculator' && (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <PositionCalculator
            symbol={symbol}
            market={market}
            candles={candles}
            forecast={forecast}
            currentPrice={currentPrice}
            onOpenTrade={onOpenTrade}
          />
        </div>
      )}

      {activeTab === 'watchlist' && (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <CoinWatchlist
            market={market}
            currentSymbol={symbol}
            currentPrice={currentPrice}
            onSelectSymbol={onSelectSymbol}
          />
        </div>
      )}
    </aside>
    </>
  )
}
