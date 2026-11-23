import React, { useState, useEffect } from 'react'
import {
  X,
  Flame,
  Activity,
  RotateCcw,
  Check,
  Sparkles,
  ShieldCheck,
  Layers
} from 'lucide-react'
import { OrderflowSettings, DEFAULT_ORDERFLOW_SETTINGS } from '../../types/orderflow'

interface OrderflowModalProps {
  isOpen: boolean
  initialTab?: 'liquidation' | 'cvd'
  settings: OrderflowSettings
  onClose: () => void
  onSave: (newSettings: OrderflowSettings) => void
}

export const OrderflowModal: React.FC<OrderflowModalProps> = ({
  isOpen,
  initialTab = 'liquidation',
  settings,
  onClose,
  onSave
}) => {
  const [form, setForm] = useState<OrderflowSettings>(settings)
  const [activeTab, setActiveTab] = useState<'liquidation' | 'cvd'>(initialTab)

  useEffect(() => {
    setForm(settings)
  }, [settings, isOpen])

  useEffect(() => {
    if (isOpen && initialTab) {
      setActiveTab(initialTab)
    }
  }, [isOpen, initialTab])

  if (!isOpen) return null

  const applyDefaultPreset = () => {
    setForm({ ...DEFAULT_ORDERFLOW_SETTINGS })
  }

  const applyScalperHighLevPreset = () => {
    setForm({
      ...form,
      enable100x: true,
      enable50x: true,
      enable25x: false,
      enable10x: false,
      liqLookbackBars: 100,
      minIntensityThreshold: 0.20,
      showCvdDivergence: true,
      showDeltaImbalance: true,
      deltaImbalanceMultiplier: 1.8
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
            <div className="w-7 h-7 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Flame className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-white text-sm tracking-wide flex items-center space-x-2">
                <span>Orderflow & Derivatives Intelligence</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  Coinglass • CVD
                </span>
              </h3>
              <p className="text-[11px] text-slate-400">
                Konfigurasi Liquidation Heatmap (25x/50x/100x) & Cumulative Volume Delta (CVD)
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
            onClick={() => setActiveTab('liquidation')}
            className={`pb-2.5 px-3 text-xs font-bold transition-all border-b-2 flex items-center space-x-1.5 cursor-pointer ${
              activeTab === 'liquidation'
                ? 'border-amber-400 text-amber-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Flame className="w-3.5 h-3.5" />
            <span>Liquidation Heatmap (25x/50x/100x)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('cvd')}
            className={`pb-2.5 px-3 text-xs font-bold transition-all border-b-2 flex items-center space-x-1.5 cursor-pointer ${
              activeTab === 'cvd'
                ? 'border-cyan-400 text-cyan-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>CVD & Orderflow Divergence</span>
          </button>
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 custom-scrollbar">
          {/* Quick Presets */}
          <div className="flex flex-wrap items-center justify-between gap-2 bg-[#161c28] p-2.5 rounded-lg border border-[#232c3d]">
            <span className="text-[11px] font-semibold text-slate-400 flex items-center space-x-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>Preset Institusional:</span>
            </span>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={applyDefaultPreset}
                className="px-2.5 py-1 rounded text-[11px] font-bold bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 transition-colors cursor-pointer"
              >
                Coinglass Standard (25x/50x/100x)
              </button>
              <button
                type="button"
                onClick={applyScalperHighLevPreset}
                className="px-2.5 py-1 rounded text-[11px] font-bold bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 transition-colors cursor-pointer"
              >
                High-Leverage Sniper (50x & 100x)
              </button>
            </div>
          </div>

          {activeTab === 'liquidation' ? (
            <div className="space-y-4">
              {/* Info Banner */}
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3.5 flex items-start space-x-3">
                <Flame className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1 text-xs">
                  <div className="font-bold text-amber-300">
                    Pemetaan Zona Likuidasi Aktif (Un-Swept Leverage Pools)
                  </div>
                  <p className="text-slate-300 leading-relaxed text-[11px]">
                    Menghitung klaster estimasi harga likuidasi posisi <span className="text-rose-400 font-bold">SHORT (di atas harga)</span> dan{' '}
                    <span className="text-emerald-400 font-bold">LONG (di bawah harga)</span> yang belum tersapu pasar.
                    Warna <span className="text-yellow-300 font-bold">Kuning Menyala</span> menandakan magnet likuiditas terbesar tempat Market Maker sering mendorong harga.
                  </p>
                </div>
              </div>

              {/* Leverage Tiers */}
              <div className="bg-[#151b26] p-4 rounded-xl border border-[#222b3b] space-y-3">
                <div className="text-xs font-bold text-white flex items-center space-x-1.5">
                  <Layers className="w-3.5 h-3.5 text-amber-400" />
                  <span>Tier Leverage yang Dipetakan</span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                  <label className="flex items-center space-x-2 p-2.5 rounded-lg bg-[#0f131c] border border-[#202838] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.enable100x}
                      onChange={(e) => setForm({ ...form, enable100x: e.target.checked })}
                      className="rounded bg-[#0b0e14] border-slate-600 text-amber-500 focus:ring-0"
                    />
                    <div>
                      <div className="text-xs font-bold text-yellow-400">100x Tier</div>
                      <div className="text-[10px] text-slate-400">±0.95% Jarak</div>
                    </div>
                  </label>

                  <label className="flex items-center space-x-2 p-2.5 rounded-lg bg-[#0f131c] border border-[#202838] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.enable50x}
                      onChange={(e) => setForm({ ...form, enable50x: e.target.checked })}
                      className="rounded bg-[#0b0e14] border-slate-600 text-amber-500 focus:ring-0"
                    />
                    <div>
                      <div className="text-xs font-bold text-amber-400">50x Tier</div>
                      <div className="text-[10px] text-slate-400">±1.90% Jarak</div>
                    </div>
                  </label>

                  <label className="flex items-center space-x-2 p-2.5 rounded-lg bg-[#0f131c] border border-[#202838] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.enable25x}
                      onChange={(e) => setForm({ ...form, enable25x: e.target.checked })}
                      className="rounded bg-[#0b0e14] border-slate-600 text-cyan-500 focus:ring-0"
                    />
                    <div>
                      <div className="text-xs font-bold text-cyan-400">25x Tier</div>
                      <div className="text-[10px] text-slate-400">±3.85% Jarak</div>
                    </div>
                  </label>

                  <label className="flex items-center space-x-2 p-2.5 rounded-lg bg-[#0f131c] border border-[#202838] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.enable10x}
                      onChange={(e) => setForm({ ...form, enable10x: e.target.checked })}
                      className="rounded bg-[#0b0e14] border-slate-600 text-purple-500 focus:ring-0"
                    />
                    <div>
                      <div className="text-xs font-bold text-purple-400">10x Tier</div>
                      <div className="text-[10px] text-slate-400">±9.50% Jarak</div>
                    </div>
                  </label>
                </div>
              </div>

              {/* Heatmap Visual Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-[#151b26] p-3.5 rounded-xl border border-[#222b3b] space-y-3">
                  <div className="text-xs font-bold text-slate-300">Skema Warna & Intensitas</div>

                  <div className="flex items-center justify-between">
                    <span className="text-xs text-slate-400">Palet Thermal</span>
                    <select
                      value={form.liqTheme}
                      onChange={(e) => setForm({ ...form, liqTheme: e.target.value as any })}
                      className="bg-[#0b0e14] text-xs font-semibold text-white px-2.5 py-1 rounded border border-[#2b3548] outline-none"
                    >
                      <option value="coinglass">Coinglass (Ungu → Cyan → Kuning)</option>
                      <option value="cyber">Cyber Neon (Biru → Emerald → Emas)</option>
                      <option value="fire">Thermal Fire (Merah → Oranye → Kuning)</option>
                    </select>
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>Opasitas Pita Heatmap</span>
                      <span className="font-mono text-amber-400 font-bold">{Math.round(form.liqOpacity * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0.20"
                      max="0.85"
                      step="0.05"
                      value={form.liqOpacity}
                      onChange={(e) => setForm({ ...form, liqOpacity: parseFloat(e.target.value) })}
                      className="w-full accent-amber-400 cursor-pointer"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>Filter Threshold Likuiditas Minimum</span>
                      <span className="font-mono text-amber-400 font-bold">{Math.round(form.minIntensityThreshold * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0.10"
                      max="0.60"
                      step="0.05"
                      value={form.minIntensityThreshold}
                      onChange={(e) => setForm({ ...form, minIntensityThreshold: parseFloat(e.target.value) })}
                      className="w-full accent-amber-400 cursor-pointer"
                    />
                  </div>
                </div>

                <div className="bg-[#151b26] p-3.5 rounded-xl border border-[#222b3b] space-y-3">
                  <div className="text-xs font-bold text-slate-300">Label Magnet & Cakupan Bar</div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>Kedalaman Riwayat Candle</span>
                      <span className="font-mono text-amber-400 font-bold">{form.liqLookbackBars} Bars</span>
                    </div>
                    <input
                      type="range"
                      min="60"
                      max="300"
                      step="20"
                      value={form.liqLookbackBars}
                      onChange={(e) => setForm({ ...form, liqLookbackBars: parseInt(e.target.value, 10) })}
                      className="w-full accent-amber-400 cursor-pointer"
                    />
                  </div>

                  <label className="flex items-center justify-between cursor-pointer pt-1">
                    <span className="text-xs text-slate-300">Garis Magnet Likuidasi Terkuat</span>
                    <input
                      type="checkbox"
                      checked={form.showLiqMagnets}
                      onChange={(e) => setForm({ ...form, showLiqMagnets: e.target.checked })}
                      className="rounded bg-[#0b0e14] border-slate-600 text-amber-500 focus:ring-0"
                    />
                  </label>

                  <label className="flex items-center justify-between cursor-pointer pt-1">
                    <span className="text-xs text-slate-300">Tampilkan Badge Harga & Leverage</span>
                    <input
                      type="checkbox"
                      checked={form.showLiqLabels}
                      onChange={(e) => setForm({ ...form, showLiqLabels: e.target.checked })}
                      className="rounded bg-[#0b0e14] border-slate-600 text-amber-500 focus:ring-0"
                    />
                  </label>

                  <label className="flex items-center justify-between cursor-pointer pt-1">
                    <div>
                      <div className="text-xs text-slate-300">Histogram Profil Likuidasi (Sisi Kanan)</div>
                      <div className="text-[10px] text-slate-400">Bar kumulatif kedalaman likuidasi gaya Coinglass</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={form.showLiqProfileBar ?? true}
                      onChange={(e) => setForm({ ...form, showLiqProfileBar: e.target.checked })}
                      className="rounded bg-[#0b0e14] border-slate-600 text-amber-500 focus:ring-0"
                    />
                  </label>

                  <label className="flex items-center justify-between cursor-pointer pt-1">
                    <div>
                      <div className="text-xs text-slate-300">Legend Skala Thermal Coinglass</div>
                      <div className="text-[10px] text-slate-400">Colorbar spektrum thermal di sudut chart</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={form.showLiqLegend ?? true}
                      onChange={(e) => setForm({ ...form, showLiqLegend: e.target.checked })}
                      className="rounded bg-[#0b0e14] border-slate-600 text-amber-500 focus:ring-0"
                    />
                  </label>
                </div>
              </div>
            </div>
          ) : (
            /* Tab 2: CVD & Orderflow Divergence */
            <div className="space-y-4">
              <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-xl p-3.5 flex items-start space-x-3">
                <ShieldCheck className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
                <div className="space-y-1 text-xs">
                  <div className="font-bold text-cyan-300">
                    Cumulative Volume Delta (CVD) & Institutional Absorption
                  </div>
                  <p className="text-slate-300 leading-relaxed text-[11px]">
                    Mengukur selisih bersih antara <span className="text-emerald-400 font-bold">Market Buy Agresif (Taker Buy)</span> vs{' '}
                    <span className="text-rose-400 font-bold">Market Sell Agresif (Taker Sell)</span>. Mendeteksi otomatis sinyal{' '}
                    <span className="text-emerald-300 font-bold">Bullish CVD Absorption</span> (harga turun tapi institusi akumulasi) dan{' '}
                    <span className="text-rose-300 font-bold">Bearish CVD Exhaustion</span> (harga naik tanpa dukungan pembeli).
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="bg-[#151b26] p-3.5 rounded-xl border border-[#222b3b] space-y-3">
                  <div className="text-xs font-bold text-slate-300">Komponen Visual CVD</div>

                  <label className="flex items-center justify-between cursor-pointer pt-1">
                    <div>
                      <div className="text-xs font-semibold text-white">Kurva CVD & Delta Histogram Bawah</div>
                      <div className="text-[10px] text-slate-400">Panel kurva kumulatif delta di bagian bawah chart</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={form.showCvdRibbon}
                      onChange={(e) => setForm({ ...form, showCvdRibbon: e.target.checked })}
                      className="rounded bg-[#0b0e14] border-slate-600 text-cyan-500 focus:ring-0"
                    />
                  </label>

                  <label className="flex items-center justify-between cursor-pointer pt-1">
                    <div>
                      <div className="text-xs font-semibold text-white">Deteksi Garis Divergensi CVD Otomatis</div>
                      <div className="text-[10px] text-slate-400">Tandai Bullish Absorption & Bearish Exhaustion</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={form.showCvdDivergence}
                      onChange={(e) => setForm({ ...form, showCvdDivergence: e.target.checked })}
                      className="rounded bg-[#0b0e14] border-slate-600 text-cyan-500 focus:ring-0"
                    />
                  </label>

                  <label className="flex items-center justify-between cursor-pointer pt-1">
                    <div>
                      <div className="text-xs font-semibold text-white">Penanda Whale Delta Imbalance</div>
                      <div className="text-[10px] text-slate-400">Tandai candle dengan lonjakan agresor institusi</div>
                    </div>
                    <input
                      type="checkbox"
                      checked={form.showDeltaImbalance}
                      onChange={(e) => setForm({ ...form, showDeltaImbalance: e.target.checked })}
                      className="rounded bg-[#0b0e14] border-slate-600 text-cyan-500 focus:ring-0"
                    />
                  </label>
                </div>

                <div className="bg-[#151b26] p-3.5 rounded-xl border border-[#222b3b] space-y-3">
                  <div className="text-xs font-bold text-slate-300">Dimensi & Sensitivitas Orderflow</div>

                  <div className="space-y-1">
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>Tinggi Panel Kurva CVD (% Layar)</span>
                      <span className="font-mono text-cyan-400 font-bold">{form.cvdRibbonHeightPct}%</span>
                    </div>
                    <input
                      type="range"
                      min="12"
                      max="25"
                      step="1"
                      value={form.cvdRibbonHeightPct}
                      onChange={(e) => setForm({ ...form, cvdRibbonHeightPct: parseInt(e.target.value, 10) })}
                      className="w-full accent-cyan-400 cursor-pointer"
                    />
                  </div>

                  <div className="space-y-1 pt-1">
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>Multiplier Whale Delta Imbalance</span>
                      <span className="font-mono text-cyan-400 font-bold">{form.deltaImbalanceMultiplier.toFixed(1)}x Avg</span>
                    </div>
                    <input
                      type="range"
                      min="1.5"
                      max="3.5"
                      step="0.1"
                      value={form.deltaImbalanceMultiplier}
                      onChange={(e) => setForm({ ...form, deltaImbalanceMultiplier: parseFloat(e.target.value) })}
                      className="w-full accent-cyan-400 cursor-pointer"
                    />
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <span className="text-xs text-slate-300">Warna Garis Kurva CVD</span>
                    <input
                      type="color"
                      value={form.cvdLineColor}
                      onChange={(e) => setForm({ ...form, cvdLineColor: e.target.value })}
                      className="w-6 h-6 rounded cursor-pointer bg-transparent border-0 p-0"
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="px-5 py-3 bg-[#161c28] border-t border-[#263042] flex items-center justify-between">
          <button
            type="button"
            onClick={applyDefaultPreset}
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
              className="flex items-center space-x-1.5 px-4 py-1.5 rounded-lg text-xs font-bold bg-amber-500 hover:bg-amber-400 text-black shadow-lg shadow-amber-500/20 transition-all cursor-pointer"
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
