import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App'
import { ErrorBoundary } from './components/UI/ErrorBoundary'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary fallbackTitle="Aplikasi Mengalami Kendala Tampilan">
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
