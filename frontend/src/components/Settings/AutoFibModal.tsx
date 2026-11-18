import React, { useState, useEffect } from 'react'
import {
  X,
  Sliders,
  RotateCcw,
  Check,
  ShieldCheck,
  Palette,
  Eye,
  SlidersHorizontal,
  Layers,
  Sparkles,
  ArrowRightLeft
} from 'lucide-react'
import { AutoFibSettings, DEFAULT_AUTO_FIB_SETTINGS, FibLevelConfig } from '../../types/fibonacci'

interface AutoFibModalProps {
  isOpen: boolean
  settings: AutoFibSettings
  onClose: () => void
  onSave: (newSettings: AutoFibSettings) => void
}

export const AutoFibModal: React.FC<AutoFibModalProps> = ({
  isOpen,
  settings,
  onClose,
  onSave
}) => {
  const [form, setForm] = useState<AutoFibSettings>(settings)
  const [activeTab, setActiveTab] = useState<'style' | 'inputs'>('style')

  useEffect(() => {
    setForm(settings)
  }, [settings, isOpen])

  if (!isOpen) return null

  const handleLevelToggle = (idx: number) => {
    const updated = [...form.levels]
    updated[idx] = { ...updated[idx], enabled: !updated[idx].enabled }
    setForm({ ...form, levels: updated })
  }

  const handleLevelColorChange = (idx: number, color: string) => {
    const updated = [...form.levels]
    updated[idx] = { ...updated[idx], color }
    setForm({ ...form, levels: updated })
  }

  const handleLevelValueChange = (idx: number, val: number) => {
    const updated = [...form.levels]
    updated[idx] = { ...updated[idx], level: val }
    setForm({ ...form, levels: updated })
  }

  const applyOtePreset = () => {
    const oteLevels = [0.0, 0.5, 0.618, 0.65, 0.705, 0.786, 1.0]
    const updated = form.levels.map((lvl) => ({
      ...lvl,
      enabled: oteLevels.some((o) => Math.abs(o - lvl.level) < 0.005)
    }))
    setForm({ ...form, levels: updated })
  }

  const applyTvPreset = () => {
    setForm({ ...DEFAULT_AUTO_FIB_SETTINGS })
  }

  const toggleAllLevels = (enable: boolean) => {
    const updated = form.levels.map((l) => ({ ...l, enabled: enable }))
    setForm({ ...form, levels: updated })
  }

  const handleSave = () => {
    onSave(form)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 select-none animate-in fade-in duration-150">
      <div className="bg-[#12161f] border border-[#263042] rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden text-slate-200">
        {/* Header */}
        <div className="px-5 py-3.5 bg-[#161c28] border-b border-[#263042] flex items-center justify-between">
          <div className="flex items-center space-x-2.5">
            <div className="w-7 h-7 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <SlidersHorizontal className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-white text-sm tracking-wide flex items-center space-x-2">
                <span>Pengaturan Auto Fibonacci Retracement</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  Anti-Repaint
                </span>
              </h3>
              <p className="text-[11px] text-slate-400">
                Konfigurasi level, gaya visual, dan algoritma pivot persis seperti TradingView
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#20293a] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="px-5 pt-2 bg-[#141923] border-b border-[#212838] flex items-center space-x-2">
          <button
            type="button"
            onClick={() => setActiveTab('style')}
            className={`pb-2.5 px-3 text-xs font-bold transition-all border-b-2 flex items-center space-x-1.5 ${
              activeTab === 'style'
                ? 'border-amber-400 text-amber-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Palette className="w-3.5 h-3.5" />
            <span>Gaya & Level (Style)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('inputs')}
            className={`pb-2.5 px-3 text-xs font-bold transition-all border-b-2 flex items-center space-x-1.5 ${
              activeTab === 'inputs'
                ? 'border-amber-400 text-amber-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Input & Anti-Repaint</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 flex-1 overflow-y-auto space-y-5 text-xs font-sans custom-scrollbar">
          {activeTab === 'style' ? (
            <>
              {/* Presets Header */}
              <div className="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-lg bg-[#18202d] border border-[#243044]">
                <span className="text-[11px] font-semibold text-slate-300">Preset Cepat:</span>
                <div className="flex items-center space-x-1.5">
                  <button
                    type="button"
                    onClick={applyOtePreset}
                    className="px-2 py-1 rounded bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/40 text-[10px] font-bold transition-all"
                  >
                    SMC OTE (0.5 - 0.786)
                  </button>
                  <button
                    type="button"
                    onClick={applyTvPreset}
                    className="px-2 py-1 rounded bg-[#252f42] text-slate-200 hover:bg-[#2e3b52] border border-[#374560] text-[10px] font-medium transition-all"
                  >
                    Default TradingView
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleAllLevels(true)}
                    className="px-1.5 py-1 text-[10px] text-slate-400 hover:text-white"
                  >
                    Semua
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleAllLevels(false)}
                    className="px-1.5 py-1 text-[10px] text-slate-400 hover:text-white"
                  >
                    Batal Semua
                  </button>
                </div>
              </div>

              {/* Fibonacci Levels Grid (TradingView Style) */}
              <div className="space-y-2">
                <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block">
                  Level Rasio Fibonacci
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-[#0d1117] p-3 rounded-lg border border-[#212838]">
                  {form.levels.map((lvl, idx) => (
                    <div
                      key={idx}
                      className={`flex items-center justify-between px-2.5 py-1.5 rounded border transition-all ${
                        lvl.enabled
                          ? 'bg-[#151c27] border-[#29354a]'
                          : 'bg-[#10141d]/60 border-[#1a212e] opacity-60'
                      }`}
                    >
                      <div className="flex items-center space-x-2">
                        <input
                          type="checkbox"
                          checked={lvl.enabled}
                          onChange={() => handleLevelToggle(idx)}
                          className="w-3.5 h-3.5 rounded bg-[#1f2636] border-[#374560] text-amber-500 focus:ring-0 cursor-pointer"
                        />
                        <input
                          type="number"
                          step="0.001"
                          value={lvl.level}
                          onChange={(e) => handleLevelValueChange(idx, parseFloat(e.target.value) || 0)}
                          className="w-16 bg-[#0a0d14] text-white font-mono text-[11px] font-bold px-1.5 py-0.5 rounded border border-[#2b3548] outline-none"
                        />
                        <span className="text-[10px] text-slate-400 truncate max-w-[80px]">
                          {lvl.label || `${(lvl.level * 100).toFixed(1)}%`}
                        </span>
                      </div>

                      <div className="flex items-center space-x-1.5">
                        <input
                          type="color"
                          value={lvl.color}
                          onChange={(e) => handleLevelColorChange(idx, e.target.value)}
                          className="w-5 h-5 rounded cursor-pointer border border-[#3b475d] bg-transparent p-0"
                          title="Pilih warna level"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Display & Layout Options */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                {/* Visual Toggles */}
                <div className="space-y-2 bg-[#131923] p-3 rounded-lg border border-[#222a3a]">
                  <span className="text-[11px] font-bold text-slate-300 block mb-1">Opsi Garis & Tampilan</span>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.extendRight}
                      onChange={(e) => setForm({ ...form, extendRight: e.target.checked })}
                      className="rounded bg-[#1e2636] border-[#36435b] text-amber-500 focus:ring-0"
                    />
                    <span className="text-slate-300">Perpanjang Garis ke Kanan (Extend Right)</span>
                  </label>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.extendLeft}
                      onChange={(e) => setForm({ ...form, extendLeft: e.target.checked })}
                      className="rounded bg-[#1e2636] border-[#36435b] text-amber-500 focus:ring-0"
                    />
                    <span className="text-slate-300">Perpanjang Garis ke Kiri (Extend Left)</span>
                  </label>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.reverse}
                      onChange={(e) => setForm({ ...form, reverse: e.target.checked })}
                      className="rounded bg-[#1e2636] border-[#36435b] text-amber-500 focus:ring-0"
                    />
                    <span className="text-slate-300">Balik Level 0 & 1 (Reverse)</span>
                  </label>
                  <label className="flex items-center space-x-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.showPrices}
                      onChange={(e) => setForm({ ...form, showPrices: e.target.checked })}
                      className="rounded bg-[#1e2636] border-[#36435b] text-amber-500 focus:ring-0"
                    />
                    <span className="text-slate-300">Tampilkan Nilai Harga (Prices)</span>
                  </label>
                </div>

                {/* Shading & Labels */}
                <div className="space-y-3 bg-[#131923] p-3 rounded-lg border border-[#222a3a]">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <label className="flex items-center space-x-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.backgroundShading}
                          onChange={(e) => setForm({ ...form, backgroundShading: e.target.checked })}
                          className="rounded bg-[#1e2636] border-[#36435b] text-amber-500 focus:ring-0"
                        />
                        <span className="font-semibold text-slate-300">Isi Warna Latar (Shading)</span>
                      </label>
                      <span className="font-mono text-[10px] text-amber-400 font-bold">
                        {Math.round(form.backgroundOpacity * 100)}%
                      </span>
                    </div>
                    {form.backgroundShading && (
                      <input
                        type="range"
                        min="0.04"
                        max="0.35"
                        step="0.01"
                        value={form.backgroundOpacity}
                        onChange={(e) => setForm({ ...form, backgroundOpacity: parseFloat(e.target.value) })}
                        className="w-full h-1 bg-[#232c3d] rounded-lg appearance-none cursor-pointer accent-amber-500"
                      />
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <div>
                      <label className="text-[10px] font-semibold text-slate-400 block mb-1">Format Label</label>
                      <select
                        value={form.showLevels}
                        onChange={(e) => setForm({ ...form, showLevels: e.target.value as any })}
                        className="w-full bg-[#0a0d14] text-slate-200 text-[11px] p-1.5 rounded border border-[#2b3548] outline-none"
                      >
                        <option value="both">Nilai & Persen</option>
                        <option value="values">Hanya Nilai (0.618)</option>
                        <option value="percent">Hanya Persen (61.8%)</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] font-semibold text-slate-400 block mb-1">Posisi Label</label>
                      <select
                        value={form.labelPosition}
                        onChange={(e) => setForm({ ...form, labelPosition: e.target.value as any })}
                        className="w-full bg-[#0a0d14] text-slate-200 text-[11px] p-1.5 rounded border border-[#2b3548] outline-none"
                      >
                        <option value="right">Kanan (Right)</option>
                        <option value="center">Tengah (Center)</option>
                        <option value="left">Kiri (Left)</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[10px] font-semibold text-slate-400 block mb-1">Ketebalan Garis</label>
                      <select
                        value={form.lineWidth}
                        onChange={(e) => setForm({ ...form, lineWidth: parseFloat(e.target.value) })}
                        className="w-full bg-[#0a0d14] text-slate-200 text-[11px] p-1.5 rounded border border-[#2b3548] outline-none"
                      >
                        <option value="1">1 px (Tipis)</option>
                        <option value="1.5">1.5 px (Standar)</option>
                        <option value="2">2 px (Tebal)</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-[10px] font-semibold text-slate-400 block mb-1">Gaya Garis</label>
                      <select
                        value={form.lineStyle}
                        onChange={(e) => setForm({ ...form, lineStyle: e.target.value as any })}
                        className="w-full bg-[#0a0d14] text-slate-200 text-[11px] p-1.5 rounded border border-[#2b3548] outline-none"
                      >
                        <option value="solid">Solid (Garis Lurus)</option>
                        <option value="dashed">Dashed (Putus-putus)</option>
                        <option value="dotted">Dotted (Titik-titik)</option>
                      </select>
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Tab 2: Inputs & Anti-Repaint Algorithm */}
              <div className="p-3.5 rounded-lg bg-emerald-950/20 border border-emerald-500/30 flex items-start space-x-3">
                <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <div className="text-[11.5px] leading-relaxed">
                  <span className="font-bold text-emerald-300 block mb-0.5">Jaminan 100% Anti-Repaint</span>
                  Level Fibonacci hanya dihitung dari titik puncak (*Swing High*) dan lembah (*Swing Low*) yang sudah
                  dikonfirmasi oleh candle yang tertutup penuh (*closed candles*). Level tidak akan melompat, bergoyang,
                  atau terhapus saat harga *real-time* sedang bergerak.
                </div>
              </div>

              {/* Source Mode */}
              <div className="space-y-2 bg-[#131923] p-4 rounded-lg border border-[#222a3a]">
                <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block">
                  Metode Deteksi Swing (Pivot Source)
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div
                    onClick={() => setForm({ ...form, source: 'smc_swings' })}
                    className={`p-3 rounded-lg border cursor-pointer transition-all ${
                      form.source === 'smc_swings'
                        ? 'bg-amber-500/10 border-amber-500/50 shadow-sm'
                        : 'bg-[#0e121a] border-[#202838] hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-white text-xs">SMC Confirmed Swings</span>
                      <span className="text-[9px] bg-amber-500/20 text-amber-300 px-1.5 py-0.2 rounded font-extrabold">
                        Rekomendasi
                      </span>
                    </div>
                    <p className="text-[10.5px] text-slate-400 leading-normal">
                      Menggunakan titik swing yang sudah divalidasi oleh Break of Structure (BOS) / Change of Character (CHoCH) pada mesin Smart Money Concepts.
                    </p>
                  </div>

                  <div
                    onClick={() => setForm({ ...form, source: 'zigzag_pivots' })}
                    className={`p-3 rounded-lg border cursor-pointer transition-all ${
                      form.source === 'zigzag_pivots'
                        ? 'bg-amber-500/10 border-amber-500/50 shadow-sm'
                        : 'bg-[#0e121a] border-[#202838] hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-white text-xs">ZigZag Multi-Bar Pivot</span>
                      <span className="text-[9px] bg-blue-500/20 text-blue-300 px-1.5 py-0.2 rounded font-mono">
                        Klasik TV
                      </span>
                    </div>
                    <p className="text-[10.5px] text-slate-400 leading-normal">
                      Mendeteksi puncak dan lembah fraktal murni berdasarkan $N$ bar konfirmasi kiri & kanan (mirip indikator Auto Fib TradingView).
                    </p>
                  </div>
                </div>
              </div>

              {/* Lookback Length / Pivot Confirmation */}
              <div className="space-y-2 bg-[#131923] p-4 rounded-lg border border-[#222a3a]">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                    Panjang Konfirmasi Pivot (Lookback Bars)
                  </label>
                  <span className="font-mono text-xs font-bold text-amber-400 bg-[#0a0d14] px-2 py-0.5 rounded border border-[#263144]">
                    {form.pivotLegs} Candle
                  </span>
                </div>
                <input
                  type="range"
                  min="3"
                  max="25"
                  value={form.pivotLegs}
                  onChange={(e) => setForm({ ...form, pivotLegs: parseInt(e.target.value) || 10 })}
                  className="w-full h-1.5 bg-[#232c3d] rounded-lg appearance-none cursor-pointer accent-amber-500"
                />
                <p className="text-[10px] text-slate-400">
                  Jumlah candle yang harus tertutup sebelum puncak/lembah dianggap definitif. Semakin tinggi nilainya, semakin besar swing struktur yang diambil.
                </p>
              </div>

              {/* Trend Direction Setting */}
              <div className="space-y-2 bg-[#131923] p-4 rounded-lg border border-[#222a3a]">
                <label className="text-[11px] font-bold text-slate-300 uppercase tracking-wider block">
                  Arah Penarikan Fibonacci
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { id: 'auto', label: 'Auto (Tren Pasar)', desc: 'Mengikuti tren aktif' },
                    { id: 'up', label: 'Bullish (Low ke High)', desc: 'Ukur diskon beli' },
                    { id: 'down', label: 'Bearish (High ke Low)', desc: 'Ukur premi jual' }
                  ].map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() => setForm({ ...form, trendDirection: d.id as any })}
                      className={`p-2.5 rounded-lg border text-left transition-all ${
                        form.trendDirection === d.id
                          ? 'bg-amber-500/15 border-amber-500/50 text-white'
                          : 'bg-[#0e121a] border-[#222a3a] text-slate-400 hover:text-white'
                      }`}
                    >
                      <div className="font-bold text-xs">{d.label}</div>
                      <div className="text-[9.5px] text-slate-400 mt-0.5">{d.desc}</div>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3 bg-[#161c28] border-t border-[#263042] flex items-center justify-between">
          <button
            type="button"
            onClick={() => setForm({ ...DEFAULT_AUTO_FIB_SETTINGS })}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#20293a] transition-all text-xs font-semibold"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Default</span>
          </button>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-[#20293a] transition-all text-xs font-semibold"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="flex items-center space-x-1.5 px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black font-extrabold text-xs transition-all shadow-md"
            >
              <Check className="w-4 h-4 stroke-[2.5]" />
              <span>Simpan & Terapkan</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
