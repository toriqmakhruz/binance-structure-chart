# Binance Crypto Structure & Forecasting Web App

Aplikasi web charting analitik canggih khusus untuk cryptocurrency **Binance** (Spot & USDT-M Futures) dengan deteksi otomatis struktur pasar (**Smart Money Concepts / SMC**), pola chart klasik, dinamika pergerakan (volatilitas, momentum, volume delta), dan **Hybrid Forecasting** (skenario target harga + kerucut probabilitas statistik).

---

## Fitur Utama

### 1. Analisa Struktur Pasar (Smart Money Concepts / SMC)
- **Swing High & Swing Low**: Deteksi otomatis `HH` (Higher High), `LH` (Lower High), `HL` (Higher Low), dan `LL` (Lower Low).
- **Break of Structure (BOS)** & **Change of Character (CHoCH)**: Garis break dan penanda konfirmasi struktur saat harga menembus level penting.
- **Order Blocks (OB)**: Kotak zona Bullish & Bearish OB dengan indikator status *Mitigated* vs *Unmitigated*.
- **Fair Value Gaps (FVG)**: Zona ketidakseimbangan likuiditas (*imbalance*) dengan highlight transparan.
- **Liquidity Pools**: Deteksi Equal Highs (`EQH`) dan Equal Lows (`EQL`).

### 2. Pola Chart Klasik & Price Action
- Deteksi pola geometris: **Double Top**, **Double Bottom**, **Head & Shoulders**, **Ascending/Descending/Symmetrical Triangles**.
- Garis Support & Resistance (S/R) dinamis dan Trendlines otomatis.

### 3. Hybrid Forecasting & Prediction Cone
- **Algorithmic Structural Targets**: Target take-profit (*measured move*), invalidasi stop-loss, dan rasio Risk:Reward (1:R).
- **Statistical / Probabilistic Cone**: Kerucut probabilitas pergerakan $N$-candle ke depan dengan pita batas deviasi keyakinan 80% dan 95% berbasis *drift-adjusted ATR*.

### 4. Analisa Pergerakan & Confluence HUD (Sidebar)
- **Indeks Konfluensi (%)**: Skor probabilitas multi-faktor (Strong Bullish, Bullish, Neutral, Bearish, Strong Bearish).
- **Tekanan Volume**: Rasio agresivitas Buyer vs Seller Volume Delta.
- **Momentum & Volatilitas**: RSI (14) dengan deteksi divergensi, serta status volatilitas ATR (*Squeeze* / *Expanding*).

### 5. Pengalaman Charting & Drawing Suite Lengkap
- **TradingView Lightweight Charts**: Rendering HTML5 Canvas ultra-halus 60fps.
- **Full Drawing Toolbar**:
  - Garis Tren (*Trendline*)
  - Garis Horizontal / Ray (*Horizontal Line*)
  - Kotak Zona (*Rectangle*)
  - Fibonacci Retracement (0.0, 0.236, 0.382, 0.5, 0.618, 0.786, 1.0)
  - Penggaris Pengukur (*Measure / Ruler* pips, %, dan bars)
  - Penghapus (*Eraser*)
- **Multi-Chart Layout**: Tampilan 1 chart, split 2 chart (vertikal/horizontal), atau grid 4 chart.
- **Real-time Non-Repainting**: Ticking candle berdetik live via Binance WebSocket, sementara analisa struktur dikonfirmasi pada penutupan candle.

---

## Cara Menjalankan Aplikasi

### Opsi 1: Menjalankan di Lokal Windows (1-Click)
Cukup jalankan file:
```cmd
run.bat
```
Script ini akan otomatis:
1. Menjalankan backend FastAPI di `http://localhost:8000`
2. Menjalankan frontend Vite di `http://localhost:3000`
3. Membuka browser default secara otomatis.

---

### Opsi 2: Menjalankan dengan Docker / Docker Compose
Pastikan Docker / Docker Desktop sudah terpasang:
```bash
docker compose up --build
```
Aplikasi akan tersedia di:
- **Web App UI**: `http://localhost:3000`
- **Backend API**: `http://localhost:8000/docs`

---

## Struktur Direktori

```
ANALISA STRUKTUR/
├── backend/
│   ├── app/
│   │   ├── analysis/
│   │   │   ├── smc_engine.py         # Engine SMC: Swings, BOS, CHoCH, OB, FVG
│   │   │   ├── pattern_engine.py     # Engine Pola: Double Top/Bottom, H&S, Triangles, S/R
│   │   │   ├── movement_engine.py    # Engine Pergerakan: ATR, RSI, Delta Volume, Confluence
│   │   │   └── forecast_engine.py    # Hybrid Forecasting: Cone & Skenario Target
│   │   ├── api/
│   │   │   ├── routes.py             # REST API Endpoints
│   │   │   └── websocket.py          # WebSocket Relay Binance Live
│   │   ├── services/
│   │   │   └── binance_service.py    # Binance REST & Vision Client
│   │   ├── models/
│   │   │   └── schemas.py            # Pydantic Schemas
│   │   ├── config.py                 # Konfigurasi Endpoints
│   │   └── main.py                   # FastAPI Entrypoint
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Chart/
│   │   │   │   ├── LightweightChart.tsx  # TradingView Canvas + Custom Overlays + Drawings
│   │   │   │   ├── ChartContainer.tsx    # Multi-Chart Layout Manager
│   │   │   │   ├── DrawingToolbar.tsx    # Drawing Suite Toolbar
│   │   │   │   └── LayerToggles.tsx      # Smart Layer Toggles
│   │   │   ├── HUD/
│   │   │   │   └── ConfluenceSidebar.tsx # Sidebar Konfluensi & Dinamika
│   │   │   ├── Navigation/
│   │   │   │   ├── TopNavbar.tsx         # Navbar Kontrol
│   │   │   │   └── SymbolSelector.tsx    # Modal Pencarian Koin
│   │   │   └── Settings/
│   │   │       └── SettingsDrawer.tsx    # Drawer Sensitivitas Parameter
│   │   ├── services/
│   │   │   ├── api.ts                    # REST API Client
│   │   │   └── binanceWs.ts              # WebSocket Client
│   │   ├── types/
│   │   │   └── analysis.ts               # TypeScript Interfaces
│   │   ├── App.tsx                       # Root Component
│   │   └── main.tsx
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   ├── nginx.conf
│   └── Dockerfile
├── docker-compose.yml
├── run.bat
└── README.md
```
