import React from 'react'
import { X, Sliders, RotateCcw, Check, Sparkles } from 'lucide-react'
import { AppSettings } from '../../types/analysis'

interface SettingsDrawerProps {
  isOpen: boolean
  settings: AppSettings
  onClose: () => void
  onSave: (newSettings: AppSettings) => void
}

export const SettingsDrawer: React.FC<SettingsDrawerProps> = ({
  isOpen,
  settings,
  onClose,
  onSave
}) => {
  const [form, setForm] = React.useState<AppSettings>(settings)

  React.useEffect(() => {
    setForm(settings)
  }, [settings, isOpen])

  if (!isOpen) return null

  const handleReset = () => {
    setForm({
      swingLength: 5,
      fvgMinPct: 0.05,
      forecastHorizon: 20,
      htf: '4h'
    })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex justify-end">
      <div className="w-96 bg-[#161b22] border-l border-[#30363d] h-full flex flex-col shadow-2xl animate-in slide-in-from-right duration-200">
        {/* Header */}
        <div className="p-4 border-b border-[#21262d] flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Sliders className="w-5 h-5 text-[#f0b90b]" />
            <h3 className="font-bold text-white text-base">Pengaturan Analisa & Parameter</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#21262d]"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-4 flex-1 overflow-y-auto space-y-6 text-sm">
          {/* 1. SMC Sensitivitas */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="font-bold text-white text-xs uppercase tracking-wider flex items-center">
                <Sparkles className="w-3.5 h-3.5 text-purple-400 mr-1.5" />
                SMC Swing Lookback (Length)
              </label>
              <span className="font-mono text-xs font-bold text-[#f0b90b] bg-[#0d1117] px-2 py-0.5 rounded border border-[#21262d]">
                {form.swingLength} Bars
              </span>
            </div>
            <input
              type="range"
              min="2"
              max="15"
              value={form.swingLength}
              onChange={(e) => setForm({ ...form, swingLength: parseInt(e.target.value) })}
              className="w-full accent-[#f0b90b] cursor-pointer"
            />
            <p className="text-[11px] text-slate-400">
              Menentukan sensitivitas deteksi Swing High/Low untuk BOS & CHoCH. Angka lebih kecil = lebih sensitif (cocok scalping).
            </p>
          </div>

          <div className="w-full border-b border-[#21262d]" />

          {/* 2. FVG Minimum Threshold */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="font-bold text-white text-xs uppercase tracking-wider flex items-center">
                <Sparkles className="w-3.5 h-3.5 text-cyan-400 mr-1.5" />
                Ambang Minimal FVG (%)
              </label>
              <span className="font-mono text-xs font-bold text-[#f0b90b] bg-[#0d1117] px-2 py-0.5 rounded border border-[#21262d]">
                {form.fvgMinPct}%
              </span>
            </div>
            <input
              type="range"
              min="0.01"
              max="0.30"
              step="0.01"
              value={form.fvgMinPct}
              onChange={(e) => setForm({ ...form, fvgMinPct: parseFloat(e.target.value) })}
              className="w-full accent-[#f0b90b] cursor-pointer"
            />
            <p className="text-[11px] text-slate-400">
              Filter ukuran minimal Fair Value Gap. Gap yang lebih kecil dari persentase ini akan diabaikan agar chart tidak terlalu ramai.
            </p>
          </div>

          <div className="w-full border-b border-[#21262d]" />

          {/* 3. Forecast Horizon */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="font-bold text-white text-xs uppercase tracking-wider flex items-center">
                <Sparkles className="w-3.5 h-3.5 text-amber-400 mr-1.5" />
                Rentang Candle Forecast (Horizon)
              </label>
              <span className="font-mono text-xs font-bold text-[#f0b90b] bg-[#0d1117] px-2 py-0.5 rounded border border-[#21262d]">
                {form.forecastHorizon} Candle
              </span>
            </div>
            <input
              type="range"
              min="5"
              max="50"
              step="5"
              value={form.forecastHorizon}
              onChange={(e) => setForm({ ...form, forecastHorizon: parseInt(e.target.value) })}
              className="w-full accent-[#f0b90b] cursor-pointer"
            />
            <p className="text-[11px] text-slate-400">
              Jumlah candle ke masa depan untuk proyeksi trajectory harga dan kerucut probabilitas (Confidence Cone).
            </p>
          </div>

          <div className="w-full border-b border-[#21262d]" />

          {/* 4. MTF (Higher Timeframe) Overlay */}
          <div className="space-y-2">
            <label className="font-bold text-white text-xs uppercase tracking-wider block">
              Higher Timeframe (HTF) Overlay
            </label>
            <div className="grid grid-cols-4 gap-2">
              {['none', '1h', '4h', '1d'].map((tf) => (
                <button
                  key={tf}
                  type="button"
                  onClick={() => setForm({ ...form, htf: tf })}
                  className={`py-2 text-xs font-mono font-bold rounded-lg border transition-all ${
                    form.htf === tf
                      ? 'bg-[#f0b90b] text-black border-[#f0b90b]'
                      : 'bg-[#0d1117] text-slate-400 border-[#21262d] hover:text-white'
                  }`}
                >
                  {tf === 'none' ? 'OFF' : tf.toUpperCase()}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-400">
              Tampilkan zona Order Block & BOS dari timeframe lebih tinggi ke chart saat ini.
            </p>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-4 border-t border-[#21262d] bg-[#111620] flex items-center justify-between">
          <button
            onClick={handleReset}
            className="flex items-center space-x-1.5 text-xs text-slate-400 hover:text-white px-3 py-2 rounded-lg hover:bg-[#1f242c]"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Default</span>
          </button>

          <button
            onClick={() => {
              onSave(form)
              onClose()
            }}
            className="flex items-center space-x-1.5 bg-[#f0b90b] hover:bg-[#dfac09] text-black font-bold text-xs px-4 py-2 rounded-lg shadow-lg"
          >
            <Check className="w-4 h-4 stroke-[2.5]" />
            <span>Terapkan Pengaturan</span>
          </button>
        </div>
      </div>
    </div>
  )
}
