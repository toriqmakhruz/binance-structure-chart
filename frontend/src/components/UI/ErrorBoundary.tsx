import React, { Component, ErrorInfo, ReactNode } from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'

interface Props {
  children: ReactNode
  fallbackTitle?: string
}

interface State {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  }

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an unhandled error:', error, errorInfo)
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null })
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full min-h-[160px] bg-[#0b0e14] border border-rose-900/60 rounded-xl p-4 flex flex-col items-center justify-center text-center space-y-3 text-slate-200">
          <div className="w-10 h-10 rounded-full bg-rose-500/20 border border-rose-500/50 flex items-center justify-center text-[#f6465d]">
            <AlertTriangle className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <h4 className="font-bold text-sm text-white">
              {this.props.fallbackTitle || 'Terjadi Kendala Tampilan'}
            </h4>
            <p className="text-xs text-slate-400 max-w-md font-mono bg-black/40 p-2 rounded border border-white/5 overflow-hidden text-ellipsis">
              {this.state.error?.message || 'Unknown render exception'}
            </p>
          </div>
          <button
            type="button"
            onClick={this.handleReset}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-[#1e2738] hover:bg-[#2b374e] border border-slate-700 text-xs font-semibold text-white transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5 text-[#f0b90b]" />
            <span>Muat Ulang Panel</span>
          </button>
        </div>
      )
    }

    return this.props.children
  }
}
