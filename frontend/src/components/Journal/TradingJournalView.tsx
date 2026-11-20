import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  JournalTradeRecord,
  TradeExecutionSource,
  TradeOutcome,
  TradeDirection
} from '../../types/journal'
import {
  calculatePerformanceKpi,
  compareBotVsManual,
  getStrategyPerformanceBreakdown,
  analyzeBehavioralHealth,
  mergeHistoryIntoJournal,
  exportJournalToCsv
} from '../../utils/journalAnalytics'
import { fetchTradeHistory, TradeHistoryItem } from '../../services/api'
import { TradeAccountMode } from '../../types/analysis'
import { formatPrice } from '../../utils/formatters'
import {
  BookOpen,
  TrendingUp,
  TrendingDown,
  Bot,
  User,
  ShieldAlert,
  Award,
  Download,
  Plus,
  RefreshCw,
  Search,
  Filter,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Flame,
  FileSpreadsheet,
  Edit3,
  Trash2,
  X,
  Calendar,
  Zap,
  Info
} from 'lucide-react'

interface TradingJournalViewProps {
  market: 'spot' | 'futures'
  mode: TradeAccountMode
  currentSymbol?: string
  onClose?: () => void
  onSelectSymbol?: (symbol: string) => void
}

const STORAGE_KEY = 'cp_trade_journal_records'

export const TradingJournalView: React.FC<TradingJournalViewProps> = ({
  market,
  mode,
  currentSymbol,
  onClose,
  onSelectSymbol
}) => {
  // Load journal records from localStorage
  const [records, setRecords] = useState<JournalTradeRecord[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) return JSON.parse(raw)
    } catch {}
    return []
  })

  // Filter States
  const [searchQuery, setSearchQuery] = useState('')
  const [filterSource, setFilterSource] = useState<'all' | 'bot' | 'manual'>('all')
  const [filterOutcome, setFilterOutcome] = useState<'all' | 'win' | 'loss'>('all')
  const [filterStrategy, setFilterStrategy] = useState<string>('all')
  const [isSyncing, setIsSyncing] = useState(false)

  // Modals
  const [isAddModalOpen, setIsAddModalOpen] = useState(false)
  const [editingRecord, setEditingRecord] = useState<JournalTradeRecord | null>(null)

  // Form State for Manual Add
  const [manualForm, setManualForm] = useState({
    symbol: currentSymbol || 'BTCUSDT',
    direction: 'LONG' as TradeDirection,
    source: 'manual' as TradeExecutionSource,
    strategy: 'Smart Risk SMC',
    entryPrice: 60000,
    exitPrice: 61500,
    margin: 50,
    leverage: 10,
    netPnl: 15.0,
    disciplineRating: 9,
    emotionalState: 'calm' as 'calm' | 'fomo' | 'hesitant' | 'greedy' | 'fearful' | 'revenge',
    rationale: 'Retest pada 50% Mean Threshold Extreme Order Block setelah likuiditas IDM tersapu.',
    lessons: 'Disiplin menunggu mitigasi extreme menghasilkan R:R 1:3 yang solid.'
  })

  // Save to localStorage whenever records change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(records))
    } catch (e) {
      console.error('Failed to save journal records:', e)
    }
  }, [records])

  // Sync with server trade history
  const handleSyncWithServer = useCallback(async () => {
    setIsSyncing(true)
    try {
      let apiKey = ''
      let apiSecret = ''
      try {
        const creds = JSON.parse(localStorage.getItem('cp_trade_credentials') || '{}')
        apiKey = mode === 'live' ? creds.liveApiKey : creds.demoApiKey
        apiSecret = mode === 'live' ? creds.liveApiSecret : creds.demoApiSecret
      } catch {}

      const res = await fetchTradeHistory(market, mode, apiKey, apiSecret, undefined, 50)
      if (res.success && Array.isArray(res.trades)) {
        setRecords((prev) => mergeHistoryIntoJournal(res.trades, prev))
      }
    } catch (err) {
      console.error('Failed to sync history into journal:', err)
    } finally {
      setIsSyncing(false)
    }
  }, [market, mode])

  // Auto-sync on initial mount
  useEffect(() => {
    handleSyncWithServer()
  }, [handleSyncWithServer])

  // Filtered records
  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      if (searchQuery && !r.symbol.toUpperCase().includes(searchQuery.toUpperCase())) return false
      if (filterSource !== 'all' && r.source !== filterSource) return false
      if (filterOutcome === 'win' && r.outcome !== 'WIN') return false
      if (filterOutcome === 'loss' && r.outcome !== 'LOSS') return false
      if (filterStrategy !== 'all' && r.strategy !== filterStrategy) return false
      return true
    })
  }, [records, searchQuery, filterSource, filterOutcome, filterStrategy])

  // Analytics
  const kpi = useMemo(() => calculatePerformanceKpi(filteredRecords), [filteredRecords])
  const botVsManual = useMemo(() => compareBotVsManual(filteredRecords), [filteredRecords])
  const strategies = useMemo(() => getStrategyPerformanceBreakdown(filteredRecords), [filteredRecords])
  const behavioral = useMemo(() => analyzeBehavioralHealth(filteredRecords), [filteredRecords])

  // Export handlers
  const handleExportCsv = () => {
    const csvContent = exportJournalToCsv(filteredRecords)
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `trading_journal_${mode}_${new Date().toISOString().slice(0, 10)}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleExportJson = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(filteredRecords, null, 2))
    const link = document.createElement('a')
    link.href = dataStr
    link.setAttribute('download', `trading_journal_${mode}_${new Date().toISOString().slice(0, 10)}.json`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  // Add Manual Record Handler
  const handleSaveManualRecord = (e: React.FormEvent) => {
    e.preventDefault()
    const outcome: TradeOutcome = manualForm.netPnl > 0.001 ? 'WIN' : manualForm.netPnl < -0.001 ? 'LOSS' : 'BREAKEVEN'
    const newRecord: JournalTradeRecord = {
      id: `manual_${Date.now()}`,
      symbol: manualForm.symbol.toUpperCase(),
      market: 'futures',
      direction: manualForm.direction,
      source: manualForm.source,
      strategy: manualForm.strategy,
      mode: mode,
      entryTime: Date.now() - 3600000,
      exitTime: Date.now(),
      holdDurationMinutes: 60,
      entryPrice: manualForm.entryPrice,
      exitPrice: manualForm.exitPrice,
      quantity: (manualForm.margin * manualForm.leverage) / manualForm.entryPrice,
      margin: manualForm.margin,
      leverage: manualForm.leverage,
      grossPnl: manualForm.netPnl + 0.5,
      fee: 0.5,
      netPnl: manualForm.netPnl,
      roePct: (manualForm.netPnl / manualForm.margin) * 100,
      outcome: outcome,
      rationale: manualForm.rationale,
      lessons: manualForm.lessons,
      disciplineRating: manualForm.disciplineRating,
      emotionalState: manualForm.emotionalState,
      tags: ['manual-entry']
    }

    setRecords((prev) => [newRecord, ...prev])
    setIsAddModalOpen(false)
  }

  // Update Record Handler
  const handleUpdateRecord = (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingRecord) return

    setRecords((prev) =>
      prev.map((r) => (r.id === editingRecord.id ? editingRecord : r))
    )
    setEditingRecord(null)
  }

  const handleDeleteRecord = (id: string) => {
    if (confirm('Yakin ingin menghapus catatan trade ini dari jurnal?')) {
      setRecords((prev) => prev.filter((r) => r.id !== id))
    }
  }

  return (
    <div className="flex flex-col h-full w-full bg-[#0b0e14] text-slate-100 select-none overflow-y-auto font-sans">
      {/* 1. Header Toolbar */}
      <div className="shrink-0 flex flex-wrap items-center justify-between p-3 sm:p-4 bg-[#111620] border-b border-[#21262d] gap-2">
        <div className="flex items-center space-x-2.5">
          <div className="p-2 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-400">
            <BookOpen className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h2 className="text-sm sm:text-base font-bold text-white tracking-wide">
                Jurnal Trading & Analitik Performa
              </h2>
              <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold uppercase tracking-wider ${
                mode === 'live' ? 'bg-emerald-950/80 text-emerald-400 border border-emerald-700/60' : 'bg-amber-950/80 text-amber-300 border border-amber-700/60'
              }`}>
                {mode === 'live' ? 'Akun Live' : 'Demo Simulasi'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Evaluasi keunggulan strategi, pola perilaku emosi, dan komparasi Bot vs Manual secara objektif.
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center space-x-2">
          <button
            type="button"
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-[#f0b90b] hover:bg-[#d9a507] text-black font-bold text-xs shadow-md transition-all cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Catat Trade Manual</span>
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            title="Unduh Riwayat Jurnal (CSV Excel)"
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-lg bg-[#161b24] hover:bg-[#1f2634] border border-[#30363d] text-slate-300 hover:text-white text-xs font-semibold transition-all cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
            <span className="hidden sm:inline">CSV</span>
          </button>

          <button
            type="button"
            onClick={handleExportJson}
            title="Unduh Riwayat Jurnal (JSON)"
            className="flex items-center space-x-1 px-2 py-1.5 rounded-lg bg-[#161b24] hover:bg-[#1f2634] border border-[#30363d] text-slate-300 hover:text-white text-xs font-semibold transition-all cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-sky-400" />
            <span className="hidden sm:inline">JSON</span>
          </button>

          <button
            type="button"
            onClick={handleSyncWithServer}
            disabled={isSyncing}
            title="Sinkronkan dengan Riwayat Bursa Binance"
            className="p-1.5 rounded-lg bg-[#161b24] hover:bg-[#1f2634] border border-[#30363d] text-slate-300 hover:text-[#f0b90b] transition-all cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin text-[#f0b90b]' : ''}`} />
          </button>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-[#1f2634] text-slate-400 hover:text-white transition-all cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 p-3 sm:p-4 space-y-4">
        {/* 2. Executive KPI Cards Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
          {/* Card 1: Net PnL */}
          <div className="p-3 rounded-xl bg-[#121722] border border-[#212838] shadow-sm">
            <div className="flex items-center justify-between text-[11px] text-slate-400 font-semibold mb-1">
              <span>Net Realized PnL</span>
              <span className={`text-[9.5px] font-mono px-1 rounded ${
                kpi.profitFactor >= 2.0 ? 'bg-emerald-950/80 text-emerald-400' : 'bg-slate-800 text-slate-300'
              }`}>
                PF: {kpi.profitFactor.toFixed(2)}
              </span>
            </div>
            <div className={`text-base sm:text-lg font-black font-mono ${
              kpi.netRealizedPnl >= 0 ? 'text-[#00c087]' : 'text-[#f6465d]'
            }`}>
              {kpi.netRealizedPnl >= 0 ? '+' : ''}${kpi.netRealizedPnl.toFixed(2)}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              Gross Profit: <span className="text-emerald-400">+${kpi.totalGrossProfit}</span> · Fee: ${kpi.totalFee}
            </div>
          </div>

          {/* Card 2: Win Rate */}
          <div className="p-3 rounded-xl bg-[#121722] border border-[#212838] shadow-sm">
            <div className="flex items-center justify-between text-[11px] text-slate-400 font-semibold mb-1">
              <span>Win Rate %</span>
              <span className="text-[10px] font-mono text-slate-400">
                {kpi.winningTrades}W / {kpi.losingTrades}L
              </span>
            </div>
            <div className="flex items-baseline space-x-1.5">
              <span className="text-base sm:text-lg font-black font-mono text-white">
                {kpi.winRatePct.toFixed(1)}%
              </span>
              <span className="text-[10px] text-slate-500">
                ({kpi.totalTrades} trade)
              </span>
            </div>
            <div className="w-full bg-[#1b2230] h-1.5 rounded-full overflow-hidden mt-2">
              <div
                className="bg-emerald-400 h-full transition-all duration-500"
                style={{ width: `${Math.min(100, Math.max(0, kpi.winRatePct))}%` }}
              />
            </div>
          </div>

          {/* Card 3: Realized R:R */}
          <div className="p-3 rounded-xl bg-[#121722] border border-[#212838] shadow-sm">
            <div className="flex items-center justify-between text-[11px] text-slate-400 font-semibold mb-1">
              <span>Rasio Risk-to-Reward</span>
              <Award className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div className="text-base sm:text-lg font-black font-mono text-amber-400">
              1 : {kpi.avgRealizedRr.toFixed(2)}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              Avg Planned: 1:{kpi.avgPlannedRr.toFixed(1)} · Win/Loss: {kpi.winLossRatio.toFixed(2)}x
            </div>
          </div>

          {/* Card 4: Expectancy & Avg Win/Loss */}
          <div className="p-3 rounded-xl bg-[#121722] border border-[#212838] shadow-sm">
            <div className="flex items-center justify-between text-[11px] text-slate-400 font-semibold mb-1">
              <span>Ekspektasi Matematis</span>
              <TrendingUp className="w-3.5 h-3.5 text-cyan-400" />
            </div>
            <div className={`text-base sm:text-lg font-black font-mono ${
              kpi.expectancyUsd >= 0 ? 'text-cyan-400' : 'text-rose-400'
            }`}>
              {kpi.expectancyUsd >= 0 ? '+' : ''}${kpi.expectancyUsd.toFixed(2)}/trade
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              Avg Win: <span className="text-emerald-400">+${kpi.avgWinUsd}</span> · Avg Loss: <span className="text-rose-400">-${kpi.avgLossUsd}</span>
            </div>
          </div>

          {/* Card 5: Max Drawdown */}
          <div className="p-3 rounded-xl bg-[#121722] border border-[#212838] shadow-sm col-span-2 sm:col-span-1">
            <div className="flex items-center justify-between text-[11px] text-slate-400 font-semibold mb-1">
              <span>Max Drawdown</span>
              <ShieldAlert className="w-3.5 h-3.5 text-rose-400" />
            </div>
            <div className="text-base sm:text-lg font-black font-mono text-rose-400">
              -${kpi.maxDrawdownUsd.toFixed(2)}
            </div>
            <div className="text-[10px] text-slate-500 mt-0.5">
              Puncak Penurunan: {kpi.maxDrawdownPct.toFixed(1)}% dari Peak
            </div>
          </div>
        </div>

        {/* 3. Special Head-to-Head: BOT vs MANUAL COMPARISON (Permintaan Spesifik User) */}
        <div className="p-3.5 rounded-xl bg-gradient-to-r from-[#141b28] via-[#101520] to-[#141b28] border border-[#26334a] shadow-md">
          <div className="flex items-center justify-between pb-2 mb-3 border-b border-[#212d42]">
            <div className="flex items-center space-x-2">
              <Flame className="w-4 h-4 text-amber-400" />
              <span className="font-bold text-xs sm:text-sm text-white uppercase tracking-wider">
                Komparasi Performa: Eksekusi Bot Otomatis vs Trader Manual
              </span>
            </div>
            <span className="text-[10px] text-slate-400 font-mono">
              Objektif & Berbasis Riwayat Transaksi
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            {/* Box Bot */}
            <div className="p-3 rounded-lg bg-[#0e131d]/90 border border-sky-800/40">
              <div className="flex items-center justify-between mb-2">
                <span className="flex items-center space-x-1.5 font-bold text-xs text-sky-400">
                  <Bot className="w-4 h-4" />
                  <span>EKSEKUSI BOT OTOMATIS</span>
                </span>
                <span className="text-[10px] font-mono text-slate-400">
                  {botVsManual.bot.totalTrades} Transaksi
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2 text-center font-mono">
                <div className="p-1.5 bg-[#141c2a] rounded">
                  <div className="text-[9px] text-slate-400">Win Rate</div>
                  <div className="text-xs font-bold text-emerald-400">{botVsManual.bot.winRatePct}%</div>
                </div>
                <div className="p-1.5 bg-[#141c2a] rounded">
                  <div className="text-[9px] text-slate-400">Net PnL</div>
                  <div className={`text-xs font-bold ${botVsManual.bot.netRealizedPnl >= 0 ? 'text-[#00c087]' : 'text-rose-400'}`}>
                    ${botVsManual.bot.netRealizedPnl}
                  </div>
                </div>
                <div className="p-1.5 bg-[#141c2a] rounded">
                  <div className="text-[9px] text-slate-400">Profit Factor</div>
                  <div className="text-xs font-bold text-amber-400">{botVsManual.bot.profitFactor}</div>
                </div>
                <div className="p-1.5 bg-[#141c2a] rounded">
                  <div className="text-[9px] text-slate-400">R:R Aktual</div>
                  <div className="text-xs font-bold text-white">1:{botVsManual.bot.avgRealizedRr}</div>
                </div>
              </div>
            </div>

            {/* Box Manual */}
            <div className="p-3 rounded-lg bg-[#0e131d]/90 border border-amber-800/40">
              <div className="flex items-center justify-between mb-2">
                <span className="flex items-center space-x-1.5 font-bold text-xs text-amber-400">
                  <User className="w-4 h-4" />
                  <span>EKSEKUSI MANUAL TRADER</span>
                </span>
                <span className="text-[10px] font-mono text-slate-400">
                  {botVsManual.manual.totalTrades} Transaksi
                </span>
              </div>
              <div className="grid grid-cols-4 gap-2 text-center font-mono">
                <div className="p-1.5 bg-[#1a1c18] rounded">
                  <div className="text-[9px] text-slate-400">Win Rate</div>
                  <div className="text-xs font-bold text-emerald-400">{botVsManual.manual.winRatePct}%</div>
                </div>
                <div className="p-1.5 bg-[#1a1c18] rounded">
                  <div className="text-[9px] text-slate-400">Net PnL</div>
                  <div className={`text-xs font-bold ${botVsManual.manual.netRealizedPnl >= 0 ? 'text-[#00c087]' : 'text-rose-400'}`}>
                    ${botVsManual.manual.netRealizedPnl}
                  </div>
                </div>
                <div className="p-1.5 bg-[#1a1c18] rounded">
                  <div className="text-[9px] text-slate-400">Profit Factor</div>
                  <div className="text-xs font-bold text-amber-400">{botVsManual.manual.profitFactor}</div>
                </div>
                <div className="p-1.5 bg-[#1a1c18] rounded">
                  <div className="text-[9px] text-slate-400">R:R Aktual</div>
                  <div className="text-xs font-bold text-white">1:{botVsManual.manual.avgRealizedRr}</div>
                </div>
              </div>
            </div>
          </div>

          {/* AI Verdict & Insight */}
          <div className="p-2.5 rounded-lg bg-[#0a0d14] border border-[#1f2838] flex items-start space-x-2">
            <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs space-y-0.5">
              <div className="font-semibold text-slate-200">{botVsManual.verdict}</div>
              <div className="text-slate-400 text-[11px]">{botVsManual.recommendation}</div>
            </div>
          </div>
        </div>

        {/* 4. Behavioral Health & Discipline Monitor */}
        <div className="p-3.5 rounded-xl bg-[#121722] border border-[#212838] shadow-sm">
          <div className="flex items-center justify-between pb-2 mb-2 border-b border-[#1f2638]">
            <div className="flex items-center space-x-2 text-xs font-bold text-white uppercase tracking-wider">
              <Award className="w-4 h-4 text-emerald-400" />
              <span>Pemantauan Psikologi & Kedisiplinan Aturan</span>
            </div>
            <div className="flex items-center space-x-2">
              <span className="text-[11px] text-slate-400">Skor Kepatuhan:</span>
              <span className={`text-xs font-black font-mono px-2 py-0.5 rounded border ${
                behavioral.disciplineScore >= 80
                  ? 'bg-emerald-950 text-emerald-400 border-emerald-700/60'
                  : behavioral.disciplineScore >= 60
                  ? 'bg-amber-950 text-amber-400 border-amber-700/60'
                  : 'bg-rose-950 text-rose-400 border-rose-700/60'
              }`}>
                {behavioral.disciplineScore}%
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-2 text-xs font-mono">
            <div className="p-2 rounded bg-[#0b0e14] border border-[#1a2232] flex items-center justify-between">
              <span className="text-slate-400 text-[11px]">Revenge Trades</span>
              <span className={`font-bold ${behavioral.revengeTradesCount === 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {behavioral.revengeTradesCount} kali
              </span>
            </div>
            <div className="p-2 rounded bg-[#0b0e14] border border-[#1a2232] flex items-center justify-between">
              <span className="text-slate-400 text-[11px]">Tilt / Size Escalation</span>
              <span className={`font-bold ${behavioral.tiltTradesCount === 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {behavioral.tiltTradesCount} kali
              </span>
            </div>
            <div className="p-2 rounded bg-[#0b0e14] border border-[#1a2232] flex items-center justify-between">
              <span className="text-slate-400 text-[11px]">Hold Ratio (Win vs Loss)</span>
              <span className={`font-bold ${kpi.holdTimeRatio >= 1.0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {kpi.holdTimeRatio}x ({kpi.avgHoldWinMinutes}m vs {kpi.avgHoldLossMinutes}m)
              </span>
            </div>
          </div>

          {/* Behavioral Notes */}
          <div className="space-y-1">
            {behavioral.summaryNotes.map((note, idx) => (
              <div key={idx} className="text-[11.5px] text-slate-300 flex items-start space-x-1.5">
                <span className="text-slate-500">•</span>
                <span>{note}</span>
              </div>
            ))}
          </div>
        </div>

        {/* 5. Strategy Attribution Matrix */}
        {strategies.length > 0 && (
          <div className="p-3.5 rounded-xl bg-[#121722] border border-[#212838] shadow-sm">
            <div className="text-xs font-bold text-white uppercase tracking-wider mb-2 flex items-center space-x-2">
              <Zap className="w-4 h-4 text-[#f0b90b]" />
              <span>Performa Berdasarkan Modul & Strategi</span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2 font-mono">
              {strategies.map((st) => (
                <div key={st.strategyName} className="p-2.5 rounded-lg bg-[#0b0e14] border border-[#1f2838] text-xs">
                  <div className="font-bold text-white truncate text-[11.5px]">{st.strategyName}</div>
                  <div className="text-[10px] text-slate-400">{st.tradesCount} trades · WR {st.winRatePct}%</div>
                  <div className={`text-xs font-bold mt-1 ${st.netPnlUsd >= 0 ? 'text-[#00c087]' : 'text-rose-400'}`}>
                    ${st.netPnlUsd.toFixed(2)}
                  </div>
                  <div className="text-[9.5px] text-slate-500">PF: {st.profitFactor} · R:R 1:{st.avgRr}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 6. Filter & Search Controls */}
        <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl bg-[#121722] border border-[#212838]">
          <div className="flex flex-wrap items-center gap-2">
            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Cari simbol (e.g. BTC)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1 bg-[#0b0e14] border border-[#212838] rounded-lg text-xs text-white placeholder-slate-500 outline-none w-36 sm:w-44 focus:border-amber-400"
              />
            </div>

            {/* Filter Source: All / Bot / Manual */}
            <div className="flex items-center bg-[#0b0e14] rounded-lg p-0.5 border border-[#212838] text-xs">
              <button
                type="button"
                onClick={() => setFilterSource('all')}
                className={`px-2 py-0.5 rounded font-medium transition-all ${
                  filterSource === 'all' ? 'bg-[#252d3d] text-white font-bold' : 'text-slate-400 hover:text-white'
                }`}
              >
                Semua Sumber
              </button>
              <button
                type="button"
                onClick={() => setFilterSource('bot')}
                className={`px-2 py-0.5 rounded font-medium transition-all ${
                  filterSource === 'bot' ? 'bg-sky-950/80 text-sky-400 font-bold border border-sky-800/40' : 'text-slate-400 hover:text-white'
                }`}
              >
                🤖 Bot Saja
              </button>
              <button
                type="button"
                onClick={() => setFilterSource('manual')}
                className={`px-2 py-0.5 rounded font-medium transition-all ${
                  filterSource === 'manual' ? 'bg-amber-950/80 text-amber-400 font-bold border border-amber-800/40' : 'text-slate-400 hover:text-white'
                }`}
              >
                👤 Manual Saja
              </button>
            </div>

            {/* Filter Outcome: All / Win / Loss */}
            <div className="flex items-center bg-[#0b0e14] rounded-lg p-0.5 border border-[#212838] text-xs">
              <button
                type="button"
                onClick={() => setFilterOutcome('all')}
                className={`px-2 py-0.5 rounded font-medium transition-all ${
                  filterOutcome === 'all' ? 'bg-[#252d3d] text-white font-bold' : 'text-slate-400 hover:text-white'
                }`}
              >
                Semua Hasil
              </button>
              <button
                type="button"
                onClick={() => setFilterOutcome('win')}
                className={`px-2 py-0.5 rounded font-medium transition-all ${
                  filterOutcome === 'win' ? 'bg-emerald-950/80 text-emerald-400 font-bold border border-emerald-800/40' : 'text-slate-400 hover:text-white'
                }`}
              >
                🟢 Win
              </button>
              <button
                type="button"
                onClick={() => setFilterOutcome('loss')}
                className={`px-2 py-0.5 rounded font-medium transition-all ${
                  filterOutcome === 'loss' ? 'bg-rose-950/80 text-rose-400 font-bold border border-rose-800/40' : 'text-slate-400 hover:text-white'
                }`}
              >
                🔴 Loss
              </button>
            </div>
          </div>

          <div className="text-[11px] text-slate-400 font-mono">
            Menampilkan <span className="text-white font-bold">{filteredRecords.length}</span> dari {records.length} catatan
          </div>
        </div>

        {/* 7. Interactive Trade Records Table */}
        <div className="rounded-xl bg-[#121722] border border-[#212838] overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-[11px]">
              <thead className="bg-[#0e131d] border-b border-[#212838] text-slate-400 uppercase text-[10px] tracking-wider">
                <tr>
                  <th className="py-2.5 px-3">Waktu</th>
                  <th className="py-2.5 px-3">Koin / Pasang</th>
                  <th className="py-2.5 px-3">Sisi</th>
                  <th className="py-2.5 px-3">Sumber</th>
                  <th className="py-2.5 px-3">Strategi</th>
                  <th className="py-2.5 px-3 text-right">Entry / Exit</th>
                  <th className="py-2.5 px-3 text-right">Margin (Lev)</th>
                  <th className="py-2.5 px-3 text-right">Net PnL ($)</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                  <th className="py-2.5 px-3">Alasan / Catatan Refleksi</th>
                  <th className="py-2.5 px-3 text-center">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1b2230]">
                {filteredRecords.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-8 text-center text-slate-500 font-sans">
                      <BookOpen className="w-8 h-8 mx-auto text-slate-600 mb-2 opacity-50" />
                      <p className="font-semibold text-slate-300">Belum ada catatan jurnal transaksi.</p>
                      <p className="text-xs text-slate-500 mt-1">
                        Klik tombol <strong>"Catat Trade Manual"</strong> di atas atau lakukan trade via aplikasi untuk mengisi jurnal otomatis.
                      </p>
                    </td>
                  </tr>
                ) : (
                  filteredRecords.map((t) => (
                    <tr key={t.id} className="hover:bg-[#161d2b] transition-colors">
                      {/* Waktu */}
                      <td className="py-2.5 px-3 whitespace-nowrap text-slate-400">
                        {new Date(t.exitTime || t.entryTime).toLocaleString('id-ID', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </td>

                      {/* Simbol */}
                      <td className="py-2.5 px-3 font-bold text-white whitespace-nowrap">
                        {onSelectSymbol ? (
                          <button
                            type="button"
                            onClick={() => onSelectSymbol(t.symbol)}
                            className="hover:text-[#f0b90b] hover:underline cursor-pointer transition-colors text-left"
                            title={`Buka chart ${t.symbol}`}
                          >
                            {t.symbol}
                          </button>
                        ) : (
                          t.symbol
                        )}
                      </td>

                      {/* Sisi */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span className={`px-1.5 py-0.5 rounded font-black text-[10px] ${
                          t.direction === 'LONG'
                            ? 'bg-emerald-950/80 text-[#00c087] border border-emerald-800/40'
                            : 'bg-rose-950/80 text-[#f6465d] border border-rose-800/40'
                        }`}>
                          {t.direction}
                        </span>
                      </td>

                      {/* Sumber: Bot vs Manual */}
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span className={`flex items-center space-x-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          t.source === 'bot'
                            ? 'bg-sky-950/80 text-sky-400 border border-sky-800/40'
                            : 'bg-amber-950/80 text-amber-400 border border-amber-800/40'
                        }`}>
                          {t.source === 'bot' ? <Bot className="w-3 h-3" /> : <User className="w-3 h-3" />}
                          <span>{t.source.toUpperCase()}</span>
                        </span>
                      </td>

                      {/* Strategi */}
                      <td className="py-2.5 px-3 whitespace-nowrap text-slate-300 font-sans text-xs">
                        {t.strategy}
                      </td>

                      {/* Entry / Exit */}
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <div className="text-white">${formatPrice(t.entryPrice)}</div>
                        {t.exitPrice ? (
                          <div className="text-[10px] text-slate-400">Exit: ${formatPrice(t.exitPrice)}</div>
                        ) : null}
                      </td>

                      {/* Margin & Leverage */}
                      <td className="py-2.5 px-3 text-right whitespace-nowrap text-slate-300">
                        {t.margin ? `$${t.margin.toFixed(1)}` : '-'}
                        {t.leverage ? <span className="text-slate-500 text-[10px]"> ({t.leverage}x)</span> : null}
                      </td>

                      {/* Net PnL */}
                      <td className="py-2.5 px-3 text-right whitespace-nowrap font-bold">
                        <div className={t.netPnl >= 0 ? 'text-[#00c087]' : 'text-[#f6465d]'}>
                          {t.netPnl >= 0 ? '+' : ''}${t.netPnl.toFixed(2)}
                        </div>
                        {t.roePct !== undefined && (
                          <div className="text-[9.5px] text-slate-500">
                            {t.roePct >= 0 ? '+' : ''}{t.roePct.toFixed(1)}%
                          </div>
                        )}
                      </td>

                      {/* Status Outcome */}
                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                          t.outcome === 'WIN'
                            ? 'bg-emerald-950/90 text-emerald-400 border border-emerald-700/60'
                            : t.outcome === 'LOSS'
                            ? 'bg-rose-950/90 text-rose-400 border border-rose-700/60'
                            : 'bg-slate-800 text-slate-300 border border-slate-700'
                        }`}>
                          {t.outcome}
                        </span>
                      </td>

                      {/* Alasan & Pelajaran */}
                      <td className="py-2.5 px-3 max-w-xs font-sans text-xs text-slate-300">
                        <div className="truncate text-slate-200" title={t.rationale || '-'}>
                          {t.rationale || '-'}
                        </div>
                        {t.lessons && (
                          <div className="truncate text-[10.5px] text-amber-300/90 italic" title={t.lessons}>
                            💡 {t.lessons}
                          </div>
                        )}
                      </td>

                      {/* Aksi */}
                      <td className="py-2.5 px-3 text-center whitespace-nowrap">
                        <div className="flex items-center justify-center space-x-1.5">
                          <button
                            type="button"
                            onClick={() => setEditingRecord(t)}
                            title="Edit Catatan & Refleksi"
                            className="p-1 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteRecord(t.id)}
                            title="Hapus Catatan"
                            className="p-1 rounded hover:bg-rose-950/50 text-slate-400 hover:text-rose-400 transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* 8. MODAL: TAMBAH TRADE MANUAL */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-[#121722] border border-[#26334a] rounded-2xl w-full max-w-lg p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#212838]">
              <div className="flex items-center space-x-2">
                <Plus className="w-5 h-5 text-amber-400" />
                <h3 className="font-bold text-white text-sm sm:text-base">Catat Transaksi Manual Baru</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveManualRecord} className="space-y-3 font-sans text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Simbol Koin</label>
                  <input
                    type="text"
                    required
                    value={manualForm.symbol}
                    onChange={(e) => setManualForm({ ...manualForm, symbol: e.target.value.toUpperCase() })}
                    className="w-full bg-[#0b0e14] border border-[#212838] rounded-lg px-2.5 py-1.5 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Arah (Side)</label>
                  <select
                    value={manualForm.direction}
                    onChange={(e) => setManualForm({ ...manualForm, direction: e.target.value as TradeDirection })}
                    className="w-full bg-[#0b0e14] border border-[#212838] rounded-lg px-2.5 py-1.5 text-white font-mono font-bold"
                  >
                    <option value="LONG">LONG (Buy)</option>
                    <option value="SHORT">SHORT (Sell)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Sumber Eksekusi</label>
                  <select
                    value={manualForm.source}
                    onChange={(e) => setManualForm({ ...manualForm, source: e.target.value as TradeExecutionSource })}
                    className="w-full bg-[#0b0e14] border border-[#212838] rounded-lg px-2.5 py-1.5 text-white font-mono font-bold"
                  >
                    <option value="manual">👤 MANUAL TRADER</option>
                    <option value="bot">🤖 BOT OTOMATIS</option>
                  </select>
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Strategi / Modul</label>
                  <select
                    value={manualForm.strategy}
                    onChange={(e) => setManualForm({ ...manualForm, strategy: e.target.value })}
                    className="w-full bg-[#0b0e14] border border-[#212838] rounded-lg px-2.5 py-1.5 text-white font-mono font-bold"
                  >
                    <option value="Smart Risk SMC">Smart Risk SMC (Institutional)</option>
                    <option value="Craig 10x">Craig 10x Asymmetric</option>
                    <option value="Apex Quant">Apex Quant A++</option>
                    <option value="Pro Shield">Pro Shield</option>
                    <option value="Manual Discretionary">Manual Discretionary</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Harga Entry ($)</label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={manualForm.entryPrice}
                    onChange={(e) => setManualForm({ ...manualForm, entryPrice: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-[#0b0e14] border border-[#212838] rounded-lg px-2 py-1.5 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Harga Exit ($)</label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={manualForm.exitPrice}
                    onChange={(e) => setManualForm({ ...manualForm, exitPrice: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-[#0b0e14] border border-[#212838] rounded-lg px-2 py-1.5 text-white font-mono"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Net PnL ($)</label>
                  <input
                    type="number"
                    step="any"
                    required
                    value={manualForm.netPnl}
                    onChange={(e) => setManualForm({ ...manualForm, netPnl: parseFloat(e.target.value) || 0 })}
                    className="w-full bg-[#0b0e14] border border-[#212838] rounded-lg px-2 py-1.5 text-white font-mono font-bold"
                  />
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Alasan Masuk Posisi (Rationale)</label>
                <textarea
                  rows={2}
                  value={manualForm.rationale}
                  onChange={(e) => setManualForm({ ...manualForm, rationale: e.target.value })}
                  placeholder="Misal: Retest pada zona Demand Extreme OB setelah likuiditas tersapu..."
                  className="w-full bg-[#0b0e14] border border-[#212838] rounded-lg p-2 text-white"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Pelajaran / Refleksi (Lessons)</label>
                <textarea
                  rows={2}
                  value={manualForm.lessons}
                  onChange={(e) => setManualForm({ ...manualForm, lessons: e.target.value })}
                  placeholder="Misal: R:R terjaga dengan baik, tidak memotong posisi sebelum target TP..."
                  className="w-full bg-[#0b0e14] border border-[#212838] rounded-lg p-2 text-white"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-[#212838]">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-[#f0b90b] hover:bg-[#d9a507] text-black font-bold shadow-md cursor-pointer"
                >
                  Simpan Catatan
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* 9. MODAL: EDIT REFLEKSI / LESSONS */}
      {editingRecord && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-in fade-in duration-150">
          <div className="bg-[#121722] border border-[#26334a] rounded-2xl w-full max-w-lg p-5 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-[#212838]">
              <div className="flex items-center space-x-2">
                <Edit3 className="w-5 h-5 text-amber-400" />
                <h3 className="font-bold text-white text-sm sm:text-base">
                  Edit Catatan & Refleksi Jurnal ({editingRecord.symbol})
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setEditingRecord(null)}
                className="p-1 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUpdateRecord} className="space-y-3 font-sans text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-slate-400 block mb-1">Skor Kepatuhan Aturan (1 - 10)</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    value={editingRecord.disciplineRating || 9}
                    onChange={(e) => setEditingRecord({ ...editingRecord, disciplineRating: parseInt(e.target.value) || 5 })}
                    className="w-full bg-[#0b0e14] border border-[#212838] rounded-lg px-2.5 py-1.5 text-white font-mono font-bold"
                  />
                </div>
                <div>
                  <label className="text-slate-400 block mb-1">Kondisi Emosi Saat Trade</label>
                  <select
                    value={editingRecord.emotionalState || 'calm'}
                    onChange={(e) => setEditingRecord({ ...editingRecord, emotionalState: e.target.value as any })}
                    className="w-full bg-[#0b0e14] border border-[#212838] rounded-lg px-2.5 py-1.5 text-white font-mono"
                  >
                    <option value="calm">Tenang / Disiplin (Calm)</option>
                    <option value="fomo">FOMO / Tergesa</option>
                    <option value="hesitant">Ragu-ragu (Hesitant)</option>
                    <option value="greedy">Serakah (Greedy)</option>
                    <option value="fearful">Takut Rugi (Fearful)</option>
                    <option value="revenge">Revenge / Balas Dendam</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Alasan Masuk Posisi (Rationale)</label>
                <textarea
                  rows={2}
                  value={editingRecord.rationale || ''}
                  onChange={(e) => setEditingRecord({ ...editingRecord, rationale: e.target.value })}
                  className="w-full bg-[#0b0e14] border border-[#212838] rounded-lg p-2 text-white"
                />
              </div>

              <div>
                <label className="text-slate-400 block mb-1">Pelajaran / Catatan Refleksi (Lessons)</label>
                <textarea
                  rows={3}
                  value={editingRecord.lessons || ''}
                  onChange={(e) => setEditingRecord({ ...editingRecord, lessons: e.target.value })}
                  placeholder="Apa yang dipelajari dari trade ini? Apakah target TP/SL dipatuhi dengan baik?"
                  className="w-full bg-[#0b0e14] border border-[#212838] rounded-lg p-2 text-white"
                />
              </div>

              <div className="flex items-center justify-end space-x-2 pt-2 border-t border-[#212838]">
                <button
                  type="button"
                  onClick={() => setEditingRecord(null)}
                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-lg bg-[#f0b90b] hover:bg-[#d9a507] text-black font-bold shadow-md cursor-pointer"
                >
                  Perbarui Jurnal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
