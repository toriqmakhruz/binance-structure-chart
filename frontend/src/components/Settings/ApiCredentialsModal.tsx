import React, { useState, useEffect } from 'react'
import {
  Key,
  ShieldCheck,
  AlertTriangle,
  X,
  CheckCircle2,
  XCircle,
  RefreshCw,
  ExternalLink,
  Eye,
  EyeOff
} from 'lucide-react'
import { testTradeConnection, fetchTradeBalance, saveServerCredentials, fetchServerCredentials } from '../../services/api'

export interface TradeCredentials {
  demoApiKey: string
  demoApiSecret: string
  liveApiKey: string
  liveApiSecret: string
  useSimulatedDemo: boolean
}

interface ApiCredentialsModalProps {
  isOpen: boolean
  onClose: () => void
  initialMode?: 'demo' | 'live'
  market?: 'spot' | 'futures'
  onSaved?: () => void
}

const STORAGE_KEYS = {
  credentials: 'cp_trade_credentials',
  accountMode: 'cp_trade_active_mode'
}

export function getStoredCredentials(): TradeCredentials {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.credentials)
    if (raw) return JSON.parse(raw)
  } catch {}
  return {
    demoApiKey: '',
    demoApiSecret: '',
    liveApiKey: '',
    liveApiSecret: '',
    useSimulatedDemo: true
  }
}

export const ApiCredentialsModal: React.FC<ApiCredentialsModalProps> = ({
  isOpen,
  onClose,
  initialMode = 'live',
  market = 'futures',
  onSaved
}) => {
  const [mode, setMode] = useState<'demo' | 'live'>(initialMode)
  const [credentials, setCredentials] = useState<TradeCredentials>(() => getStoredCredentials())
  const [showSecrets, setShowSecrets] = useState(false)
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; message: string; balance?: number } | null>(null)

  useEffect(() => {
    if (isOpen) {
      const local = getStoredCredentials()
      setCredentials(local)
      fetchServerCredentials().then((srv) => {
        if (srv && (srv.liveApiKey || srv.demoApiKey)) {
          setCredentials((prev) => ({
            ...prev,
            demoApiKey: srv.demoApiKey || prev.demoApiKey,
            demoApiSecret: srv.demoApiSecret || prev.demoApiSecret,
            liveApiKey: srv.liveApiKey || prev.liveApiKey,
            liveApiSecret: srv.liveApiSecret || prev.liveApiSecret,
          }))
          if (srv.mode && !localStorage.getItem(STORAGE_KEYS.accountMode)) {
            setMode(srv.mode)
          }
        }
      }).catch(() => {})
      try {
        const savedMode = localStorage.getItem(STORAGE_KEYS.accountMode)
        if (savedMode === 'live' || savedMode === 'demo') {
          setMode(savedMode)
        } else {
          setMode(initialMode)
        }
      } catch {
        setMode(initialMode)
      }
      setTestResult(null)
    }
  }, [isOpen, initialMode])

  if (!isOpen) return null

  const activeKey = mode === 'demo' ? credentials.demoApiKey : credentials.liveApiKey
  const activeSecret = mode === 'demo' ? credentials.demoApiSecret : credentials.liveApiSecret

  const handleModeChange = (newMode: 'demo' | 'live') => {
    setMode(newMode)
    setTestResult(null)
  }

  const handleSave = () => {
    try {
      localStorage.setItem(STORAGE_KEYS.credentials, JSON.stringify(credentials))
      localStorage.setItem(STORAGE_KEYS.accountMode, mode)
      saveServerCredentials({ ...credentials, mode }).catch(() => {})
      window.dispatchEvent(new CustomEvent('cp_trade_mode_change', { detail: mode }))
      window.dispatchEvent(new CustomEvent('cp_credentials_updated', { detail: { mode, credentials } }))
      onSaved?.()
      onClose()
    } catch {
      alert('Gagal menyimpan kredensial ke penyimpanan lokal browser.')
    }
  }

  const handleTest = async () => {
    setIsTesting(true)
    setTestResult(null)
    try {
      const connRes = await testTradeConnection(market, mode, activeKey, activeSecret)
      if (connRes.success) {
        const balRes = await fetchTradeBalance(market, mode, activeKey, activeSecret)
        const balText = balRes.success ? ` | Saldo: $${balRes.availableBalance.toFixed(2)} USDT` : ''
        setTestResult({
          success: true,
          message: `${connRes.message || 'Koneksi Binance API berhasil terverifikasi!'}${balText}`,
          balance: balRes.success ? balRes.availableBalance : undefined
        })
        // Auto-save on successful test
        localStorage.setItem(STORAGE_KEYS.credentials, JSON.stringify(credentials))
        localStorage.setItem(STORAGE_KEYS.accountMode, mode)
        window.dispatchEvent(new CustomEvent('cp_trade_mode_change', { detail: mode }))
        window.dispatchEvent(new CustomEvent('cp_credentials_updated', { detail: { mode, credentials } }))
        onSaved?.()
      } else {
        setTestResult({
          success: false,
          message: connRes.message || 'Koneksi gagal. Periksa kembali API Key dan Secret Anda.'
        })
      }
    } catch (err: any) {
      setTestResult({
        success: false,
        message: err?.message || 'Gagal menghubungi server API'
      })
    } finally {
      setIsTesting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm select-none">
      <div className="w-full max-w-md bg-[#0f141f] border border-[#263040] rounded-xl shadow-2xl text-slate-100 overflow-hidden animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-4 bg-[#141a27] border-b border-[#212a38] flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-7 h-7 rounded-lg bg-[#f0b90b]/10 border border-[#f0b90b]/30 flex items-center justify-center text-[#f0b90b]">
              <Key className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-white">Pengaturan API Key Binance</h3>
              <p className="text-[10px] text-slate-400">Sinkronkan posisi & eksekusi order langsung ke Binance</p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-[#1f2636] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 text-xs">
          {/* Mode Tabs */}
          <div className="grid grid-cols-2 p-1 bg-[#0b0e14] border border-[#21293a] rounded-lg gap-1 font-bold">
            <button
              type="button"
              onClick={() => handleModeChange('live')}
              className={`py-1.5 rounded text-xs transition-colors ${
                mode === 'live'
                  ? 'bg-emerald-950 text-[#00c087] border border-emerald-700/60 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Mode LIVE (Binance Riil)
            </button>
            <button
              type="button"
              onClick={() => handleModeChange('demo')}
              className={`py-1.5 rounded text-xs transition-colors ${
                mode === 'demo'
                  ? 'bg-amber-950 text-[#f0b90b] border border-amber-700/60 shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Mode DEMO (Paper / Testnet)
            </button>
          </div>

          {/* Info Notice */}
          {mode === 'live' ? (
            <div className="p-2.5 rounded-lg bg-emerald-950/30 border border-emerald-800/40 text-[11px] text-emerald-200 leading-relaxed space-y-1">
              <div className="flex items-center space-x-1.5 font-bold text-emerald-300">
                <ShieldCheck className="w-3.5 h-3.5 text-[#00c087]" />
                <span>Koneksi Aman & Privat</span>
              </div>
              <p className="text-[10px] text-slate-300">
                API Key Anda <strong>hanya disimpan di browser lokal Anda</strong> (LocalStorage). Pastikan API Key diizinkan untuk <em>Enable Reading</em> dan <em>Enable Futures</em> (JANGAN aktifkan izin penarikan/Withdrawal).
              </p>
            </div>
          ) : (
            <div className="p-2.5 rounded-lg bg-amber-950/30 border border-amber-800/40 text-[11px] text-amber-200 leading-relaxed">
              <div className="flex items-center space-x-1.5 font-bold text-amber-300">
                <ShieldCheck className="w-3.5 h-3.5 text-[#f0b90b]" />
                <span>Simulasi Paper Trading Aman</span>
              </div>
              <p className="text-[10px] text-slate-300 mt-1">
                Jika Anda belum memiliki API Key Testnet, Anda tetap bisa berlatih trading dengan saldo simulasi virtual $10,000 USDT.
              </p>
            </div>
          )}

          {/* API Key Inputs */}
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="text-[11px] font-bold text-slate-300">
                API Key ({mode.toUpperCase()})
              </label>
              <input
                type="text"
                placeholder={mode === 'live' ? 'Masukkan Binance Live API Key...' : 'Binance Testnet API Key...'}
                value={activeKey}
                onChange={(e) => {
                  const val = e.target.value.trim()
                  setCredentials((prev) =>
                    mode === 'live' ? { ...prev, liveApiKey: val } : { ...prev, demoApiKey: val }
                  )
                }}
                className="w-full px-3 py-2 rounded-lg bg-[#141b28] border border-[#263246] text-white font-mono text-xs focus:outline-none focus:border-[#f0b90b]"
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-bold text-slate-300">
                  Secret Key ({mode.toUpperCase()})
                </label>
                <button
                  type="button"
                  onClick={() => setShowSecrets(!showSecrets)}
                  className="text-[10px] text-slate-400 hover:text-white flex items-center space-x-1"
                >
                  {showSecrets ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  <span>{showSecrets ? 'Sembunyikan' : 'Tampilkan'}</span>
                </button>
              </div>
              <input
                type={showSecrets ? 'text' : 'password'}
                placeholder={mode === 'live' ? 'Masukkan Binance Live Secret Key...' : 'Binance Testnet Secret Key...'}
                value={activeSecret}
                onChange={(e) => {
                  const val = e.target.value.trim()
                  setCredentials((prev) =>
                    mode === 'live' ? { ...prev, liveApiSecret: val } : { ...prev, demoApiSecret: val }
                  )
                }}
                className="w-full px-3 py-2 rounded-lg bg-[#141b28] border border-[#263246] text-white font-mono text-xs focus:outline-none focus:border-[#f0b90b]"
              />
            </div>
          </div>

          {/* Test Status Message */}
          {testResult && (
            <div
              className={`p-2.5 rounded-lg border text-xs flex items-start space-x-2 ${
                testResult.success
                  ? 'bg-emerald-950/60 border-emerald-800 text-[#00c087]'
                  : 'bg-rose-950/60 border-rose-800 text-[#f6465d]'
              }`}
            >
              {testResult.success ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              ) : (
                <XCircle className="w-4 h-4 shrink-0 mt-0.5" />
              )}
              <div className="space-y-0.5 leading-tight">
                <span className="font-bold">{testResult.success ? 'Berhasil Terhubung' : 'Gagal Terhubung'}</span>
                <p className="text-[11px] opacity-90">{testResult.message}</p>
              </div>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div className="p-3 bg-[#141a27] border-t border-[#212a38] flex items-center justify-between">
          <button
            type="button"
            onClick={handleTest}
            disabled={isTesting || (mode === 'live' && (!activeKey || !activeSecret))}
            className="px-3 py-2 rounded-lg bg-[#1e2535] hover:bg-[#283247] text-slate-200 font-semibold text-xs transition-colors flex items-center space-x-1.5 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isTesting ? 'animate-spin text-[#f0b90b]' : ''}`} />
            <span>{isTesting ? 'Menguji...' : 'Tes Koneksi'}</span>
          </button>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-2 rounded-lg bg-[#1b2230] text-slate-300 text-xs hover:bg-[#252f42] transition-colors"
            >
              Tutup
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-4 py-2 rounded-lg bg-[#00c087] hover:bg-[#00ab78] text-black font-bold text-xs shadow-lg transition-all"
            >
              Simpan & Sinkronkan
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
