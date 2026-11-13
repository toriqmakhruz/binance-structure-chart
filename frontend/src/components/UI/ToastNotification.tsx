import React, { useEffect, useState } from 'react'
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  X,
  Zap,
  TrendingUp,
  TrendingDown,
  ShieldCheck
} from 'lucide-react'
import { formatPrice } from '../../utils/formatters'

export interface ToastData {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  title: string
  message?: string
  details?: {
    symbol?: string
    side?: 'BUY' | 'SELL' | 'LONG' | 'SHORT'
    quantity?: number
    price?: number
    leverage?: number
    mode?: 'demo' | 'live'
    orderId?: number | string
    stopLoss?: number
    takeProfit?: number
  }
  duration?: number
}

interface ToastNotificationProps {
  toasts: ToastData[]
  onDismiss: (id: string) => void
}

export const ToastNotification: React.FC<ToastNotificationProps> = ({ toasts, onDismiss }) => {
  return (
    <div className="fixed top-5 right-5 z-[9999] flex flex-col space-y-2.5 max-w-sm w-full pointer-events-none select-none">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

const ToastItem: React.FC<{ toast: ToastData; onDismiss: (id: string) => void }> = ({
  toast,
  onDismiss
}) => {
  const duration = toast.duration || 5000
  const [progress, setProgress] = useState(100)

  useEffect(() => {
    const startTime = Date.now()
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100)
      setProgress(remaining)
      if (remaining <= 0) {
        clearInterval(interval)
        onDismiss(toast.id)
      }
    }, 50)

    return () => clearInterval(interval)
  }, [toast.id, duration, onDismiss])

  const isSuccess = toast.type === 'success'
  const isError = toast.type === 'error'
  const isWarning = toast.type === 'warning'
  const d = toast.details

  const isLong = d?.side === 'BUY' || d?.side === 'LONG'

  return (
    <div
      className={`pointer-events-auto rounded-xl border p-3.5 shadow-2xl backdrop-blur-md transition-all animate-in slide-in-from-top-3 fade-in duration-200 relative overflow-hidden ${
        isSuccess
          ? 'bg-[#0f1722]/95 border-emerald-600/70 text-emerald-100 shadow-emerald-950/60'
          : isError
          ? 'bg-[#181116]/95 border-rose-600/70 text-rose-100 shadow-rose-950/60'
          : isWarning
          ? 'bg-[#18150f]/95 border-amber-600/70 text-amber-100 shadow-amber-950/60'
          : 'bg-[#111622]/95 border-blue-600/70 text-blue-100 shadow-blue-950/60'
      }`}
    >
      {/* Top row: Icon, Title, Mode, Close button */}
      <div className="flex items-start justify-between">
        <div className="flex items-center space-x-2">
          {isSuccess && (
            <div className="w-6 h-6 rounded-full bg-emerald-500/20 border border-emerald-500/50 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-4 h-4 text-[#00c087]" />
            </div>
          )}
          {isError && (
            <div className="w-6 h-6 rounded-full bg-rose-500/20 border border-rose-500/50 flex items-center justify-center shrink-0">
              <XCircle className="w-4 h-4 text-[#f6465d]" />
            </div>
          )}
          {isWarning && (
            <div className="w-6 h-6 rounded-full bg-amber-500/20 border border-amber-500/50 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-4 h-4 text-[#f0b90b]" />
            </div>
          )}

          <div>
            <div className="font-bold text-xs text-white flex items-center space-x-1.5">
              <span>{toast.title}</span>
              {d?.mode && (
                <span
                  className={`px-1.5 py-0.2 rounded text-[9px] font-mono font-bold uppercase ${
                    d.mode === 'demo'
                      ? 'bg-amber-950/90 text-[#f0b90b] border border-amber-700/60'
                      : 'bg-emerald-950/90 text-[#00c087] border border-emerald-700/60'
                  }`}
                >
                  {d.mode}
                </span>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          className="p-1 rounded text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Details Banner */}
      {d && d.symbol && (
        <div className="mt-2 p-2 rounded-lg bg-black/40 border border-white/10 space-y-1 font-mono text-[11px]">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-1.5">
              <span
                className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase flex items-center space-x-0.5 ${
                  isLong
                    ? 'bg-emerald-950 text-[#00c087] border border-emerald-800'
                    : 'bg-rose-950 text-[#f6465d] border border-rose-800'
                }`}
              >
                {isLong ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                <span>{d.side || (isLong ? 'LONG' : 'SHORT')} {d.leverage ? `${d.leverage}x` : ''}</span>
              </span>
              <span className="font-bold text-white">{d.symbol}</span>
            </div>

            {d.quantity && (
              <span className="text-slate-300 font-semibold">
                {d.quantity} {d.symbol.replace(/USDT$|BUSD$|USDC$/i, '')}
              </span>
            )}
          </div>

          <div className="flex items-center justify-between text-[10px] text-slate-400 font-sans">
            {d.price && d.price > 0 && (
              <span>Entry: <strong className="font-mono text-white">${formatPrice(d.price)}</strong></span>
            )}
            {d.orderId && (
              <span className="text-[9px] opacity-75">ID: #{d.orderId}</span>
            )}
          </div>

          {(d.stopLoss || d.takeProfit) && (
            <div className="pt-1 border-t border-white/5 flex items-center justify-between text-[9px]">
              {d.stopLoss && <span className="text-[#f6465d]">SL: ${formatPrice(d.stopLoss)}</span>}
              {d.takeProfit && <span className="text-[#00c087]">TP: ${formatPrice(d.takeProfit)}</span>}
            </div>
          )}
        </div>
      )}

      {/* Message Text if no structured details */}
      {toast.message && (!d || !d.symbol) && (
        <p className="mt-1.5 text-[11px] text-slate-300 leading-relaxed font-sans">
          {toast.message}
        </p>
      )}

      {/* Progress Bar Timer */}
      <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-black/40">
        <div
          className={`h-full transition-all duration-75 ${
            isSuccess ? 'bg-[#00c087]' : isError ? 'bg-[#f6465d]' : 'bg-[#f0b90b]'
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  )
}
