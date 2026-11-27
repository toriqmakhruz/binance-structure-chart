import React, { useState, useEffect } from 'react'
import {
  Send,
  CheckCircle2,
  XCircle,
  RefreshCw,
  X,
  Eye,
  EyeOff,
  HelpCircle,
  Target,
  Flame,
  Radio,
  Newspaper
} from 'lucide-react'
import {
  fetchTelegramSettings,
  saveTelegramSettings,
  testTelegramNotification,
  TelegramSettings
} from '../../services/api'

interface TelegramAlertModalProps {
  isOpen: boolean
  onClose: () => void
  onSaved?: () => void
}

export const TelegramAlertModal: React.FC<TelegramAlertModalProps> = ({
  isOpen,
  onClose,
  onSaved
}) => {
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
  const [statusMsg, setStatusMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const [form, setForm] = useState<TelegramSettings>({
    enabled: false,
    bot_token: '',
    bot_token_masked: '',
    has_token: false,
    chat_id: '',
    min_rr: 1.5,
    market: 'futures',
    timeframe: '15m',
    scan_interval_seconds: 60,
    min_confluence_score: 50.0,
    notify_setup_radar: true,
    notify_smart_div: true,
    notify_squeeze: true,
    notify_news: true
  })

  useEffect(() => {
    if (isOpen) {
      setStatusMsg(null)
      setLoading(true)
      fetchTelegramSettings()
        .then((data) => {
          if (data) {
            setForm((prev) => ({
              ...prev,
              ...data,
              bot_token: data.bot_token_masked || ''
            }))
          }
        })
        .finally(() => setLoading(false))
    }
  }, [isOpen])

  if (!isOpen) return null

  const handleSave = async () => {
    setSaving(true)
    setStatusMsg(null)
    try {
      const payload: Partial<TelegramSettings> = {
        enabled: form.enabled,
        chat_id: form.chat_id.trim(),
        min_rr: form.min_rr,
        min_confluence_score: form.min_confluence_score,
        notify_setup_radar: form.notify_setup_radar ?? true,
        notify_smart_div: form.notify_smart_div ?? true,
        notify_squeeze: form.notify_squeeze ?? true,
        notify_news: form.notify_news ?? true
      }
      if (form.bot_token && !form.bot_token.includes('...')) {
        payload.bot_token = form.bot_token.trim()
      }

      const res = await saveTelegramSettings(payload)
      setStatusMsg({ type: 'success', text: res.message || 'Pengaturan notifikasi berhasil disimpan!' })
      if (res.data) {
        setForm((prev) => ({
          ...prev,
          ...res.data,
          bot_token: res.data?.bot_token_masked || ''
        }))
      }
      if (onSaved) onSaved()
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || 'Gagal menyimpan pengaturan' })
    } finally {
      setSaving(false)
    }
  }

  const handleTest = async () => {
    setTesting(true)
    setStatusMsg(null)
    try {
      const token = form.bot_token && !form.bot_token.includes('...') ? form.bot_token.trim() : undefined
      const res = await testTelegramNotification({
        bot_token: token,
        chat_id: form.chat_id.trim()
      })
      setStatusMsg({ type: 'success', text: res.message || 'Pesan uji coba berhasil terkirim ke Telegram Anda!' })
    } catch (err: any) {
      setStatusMsg({ type: 'error', text: err?.message || 'Gagal mengirim pesan uji coba' })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="relative w-full max-w-md bg-[#161b22] border border-[#30363d] rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden text-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#21262d] bg-[#0d1117]/80">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-[#0088cc]/15 text-[#0088cc] border border-[#0088cc]/30">
              <Send className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                Notifikasi Telegram Setup
                {form.enabled ? (
                  <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                    Aktif
                  </span>
                ) : (
                  <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-slate-500/15 text-slate-400 border border-slate-500/30">
                    Nonaktif
                  </span>
                )}
              </h3>
              <p className="text-xs text-slate-400">Info otomatis setiap ada setup baru muncul di tab Radar</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white rounded-lg hover:bg-[#21262d] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5 text-xs">
          {/* Status Message Banner */}
          {statusMsg && (
            <div
              className={`p-3 rounded-xl flex items-start gap-2.5 border ${
                statusMsg.type === 'success'
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
              }`}
            >
              {statusMsg.type === 'success' ? (
                <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
              ) : (
                <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              )}
              <div className="text-xs">{statusMsg.text}</div>
            </div>
          )}

          {/* Master Enable Toggle */}
          <div className="p-4 rounded-xl bg-[#0d1117] border border-[#30363d] flex items-center justify-between">
            <div>
              <div className="font-semibold text-white text-sm">Aktifkan Notifikasi Telegram</div>
              <div className="text-slate-400 text-[11px] mt-0.5">
                Setiap kali setup baru muncul di tab Setup Radar, infokan langsung ke Telegram.
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer ml-3">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#0088cc]"></div>
            </label>
          </div>

          {/* Form Credentials */}
          <div className="space-y-4">
            {/* Telegram Bot Token */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="font-semibold text-slate-300">Telegram Bot Token</label>
                <button
                  type="button"
                  onClick={() => setShowGuide(!showGuide)}
                  className="text-[#0088cc] hover:underline flex items-center gap-1 text-[11px]"
                >
                  <HelpCircle className="w-3.5 h-3.5" />
                  Cara dapat Token & Chat ID
                </button>
              </div>
              <div className="relative">
                <input
                  type={showToken ? 'text' : 'password'}
                  placeholder={form.has_token ? form.bot_token_masked : 'Contoh: 123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ'}
                  value={form.bot_token}
                  onChange={(e) => setForm({ ...form, bot_token: e.target.value })}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#0088cc] transition-colors pr-10"
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                >
                  {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Guide Collapse */}
            {showGuide && (
              <div className="p-3.5 rounded-xl bg-[#0088cc]/10 border border-[#0088cc]/20 text-slate-300 space-y-2 text-[11px] leading-relaxed">
                <div className="font-semibold text-[#0088cc] flex items-center gap-1.5">
                  <Send className="w-3.5 h-3.5" /> Panduan Singkat (1 Menit):
                </div>
                <ol className="list-decimal list-inside space-y-1.5 text-slate-300">
                  <li>
                    Buka Telegram, cari akun resmi <b>@BotFather</b> lalu ketik <code>/newbot</code>.
                  </li>
                  <li>
                    Beri nama bot Anda, lalu BotFather akan memberikan <b>Bot Token</b>.
                  </li>
                  <li>
                    Buka bot yang baru dibuat tersebut dan tekan tombol <b>START</b>.
                  </li>
                  <li>
                    Cari akun <b>@userinfobot</b> di Telegram untuk melihat <b>ID</b> akun Anda (Chat ID).
                  </li>
                </ol>
              </div>
            )}

            {/* Telegram Chat ID */}
            <div>
              <label className="block font-semibold text-slate-300 mb-1.5">Telegram Chat ID</label>
              <input
                type="text"
                placeholder="Contoh: 123456789 atau -100123456789"
                value={form.chat_id}
                onChange={(e) => setForm({ ...form, chat_id: e.target.value })}
                className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#0088cc] transition-colors"
              />
              <p className="text-[10px] text-slate-500 mt-1">
                Bisa ID akun pribadi Anda atau ID Grup/Channel (jika grup/channel, pastikan bot sudah dimasukkan sebagai Admin).
              </p>
            </div>

            {/* Notification Alert Types / Filters */}
            <div className="pt-2 border-t border-[#21262d] space-y-2.5">
              <label className="block font-semibold text-slate-300">Pilihan Tipe Sinyal Alert</label>
              
              {/* Option 1: Setup Radar (SMC & Pattern Setup) */}
              <label className="flex items-start gap-3 p-3 rounded-xl bg-[#0d1117] border border-[#30363d] hover:border-cyan-500/40 cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={form.notify_setup_radar ?? true}
                  onChange={(e) => setForm({ ...form, notify_setup_radar: e.target.checked })}
                  className="mt-0.5 rounded border-slate-700 text-cyan-500 focus:ring-0 focus:ring-offset-0 bg-slate-900 cursor-pointer w-4 h-4"
                />
                <div className="space-y-0.5">
                  <div className="font-semibold text-white text-xs flex items-center gap-1.5">
                    <Radio className="w-3.5 h-3.5 text-cyan-400" />
                    <span>Sinyal Setup Radar (SMC & Pola Struktur)</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Kirim notifikasi otomatis saat setup valid terdeteksi di panel Setup Radar (Order Block, FVG, BOS/CHoCH, R:R ≥ {form.min_rr || 1.5}).
                  </p>
                </div>
              </label>

              {/* Option 2: Smart Divergence Grade A+ */}
              <label className="flex items-start gap-3 p-3 rounded-xl bg-[#0d1117] border border-[#30363d] hover:border-emerald-500/40 cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={form.notify_smart_div ?? true}
                  onChange={(e) => setForm({ ...form, notify_smart_div: e.target.checked })}
                  className="mt-0.5 rounded border-slate-700 text-emerald-500 focus:ring-0 focus:ring-offset-0 bg-slate-900 cursor-pointer w-4 h-4"
                />
                <div className="space-y-0.5">
                  <div className="font-semibold text-white text-xs flex items-center gap-1.5">
                    <Target className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Smart Divergence (Grade A+ Khusus)</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Kirim alert instan saat divergence terkonfirmasi minimal 2 osilator (RSI+MACD+CVD) + Rejection Wick & Liquidity Sweep di timeframe 15m/1h.
                  </p>
                </div>
              </label>

              {/* Option 3: Whale Squeeze Hunter */}
              <label className="flex items-start gap-3 p-3 rounded-xl bg-[#0d1117] border border-[#30363d] hover:border-amber-500/40 cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={form.notify_squeeze ?? true}
                  onChange={(e) => setForm({ ...form, notify_squeeze: e.target.checked })}
                  className="mt-0.5 rounded border-slate-700 text-amber-500 focus:ring-0 focus:ring-offset-0 bg-slate-900 cursor-pointer w-4 h-4"
                />
                <div className="space-y-0.5">
                  <div className="font-semibold text-white text-xs flex items-center gap-1.5">
                    <Flame className="w-3.5 h-3.5 text-amber-400" />
                    <span>Whale Squeeze Hunter (Funding Anomali Ekstrem)</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Kirim alert peringatan saat Funding Rate menyentuh level ekstrem (|Rate| ≥ 0.15%), indikasi kuat perangkap whale yang memicu Short Squeeze pump atau Long Squeeze dump mendadak.
                  </p>
                </div>
              </label>

              {/* Option 4: Breaking High-Impact News & Fed/Macro */}
              <label className="flex items-start gap-3 p-3 rounded-xl bg-[#0d1117] border border-[#30363d] hover:border-rose-500/40 cursor-pointer transition-colors">
                <input
                  type="checkbox"
                  checked={form.notify_news ?? true}
                  onChange={(e) => setForm({ ...form, notify_news: e.target.checked })}
                  className="mt-0.5 rounded border-slate-700 text-rose-500 focus:ring-0 focus:ring-offset-0 bg-slate-900 cursor-pointer w-4 h-4"
                />
                <div className="space-y-0.5">
                  <div className="font-semibold text-white text-xs flex items-center gap-1.5">
                    <Newspaper className="w-3.5 h-3.5 text-rose-400" />
                    <span>Breaking High-Impact News &amp; Rilis The Fed</span>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Kirim alert otomatis saat berita kripto atau pengumuman moneter The Fed / ETF / Regulasi berstatus High-Impact terbit secara real-time.
                  </p>
                </div>
              </label>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[#21262d] bg-[#0d1117]/80">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || (!form.chat_id && !form.has_token && !form.bot_token)}
            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-medium flex items-center gap-1.5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {testing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5 text-[#0088cc]" />}
            Test Kirim Pesan
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-medium transition-colors"
            >
              Tutup
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="px-5 py-2 rounded-xl bg-[#0088cc] hover:bg-[#0077b5] text-white font-semibold flex items-center gap-1.5 transition-colors shadow-lg shadow-[#0088cc]/20 disabled:opacity-50"
            >
              {saving ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              Simpan
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
