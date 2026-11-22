import React, { useState, useEffect } from 'react'
import {
  ShieldCheck,
  Zap,
  Activity,
  Layers,
  Target,
  BarChart2,
  Lock,
  Unlock,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  Anchor,
  Flame,
  ChevronDown,
  Clock,
  Compass
} from 'lucide-react'
import { ITITelemetryResponse, ITITradePlan } from '../../types/iti'
import { fetchItiTelemetry } from '../../services/api'
import { formatPrice } from '../../utils/formatters'

interface ITIWorkspacePanelProps {
  symbol: string
  market?: 'spot' | 'futures'
  onOpenTrade?: (plan: ITITradePlan) => void
}

export const ITIWorkspacePanel: React.FC<ITIWorkspacePanelProps> = ({
  symbol,
  market = 'futures',
  onOpenTrade
}) => {
  const [data, setData] = useState<ITITelemetryResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<'all' | 'smc' | 'liquidity' | 'dom' | 'footprint' | 'derivatives'>('all')

  const loadTelemetry = async () => {
    try {
      const res = await fetchItiTelemetry(symbol, market)
      setData(res)
      setError(null)
    } catch (err: any) {
      setError(err?.message || 'Gagal memuat telemetry ITI')
    }
  }

  useEffect(() => {
    setLoading(true)
    loadTelemetry().finally(() => setLoading(false))

    // Real-time polling every 3 seconds for active pair
    const interval = setInterval(loadTelemetry, 3000)
    return () => clearInterval(interval)
  }, [symbol, market])

  if (loading && !data) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-slate-400 font-mono text-xs space-y-3">
        <RefreshCw className="w-5 h-5 text-amber-400 animate-spin" />
        <span>Memuat Intelligence {symbol}...</span>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="p-4 text-xs font-mono text-rose-400 space-y-2">
        <div className="flex items-center space-x-1.5 font-bold">
          <AlertTriangle className="w-4 h-4" />
          <span>Error ITI Telemetry</span>
        </div>
        <p className="text-slate-400">{error}</p>
        <button
          onClick={loadTelemetry}
          className="px-3 py-1 bg-[#1e2533] hover:bg-[#252f42] rounded text-white text-[11px] transition-colors"
        >
          Coba Lagi
        </button>
      </div>
    )
  }

  if (!data) return null

  const isConfirmed = data.lifecycle_state === 'CONFIRMED'
  const isPrepare = data.lifecycle_state === 'PREPARE'
  const isInvalidated = data.lifecycle_state === 'INVALIDATED'
  const isLong = data.direction === 'LONG'
  const isShort = data.direction === 'SHORT'

  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-y-auto bg-[#0c1017] text-slate-200 font-mono text-xs select-none">
      {/* Top Header Card */}
      <div className="p-3 bg-[#111622] border-b border-[#21262d] flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <div className="p-1.5 rounded-lg bg-amber-950/60 border border-amber-800/60 text-amber-400">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center space-x-1.5">
              <span className="font-bold text-white text-[12px]">{data.symbol}</span>
              <span className="text-[9px] px-1 py-0.2 rounded bg-slate-800 text-slate-300 font-bold">
                Gen #{data.generation_id}
              </span>
            </div>
            <div className="text-[10px] text-slate-400">USDⓈ-M Futures ITI</div>
          </div>
        </div>

        <div className="flex items-center space-x-1.5">
          <span
            className={`w-2 h-2 rounded-full ${
              data.data_health.feed_status === 'ONLINE'
                ? 'bg-emerald-400 animate-pulse'
                : 'bg-amber-400'
            }`}
          />
          <span className="text-[10px] font-bold text-slate-300">
            {data.data_health.feed_status}
          </span>
          <button
            onClick={loadTelemetry}
            title="Refresh Data"
            className="p-1 rounded hover:bg-[#1f2637] text-slate-400 hover:text-white transition-colors"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        </div>
      </div>

      <div className="p-3 space-y-3">
        {/* 1. SIGNAL LIFECYCLE BANNER */}
        <div
          className={`p-3 rounded-xl border transition-all ${
            isConfirmed
              ? 'bg-gradient-to-r from-emerald-950/80 to-[#10241b] border-emerald-500/80 shadow-lg shadow-emerald-950/40'
              : isPrepare
              ? 'bg-gradient-to-r from-amber-950/80 to-[#241a0b] border-amber-500/70 shadow-lg shadow-amber-950/30'
              : isInvalidated
              ? 'bg-gradient-to-r from-rose-950/80 to-[#241014] border-rose-600/70'
              : 'bg-[#141a24] border-[#252f3f]'
          }`}
        >
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center space-x-2">
              <span
                className={`px-2 py-0.5 rounded text-[10px] font-black tracking-wider uppercase ${
                  isConfirmed
                    ? 'bg-emerald-500 text-black'
                    : isPrepare
                    ? 'bg-amber-400 text-black animate-pulse'
                    : isInvalidated
                    ? 'bg-rose-500 text-white'
                    : 'bg-slate-700 text-slate-200'
                }`}
              >
                {data.lifecycle_state}
              </span>
              <span className="text-[11px] font-bold text-white">
                {isConfirmed && 'SIAP EKSEKUSI MANUAL'}
                {isPrepare && 'MENUNGGU RECLAIM / MSS'}
                {data.lifecycle_state === 'WATCH' && 'MONITORING STRUKTUR'}
                {isInvalidated && 'STRUKTUR BATAL (INVALID)'}
                {data.lifecycle_state === 'EXPIRED' && 'KADALUWARSA'}
              </span>
            </div>

            <div className="flex items-center space-x-1">
              {isLong && <TrendingUp className="w-4 h-4 text-emerald-400" />}
              {isShort && <TrendingDown className="w-4 h-4 text-rose-400" />}
              <span
                className={`font-black text-sm ${
                  isLong ? 'text-emerald-400' : isShort ? 'text-rose-400' : 'text-slate-400'
                }`}
              >
                {data.direction}
              </span>
            </div>
          </div>

          {/* Long vs Short Confluence Bar */}
          <div className="space-y-1">
            <div className="flex justify-between text-[10px] text-slate-400">
              <span>Long: <strong className="text-emerald-400">{data.long_score}%</strong></span>
              <span>Short: <strong className="text-rose-400">{data.short_score}%</strong></span>
            </div>
            <div className="w-full h-2 bg-[#21262d] rounded-full overflow-hidden flex">
              <div
                className="bg-emerald-500 h-full transition-all duration-300"
                style={{ width: `${data.long_score}%` }}
              />
              <div
                className="bg-rose-500 h-full transition-all duration-300"
                style={{ width: `${data.short_score}%` }}
              />
            </div>
          </div>
        </div>

        {/* 2. HARD GATES EVALUATION CHECKLIST */}
        <div className="bg-[#111622] border border-[#21262d] rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between pb-1.5 border-b border-[#21262d]">
            <div className="flex items-center space-x-1.5">
              <Lock className="w-3.5 h-3.5 text-amber-400" />
              <span className="font-bold text-white text-[11px]">Hard Gates Validator</span>
            </div>
            <span
              className={`px-1.5 py-0.5 rounded text-[9.5px] font-bold ${
                data.hard_gates.all_passed
                  ? 'bg-emerald-950/80 text-emerald-300 border border-emerald-800'
                  : 'bg-rose-950/80 text-rose-300 border border-rose-800'
              }`}
            >
              {data.hard_gates.all_passed ? 'ALL GATES PASS' : 'GATES LOCKED'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[9.5px]">
            {/* Spread Gate */}
            <div className="bg-[#161c28] p-2 rounded border border-[#232a39] flex items-center justify-between">
              <div>
                <div className="text-slate-400">Spread Filter</div>
                <div className="font-bold text-white">{data.hard_gates.spread_gate.value}%</div>
              </div>
              {data.hard_gates.spread_gate.status === 'PASS' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              ) : (
                <XCircle className="w-4 h-4 text-rose-400" />
              )}
            </div>

            {/* Freshness Gate */}
            <div className="bg-[#161c28] p-2 rounded border border-[#232a39] flex items-center justify-between">
              <div>
                <div className="text-slate-400">Data Freshness</div>
                <div className="font-bold text-white">{data.hard_gates.data_freshness_gate.value}s</div>
              </div>
              {data.hard_gates.data_freshness_gate.status === 'PASS' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              ) : (
                <XCircle className="w-4 h-4 text-rose-400" />
              )}
            </div>

            {/* Volatility Gate */}
            <div className="bg-[#161c28] p-2 rounded border border-[#232a39] flex items-center justify-between">
              <div>
                <div className="text-slate-400">Volatilitas DOM</div>
                <div className="font-bold text-white">
                  {data.hard_gates.volatility_gate.status === 'PASS' ? 'Stabil' : 'Anomali'}
                </div>
              </div>
              {data.hard_gates.volatility_gate.status === 'PASS' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              ) : (
                <XCircle className="w-4 h-4 text-rose-400" />
              )}
            </div>

            {/* Whale Counter Gate */}
            <div className="bg-[#161c28] p-2 rounded border border-[#232a39] flex items-center justify-between">
              <div>
                <div className="text-slate-400">Whale Wall Gate</div>
                <div className="font-bold text-white">
                  {data.hard_gates.whale_counter_gate.status === 'PASS' ? 'Clear' : 'Blocked'}
                </div>
              </div>
              {data.hard_gates.whale_counter_gate.status === 'PASS' ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              ) : (
                <XCircle className="w-4 h-4 text-rose-400" />
              )}
            </div>
          </div>
        </div>

        {/* 3. TRADE PLAN EKSEKUSI (STOP LOSS HUNT ENGINE) */}
        {data.trade_plan ? (
          <div className="bg-[#111622] border border-[#21262d] rounded-xl p-3 space-y-2.5">
            <div className="flex items-center justify-between pb-1.5 border-b border-[#21262d]">
              <div className="flex items-center space-x-1.5">
                <Target className="w-3.5 h-3.5 text-emerald-400" />
                <span className="font-bold text-white text-[11px]">Rencana Stop Loss Hunt (Institusi)</span>
              </div>
              <span className="text-[10px] text-amber-400 font-bold">
                1 : {data.trade_plan.risk_reward_ratio} R:R
              </span>
            </div>

            {/* Target SL Pool Info Banner */}
            {data.trade_plan.sl_pool_name && (
              <div className="bg-[#161c28] p-2 rounded border border-[#232a39] space-y-1">
                <div className="flex items-center justify-between text-[9.5px]">
                  <span className="text-amber-400 font-bold flex items-center space-x-1">
                    <span>🎯</span>
                    <span>Target SL Ritel:</span>
                  </span>
                  <span className="text-white font-bold">{data.trade_plan.sl_pool_name}</span>
                </div>
                {data.trade_plan.sl_hunt_rationale && (
                  <p className="text-[9px] text-slate-300 leading-snug">
                    {data.trade_plan.sl_hunt_rationale}
                  </p>
                )}
              </div>
            )}

            <div className="space-y-1.5 text-[10px]">
              <div className="flex justify-between py-1 border-b border-[#1f2636]">
                <span className="text-slate-400">Tipe & Harga Entry</span>
                <span className="font-bold text-white flex items-center space-x-1.5">
                  <span className="px-1.5 py-0.2 rounded bg-indigo-950 text-indigo-300 border border-indigo-800 text-[9px]">
                    {data.trade_plan.entry_type}
                  </span>
                  <span>${data.trade_plan.entry_price.toLocaleString()}</span>
                </span>
              </div>

              {data.trade_plan.sl_pool_distance_pct !== undefined && data.trade_plan.sl_pool_distance_pct !== 0 && (
                <div className="flex justify-between py-1 border-b border-[#1f2636]">
                  <span className="text-slate-400">Jarak dari Harga Saat Ini</span>
                  <span className={`font-bold ${data.trade_plan.sl_pool_distance_pct > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                    {data.trade_plan.sl_pool_distance_pct > 0 ? '+' : ''}{data.trade_plan.sl_pool_distance_pct}%
                  </span>
                </div>
              )}

              <div className="flex justify-between py-1 border-b border-[#1f2636]">
                <span className="text-rose-400 font-bold">Invalidation Stop Loss</span>
                <span className="font-bold text-rose-400">
                  ${data.trade_plan.invalidation_stop_loss.toLocaleString()}
                </span>
              </div>

              <div className="flex justify-between py-1 border-b border-[#1f2636]">
                <span className="text-emerald-400">Target TP 1 (1.8R - Likuiditas Awal)</span>
                <span className="font-bold text-emerald-400">
                  ${data.trade_plan.tp1_price.toLocaleString()}
                </span>
              </div>

              <div className="flex justify-between py-1 border-b border-[#1f2636]">
                <span className="text-emerald-400">Target TP 2 (Opposite SL Pool)</span>
                <span className="font-bold text-emerald-400">
                  ${data.trade_plan.tp2_price.toLocaleString()}
                </span>
              </div>

              <div className="flex justify-between py-1 border-b border-[#1f2636]">
                <span className="text-emerald-400">Target TP 3 (Runner Ekstrem)</span>
                <span className="font-bold text-emerald-400">
                  ${data.trade_plan.tp3_price.toLocaleString()}
                </span>
              </div>

              <div className="flex justify-between py-1 text-slate-400">
                <span>Rekomendasi Sizing</span>
                <span className="font-bold text-white">
                  Risk {data.trade_plan.suggested_risk_pct}% · Lev {data.trade_plan.recommended_leverage}x
                </span>
              </div>
            </div>

            {onOpenTrade && (
              <button
                type="button"
                onClick={() => onOpenTrade(data.trade_plan!)}
                className="w-full mt-2 py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-black font-black text-xs flex items-center justify-center space-x-2 transition-all shadow-lg shadow-emerald-950/40"
              >
                <Zap className="w-3.5 h-3.5 fill-current" />
                <span>Buka Limit Order di Titik SL Hunt</span>
              </button>
            )}
          </div>
        ) : (
          <div className="bg-[#111622] border border-[#21262d] rounded-xl p-3 space-y-2">
            <div className="flex items-center space-x-1.5 text-amber-400 font-bold text-[11px]">
              <Target className="w-3.5 h-3.5 text-amber-400" />
              <span>Menunggu Kluster Stop Loss Tersapu</span>
            </div>
            <p className="text-[10px] text-slate-300 leading-relaxed">
              Sistem berdisiplin tinggi: <strong>tidak memberikan entry di harga sekarang</strong> untuk menghindari jebakan volatilitas. Entry institusi disiapkan ketika harga mendekati kluster likuiditas Stop Loss ritel ({data.liquidity.nearest_ssl?.price ? `$${data.liquidity.nearest_ssl.price.toLocaleString()} (SSL)` : 'Long SL Cascade'} di bawah atau {data.liquidity.nearest_bsl?.price ? `$${data.liquidity.nearest_bsl.price.toLocaleString()} (BSL)` : 'Short SL Magnet'} di atas).
            </p>
          </div>
        )}

        {/* 4. 7 ENGINES DEEP METRICS */}
        <div className="space-y-2">
          <div className="text-[11px] font-bold text-slate-300 flex items-center space-x-1.5">
            <Layers className="w-3.5 h-3.5 text-amber-400" />
            <span>7 Institutional Engines Data</span>
          </div>

          {/* Engine Metrics Grid */}
          <div className="space-y-2 text-[9.5px]">
            {/* SMC & Structure */}
            <div className="bg-[#111622] p-2.5 rounded-lg border border-[#21262d] space-y-1">
              <div className="flex justify-between font-bold text-white">
                <span className="text-amber-400">🏛️ SMC Structure:</span>
                <span className="text-emerald-400">{data.smc.current_structure}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Swing High / Low:</span>
                <span className="text-white">${data.smc.swing_high} / ${data.smc.swing_low}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Zone Valuation:</span>
                <span className="font-bold text-amber-300">{data.smc.premium_discount}</span>
              </div>
            </div>

            {/* Liquidity BSL / SSL */}
            <div className="bg-[#111622] p-2.5 rounded-lg border border-[#21262d] space-y-1">
              <div className="flex justify-between font-bold text-white">
                <span className="text-cyan-400">💧 Liquidity Pools:</span>
                <span className="text-white">BSL & SSL Targets</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Nearest BSL (Above):</span>
                <span className="text-rose-400 font-bold">${data.liquidity.nearest_bsl?.price}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Nearest SSL (Below):</span>
                <span className="text-emerald-400 font-bold">${data.liquidity.nearest_ssl?.price}</span>
              </div>
            </div>

            {/* DOM Microstructure */}
            <div className="bg-[#111622] p-2.5 rounded-lg border border-[#21262d] space-y-1">
              <div className="flex justify-between font-bold text-white">
                <span className="text-indigo-400">📊 DOM & Microprice:</span>
                <span className="text-white">${data.dom.microprice}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Orderbook Imbalance (OBI):</span>
                <span className={`font-bold ${data.dom.obi > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {data.dom.obi}
                </span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Whale Bid Wall (Support):</span>
                <span className="text-cyan-400 font-bold">${data.dom.whale_bid_wall?.price}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Whale Ask Wall (Resist):</span>
                <span className="text-amber-400 font-bold">${data.dom.whale_ask_wall?.price}</span>
              </div>
            </div>

            {/* Footprint & CVD */}
            <div className="bg-[#111622] p-2.5 rounded-lg border border-[#21262d] space-y-1">
              <div className="flex justify-between font-bold text-white">
                <span className="text-rose-400">👣 Footprint & CVD:</span>
                <span className="text-white">{data.footprint.cvd_divergence}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Bar Volume Delta:</span>
                <span className={`font-bold ${data.footprint.current_bar_delta >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  ${data.footprint.current_bar_delta.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Taker Aggression:</span>
                <span className="text-white font-bold">{data.footprint.taker_aggression_ratio}% Buy</span>
              </div>
            </div>

            {/* Derivatives Telemetry */}
            <div className="bg-[#111622] p-2.5 rounded-lg border border-[#21262d] space-y-1">
              <div className="flex justify-between font-bold text-white">
                <span className="text-purple-400">⚡ Derivatives:</span>
                <span className="text-white">Funding: {data.derivatives.funding_rate}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Top Trader Long %:</span>
                <span className="text-emerald-400 font-bold">{data.derivatives.top_trader_long_pct}%</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>Global Retail Long %:</span>
                <span className="text-amber-400 font-bold">{data.derivatives.global_account_long_pct}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
