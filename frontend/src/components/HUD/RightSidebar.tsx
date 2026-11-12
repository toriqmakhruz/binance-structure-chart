import React, { useState, useEffect, useMemo } from 'react'
import {
  Candle,
  MovementMetrics,
  SmcAnalysisResult,
  ForecastResult,
  ChartPattern
} from '../../types/analysis'
import { ConfluenceSidebar } from './ConfluenceSidebar'
import { PositionCalculator } from './PositionCalculator'
import {
  Gauge,
  Calculator,
  PanelRightClose,
  PanelRightOpen
} from 'lucide-react'

type RightTab = 'index' | 'calculator'

interface RightSidebarProps {
  symbol: string
  market: 'spot' | 'futures'
  candles: Candle[]
  movement?: MovementMetrics
  smc?: SmcAnalysisResult
  forecast?: ForecastResult
  patterns?: ChartPattern[]
  currentPrice?: number
}

export const RightSidebar: React.FC<RightSidebarProps> = ({
  symbol,
  market,
  candles,
  movement,
  smc,
  forecast,
  patterns = [],
  currentPrice
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
      return saved === 'calculator' ? 'calculator' : 'index'
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
      </aside>
    )
  }

  // Expanded State
  return (
    <aside className="w-80 bg-[#111620] border-l border-[#21262d] flex flex-col h-full shrink-0 overflow-hidden">
      {/* Sidebar Navigation Bar + Collapse Toggle */}
      <div className="flex items-center justify-between px-2 py-1.5 bg-[#0d1117] border-b border-[#21262d] shrink-0">
        <div className="flex items-center space-x-1 flex-1 mr-1">
          <button
            type="button"
            onClick={() => setActiveTab('index')}
            className={`flex-1 flex items-center justify-center space-x-1.5 py-1.5 px-2 rounded-md text-[11px] font-bold transition-all ${
              activeTab === 'index'
                ? 'bg-[#1b2230] text-white border border-[#2f394c] shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#151b26]'
            }`}
          >
            <Gauge className={`w-3.5 h-3.5 ${activeTab === 'index' ? 'text-[#f0b90b]' : ''}`} />
            <span>Indeks</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('calculator')}
            className={`relative flex-1 flex items-center justify-center space-x-1.5 py-1.5 px-2 rounded-md text-[11px] font-bold transition-all ${
              activeTab === 'calculator'
                ? 'bg-[#1b2230] text-white border border-[#2f394c] shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-[#151b26]'
            }`}
          >
            <Calculator className={`w-3.5 h-3.5 ${activeTab === 'calculator' ? 'text-[#f0b90b]' : ''}`} />
            <span>Kalkulator</span>
            {hasActiveBox && (
              <span
                className="w-1.5 h-1.5 rounded-full bg-[#00c087]"
                title="Ada Setup A+ Aktif"
              />
            )}
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
      {activeTab === 'index' ? (
        <div className="flex-1 flex flex-col overflow-hidden [&>aside]:w-full [&>aside]:border-l-0 [&>aside]:flex-1 [&>aside]:h-full">
          <ConfluenceSidebar
            movement={movement}
            smc={smc}
            forecast={forecast}
            patterns={patterns}
            currentPrice={currentPrice}
          />
        </div>
      ) : (
        <PositionCalculator
          symbol={symbol}
          market={market}
          candles={candles}
          forecast={forecast}
          currentPrice={currentPrice}
        />
      )}
    </aside>
  )
}
