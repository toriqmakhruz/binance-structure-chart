import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Newspaper,
  RefreshCw,
  ExternalLink,
  TrendingUp,
  TrendingDown,
  Flame,
  Calendar,
  Search,
  Maximize2,
  ArrowLeft,
  Globe,
  Gauge,
  Activity,
  ShieldAlert,
  Clock,
  CheckCircle2,
  XCircle,
  BarChart2
} from 'lucide-react'
import { fetchNewsHub } from '../../services/api'
import { NewsHubResponse, NewsArticle, MacroEvent } from '../../types/news'

interface NewsWorkspaceProps {
  mode: 'full' | 'sidebar'
  activeSymbol?: string
  onSelectSymbol?: (symbol: string) => void
  onBackToChart?: () => void
  onExpandFull?: () => void
}

type CategoryFilter = 'all' | 'HIGH' | 'MACRO' | 'ONCHAIN_WHALE' | 'REGULATION' | 'PAIR'
type SentimentFilter = 'all' | 'BULLISH' | 'BEARISH'
type SidebarView = 'news' | 'macro'

function formatCompactUsd(val: number): string {
  if (!val || val <= 0) return '-'
  if (val >= 1e12) return `$${(val / 1e12).toFixed(2)}T`
  if (val >= 1e9) return `$${(val / 1e9).toFixed(1)}B`
  if (val >= 1e6) return `$${(val / 1e6).toFixed(1)}M`
  return `$${val.toLocaleString()}`
}

function formatTimeAgo(tsSec: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - tsSec)
  if (diff < 60) return 'Baru saja'
  if (diff < 3600) return `${Math.floor(diff / 60)}m lalu`
  if (diff < 86400) return `${Math.floor(diff / 3600)}j lalu`
  return `${Math.floor(diff / 86400)}h lalu`
}

function formatMacroTime(tsSec: number): string {
  try {
    const d = new Date(tsSec * 1000)
    return d.toLocaleString('id-ID', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch {
    return '-'
  }
}

function formatCountdown(secondsUntil: number): string {
  if (secondsUntil <= 0) return 'Sudah Rilis'
  const hrs = Math.floor(secondsUntil / 3600)
  const mins = Math.floor((secondsUntil % 3600) / 60)
  if (hrs >= 24) {
    const days = Math.floor(hrs / 24)
    return `Dalam ${days}h ${hrs % 24}j`
  }
  if (hrs > 0) return `Dalam ${hrs}j ${mins}m`
  return `Dalam ${mins}m`
}

export const NewsWorkspace: React.FC<NewsWorkspaceProps> = ({
  mode,
  activeSymbol = 'BTCUSDT',
  onSelectSymbol,
  onBackToChart,
  onExpandFull
}) => {
  const [hub, setHub] = useState<NewsHubResponse | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [refreshing, setRefreshing] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)

  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')
  const [sentimentFilter, setSentimentFilter] = useState<SentimentFilter>('all')
  const [sourceFilter, setSourceFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState<string>('')
  const [sidebarView, setSidebarView] = useState<SidebarView>('news')

  const baseAsset = useMemo(
    () => (activeSymbol || 'BTCUSDT').toUpperCase().replace(/(USDT|USDC|BUSD)$/i, ''),
    [activeSymbol]
  )

  const loadData = useCallback(async (forceRefresh = false) => {
    try {
      if (forceRefresh) setRefreshing(true)
      const data = await fetchNewsHub({ limit: 150, refresh: forceRefresh })
      setHub(data)
      setError(null)
    } catch (err: any) {
      setError(err?.message || 'Gagal memuat berita pasar.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    loadData(false)
    const timer = setInterval(() => loadData(false), 75000)
    return () => clearInterval(timer)
  }, [loadData])

  const filteredArticles = useMemo(() => {
    if (!hub?.articles) return []
    return hub.articles.filter((art) => {
      if (categoryFilter === 'HIGH' && art.impact !== 'HIGH') return false
      if (categoryFilter === 'MACRO' && art.category !== 'MACRO') return false
      if (categoryFilter === 'ONCHAIN_WHALE' && art.category !== 'ONCHAIN_WHALE') return false
      if (categoryFilter === 'REGULATION' && art.category !== 'REGULATION') return false
      if (categoryFilter === 'PAIR') {
        const matchCoin = art.coins.includes(baseAsset) || art.title.toUpperCase().includes(baseAsset)
        if (!matchCoin) return false
      }
      if (sentimentFilter !== 'all' && art.sentiment !== sentimentFilter) return false
      if (sourceFilter !== 'all' && art.source !== sourceFilter) return false
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase()
        const hay = `${art.title} ${art.summary} ${art.source} ${art.coins.join(' ')}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [hub, categoryFilter, sentimentFilter, sourceFilter, searchQuery, baseAsset])

  const fearGreedColor = (val: number) => {
    if (val <= 25) return 'text-rose-400'
    if (val <= 45) return 'text-amber-400'
    if (val <= 55) return 'text-slate-200'
    if (val <= 75) return 'text-emerald-400'
    return 'text-green-400'
  }

  const renderSentimentBadge = (art: NewsArticle) => {
    if (art.sentiment === 'BULLISH') {
      return (
        <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded bg-emerald-950/70 text-emerald-300 border border-emerald-700/50 text-[9.5px] font-bold">
          <TrendingUp className="w-2.5 h-2.5" />
          <span>BULLISH</span>
        </span>
      )
    }
    if (art.sentiment === 'BEARISH') {
      return (
        <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded bg-rose-950/70 text-rose-300 border border-rose-700/50 text-[9.5px] font-bold">
          <TrendingDown className="w-2.5 h-2.5" />
          <span>BEARISH</span>
        </span>
      )
    }
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-slate-800/80 text-slate-300 border border-slate-700 text-[9.5px] font-semibold">
        NETRAL
      </span>
    )
  }

  const renderImpactBadge = (impact: string) => {
    if (impact === 'HIGH') {
      return (
        <span className="inline-flex items-center space-x-1 px-1.5 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/50 text-[9.5px] font-extrabold animate-pulse">
          <Flame className="w-2.5 h-2.5 text-rose-400" />
          <span>HIGH</span>
        </span>
      )
    }
    if (impact === 'MEDIUM') {
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-950/60 text-amber-300 border border-amber-700/50 text-[9.5px] font-bold">
          MED
        </span>
      )
    }
    return null
  }

  // ==================== COMPACT SIDEBAR MODE ====================
  if (mode === 'sidebar') {
    return (
      <div className="flex flex-col h-full bg-[#0d1117] text-slate-200 select-none">
        {/* Top Action Header */}
        <div className="p-2.5 border-b border-[#21262d] bg-[#111620] space-y-2 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-1.5">
              <Newspaper className="w-4 h-4 text-[#f0b90b]" />
              <span className="font-bold text-white text-xs">News & Sentimen Live</span>
              {hub && (
                <span className="px-1.5 py-0.2 rounded bg-emerald-950/60 text-emerald-300 border border-emerald-800/50 text-[9px] font-mono">
                  {hub.active_sources_count} Feed
                </span>
              )}
            </div>
            <div className="flex items-center space-x-1">
              <button
                type="button"
                onClick={() => loadData(true)}
                disabled={refreshing}
                className="p-1 rounded bg-[#18202d] hover:bg-[#222d3f] text-slate-300 hover:text-white border border-[#2b3548] transition-colors"
                title="Refresh berita terbaru"
              >
                <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin text-[#f0b90b]' : ''}`} />
              </button>
              {onExpandFull && (
                <button
                  type="button"
                  onClick={onExpandFull}
                  className="flex items-center space-x-1 px-2 py-1 rounded bg-[#f0b90b]/15 hover:bg-[#f0b90b]/25 text-[#f0b90b] border border-[#f0b90b]/40 text-[10px] font-bold transition-colors"
                  title="Buka Halaman News Layar Penuh"
                >
                  <Maximize2 className="w-3 h-3" />
                  <span>Penuh</span>
                </button>
              )}
            </div>
          </div>

          {/* Mini Telemetry Strip */}
          {hub && (
            <div className="grid grid-cols-3 gap-1.5 text-[10px]">
              <div className="bg-[#0b0e14] border border-[#21262d] rounded p-1.5">
                <div className="text-[9px] text-slate-400">Fear &amp; Greed</div>
                <div className={`font-mono font-bold ${fearGreedColor(hub.fear_greed.value)}`}>
                  {hub.fear_greed.value} <span className="text-[8.5px] font-normal">({hub.fear_greed.classification})</span>
                </div>
              </div>
              <div className="bg-[#0b0e14] border border-[#21262d] rounded p-1.5">
                <div className="text-[9px] text-slate-400">Sentimen News</div>
                <div
                  className={`font-mono font-bold ${
                    hub.news_sentiment.bias === 'BULLISH'
                      ? 'text-emerald-400'
                      : hub.news_sentiment.bias === 'BEARISH'
                      ? 'text-rose-400'
                      : 'text-slate-300'
                  }`}
                >
                  {hub.news_sentiment.score}% {hub.news_sentiment.bias === 'BULLISH' ? 'Bull' : hub.news_sentiment.bias === 'BEARISH' ? 'Bear' : 'Netral'}
                </div>
              </div>
              <div className="bg-[#0b0e14] border border-[#21262d] rounded p-1.5">
                <div className="text-[9px] text-slate-400">BTC.D / MCap</div>
                <div className="font-mono font-bold text-amber-300">
                  {hub.global_market.btc_dominance_pct}% <span className="text-[8.5px] text-slate-400">{formatCompactUsd(hub.global_market.total_market_cap_usd)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Switcher: Berita Live vs Kalender Makro */}
          <div className="flex items-center space-x-1 bg-[#0b0e14] p-0.5 rounded-lg border border-[#21262d] text-[10.5px]">
            <button
              type="button"
              onClick={() => setSidebarView('news')}
              className={`flex-1 py-1 rounded-md font-bold transition-colors ${
                sidebarView === 'news' ? 'bg-[#1f293d] text-[#f0b90b]' : 'text-slate-400 hover:text-white'
              }`}
            >
              Berita ({filteredArticles.length})
            </button>
            <button
              type="button"
              onClick={() => setSidebarView('macro')}
              className={`flex-1 py-1 rounded-md font-bold transition-colors ${
                sidebarView === 'macro' ? 'bg-[#1f293d] text-amber-300' : 'text-slate-400 hover:text-white'
              }`}
            >
              Kalender Makro ({hub?.macro_calendar?.length || 0})
            </button>
          </div>

          {sidebarView === 'news' && (
            <div className="flex items-center gap-1 overflow-x-auto pb-0.5">
              {(
                [
                  { id: 'all', label: 'Semua' },
                  { id: 'HIGH', label: '⚡ High' },
                  { id: 'PAIR', label: `🎯 ${baseAsset}` },
                  { id: 'MACRO', label: '🏛️ Makro' }
                ] as { id: CategoryFilter; label: string }[]
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setCategoryFilter(t.id)}
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold whitespace-nowrap border transition-colors ${
                    categoryFilter === t.id
                      ? 'bg-[#f0b90b]/20 text-[#f0b90b] border-[#f0b90b]/50'
                      : 'bg-[#131924] text-slate-400 border-[#21262d] hover:text-white'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Content Scroll */}
        <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-slate-400 text-xs space-y-2">
              <RefreshCw className="w-5 h-5 animate-spin text-[#f0b90b]" />
              <span>Menarik berita dari 14 media global...</span>
            </div>
          ) : error ? (
            <div className="p-3 rounded-lg bg-rose-950/30 border border-rose-800/50 text-rose-300 text-xs">
              {error}
            </div>
          ) : sidebarView === 'macro' ? (
            <div className="space-y-2">
              {(hub?.macro_calendar || []).map((ev) => (
                <div
                  key={ev.id}
                  className={`p-2 rounded-lg border text-xs ${
                    ev.impact === 'HIGH'
                      ? 'bg-rose-950/15 border-rose-800/40'
                      : 'bg-[#111620] border-[#21262d]'
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px] mb-1">
                    <span className="font-bold text-amber-300">{ev.country} • {ev.impact}</span>
                    <span className={ev.is_released ? 'text-slate-400' : 'text-emerald-400 font-bold'}>
                      {formatCountdown(ev.seconds_until)}
                    </span>
                  </div>
                  <div className="font-semibold text-white text-[11px] leading-snug mb-1">{ev.title}</div>
                  <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                    <span>{formatMacroTime(ev.timestamp)}</span>
                    <span>
                      F: <strong className="text-slate-200">{ev.forecast}</strong> | P: {ev.previous}
                      {ev.actual ? ` | A: ${ev.actual}` : ''}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : filteredArticles.length === 0 ? (
            <div className="text-center py-10 text-slate-400 text-xs">
              Tidak ada berita yang cocok dengan filter ini.
            </div>
          ) : (
            filteredArticles.slice(0, 45).map((art) => (
              <div
                key={art.id}
                className="p-2.5 rounded-lg bg-[#111620] hover:bg-[#161c28] border border-[#21262d] hover:border-slate-700 transition-colors space-y-1.5"
              >
                <div className="flex items-center justify-between gap-1 flex-wrap">
                  <div className="flex items-center space-x-1.5">
                    <span className="text-[10px] font-bold text-amber-300">{art.source}</span>
                    <span className="text-[9.5px] text-slate-500">• {formatTimeAgo(art.published_at)}</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    {renderImpactBadge(art.impact)}
                    {renderSentimentBadge(art)}
                  </div>
                </div>
                <a
                  href={art.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-[11.5px] font-semibold text-slate-100 hover:text-[#f0b90b] leading-snug transition-colors"
                >
                  {art.title}
                </a>
                <div className="flex items-center justify-between pt-0.5">
                  <div className="flex items-center gap-1 flex-wrap">
                    {art.coins.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => onSelectSymbol && !['USDT', 'USDC'].includes(c) && onSelectSymbol(`${c}USDT`)}
                        className="px-1.5 py-0.2 rounded bg-[#1a2232] hover:bg-[#253047] text-cyan-300 text-[9px] font-mono font-bold border border-cyan-900/40"
                        title={`Buka chart ${c}USDT`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                  <a
                    href={art.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] text-slate-400 hover:text-white flex items-center space-x-0.5"
                  >
                    <span>Baca</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    )
  }

  // ==================== FULL PAGE TERMINAL MODE ====================
  return (
    <div className="flex flex-col w-full h-full bg-[#0b0e14] text-slate-200 overflow-hidden select-none">
      {/* Top Header Bar */}
      <header className="px-4 py-3 bg-[#111620] border-b border-[#21262d] flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center space-x-3">
          {onBackToChart && (
            <button
              type="button"
              onClick={onBackToChart}
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-[#18202d] hover:bg-[#222d3f] text-slate-200 border border-[#2b3548] text-xs font-bold transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5 text-[#f0b90b]" />
              <span>Kembali ke Chart</span>
            </button>
          )}
          <div className="flex items-center space-x-2">
            <div className="p-2 rounded-lg bg-[#f0b90b]/15 border border-[#f0b90b]/30">
              <Newspaper className="w-5 h-5 text-[#f0b90b]" />
            </div>
            <div>
              <h1 className="text-sm sm:text-base font-extrabold text-white tracking-tight flex items-center space-x-2">
                <span>Crypto News &amp; Global Macro Sentiment Center</span>
                <span className="px-2 py-0.5 rounded-full bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 text-[10px] font-mono">
                  LIVE REAL-TIME
                </span>
              </h1>
              <p className="text-[11px] text-slate-400">
                Agregasi {hub?.active_sources_count || 14} sumber media kripto, rilis The Fed, Fear &amp; Greed Index, dan Kalender Ekonomi Global.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center space-x-2">
          {hub && (
            <span className="hidden sm:inline text-[11px] text-slate-400 font-mono">
              Update: {formatTimeAgo(hub.updated_at)}
            </span>
          )}
          <button
            type="button"
            onClick={() => loadData(true)}
            disabled={refreshing}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-[#f0b90b] hover:bg-[#e5b009] text-slate-950 text-xs font-extrabold transition-colors disabled:opacity-60"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            <span>{refreshing ? 'Menyinkronkan...' : 'Refresh Sumber'}</span>
          </button>
        </div>
      </header>

      {/* Main Scrollable Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* 1. Top 4 Telemetry Cards */}
        {hub && (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {/* Card 1: Fear & Greed Index */}
            <div className="p-3.5 rounded-xl bg-[#111620] border border-[#21262d] flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
                <span className="font-semibold flex items-center space-x-1.5">
                  <Gauge className="w-4 h-4 text-amber-400" />
                  <span>Crypto Fear &amp; Greed Index</span>
                </span>
                <span className="text-[10px] font-mono text-slate-500">Alternative.me</span>
              </div>
              <div className="flex items-baseline justify-between">
                <div className="flex items-baseline space-x-2">
                  <span className={`text-2xl font-mono font-black ${fearGreedColor(hub.fear_greed.value)}`}>
                    {hub.fear_greed.value}
                  </span>
                  <span className={`text-xs font-bold ${fearGreedColor(hub.fear_greed.value)}`}>
                    {hub.fear_greed.classification}
                  </span>
                </div>
                <span className="text-[11px] font-mono text-slate-400">
                  Kemarin: {hub.fear_greed.yesterday_value} ({hub.fear_greed.delta >= 0 ? `+${hub.fear_greed.delta}` : hub.fear_greed.delta})
                </span>
              </div>
              <div className="w-full h-1.5 bg-[#1b2230] rounded-full overflow-hidden mt-2">
                <div
                  className="h-full bg-gradient-to-r from-rose-500 via-amber-400 to-emerald-500 transition-all"
                  style={{ width: `${Math.min(100, Math.max(4, hub.fear_greed.value))}%` }}
                />
              </div>
            </div>

            {/* Card 2: News Sentiment Pulse */}
            <div className="p-3.5 rounded-xl bg-[#111620] border border-[#21262d] flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
                <span className="font-semibold flex items-center space-x-1.5">
                  <Activity className="w-4 h-4 text-cyan-400" />
                  <span>Sentimen Headline Berita</span>
                </span>
                <span className="text-[10px] font-mono text-slate-500">100 Berita Terbaru</span>
              </div>
              <div className="flex items-baseline justify-between">
                <span
                  className={`text-2xl font-mono font-black ${
                    hub.news_sentiment.bias === 'BULLISH'
                      ? 'text-emerald-400'
                      : hub.news_sentiment.bias === 'BEARISH'
                      ? 'text-rose-400'
                      : 'text-slate-200'
                  }`}
                >
                  {hub.news_sentiment.score}% {hub.news_sentiment.bias}
                </span>
                <span className="text-[11px] font-mono text-slate-400">
                  🟢 {hub.news_sentiment.bullish_count} | 🔴 {hub.news_sentiment.bearish_count}
                </span>
              </div>
              <div className="w-full h-1.5 bg-rose-500/40 rounded-full overflow-hidden mt-2 flex">
                <div
                  className="h-full bg-emerald-500 transition-all"
                  style={{ width: `${hub.news_sentiment.score}%` }}
                />
              </div>
            </div>

            {/* Card 3: Global Crypto Market Cap & Dominance */}
            <div className="p-3.5 rounded-xl bg-[#111620] border border-[#21262d] flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
                <span className="font-semibold flex items-center space-x-1.5">
                  <Globe className="w-4 h-4 text-emerald-400" />
                  <span>Global Market Cap &amp; Dominasi</span>
                </span>
                <span className="text-[10px] font-mono text-slate-500">CoinGecko</span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-mono font-black text-white">
                  {formatCompactUsd(hub.global_market.total_market_cap_usd)}
                </span>
                <span
                  className={`text-xs font-mono font-bold ${
                    hub.global_market.market_cap_change_24h_pct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {hub.global_market.market_cap_change_24h_pct >= 0 ? '+' : ''}
                  {hub.global_market.market_cap_change_24h_pct}% (24j)
                </span>
              </div>
              <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 mt-1.5">
                <span>BTC.D: <strong className="text-amber-300">{hub.global_market.btc_dominance_pct}%</strong></span>
                <span>ETH.D: <strong className="text-cyan-300">{hub.global_market.eth_dominance_pct}%</strong></span>
                <span>Vol: <strong className="text-slate-200">{formatCompactUsd(hub.global_market.total_volume_24h_usd)}</strong></span>
              </div>
            </div>

            {/* Card 4: Next High Impact Macro Event */}
            <div className="p-3.5 rounded-xl bg-[#111620] border border-[#21262d] flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
                <span className="font-semibold flex items-center space-x-1.5">
                  <Calendar className="w-4 h-4 text-rose-400" />
                  <span>Agenda Makro Terdekat</span>
                </span>
                <span className="text-[10px] font-mono text-slate-500">ForexFactory</span>
              </div>
              {hub.next_high_impact_macro ? (
                <>
                  <div className="text-xs font-bold text-white truncate" title={hub.next_high_impact_macro.title}>
                    {hub.next_high_impact_macro.country}: {hub.next_high_impact_macro.title}
                  </div>
                  <div className="flex items-center justify-between text-[11px] font-mono mt-2">
                    <span className="text-amber-300 font-bold">
                      ⏳ {formatCountdown(hub.next_high_impact_macro.seconds_until)}
                    </span>
                    <span className="text-slate-400">
                      Est: <strong className="text-white">{hub.next_high_impact_macro.forecast}</strong>
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-xs font-bold text-slate-200">
                    {hub.macro_calendar.length > 0
                      ? `${hub.macro_calendar.length} Rilis Ekonomi Pekan Ini`
                      : 'Tidak ada jadwal High-Impact aktif'}
                  </div>
                  <div className="text-[11px] text-slate-400 mt-1">
                    Pantau daftar rilis CPI, FOMC &amp; NFP di kolom kanan.
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* 2. Smart Filter & Search Controls */}
        <div className="p-3 rounded-xl bg-[#111620] border border-[#21262d] flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'all', label: '🌐 Semua Berita' },
                { id: 'HIGH', label: '⚡ High Impact' },
                { id: 'MACRO', label: '🏛️ Makro & The Fed' },
                { id: 'PAIR', label: `🎯 Khusus ${baseAsset}` },
                { id: 'ONCHAIN_WHALE', label: '🐋 Whale & Likuidasi' },
                { id: 'REGULATION', label: '⚖️ Regulasi & ETF' }
              ] as { id: CategoryFilter; label: string }[]
            ).map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCategoryFilter(cat.id)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                  categoryFilter === cat.id
                    ? 'bg-[#f0b90b]/20 text-[#f0b90b] border-[#f0b90b]/60'
                    : 'bg-[#0b0e14] text-slate-300 border-[#21262d] hover:border-slate-600'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Sentiment Pills */}
            <div className="flex items-center bg-[#0b0e14] p-0.5 rounded-lg border border-[#21262d] text-xs">
              {(
                [
                  { id: 'all', label: 'Semua' },
                  { id: 'BULLISH', label: '🟢 Bullish' },
                  { id: 'BEARISH', label: '🔴 Bearish' }
                ] as { id: SentimentFilter; label: string }[]
              ).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSentimentFilter(s.id)}
                  className={`px-2.5 py-1 rounded-md font-bold transition-colors ${
                    sentimentFilter === s.id
                      ? 'bg-[#1f293d] text-white'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            {/* Source Selector */}
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              className="bg-[#0b0e14] border border-[#21262d] rounded-lg px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-[#f0b90b]"
            >
              <option value="all">Semua Sumber ({hub?.active_sources_count || 14})</option>
              {(hub?.sources_status || [])
                .filter((s) => s.ok)
                .map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name} ({s.count})
                  </option>
                ))}
            </select>

            {/* Search Input */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Cari BTC, ETF, FOMC, Hack..."
                className="bg-[#0b0e14] border border-[#21262d] rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#f0b90b] w-48 sm:w-56"
              />
            </div>
          </div>
        </div>

        {/* 3. Main 2-Column Content Area */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400 space-y-3">
            <RefreshCw className="w-8 h-8 animate-spin text-[#f0b90b]" />
            <span className="text-sm font-medium">Mengumpulkan berita terbaru dari 14 media kripto &amp; The Fed...</span>
          </div>
        ) : error ? (
          <div className="p-4 rounded-xl bg-rose-950/30 border border-rose-700/50 text-rose-200 text-sm">
            {error}
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            {/* Left 8 Columns: News Articles Stream */}
            <div className="lg:col-span-8 space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-400 px-1">
                <span>
                  Menampilkan <strong className="text-white">{filteredArticles.length}</strong> berita terbaru
                </span>
                {sourceFilter !== 'all' && (
                  <button
                    type="button"
                    onClick={() => setSourceFilter('all')}
                    className="text-[#f0b90b] hover:underline"
                  >
                    Reset Filter Sumber
                  </button>
                )}
              </div>

              {filteredArticles.length === 0 ? (
                <div className="p-10 rounded-xl bg-[#111620] border border-[#21262d] text-center text-slate-400 text-sm">
                  Tidak ada berita yang cocok dengan filter saat ini. Coba ubah kata kunci atau pilih kategori "Semua Berita".
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {filteredArticles.map((art) => (
                    <article
                      key={art.id}
                      className={`p-3.5 rounded-xl border transition-all flex flex-col justify-between space-y-2.5 ${
                        art.impact === 'HIGH'
                          ? 'bg-[#141720] border-rose-900/50 hover:border-rose-600/60'
                          : 'bg-[#111620] border-[#21262d] hover:border-slate-600'
                      }`}
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <div className="flex items-center space-x-1.5">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                art.source_tier === 'OFFICIAL'
                                  ? 'bg-indigo-950 text-indigo-300 border border-indigo-700/60'
                                  : art.source_tier === 'TIER_1'
                                  ? 'bg-amber-950/60 text-amber-300 border border-amber-800/50'
                                  : 'bg-slate-800 text-slate-300 border border-slate-700'
                              }`}
                            >
                              {art.source}
                            </span>
                            <span className="text-[10.5px] text-slate-400 flex items-center space-x-1">
                              <Clock className="w-2.5 h-2.5" />
                              <span>{formatTimeAgo(art.published_at)}</span>
                            </span>
                          </div>
                          <div className="flex items-center space-x-1">
                            {renderImpactBadge(art.impact)}
                            {renderSentimentBadge(art)}
                          </div>
                        </div>

                        <a
                          href={art.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block text-[13px] font-bold text-white hover:text-[#f0b90b] leading-snug transition-colors"
                        >
                          {art.title}
                        </a>

                        {art.summary && (
                          <p className="text-[11.5px] text-slate-400 leading-relaxed line-clamp-3">
                            {art.summary}
                          </p>
                        )}
                      </div>

                      <div className="pt-2 border-t border-[#1e2533] flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1 flex-wrap">
                          <span className="px-1.5 py-0.5 rounded bg-[#0b0e14] text-slate-400 text-[9.5px] font-mono border border-[#21262d]">
                            {art.category}
                          </span>
                          {art.coins.map((c) => (
                            <button
                              key={c}
                              type="button"
                              onClick={() => onSelectSymbol && !['USDT', 'USDC'].includes(c) && onSelectSymbol(`${c}USDT`)}
                              className="inline-flex items-center space-x-0.5 px-1.5 py-0.5 rounded bg-[#162032] hover:bg-[#1f2e47] text-cyan-300 text-[9.5px] font-mono font-bold border border-cyan-900/50 transition-colors"
                              title={`Buka Chart ${c}USDT`}
                            >
                              <BarChart2 className="w-2.5 h-2.5" />
                              <span>{c}</span>
                            </button>
                          ))}
                        </div>
                        <a
                          href={art.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center space-x-1 text-[11px] font-semibold text-[#f0b90b] hover:underline shrink-0"
                        >
                          <span>Sumber</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </div>

            {/* Right 4 Columns: Macro Economic Calendar + Trending Coins + Sources Health */}
            <div className="lg:col-span-4 space-y-4">
              {/* Panel A: Macro Economic Calendar */}
              <div className="rounded-xl bg-[#111620] border border-[#21262d] overflow-hidden">
                <div className="px-3.5 py-2.5 border-b border-[#21262d] bg-[#161c28] flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <Calendar className="w-4 h-4 text-rose-400" />
                    <span className="font-bold text-white text-xs">Kalender Ekonomi Makro (Pekan Ini)</span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-400">{hub?.macro_calendar?.length || 0} Event</span>
                </div>
                <div className="max-h-96 overflow-y-auto divide-y divide-[#1e2533]">
                  {(hub?.macro_calendar || []).length === 0 ? (
                    <div className="p-4 text-xs text-slate-400 text-center">
                      Belum ada jadwal makro minggu ini.
                    </div>
                  ) : (
                    (hub?.macro_calendar || []).map((ev: MacroEvent) => (
                      <div key={ev.id} className="p-3 hover:bg-[#161b26] transition-colors space-y-1">
                        <div className="flex items-center justify-between text-[10px]">
                          <div className="flex items-center space-x-1.5">
                            <span className="px-1.5 py-0.2 rounded bg-slate-800 text-white font-mono font-bold">
                              {ev.country}
                            </span>
                            <span
                              className={`px-1.5 py-0.2 rounded font-bold ${
                                ev.impact === 'HIGH'
                                  ? 'bg-rose-950/80 text-rose-300 border border-rose-700/60'
                                  : 'bg-amber-950/60 text-amber-300 border border-amber-800/50'
                              }`}
                            >
                              {ev.impact}
                            </span>
                          </div>
                          <span className={ev.is_released ? 'text-slate-500 font-mono' : 'text-emerald-400 font-mono font-bold'}>
                            {formatCountdown(ev.seconds_until)}
                          </span>
                        </div>
                        <div className="text-xs font-semibold text-white">{ev.title}</div>
                        <div className="flex items-center justify-between text-[10.5px] font-mono text-slate-400">
                          <span>{formatMacroTime(ev.timestamp)}</span>
                          <span>
                            Prev: <strong className="text-slate-300">{ev.previous}</strong> | Est:{' '}
                            <strong className="text-amber-300">{ev.forecast}</strong>
                            {ev.actual && (
                              <>
                                {' '}
                                | Act: <strong className="text-emerald-400">{ev.actual}</strong>
                              </>
                            )}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Panel B: Trending Coins in News */}
              {hub?.trending_coins && hub.trending_coins.length > 0 && (
                <div className="rounded-xl bg-[#111620] border border-[#21262d] p-3.5 space-y-2.5">
                  <div className="flex items-center space-x-2 text-xs font-bold text-white">
                    <ShieldAlert className="w-4 h-4 text-cyan-400" />
                    <span>Koin Paling Ramai Diberitakan</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {hub.trending_coins.map((tc) => (
                      <button
                        key={tc.coin}
                        type="button"
                        onClick={() => setSearchQuery(tc.coin)}
                        className="px-2.5 py-1 rounded-lg bg-[#0b0e14] hover:bg-[#1a2232] border border-[#21262d] text-xs font-mono flex items-center space-x-1.5 transition-colors"
                      >
                        <span className="font-bold text-cyan-300">{tc.coin}</span>
                        <span className="text-[10px] text-slate-400">({tc.mentions})</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Panel C: Live Sources Status */}
              {hub?.sources_status && (
                <div className="rounded-xl bg-[#111620] border border-[#21262d] p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between text-xs font-bold text-white">
                    <span>Status Sumber Berita Real-Time</span>
                    <span className="text-emerald-400 font-mono">
                      {hub.active_sources_count}/{hub.total_sources_count} Online
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 text-[10.5px]">
                    {hub.sources_status.map((src) => (
                      <button
                        key={src.name}
                        type="button"
                        onClick={() => src.ok && setSourceFilter(src.name === sourceFilter ? 'all' : src.name)}
                        className={`flex items-center justify-between px-2 py-1 rounded border text-left transition-colors ${
                          sourceFilter === src.name
                            ? 'bg-[#f0b90b]/20 border-[#f0b90b]/60 text-[#f0b90b]'
                            : 'bg-[#0b0e14] border-[#21262d] text-slate-300 hover:border-slate-600'
                        }`}
                      >
                        <span className="flex items-center space-x-1 truncate">
                          {src.ok ? (
                            <CheckCircle2 className="w-3 h-3 text-emerald-400 shrink-0" />
                          ) : (
                            <XCircle className="w-3 h-3 text-rose-500 shrink-0" />
                          )}
                          <span className="truncate">{src.name}</span>
                        </span>
                        <span className="text-[9.5px] font-mono text-slate-400 ml-1">{src.count}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
