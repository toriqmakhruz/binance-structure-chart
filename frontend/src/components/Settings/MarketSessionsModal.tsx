import React, { useState, useEffect } from 'react'
import {
  X,
  Clock,
  RotateCcw,
  Check,
  Palette,
  Eye,
  Sliders,
  Sparkles,
  Info
} from 'lucide-react'
import {
  MarketSessionSettings,
  DEFAULT_MARKET_SESSION_SETTINGS,
  SingleSessionConfig
} from '../../types/marketSessions'

interface MarketSessionsModalProps {
  isOpen: boolean
  settings: MarketSessionSettings
  onClose: () => void
  onSave: (newSettings: MarketSessionSettings) => void
}

const COLOR_PRESETS = [
  '#f59e0b', // Amber
  '#38bdf8', // Sky
  '#10b981', // Emerald
  '#a855f7', // Purple
  '#f43f5e', // Rose
  '#eab308', // Yellow
  '#06b6d4', // Cyan
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#64748b'  // Slate
]

export const MarketSessionsModal: React.FC<MarketSessionsModalProps> = ({
  isOpen,
  settings,
  onClose,
  onSave
}) => {
  const [form, setForm] = useState<MarketSessionSettings>(settings)

  useEffect(() => {
    setForm(settings)
  }, [settings, isOpen])

  if (!isOpen) return null

  const handleSessionToggle = (idx: number) => {
    const updated = [...form.sessions]
    updated[idx] = { ...updated[idx], enabled: !updated[idx].enabled }
    setForm({ ...form, sessions: updated })
  }

  const handleSessionColor = (idx: number, color: string) => {
    const updated = [...form.sessions]
    updated[idx] = { ...updated[idx], color }
    setForm({ ...form, sessions: updated })
  }

  const handleSessionHours = (idx: number, field: 'startHourUtc' | 'endHourUtc', value: number) => {
    const updated = [...form.sessions]
    const clamped = Math.max(0, Math.min(23, value))
    updated[idx] = { ...updated[idx], [field]: clamped }
    setForm({ ...form, sessions: updated })
  }

  const handleReset = () => {
    setForm({ ...DEFAULT_MARKET_SESSION_SETTINGS })
  }

  const handleSave = () => {
    onSave(form)
    onClose()
  }

  const pad = (n: number) => String(n).padStart(2, '0')

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 select-none animate-in fade-in duration-150">
      <div className="bg-[#12161f] border border-[#263042] rounded-xl shadow-2xl w-full max-w-xl max-h-[92vh] flex flex-col overflow-hidden text-slate-200">
        {/* Header */}
        <div className="px-5 py-3.5 bg-[#161c28] border-b border-[#263042] flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="w-7 h-7 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Clock className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-white text-sm tracking-wide flex items-center space-x-2">
                <span>Pengaturan Sesi Pasar</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
                  Garis Vertikal Tipis
                </span>
              </h3>
              <p className="text-[11px] text-slate-400">
                Garis vertikal putus-putus tipis penanda sesi & waktu sesi berikutnya
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body (Scrollable) */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-5 custom-scrollbar text-xs">
          {/* Quick Display Options */}
          <div className="bg-[#161b26] border border-[#222a3a] rounded-lg p-3.5 space-y-3">
            <h4 className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center space-x-1.5">
              <Sliders className="w-3.5 h-3.5 text-amber-400" />
              <span>Format Tampilan Garis</span>
            </h4>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              <label className="flex items-center justify-between p-2 rounded bg-[#0e121a] border border-[#1e2535] cursor-pointer hover:border-slate-600 transition-colors">
                <span className="text-slate-300 font-medium">Garis Vertikal Tipis</span>
                <input
                  type="checkbox"
                  checked={form.showVerticalLines}
                  onChange={(e) => setForm({ ...form, showVerticalLines: e.target.checked })}
                  className="rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-0 focus:ring-offset-0 cursor-pointer w-4 h-4"
                />
              </label>

              <label className="flex items-center justify-between p-2 rounded bg-[#0e121a] border border-[#1e2535] cursor-pointer hover:border-slate-600 transition-colors">
                <span className="text-slate-300 font-medium">Badge Label Sesi di Atas</span>
                <input
                  type="checkbox"
                  checked={form.showSessionBadges}
                  onChange={(e) => setForm({ ...form, showSessionBadges: e.target.checked })}
                  className="rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-0 focus:ring-offset-0 cursor-pointer w-4 h-4"
                />
              </label>

              <label className="flex items-center justify-between p-2 rounded bg-[#0e121a] border border-[#1e2535] cursor-pointer hover:border-slate-600 transition-colors">
                <span className="text-slate-300 font-medium">Garis Proyeksi Sesi Berikutnya</span>
                <input
                  type="checkbox"
                  checked={form.showUpcomingMarker}
                  onChange={(e) => setForm({ ...form, showUpcomingMarker: e.target.checked })}
                  className="rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-0 focus:ring-offset-0 cursor-pointer w-4 h-4"
                />
              </label>

              <label className="flex items-center justify-between p-2 rounded bg-[#0e121a] border border-[#1e2535] cursor-pointer hover:border-slate-600 transition-colors">
                <span className="text-slate-300 font-medium">Status Widget di Pojok Chart</span>
                <input
                  type="checkbox"
                  checked={form.showHudBar}
                  onChange={(e) => setForm({ ...form, showHudBar: e.target.checked })}
                  className="rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-0 focus:ring-offset-0 cursor-pointer w-4 h-4"
                />
              </label>
            </div>

            {/* Line Style & Opacity */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-[#1e2535]">
              <div>
                <span className="text-slate-400 text-[11px] block mb-1.5 font-medium">Tipe Garis:</span>
                <div className="flex space-x-1.5">
                  {(['dashed', 'dotted', 'solid'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setForm({ ...form, lineStyle: st })}
                      className={`flex-1 py-1 px-2 rounded text-[11px] font-bold uppercase transition-all ${
                        form.lineStyle === st
                          ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40 shadow-sm'
                          : 'bg-[#0e121a] text-slate-400 hover:text-white border border-[#1e2535]'
                      }`}
                    >
                      {st === 'dashed' ? '- - Putus' : st === 'dotted' ? '··· Titik' : '— Solid'}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <div className="flex justify-between text-[11px] mb-1 font-medium">
                  <span className="text-slate-400">Opasitas Garis:</span>
                  <span className="text-amber-400 font-mono font-bold">{Math.round(form.opacity * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0.2"
                  max="1.0"
                  step="0.05"
                  value={form.opacity}
                  onChange={(e) => setForm({ ...form, opacity: parseFloat(e.target.value) })}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-amber-500"
                />
              </div>
            </div>
          </div>

          {/* Sesi-Sesi Pasar */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-[11px] font-bold text-slate-300 uppercase tracking-wider flex items-center space-x-1.5">
                <Clock className="w-3.5 h-3.5 text-sky-400" />
                <span>Konfigurasi Sesi Pasar (Waktu UTC)</span>
              </h4>
              <span className="text-[10px] text-slate-500 font-mono">
                Waktu Acuan: UTC (GMT+0)
              </span>
            </div>

            <div className="space-y-2.5">
              {form.sessions.map((sess, idx) => (
                <div
                  key={sess.id}
                  className={`p-3 rounded-lg border transition-all ${
                    sess.enabled
                      ? 'bg-[#151a24] border-[#222a3a]'
                      : 'bg-[#0f131a]/60 border-[#1a202c] opacity-60'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    {/* Checkbox & Name */}
                    <label className="flex items-center space-x-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={sess.enabled}
                        onChange={() => handleSessionToggle(idx)}
                        className="rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-0 focus:ring-offset-0 cursor-pointer w-4 h-4"
                      />
                      <div className="flex items-center space-x-2">
                        <span
                          className="w-3 h-3 rounded-full shrink-0 shadow-sm"
                          style={{ backgroundColor: sess.color }}
                        />
                        <span className="font-bold text-slate-200 text-xs">
                          {sess.name}
                        </span>
                        <span
                          className="text-[9.5px] font-mono px-1.5 py-0.2 rounded font-bold"
                          style={{
                            color: sess.color,
                            backgroundColor: `${sess.color}15`,
                            border: `1px solid ${sess.color}35`
                          }}
                        >
                          {sess.label}
                        </span>
                      </div>
                    </label>

                    {/* Color selector */}
                    <div className="flex items-center space-x-1">
                      {COLOR_PRESETS.slice(0, 5).map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => handleSessionColor(idx, c)}
                          className={`w-4 h-4 rounded-full transition-transform ${
                            sess.color.toLowerCase() === c.toLowerCase()
                              ? 'scale-125 ring-2 ring-white/60'
                              : 'opacity-70 hover:opacity-100 hover:scale-110'
                          }`}
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Hours Config */}
                  <div className="mt-2.5 pt-2 border-t border-[#1c2332] flex items-center justify-between text-[11px]">
                    <div className="flex items-center space-x-2">
                      <span className="text-slate-400">Jam Buka:</span>
                      <input
                        type="number"
                        min="0"
                        max="23"
                        value={sess.startHourUtc}
                        onChange={(e) =>
                          handleSessionHours(idx, 'startHourUtc', parseInt(e.target.value) || 0)
                        }
                        className="w-14 px-2 py-0.5 rounded bg-[#0c1017] border border-[#252d3d] text-center font-mono font-bold text-amber-300 focus:outline-none focus:border-amber-500 text-xs"
                      />
                      <span className="text-slate-500">:00 UTC</span>
                    </div>

                    <div className="text-slate-500 font-bold">➔</div>

                    <div className="flex items-center space-x-2">
                      <span className="text-slate-400">Jam Tutup:</span>
                      <input
                        type="number"
                        min="0"
                        max="23"
                        value={sess.endHourUtc}
                        onChange={(e) =>
                          handleSessionHours(idx, 'endHourUtc', parseInt(e.target.value) || 0)
                        }
                        className="w-14 px-2 py-0.5 rounded bg-[#0c1017] border border-[#252d3d] text-center font-mono font-bold text-sky-300 focus:outline-none focus:border-sky-500 text-xs"
                      />
                      <span className="text-slate-500">:00 UTC</span>
                    </div>

                    <div className="text-[10px] text-slate-500 font-mono hidden sm:inline">
                      ({pad(sess.startHourUtc)}:00 - {pad(sess.endHourUtc)}:00 UTC)
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Info Box */}
          <div className="p-3 rounded-lg bg-[#0d121a] border border-[#1b2230] flex items-start space-x-2.5 text-[11px] text-slate-400">
            <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="text-slate-200 font-bold">Tips Trading SMC / London Breakout:</span>
              <p>
                Garis vertikal putus-putus tipis menandai pergantian sesi pasar tanpa menutupi candle. Garis proyeksi di sebelah kanan candle menunjukkan kapan sesi berikutnya akan dibuka sehingga Anda bisa bersiap mengantisipasi lonjakan volume (*liquidity injection*).
              </p>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-[#161c28] border-t border-[#263042] flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={handleReset}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-[#1f2637] hover:bg-[#2b354b] text-slate-300 hover:text-white border border-[#2b354c] text-xs font-semibold transition-all"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Default</span>
          </button>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 text-xs font-semibold transition-all"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="flex items-center space-x-1.5 px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold transition-all shadow-md shadow-amber-500/20 cursor-pointer"
            >
              <Check className="w-3.5 h-3.5 stroke-[2.5]" />
              <span>Simpan & Terapkan</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
