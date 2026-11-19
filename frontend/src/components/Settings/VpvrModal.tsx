import React, { useState, useEffect } from 'react'
import {
  X,
  Sliders,
  RotateCcw,
  Check,
  BarChart2,
  Palette,
  Layers,
  Sparkles,
  AlignRight,
  AlignLeft,
  ShieldCheck
} from 'lucide-react'
import { VolumeProfileSettings, DEFAULT_VOLUME_PROFILE_SETTINGS } from '../../types/volumeProfile'

interface VpvrModalProps {
  isOpen: boolean
  settings: VolumeProfileSettings
  onClose: () => void
  onSave: (newSettings: VolumeProfileSettings) => void
}

export const VpvrModal: React.FC<VpvrModalProps> = ({
  isOpen,
  settings,
  onClose,
  onSave
}) => {
  const [form, setForm] = useState<VolumeProfileSettings>(settings)
  const [activeTab, setActiveTab] = useState<'style' | 'inputs'>('style')

  useEffect(() => {
    setForm(settings)
  }, [settings, isOpen])

  if (!isOpen) return null

  const applyTvStandardPreset = () => {
    setForm({ ...DEFAULT_VOLUME_PROFILE_SETTINGS })
  }

  const applyDeltaOrderflowPreset = () => {
    setForm({
      ...form,
      volumeType: 'delta',
      rowSize: 64,
      valueAreaVolumePct: 70,
      showPoc: true,
      showVah: true,
      showVal: true,
      showHvnLvn: true,
      barOpacity: 0.60,
      outsideVaOpacity: 0.25
    })
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
            <div className="w-7 h-7 rounded-lg bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <BarChart2 className="w-4 h-4 rotate-90" />
            </div>
            <div>
              <h3 className="font-bold text-white text-sm tracking-wide flex items-center space-x-2">
                <span>Pengaturan Volume Profile (VPVR)</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                  POC • VAH • VAL
                </span>
              </h3>
              <p className="text-[11px] text-slate-400">
                Visible Range Volume Profile dengan kalkulasi Value Area 70% & Taker Buy/Sell Delta
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#20293a] transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="px-5 pt-2 bg-[#141923] border-b border-[#212838] flex items-center space-x-2">
          <button
            type="button"
            onClick={() => setActiveTab('style')}
            className={`pb-2.5 px-3 text-xs font-bold transition-all border-b-2 flex items-center space-x-1.5 cursor-pointer ${
              activeTab === 'style'
                ? 'border-cyan-400 text-cyan-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Palette className="w-3.5 h-3.5" />
            <span>Gaya & Level (Style)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('inputs')}
            className={`pb-2.5 px-3 text-xs font-bold transition-all border-b-2 flex items-center space-x-1.5 cursor-pointer ${
              activeTab === 'inputs'
                ? 'border-cyan-400 text-cyan-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Input & Parameter (Inputs)</span>
          </button>
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 custom-scrollbar">
          {activeTab === 'style' ? (
            <>
              {/* Quick Presets */}
              <div className="flex flex-wrap items-center justify-between gap-2 bg-[#161c28] p-2.5 rounded-lg border border-[#232c3d]">
                <span className="text-[11px] font-semibold text-slate-400 flex items-center space-x-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
                  <span>Preset Cepat:</span>
                </span>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    onClick={applyTvStandardPreset}
                    className="px-2.5 py-1 rounded text-[11px] font-bold bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 transition-colors cursor-pointer"
                  >
                    TradingView VPVR Standard
                  </button>
                  <button
                    type="button"
                    onClick={applyDeltaOrderflowPreset}
                    className="px-2.5 py-1 rounded text-[11px] font-bold bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 transition-colors cursor-pointer"
                  >
                    Orderflow Net Delta (64 Rows)
                  </button>
                </div>
              </div>

              {/* 1. Institutional Levels: POC, VAH, VAL */}
              <div className="space-y-3 bg-[#151b26] p-3.5 rounded-lg border border-[#222b3b]">
                <div className="text-xs font-bold text-slate-300 flex items-center space-x-1.5">
                  <Layers className="w-3.5 h-3.5 text-amber-400" />
                  <span>Garis Level Institusional (POC, VAH, VAL)</span>
                </div>

                <div className="space-y-2.5">
                  {/* POC Row */}
                  <div className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-lg bg-[#0f131c] border border-[#202838]">
                    <label className="flex items-center space-x-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.showPoc}
                        onChange={(e) => setForm({ ...form, showPoc: e.target.checked })}
                        className="rounded bg-[#0b0e14] border-slate-600 text-amber-500 focus:ring-0 cursor-pointer"
                      />
                      <div>
                        <div className="text-xs font-bold text-amber-400">POC (Point of Control)</div>
                        <div className="text-[10px] text-slate-400">Level harga dengan akumulasi volume tertinggi (Magnet Harga)</div>
                      </div>
                    </label>
                    <div className="flex items-center space-x-3">
                      <label className="flex items-center space-x-1.5 text-[11px] text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={form.pocExtendFull}
                          onChange={(e) => setForm({ ...form, pocExtendFull: e.target.checked })}
                          className="rounded bg-[#0b0e14] border-slate-600 text-cyan-500 focus:ring-0"
                        />
                        <span>Extend Garis</span>
                      </label>
                      <input
                        type="color"
                        value={form.pocColor}
                        onChange={(e) => setForm({ ...form, pocColor: e.target.value })}
                        className="w-6 h-6 rounded cursor-pointer bg-transparent border-0 p-0"
                        title="Warna Garis POC"
                      />
                    </div>
                  </div>

                  {/* VAH Row */}
                  <div className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-lg bg-[#0f131c] border border-[#202838]">
                    <label className="flex items-center space-x-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.showVah}
                        onChange={(e) => setForm({ ...form, showVah: e.target.checked })}
                        className="rounded bg-[#0b0e14] border-slate-600 text-cyan-500 focus:ring-0 cursor-pointer"
                      />
                      <div>
                        <div className="text-xs font-bold text-sky-400">VAH (Value Area High)</div>
                        <div className="text-[10px] text-slate-400">Batas atas distribusi {form.valueAreaVolumePct}% volume utama (Dynamic Resistance)</div>
                      </div>
                    </label>
                    <input
                      type="color"
                      value={form.vahColor}
                      onChange={(e) => setForm({ ...form, vahColor: e.target.value })}
                      className="w-6 h-6 rounded cursor-pointer bg-transparent border-0 p-0"
                      title="Warna Garis VAH"
                    />
                  </div>

                  {/* VAL Row */}
                  <div className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-lg bg-[#0f131c] border border-[#202838]">
                    <label className="flex items-center space-x-2.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.showVal}
                        onChange={(e) => setForm({ ...form, showVal: e.target.checked })}
                        className="rounded bg-[#0b0e14] border-slate-600 text-cyan-500 focus:ring-0 cursor-pointer"
                      />
                      <div>
                        <div className="text-xs font-bold text-sky-400">VAL (Value Area Low)</div>
                        <div className="text-[10px] text-slate-400">Batas bawah distribusi {form.valueAreaVolumePct}% volume utama (Dynamic Support)</div>
                      </div>
                    </label>
                    <input
                      type="color"
                      value={form.valColor}
                      onChange={(e) => setForm({ ...form, valColor: e.target.value })}
                      className="w-6 h-6 rounded cursor-pointer bg-transparent border-0 p-0"
                      title="Warna Garis VAL"
                    />
                  </div>
                </div>
              </div>

              {/* 2. Histogram Styling & Layout */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-1">
                <div className="space-y-3 bg-[#151b26] p-3.5 rounded-lg border border-[#222b3b]">
                  <div className="text-xs font-bold text-slate-300">Posisi & Dimensi Histogram</div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-xs text-slate-400">Posisi Dock (Placement)</span>
                    <div className="flex items-center space-x-1 bg-[#0b0e14] p-0.5 rounded-md border border-[#263042]">
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, placement: 'left' })}
                        className={`flex items-center space-x-1 px-2 py-1 rounded text-[11px] font-bold transition-colors cursor-pointer ${
                          form.placement === 'left'
                            ? 'bg-cyan-500 text-black'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        <AlignLeft className="w-3 h-3" />
                        <span>Kiri</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, placement: 'right' })}
                        className={`flex items-center space-x-1 px-2 py-1 rounded text-[11px] font-bold transition-colors cursor-pointer ${
                          form.placement === 'right'
                            ? 'bg-cyan-500 text-black'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        <AlignRight className="w-3 h-3" />
                        <span>Kanan</span>
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1 pt-1">
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>Lebar Maksimum Histogram (% Layar)</span>
                      <span className="font-mono text-cyan-400 font-bold">{form.widthPct}%</span>
                    </div>
                    <input
                      type="range"
                      min="12"
                      max="45"
                      step="1"
                      value={form.widthPct}
                      onChange={(e) => setForm({ ...form, widthPct: parseInt(e.target.value, 10) })}
                      className="w-full accent-cyan-400 cursor-pointer"
                    />
                  </div>

                  <div className="space-y-1 pt-1">
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>Opasitas Bar Value Area</span>
                      <span className="font-mono text-cyan-400 font-bold">{Math.round(form.barOpacity * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0.20"
                      max="0.85"
                      step="0.02"
                      value={form.barOpacity}
                      onChange={(e) => setForm({ ...form, barOpacity: parseFloat(e.target.value) })}
                      className="w-full accent-cyan-400 cursor-pointer"
                    />
                  </div>
                </div>

                {/* Colors & Extra Visuals */}
                <div className="space-y-3 bg-[#151b26] p-3.5 rounded-lg border border-[#222b3b]">
                  <div className="text-xs font-bold text-slate-300">Warna Volume & Label</div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-xs text-slate-300">Warna Buy / Up Volume</span>
                    <div className="flex items-center space-x-2">
                      <span className="text-[11px] font-mono text-emerald-400">{form.upVolumeColor}</span>
                      <input
                        type="color"
                        value={form.upVolumeColor}
                        onChange={(e) => setForm({ ...form, upVolumeColor: e.target.value })}
                        className="w-6 h-6 rounded cursor-pointer bg-transparent border-0 p-0"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-xs text-slate-300">Warna Sell / Down Volume</span>
                    <div className="flex items-center space-x-2">
                      <span className="text-[11px] font-mono text-rose-400">{form.downVolumeColor}</span>
                      <input
                        type="color"
                        value={form.downVolumeColor}
                        onChange={(e) => setForm({ ...form, downVolumeColor: e.target.value })}
                        className="w-6 h-6 rounded cursor-pointer bg-transparent border-0 p-0"
                      />
                    </div>
                  </div>

                  <label className="flex items-center justify-between cursor-pointer pt-1">
                    <span className="text-xs text-slate-300">Background Shading Value Area</span>
                    <input
                      type="checkbox"
                      checked={form.vaBackgroundShading}
                      onChange={(e) => setForm({ ...form, vaBackgroundShading: e.target.checked })}
                      className="rounded bg-[#0b0e14] border-slate-600 text-cyan-500 focus:ring-0"
                    />
                  </label>

                  <label className="flex items-center justify-between cursor-pointer pt-1">
                    <span className="text-xs text-slate-300">Tampilkan Badge Harga (POC/VAH/VAL)</span>
                    <input
                      type="checkbox"
                      checked={form.showLabels}
                      onChange={(e) => setForm({ ...form, showLabels: e.target.checked })}
                      className="rounded bg-[#0b0e14] border-slate-600 text-cyan-500 focus:ring-0"
                    />
                  </label>

                  <label className="flex items-center justify-between cursor-pointer pt-1">
                    <span className="text-xs text-slate-300">Highlight High Volume Nodes (HVN)</span>
                    <input
                      type="checkbox"
                      checked={form.showHvnLvn}
                      onChange={(e) => setForm({ ...form, showHvnLvn: e.target.checked })}
                      className="rounded bg-[#0b0e14] border-slate-600 text-cyan-500 focus:ring-0"
                    />
                  </label>
                </div>
              </div>
            </>
          ) : (
            /* Tab 2: Inputs & Calculation Parameters */
            <div className="space-y-4">
              <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-xl p-4 flex items-start space-x-3">
                <ShieldCheck className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
                <div className="space-y-1 text-xs">
                  <div className="font-bold text-cyan-300">
                    Algoritma Institutional Volume Profile (VPVR)
                  </div>
                  <p className="text-slate-300 leading-relaxed text-[11px]">
                    Memetakan distribusi likuiditas secara horizontal pada setiap tingkat harga. Ketika zona{' '}
                    <span className="text-amber-300 font-bold">Order Block / FVG / Golden Pocket (Apex Quant)</span>{' '}
                    berimpitan langsung dengan garis <span className="text-amber-400 font-bold">POC</span> atau{' '}
                    <span className="text-sky-300 font-bold">VAH / VAL</span>, area tersebut memiliki dinding pertahanan institusional terkuat.
                  </p>
                </div>
              </div>

              <div className="space-y-4 bg-[#151b26] p-4 rounded-xl border border-[#222b3b]">
                {/* Range Mode */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-[#202838]">
                  <div>
                    <div className="text-xs font-bold text-white">Cakupan Perhitungan (Range Mode)</div>
                    <div className="text-[11px] text-slate-400">
                      Visible Range mengikuti zoom/pan layar secara dinamis seperti VPVR TradingView
                    </div>
                  </div>
                  <select
                    value={form.rangeMode}
                    onChange={(e) => setForm({ ...form, rangeMode: e.target.value as any })}
                    className="bg-[#0b0e14] text-xs font-semibold text-white px-3 py-1.5 rounded-lg border border-[#2b3548] outline-none"
                  >
                    <option value="visible">Visible Range (VPVR Dinamis)</option>
                    <option value="fixed_bars">Fixed Lookback (N Bar Terakhir)</option>
                  </select>
                </div>

                {form.rangeMode === 'fixed_bars' && (
                  <div className="space-y-2 pb-3 border-b border-[#202838]">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-white">Jumlah Candle Lookback</span>
                      <span className="px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-400 font-mono text-xs font-bold">
                        {form.fixedLookbackBars} Bars
                      </span>
                    </div>
                    <input
                      type="range"
                      min="50"
                      max="500"
                      step="10"
                      value={form.fixedLookbackBars}
                      onChange={(e) => setForm({ ...form, fixedLookbackBars: parseInt(e.target.value, 10) })}
                      className="w-full accent-cyan-400 cursor-pointer"
                    />
                  </div>
                )}

                {/* Row Size (Number of Bins) */}
                <div className="space-y-2 pb-3 border-b border-[#202838]">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-white">Resolusi Baris Harga (Row Layout / Number of Rows)</div>
                      <div className="text-[11px] text-slate-400">
                        Semakin tinggi jumlah baris, semakin detail pemetaan klaster harga HVN & LVN
                      </div>
                    </div>
                    <span className="px-2.5 py-1 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30 font-mono text-xs font-bold">
                      {form.rowSize} Rows
                    </span>
                  </div>
                  <input
                    type="range"
                    min="16"
                    max="100"
                    step="4"
                    value={form.rowSize}
                    onChange={(e) => setForm({ ...form, rowSize: parseInt(e.target.value, 10) })}
                    className="w-full accent-amber-400 cursor-pointer"
                  />
                  <div className="flex items-center gap-1.5 pt-1">
                    {[24, 36, 48, 64, 80, 100].map((r) => (
                      <button
                        key={r}
                        type="button"
                        onClick={() => setForm({ ...form, rowSize: r })}
                        className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border transition-colors cursor-pointer ${
                          form.rowSize === r
                            ? 'bg-amber-500 text-black border-amber-400'
                            : 'bg-[#0b0e14] text-slate-400 border-[#263042] hover:text-white'
                        }`}
                      >
                        {r}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Value Area % */}
                <div className="space-y-2 pb-3 border-b border-[#202838]">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-white">Value Area Volume (%)</div>
                      <div className="text-[11px] text-slate-400">
                        Standar distribusi normal institusional (1 Standar Deviasi = 70% dari total volume)
                      </div>
                    </div>
                    <span className="px-2.5 py-1 rounded bg-sky-500/20 text-sky-400 border border-sky-500/30 font-mono text-xs font-bold">
                      {form.valueAreaVolumePct}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="50"
                    max="90"
                    step="2"
                    value={form.valueAreaVolumePct}
                    onChange={(e) => setForm({ ...form, valueAreaVolumePct: parseInt(e.target.value, 10) })}
                    className="w-full accent-sky-400 cursor-pointer"
                  />
                </div>

                {/* Volume Type */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold text-white">Tipe Komposisi Volume (Volume Type)</div>
                    <div className="text-[11px] text-slate-400">
                      Memisahkan volume Taker Buy vs Taker Sell pada setiap baris harga
                    </div>
                  </div>
                  <select
                    value={form.volumeType}
                    onChange={(e) => setForm({ ...form, volumeType: e.target.value as any })}
                    className="bg-[#0b0e14] text-xs font-semibold text-white px-3 py-1.5 rounded-lg border border-[#2b3548] outline-none"
                  >
                    <option value="up_down">Up / Down Volume (Buy vs Sell Split)</option>
                    <option value="delta">Net Delta Dominance (Buy vs Sell Winner)</option>
                    <option value="total">Total Volume (Monokrom)</option>
                  </select>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3 bg-[#161c28] border-t border-[#263042] flex items-center justify-between">
          <button
            type="button"
            onClick={applyTvStandardPreset}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-400 hover:text-white hover:bg-[#202838] transition-colors cursor-pointer"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset ke Default</span>
          </button>

          <div className="flex items-center space-x-2.5">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-1.5 rounded-lg text-xs font-semibold text-slate-300 hover:bg-[#202838] transition-colors cursor-pointer"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="flex items-center space-x-1.5 px-4 py-1.5 rounded-lg text-xs font-bold bg-cyan-500 hover:bg-cyan-400 text-black shadow-lg shadow-cyan-500/20 transition-all cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Simpan Konfigurasi</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

