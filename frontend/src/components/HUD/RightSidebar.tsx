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
import {
  Gauge,
  Target,
  Calculator,
  Coins,
  PanelRightClose,
  PanelRightOpen
} from 'lucide-react'

type RightTab = 'index' | 'setup' | 'calculator' | 'watchlist'

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
  onSelectSymbol: (symbol: string) => void
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
  onSelectSymbol
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
      if (saved === 'calculator' || saved === 'watchlist' || saved === 'setup' || saved === 'index') {
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

  // Collapsed State (Slim Right Dock Rail)
  if (!isOpen) {
    return (
      <aside className="w-11 bg-[#111620] border-l border-[#21262d] flex flex-col items-center py-2.5 space-y-2 shrink-0 select-none">
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
          {hasActiveBox && (
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#00c087] ring-2 ring-[#111620]" />
          )}
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
    )
  }

  // Expanded State
  return (
    <aside className="w-80 bg-[#111620] border-l border-[#21262d] flex flex-col h-full shrink-0 overflow-hidden">
      {/* Sidebar Navigation Bar + Collapse Toggle */}
      <div className="flex items-center justify-between px-1.5 py-1.5 bg-[#0d1117] border-b border-[#21262d] shrink-0">
        <div className="grid grid-cols-4 gap-1 flex-1 mr-1">
          <button
            type="button"
            onClick={() => setActiveTab('index')}
            className={`flex items-center justify-center space-x-1 py-1.5 px-1 rounded-md text-[10px] font-bold transition-all ${
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
            className={`relative flex items-center justify-center space-x-1 py-1.5 px-1 rounded-md text-[10px] font-bold transition-all ${
              activeTab === 'setup'
                ? 'bg-[#1b2230] text-white border border-[#2f394c] shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#151b26]'
            }`}
          >
            <Target className={`w-3 h-3 shrink-0 ${activeTab === 'setup' ? 'text-[#00c087]' : ''}`} />
            <span>Setup</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('calculator')}
            className={`relative flex items-center justify-center space-x-1 py-1.5 px-1 rounded-md text-[10px] font-bold transition-all ${
              activeTab === 'calculator'
                ? 'bg-[#1b2230] text-white border border-[#2f394c] shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#151b26]'
            }`}
          >
            <Calculator className={`w-3 h-3 shrink-0 ${activeTab === 'calculator' ? 'text-[#f0b90b]' : ''}`} />
            <span>Hitung</span>
            {hasActiveBox && (
              <span
                className="w-1.5 h-1.5 rounded-full bg-[#00c087] shrink-0"
                title="Ada Setup A+ Aktif"
              />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('watchlist')}
            className={`flex items-center justify-center space-x-1 py-1.5 px-1 rounded-md text-[10px] font-bold transition-all ${
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
        <div className="flex-1 flex flex-col overflow-hidden [&>aside]:w-full [&>aside]:border-l-0 [&>aside]:flex-1 [&>aside]:h-full">
          <ConfluenceSidebar
            movement={movement}
            smc={smc}
            forecast={forecast}
            patterns={patterns}
            currentPrice={currentPrice}
          />
        </div>
      )}

      {activeTab === 'setup' && (
        <SetupRadarPanel
          symbol={symbol}
          timeframe={timeframe}
          market={market}
          settings={settings}
          forecast={forecast}
          currentPrice={currentPrice}
          onSelectSymbol={onSelectSymbol}
        />
      )}

      {activeTab === 'calculator' && (
        <PositionCalculator
          symbol={symbol}
          market={market}
          candles={candles}
          forecast={forecast}
          currentPrice={currentPrice}
        />
      )}

      {activeTab === 'watchlist' && (
        <CoinWatchlist
          market={market}
          currentSymbol={symbol}
          currentPrice={currentPrice}
          onSelectSymbol={onSelectSymbol}
        />
      )}
    </aside>
  )
}
