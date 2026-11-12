# Binance Crypto Structure & Forecasting Web App

Aplikasi web charting analitik canggih khusus untuk cryptocurrency **Binance** (Spot & USDT-M Futures) dengan deteksi otomatis struktur pasar (**Smart Money Concepts / SMC**), pola chart klasik, dinamika pergerakan (volatilitas, momentum, volume delta), dan **Hybrid Forecasting** (skenario target harga + kerucut volatilitas expanding berbasis drift-adjusted ATR).

> [!IMPORTANT]
> **Keputusan Operasional & Disclaimer**: Ruang lingkup aplikasi ini adalah *market analysis* dan *decision support*. Aplikasi tidak melakukan eksekusi order otomatis (auto-trading). Probabilitas skenario yang belum terkalibrasi secara empiris disajikan secara transparan sebagai skor bobot konfluensi (Confluence Score).

---

## Fitur Utama & Spesifikasi Teknis

### 1. Integritas Data Binance Terisolasi (P0-A)
- **Isolasi Endpoint**: Endpoint Spot (`api.binance.com`, `data-api.binance.vision`) dan USDT-M Futures (`fapi.binance.com`, `fapi1.binance.com`) dipisahkan secara ketat tanpa crossover/fallback silang.
- **Bebas Harga Sintetis**: Tidak ada harga statis hardcoded di jalur produksi. Jika seluruh gateway upstream Binance tidak dapat diakses, sistem mengembalikan status eksplisit `DATA_UNAVAILABLE` (HTTP 503).
- **Validasi Ketat OHLCV & Timestamp**: Memvalidasi relasi matematis candle (`high >= max(open, close, low)`, `low <= min(open, close, high)`), membuang volume negatif, mendeteksi nilai non-finite (`NaN`/`Inf`), mengurutkan timestamp secara ascending deterministik, serta membedakan candle open (*provisional*) vs closed.
- **Metadata Respons Lengkap**: Setiap data membawa metadata `market_type`, `symbol`, `interval`, `source`, dan `received_at`.

### 2. Analisa Struktur Pasar (Smart Money Concepts / SMC) (P0-B)
- **Swing Detection Deterministik**: Swing awal tanpa pembanding struktural diberi label dasar (`H` / `L`). Label `HH`, `HL`, `LH`, dan `LL` hanya diberikan setelah diverifikasi dengan swing pembanding yang sah.
- **Kronologi BOS & CHoCH Non-Repainting**: Evaluasi sekuensial candle-by-candle menggunakan state machine. Swing point baru diaktifkan setelah melewati *right-bars confirmation*. Diterapkan aturan close-break untuk mencegah false-break akibat wick spike.
- **Order Blocks (OB) Lifecycle**: Memeriksa overlap rentang zona sesungguhnya `[candle.low <= top and candle.high >= bottom]`. Status terbagi eksplisit: `ACTIVE`, `MITIGATED` (terisi), dan `INVALIDATED` (candle close menembus batas zona).
- **Fair Value Gaps (FVG)**: Deteksi gap 3-candle dengan pelacakan persentase penetrasi (`fill_pct`), status `UNFILLED`, `PARTIALLY_FILLED`, `FILLED`, dan `INVALIDATED`.
- **Liquidity Pools (EQH / EQL)**: Algoritma clustering multi-touch berbasis toleransi dinamis (0.15%) lengkap dengan pelacakan status *liquidity sweep* (wick menembus level tetapi close bertahan di dalam).

### 3. Hybrid Forecasting & Volatility Cone (P0-C)
- **Pemisahan Konfluensi & Probabilitas**: Skor konfluensi (0-100) disajikan secara jujur sebagai `Confluence Score` / bobot keselarasan sinyal, bukan probabilitas statistik semu.
- **Prediction Cone Non-Leakage**: Kerucut deviasi volatilitas 80% dan 95% ($1.28\sigma$ dan $1.96\sigma$) dihitung berbasis drift historis dan $\text{ATR} \times \sqrt{k}$ masa lampau tanpa mengintip data masa depan (*zero lookahead*).

### 4. Indikator Momentum & Pola Geometris (P1-A)
- **RSI Edge Case Safety**: Menangani kondisi ekstrem zero loss (RSI 100.0, bukan 50.0), zero gain (RSI 0.0), harga flat konstan (RSI 50.0), dan data pendek.
- **Konfirmasi Breakout Pola**: Double Top, Double Bottom, dan Head and Shoulders memiliki status lifecycle `FORMING`, `CONFIRMED` (setelah penutupan candle menembus neckline), dan `INVALIDATED`.
- **Kelengkapan Segitiga**: Mendukung Symmetrical Triangle, Ascending Triangle, dan Descending Triangle (support datar dengan resistance menurun).

### 5. WebSocket Upstream & Multi-Timeframe Sejati (P1-B)
- **Resilient Upstream Relay**: Reconnection loop dengan exponential backoff dan random jitter.
- **Pemisahan Status Koneksi**: Status browser WebSocket dipisahkan dari status Binance upstream. Status eksplisit dikirim ke UI: `LIVE`, `CONNECTING`, `RECONNECTING`, `DATA_STALE` (>45 detik tanpa tick), dan `OFFLINE`.
- **Multi-Timeframe Independen**: Setiap panel layout (`5m`, `15m`, `1h`, `4h`) mengambil dan menampilkan candle, indikator, dan struktur dari intervalnya masing-masing. Pergantian simbol me-reset state lama.

### 6. Keamanan & Deployment Konsisten (P1-C)
- **TLS Verification**: Verifikasi sertifikat TLS aktif secara default (`verify=True`).
- **Strict CORS**: Batasan origin eksplisit untuk frontend (`http://localhost:3000`, `http://127.0.0.1:3000`), menolak wildcard bersama credentials.
- **Port Tersinkronisasi**: Seluruh konfigurasi Docker Compose, script startup Windows, dan dokumentasi selaras menggunakan port backend `8000` dan frontend `3000`.

### 7. Chronological Walk-Forward Backtesting (P1-D)
- Endpoint `/api/backtest` menyediakan simulasi time-series walk-forward kronologis out-of-sample dengan memperhitungkan taker fees, slippage, funding rate, profit factor, win rate, expectancy, dan maximum drawdown.

---

## Cara Menjalankan Aplikasi

### Opsi 1: Menjalankan di Lokal Windows (1-Click)
Cukup jalankan file:
```cmd
run.bat
```
Script ini akan otomatis:
1. Memeriksa ketersediaan virtualenv atau python environment lokal.
2. Memeriksa dependensi frontend (`npm install` otomatis jika pertama kali dijalankan).
3. Menjalankan Backend FastAPI di `http://localhost:8000`
4. Menjalankan Frontend Vite di `http://localhost:3000`
5. Membuka browser default secara otomatis.

---

### Opsi 2: Menjalankan dengan Docker Compose
Pastikan Docker Desktop sudah aktif:
```bash
docker compose up --build
```
Aplikasi akan tersedia di:
- **Web App UI**: `http://localhost:3000`
- **Backend API**: `http://localhost:8000/docs`

---

## Menjalankan Automated Tests

Aplikasi dilengkapi test suite komprehensif (29 unit tests):
```bash
# Menjalankan seluruh test backend
python -m pytest backend/tests/ -v
```

Komponen test mencakup:
- `test_data_integrity.py`: Validasi OHLCV, pencegahan harga sintetis, isolasi Spot vs Futures, dan metadata.
- `test_smc_engine.py`: Swing detection deterministik, urutan kronologis BOS/CHoCH, mitigasi & invalidasi OB, partial/full fill FVG, dan sweep liquidity pool.
- `test_forecast_engine.py`: Pemisahan konfluensi vs probabilitas, expanding bounds kerucut prediksi, zero-leakage time series.
- `test_indicator_and_pattern.py`: RSI edge cases (zero loss, zero gain, flat), status FORMING/CONFIRMED pola breakout, dan Descending Triangle.
- `test_backtest_engine.py`: Walk-forward chronological split, accounting fee/slippage/funding, dan metrik drawdown.

---

## Struktur Direktori

```
CHART PATERN/
├── backend/
│   ├── app/
│   │   ├── analysis/
│   │   │   ├── smc_engine.py         # Engine SMC: Swings, BOS, CHoCH, OB, FVG, Liquidity
│   │   │   ├── pattern_engine.py     # Engine Pola: Double Top/Bottom, H&S, Triangles
│   │   │   ├── movement_engine.py    # Engine Pergerakan: ATR, RSI (Edge-safe), Delta Volume, Confluence
│   │   │   ├── forecast_engine.py    # Hybrid Forecasting: Expanding Volatility Cone & Targets
│   │   │   ├── backtest_engine.py    # Chronological Walk-Forward Backtesting Framework
│   │   │   └── utils.py              # Dynamic Rounding Helpers
│   │   ├── api/
│   │   │   ├── routes.py             # REST API Endpoints (/symbols, /analysis, /backtest)
│   │   │   └── websocket.py          # Resilient WebSocket Relay & Stale Monitor
│   │   ├── services/
│   │   │   └── binance_service.py    # Isolated Binance Client (Spot & Futures separated)
│   │   ├── models/
│   │   │   └── schemas.py            # Pydantic Schemas dengan Lifecycle Status & Metadata
│   │   ├── config.py                 # Konfigurasi Endpoints & Security
│   │   └── main.py                   # FastAPI Entrypoint & Explicit CORS
│   ├── tests/                        # 29 Automated Unit Tests
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Chart/
│   │   │   │   ├── LightweightChart.tsx  # TradingView Canvas + Custom Overlays + Drawings
│   │   │   │   ├── ChartContainer.tsx    # Multi-Chart Layout Manager dengan Sub-Timeframe Sejati
│   │   │   │   ├── DrawingToolbar.tsx    # Drawing Suite Toolbar
│   │   │   │   └── LayerToggles.tsx      # Smart Layer Toggles
│   │   │   ├── HUD/
│   │   │   │   └── ConfluenceSidebar.tsx # Sidebar Konfluensi (Label Bobot Transparan)
│   │   │   ├── Navigation/
│   │   │   │   ├── TopNavbar.tsx         # Navbar Kontrol & Badge Status Stream
│   │   │   │   └── SymbolSelector.tsx    # Modal Pencarian Koin
│   │   │   └── Settings/
│   │   │       └── SettingsDrawer.tsx    # Drawer Sensitivitas Parameter
│   │   ├── services/
│   │   │   ├── api.ts                    # REST API Client
│   │   │   └── binanceWs.ts              # WebSocket Client dengan Upstream Status Callback
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
├── pytest.ini
└── README.md
```
