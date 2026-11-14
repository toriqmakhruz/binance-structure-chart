import React, { useState, useEffect } from 'react'
import {
  Send,
  Bell,
  CheckCircle2,
  XCircle,
  RefreshCw,
  X,
  Eye,
  EyeOff,
  HelpCircle,
  ExternalLink,
  ShieldAlert
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
    min_confluence_score: 50.0
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
        chat_id: form.chat_id,
        min_rr: Number(form.min_rr),
        market: form.market,
        timeframe: form.timeframe,
        scan_interval_seconds: Number(form.scan_interval_seconds)
      }
      // Only include bot_token if user edited it and it is not the masked placeholder
      if (form.bot_token && !form.bot_token.includes('...')) {
        payload.bot_token = form.bot_token.trim()
      }

      const res = await saveTelegramSettings(payload)
      setStatusMsg({ type: 'success', text: res.message || 'Pengaturan berhasil disimpan!' })
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
      <div className="relative w-full max-w-lg bg-[#161b22] border border-[#30363d] rounded-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden text-slate-200">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#21262d] bg-[#0d1117]/80">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-[#0088cc]/15 text-[#0088cc] border border-[#0088cc]/30">
              <Send className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                Notifikasi Telegram Setup Radar
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
              <p className="text-xs text-slate-400">Kirim sinyal pola & entry A+ real-time ke akun Telegram Anda</p>
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
          <div className="p-3.5 rounded-xl bg-[#0d1117] border border-[#30363d] flex items-center justify-between">
            <div>
              <div className="font-semibold text-white text-sm">Aktifkan Notifikasi Otomatis</div>
              <div className="text-slate-400 text-[11px]">
                Bot akan memantau pasar di latar belakang dan mengirimkan pesan setiap ada setup valid baru.
              </div>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
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
                  Cara dapatkan Token & Chat ID
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
                  <Send className="w-3.5 h-3.5" /> Panduan Singkat (Hanya 1 Menit):
                </div>
                <ol className="list-decimal list-inside space-y-1 text-slate-300">
                  <li>
                    Buka Telegram dan cari akun resmi <b>@BotFather</b>.
                  </li>
                  <li>
                    Kirim pesan <code>/newbot</code>, beri nama bot Anda, lalu Anda akan menerima <b>Bot Token</b>.
                  </li>
                  <li>
                    Buka bot yang baru dibuat tersebut lalu tekan <b>START</b> agar bot bisa mengirim pesan ke Anda.
                  </li>
                  <li>
                    Cari akun <b>@userinfobot</b> di Telegram untuk melihat <b>ID</b> akun Anda (Chat ID berupa angka).
                  </li>
                </ol>
              </div>
            )}

            {/* Telegram Chat ID */}
            <div>
              <label className="block font-semibold text-slate-300 mb-1.5">Telegram Chat ID / Channel ID</label>
              <input
                type="text"
                placeholder="Contoh: 123456789 atau -100123456789"
                value={form.chat_id}
                onChange={(e) => setForm({ ...form, chat_id: e.target.value })}
                className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-[#0088cc] transition-colors"
              />
              <p className="text-[10px] text-slate-500 mt-1">
                Bisa ID akun pribadi atau ID Channel/Grup (pastikan bot sudah dijadikan Admin di grup/channel).
              </p>
            </div>

            {/* Filter Setup Settings */}
            <div className="grid grid-cols-2 gap-3 pt-2">
              <div>
                <label className="block font-semibold text-slate-300 mb-1.5">Market Target</label>
                <select
                  value={form.market}
                  onChange={(e) => setForm({ ...form, market: e.target.value as any })}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#0088cc]"
                >
                  <option value="futures">USD-M Futures</option>
                  <option value="spot">Binance Spot</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1.5">Timeframe Sinyal</label>
                <select
                  value={form.timeframe}
                  onChange={(e) => setForm({ ...form, timeframe: e.target.value })}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#0088cc]"
                >
                  <option value="5m">5 Menit (5m)</option>
                  <option value="15m">15 Menit (15m - Disarankan)</option>
                  <option value="30m">30 Menit (30m)</option>
                  <option value="1h">1 Jam (1h)</option>
                  <option value="4h">4 Jam (4h)</option>
                </select>
              </div>
            </div>

            {/* Minimum Risk/Reward & Interval */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-300 mb-1.5">
                  Minimal Risk/Reward (R:R)
                </label>
                <input
                  type="number"
                  step="0.1"
                  min="1.0"
                  max="10.0"
                  value={form.min_rr}
                  onChange={(e) => setForm({ ...form, min_rr: parseFloat(e.target.value) || 1.5 })}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#0088cc]"
                />
                <p className="text-[10px] text-slate-500 mt-1">Hanya kirim setup dengan R:R minimal ini (cth: 1.5).</p>
              </div>

              <div>
                <label className="block font-semibold text-slate-300 mb-1.5">
                  Frekuensi Pindai (Detik)
                </label>
                <select
                  value={form.scan_interval_seconds}
                  onChange={(e) => setForm({ ...form, scan_interval_seconds: parseInt(e.target.value) || 60 })}
                  className="w-full bg-[#0d1117] border border-[#30363d] rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-[#0088cc]"
                >
                  <option value={30}>Setiap 30 Detik</option>
                  <option value={60}>Setiap 60 Detik (Disarankan)</option>
                  <option value={120}>Setiap 2 Menit</option>
                  <option value={300}>Setiap 5 Menit</option>
                </select>
                <p className="text-[10px] text-slate-500 mt-1">Interval scanner background memantau pasar.</p>
              </div>
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
              Simpan Pengaturan
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
