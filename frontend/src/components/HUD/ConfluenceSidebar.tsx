import React from 'react'
import {
  MovementMetrics,
  SmcAnalysisResult,
  ForecastResult,
  ChartPattern
} from '../../types/analysis'
import { formatPrice } from '../../utils/formatters'
import {
  Gauge,
  Activity,
  Zap,
  Target,
  ShieldAlert,
  ArrowUpRight,
  ArrowDownRight,
  TrendingDown,
  TrendingUp,
  SlidersHorizontal,
  ChevronRight
} from 'lucide-react'

interface ConfluenceSidebarProps {
  movement?: MovementMetrics
  smc?: SmcAnalysisResult
  forecast?: ForecastResult
  patterns?: ChartPattern[]
  currentPrice?: number
}

export const ConfluenceSidebar: React.FC<ConfluenceSidebarProps> = ({
  movement,
  smc,
  forecast,
  patterns = [],
  currentPrice
}) => {
  if (!movement) {
    return (
      <aside className="w-80 bg-[#111620] border-l border-[#21262d] p-4 flex flex-col justify-center items-center text-slate-500 text-sm">
        <Activity className="w-8 h-8 animate-pulse text-slate-600 mb-2" />
        <span>Menunggu data analisa...</span>
      </aside>
    )
  }

  // Color mapping based on confluence bias
  const getBiasBadge = (bias: string) => {
    switch (bias) {
      case 'STRONG BULLISH':
        return { bg: 'bg-emerald-950/80 text-emerald-400 border-emerald-500/50', icon: <TrendingUp className="w-4 h-4 mr-1 text-emerald-400" /> }
      case 'BULLISH':
        return { bg: 'bg-emerald-950/50 text-emerald-300 border-emerald-600/30', icon: <TrendingUp className="w-4 h-4 mr-1 text-emerald-300" /> }
      case 'STRONG BEARISH':
        return { bg: 'bg-rose-950/80 text-rose-400 border-rose-500/50', icon: <TrendingDown className="w-4 h-4 mr-1 text-rose-400" /> }
      case 'BEARISH':
        return { bg: 'bg-rose-950/50 text-rose-300 border-rose-600/30', icon: <TrendingDown className="w-4 h-4 mr-1 text-rose-300" /> }
      default:
        return { bg: 'bg-slate-800 text-slate-300 border-slate-600', icon: <Activity className="w-4 h-4 mr-1 text-slate-400" /> }
    }
  }

  const badge = getBiasBadge(movement.confluence_bias)
  const buyPct = Math.round(movement.volume_delta_ratio * 100)
  const sellPct = 100 - buyPct

  return (
    <aside className="w-80 bg-[#111620] border-l border-[#21262d] flex flex-col h-full overflow-y-auto select-none divide-y divide-[#21262d] text-xs">
      {/* 1. Confluence Index Header */}
      <div className="p-4 bg-gradient-to-b from-[#161d2b] to-[#111620]">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center space-x-1.5 text-slate-400 font-bold uppercase tracking-wider text-[11px]">
            <Gauge className="w-4 h-4 text-[#f0b90b]" />
            <span>Indeks Konfluensi</span>
          </div>
          <span className="font-mono text-lg font-extrabold text-white">
            {movement.confluence_score}%
          </span>
        </div>

        {/* Confluence Gauge Bar */}
        <div className="w-full bg-[#1e2533] h-2.5 rounded-full overflow-hidden mb-3 p-0.5 border border-[#30394b]">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              movement.confluence_score >= 60
                ? 'bg-gradient-to-r from-emerald-500 to-emerald-400'
                : movement.confluence_score <= 40
                ? 'bg-gradient-to-r from-rose-500 to-rose-400'
                : 'bg-gradient-to-r from-yellow-500 to-amber-400'
            }`}
            style={{ width: `${movement.confluence_score}%` }}
          />
        </div>

        {/* Bias Pill */}
        <div className={`flex items-center justify-center py-1.5 px-3 rounded-lg border font-bold text-xs uppercase tracking-wide ${badge.bg}`}>
          {badge.icon}
          {movement.confluence_bias}
        </div>

        {/* Summary text */}
        <p className="mt-2.5 text-[11px] text-slate-400 leading-relaxed font-sans">
          {movement.summary}
        </p>
      </div>

      {/* 2. Movement & Momentum Dynamics */}
      <div className="p-4 space-y-3">
        <div className="flex items-center space-x-1.5 text-slate-400 font-bold uppercase tracking-wider text-[11px]">
          <Activity className="w-4 h-4 text-cyan-400" />
          <span>Dinamika Pergerakan</span>
        </div>

        {/* Buyer vs Seller Pressure */}
        <div>
          <div className="flex justify-between text-[11px] font-mono mb-1">
            <span className="text-[#00c087] font-semibold">Buy {buyPct}%</span>
            <span className="text-slate-400">Tekanan Volume</span>
            <span className="text-[#f6465d] font-semibold">Sell {sellPct}%</span>
          </div>
          <div className="w-full h-2 rounded-full overflow-hidden flex bg-[#1e2533]">
            <div className="bg-[#00c087] h-full transition-all" style={{ width: `${buyPct}%` }} />
            <div className="bg-[#f6465d] h-full transition-all" style={{ width: `${sellPct}%` }} />
          </div>
        </div>

        {/* RSI & Volatility Grid */}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <div className="bg-[#0d1117] p-2.5 rounded-lg border border-[#21262d]">
            <span className="text-slate-400 text-[10px] uppercase font-bold block mb-1">RSI (14)</span>
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm font-bold text-white">{movement.rsi}</span>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                movement.rsi_condition.includes('DIV')
                  ? 'bg-amber-950 text-amber-300 border border-amber-800'
                  : movement.rsi_condition === 'OVERBOUGHT'
                  ? 'bg-rose-950 text-rose-300'
                  : movement.rsi_condition === 'OVERSOLD'
                  ? 'bg-emerald-950 text-emerald-300'
                  : 'text-slate-400'
              }`}>
                {movement.rsi_condition}
              </span>
            </div>
          </div>

          <div className="bg-[#0d1117] p-2.5 rounded-lg border border-[#21262d]">
            <span className="text-slate-400 text-[10px] uppercase font-bold block mb-1">Volatilitas (ATR)</span>
            <div className="flex items-center justify-between">
              <span className="font-mono text-sm font-bold text-white">${formatPrice(movement.volatility_atr)}</span>
              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                movement.volatility_status === 'SQUEEZE'
                  ? 'bg-purple-950 text-purple-300 border border-purple-800'
                  : 'text-slate-400'
              }`}>
                {movement.volatility_status}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Market Structure (SMC) */}
      {smc && (
        <div className="p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-1.5 text-slate-400 font-bold uppercase tracking-wider text-[11px]">
              <Zap className="w-4 h-4 text-purple-400" />
              <span>Struktur Pasar (SMC)</span>
            </div>
            <span className={`px-2 py-0.5 rounded text-[10px] font-bold font-mono ${
              smc.current_trend === 'BULLISH' ? 'bg-emerald-950 text-emerald-400' : 'bg-rose-950 text-rose-400'
            }`}>
              {smc.current_trend}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px]">
            <div className="bg-[#0d1117] p-2 rounded border border-[#21262d] flex justify-between items-center">
              <span className="text-slate-400">Order Blocks:</span>
              <span className="font-mono font-bold text-indigo-400">{smc.order_blocks.length}</span>
            </div>
            <div className="bg-[#0d1117] p-2 rounded border border-[#21262d] flex justify-between items-center">
              <span className="text-slate-400">Fair Value Gaps:</span>
              <span className="font-mono font-bold text-cyan-400">{smc.fvgs.length}</span>
            </div>
          </div>

          {/* Recent Structure Event */}
          {smc.events.length > 0 && (
            <div className="bg-[#0d1117] p-2.5 rounded-lg border border-[#21262d] flex items-center justify-between">
              <div>
                <span className="text-[10px] text-slate-500 uppercase block font-bold">Event Struktur Terakhir</span>
                <span className="font-mono font-bold text-white text-xs">
                  {smc.events[smc.events.length - 1].direction} {smc.events[smc.events.length - 1].type}
                </span>
              </div>
              <span className="font-mono text-xs text-[#f0b90b]">
                ${formatPrice(smc.events[smc.events.length - 1].level_price)}
              </span>
            </div>
          )}
        </div>
      )}

      {/* 4. Forecasting Scenarios */}
      {forecast && (
        <div className="p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-1.5 text-slate-400 font-bold uppercase tracking-wider text-[11px]">
              <Target className="w-4 h-4 text-amber-400" />
              <span>Skenario Forecast ({forecast.horizon_candles} Candle)</span>
            </div>
          </div>

          {/* Banner jika belum ada setup valid */}
          {!forecast.scenarios.some(s => s.is_valid === true && (s.risk_reward_ratio || 0) >= 1.5 && s.status === 'VALID_ENTRY') && (
            <div className="bg-[#141a24] p-2.5 rounded-lg border border-[#2b3548] space-y-1">
              <div className="flex items-center text-amber-400 font-bold text-[11px]">
                <ShieldAlert className="w-3.5 h-3.5 mr-1 text-amber-400" />
                <span>Status: Wait & See (Belum Valid)</span>
              </div>
              <p className="text-[10px] text-slate-400 leading-tight">
                Box Entry tidak digambar pada chart karena belum ada setup yang memenuhi kriteria R:R ≥ 1:1.5 dan arah struktur SMC.
              </p>
            </div>
          )}

          {forecast.scenarios.map((sc, idx) => {
            const isLong = sc.direction === 'LONG' || sc.name.toLowerCase().includes('bullish')
            return (
              <div
                key={idx}
                className="bg-[#0d1117] p-3 rounded-lg border border-[#21262d] space-y-2 hover:border-[#384358] transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1.5 truncate max-w-[170px]">
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                      isLong 
                        ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' 
                        : 'bg-rose-950 text-rose-400 border border-rose-800'
                    }`}>
                      {isLong ? 'LONG' : 'SHORT'}
                    </span>
                    <span className="font-bold text-white text-[11px] truncate">{sc.name}</span>
                  </div>
                  <span className="font-mono font-bold text-[#f0b90b] text-[11px]">
                    {sc.probability != null ? `${sc.probability}% Prob` : `Bobot: ${sc.confluence_weight}%`}
                  </span>
                </div>

                {/* Entry Level & Zone */}
                <div className="bg-[#131924] p-1.5 rounded border border-[#232b3b] flex items-center justify-between text-[10px]">
                  <span className="text-slate-400 font-medium">Titik Entry:</span>
                  <span className="font-mono font-bold text-sky-400">
                    {sc.entry_price ? `$${formatPrice(sc.entry_price)}` : (currentPrice ? `$${formatPrice(currentPrice)}` : '-')}
                    {sc.entry_zone_low && sc.entry_zone_high && (
                      <span className="text-[9px] text-slate-400 font-normal ml-1">
                        (${formatPrice(sc.entry_zone_low)} - ${formatPrice(sc.entry_zone_high)})
                      </span>
                    )}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                  <div className="bg-[#161b22] p-1.5 rounded">
                    <span className="text-slate-500 block">Target (TP)</span>
                    <span className="font-bold text-[#00c087]">${formatPrice(sc.target_price)}</span>
                  </div>
                  <div className="bg-[#161b22] p-1.5 rounded">
                    <span className="text-slate-500 block">Invalidasi (SL)</span>
                    <span className="font-bold text-[#f6465d]">${formatPrice(sc.invalidation_price)}</span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 border-t border-[#1c222e]">
                  <span>Risk:Reward Ratio</span>
                  <div className="flex items-center space-x-1.5">
                    <span className="font-mono font-bold text-white">1 : {sc.risk_reward_ratio}</span>
                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${
                      sc.is_valid
                        ? 'bg-emerald-950 text-emerald-400 border-emerald-800'
                        : sc.status === 'LOW_RR'
                        ? 'bg-amber-950/80 text-amber-400 border-amber-800'
                        : 'bg-slate-900 text-slate-400 border-slate-700'
                    }`}>
                      {sc.is_valid ? 'VALID ENTRY' : (sc.status || 'NO SETUP')}
                    </span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </aside>
  )
}
