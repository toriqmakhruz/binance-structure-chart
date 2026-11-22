# INSTITUTIONAL TRADING INTELLIGENCE (ITI)
## DOCUMENT 1: PROJECT & SYSTEM AUDIT (`docs/ITI_PROJECT_AUDIT.md`)

---

### 1. Executive Summary & Audit Purpose

Sesuai instruksi proyek **Institutional Trading Intelligence (ITI)**, audit menyeluruh (*Phase 0 - Audit*) dilakukan terhadap seluruh arsitektur kode eksisting pada repositori `binance-structure-chart`. 

Tujuan audit ini adalah:
1. Memetakan seluruh komponen teknis (Framework, Routing, State, Charting, Storage, Network, Deploy).
2. Memastikan pemenuhan **spesifikasi wajib**: **ITI BUKAN SCANNER**. ITI hanya berjalan secara eksklusif pada **satu active pair (`active_symbol`)** yang dipilih secara manual oleh pengguna.
3. Menjamin pendekatan **zero-regression**: tidak menghapus fitur existing, tidak merusak alur trading yang sudah berjalan, dan menggunakan kembali (*reuse*) design system serta komponen yang sudah teruji.

---

### 2. Technology Stack & Framework Inventory

| Layer | Komponen / Library | Versi | Status & Catatan Audit |
| :--- | :--- | :--- | :--- |
| **Backend Runtime** | Python | `3.12.x` | Modern runtime dengan dukungan async/await efisien. |
| **Backend Framework** | FastAPI | `>=0.110.0` | Asynchronous high-performance REST & WebSocket gateway. |
| **ASGI Server** | Uvicorn (standard) | `>=0.28.0` | Event-loop uvloop/httptools untuk handling sub-second ticks. |
| **Data Validation** | Pydantic | `>=2.6.0` | Type-safety, serialisasi model cepat (Pydantic Core). |
| **HTTP Client** | HTTPX | `>=0.27.0` | Async HTTP client dengan pooling, TLS verify config, dan keep-alive. |
| **WebSocket Core** | WebSockets | `>=12.0` | Koneksi duplex upstream Binance Futures & downstream browser. |
| **Math / Quant** | NumPy | `>=1.26.0` | Operasi vektorik dan kalkulasi volatilitas / z-scores. |
| **Frontend Core** | React | `^18.3.1` | Concurrent mode rendering dengan hooks terstruktur. |
| **Language** | TypeScript | `^5.4.5` | Strict static typing untuk data flow trading yang aman. |
| **Build Tool** | Vite | `^5.3.1` | Lightning fast HMR dan rollup-based minification. |
| **CSS / Styling** | Tailwind CSS | `^3.4.4` | Dark trading UI system (`#0b0e14`, `#161b22`, `#21262d`). |
| **Chart Engine** | Lightweight Charts | `^4.2.1` | Canvas-based high performance chart engine dari TradingView. |
| **Iconography** | Lucide React | `^0.395.0` | Crisp SVG iconography (Radar, Activity, Shield, Boxes, dll). |
| **Containerization** | Docker & Compose | Docker CE v24+ | Multi-stage build (Alpine Node frontend + Slim Python backend). |
| **Production Server** | VPS Indonesia Ubuntu | 1GB RAM / 2GB Swap | IP `202.134.242.16`, ports `3050` (Nginx) & `8050` (Uvicorn). |

---

### 3. Folder Structure & Codebase Map

```
CHART PATERN/
├── backend/
│   ├── app/
│   │   ├── analysis/             # Existing quant & SMC engines (smc, pattern, movement, forecast, etc.)
│   │   ├── api/                  # REST & WS controllers (routes.py, trade_routes.py, websocket.py)
│   │   ├── models/               # Pydantic schemas (schemas.py, trade_schemas.py)
│   │   ├── services/             # Binance upstream, Trade service, Telegram, Liquidity Matrix, Market X-Ray
│   │   ├── config.py             # Settings, allowed intervals, endpoint URLs
│   │   └── main.py               # FastAPI entry point, lifespan, CORS configuration
│   ├── data/                     # Backend local JSON persistence (autobot_state.json, user_preferences.json)
│   ├── tests/                    # Pytest test suites
│   ├── Dockerfile                # Python 3.12-slim production container
│   └── requirements.txt          # Python dependencies
├── data/                         # Root shared persistent JSON files (paper_trading.json, trade_credentials.json)
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Chart/            # LightweightChart.tsx, ChartContainer.tsx, LayerToggles.tsx, etc.
│   │   │   ├── HUD/              # RightSidebar.tsx, ConfluenceSidebar.tsx, LiquidityMatrixModal.tsx, etc.
│   │   │   ├── Navigation/       # LeftSidebar.tsx, SymbolSelector.tsx, TopNavbar.tsx
│   │   │   ├── Trade/            # OpenPositionModal.tsx, TradingDashboardDrawer.tsx
│   │   │   └── Settings/         # OrderflowModal.tsx, MarketSessionsModal.tsx, ApiCredentialsModal.tsx
│   │   ├── services/             # api.ts (REST client), binanceWs.ts (WebSocket client)
│   │   ├── types/                # TypeScript interface definitions (analysis.ts, marketXray.ts, etc.)
│   │   ├── utils/                # Calculation utilities (formatters.ts, institutionalIndicators.ts, etc.)
│   │   ├── App.tsx               # Root application shell, state hub, hotkey listener
│   │   └── main.tsx              # React DOM mounting
│   ├── Dockerfile                # Multi-stage Nginx build
│   └── package.json              # Frontend dependencies
├── docs/                         # ITI Architectural & Phase Documentation
├── deploy_to_indo_vps.py         # Automated production SSH deployer
└── docker-compose.yml            # Container definitions
```

---

### 4. Routing, Endpoints & Communication Protocols

#### 4.1 REST API Endpoints (`backend/app/api/`)
* **Market Data & Structure**:
  * `GET /api/symbols?market=futures`: Mengambil daftar symbol aktif Binance USDⓈ-M Futures.
  * `GET /api/analysis`: Endpoint analitik utama (Candlestick, SMC, Chart Pattern, Forecast Confluence, Trend Strength).
  * `GET /api/open-interest`: Mengambil data historis Open Interest pair aktif.
  * `GET /api/funding-rate`: Mengambil data historis Funding Rate pair aktif.
  * `GET /api/market/liquidity-matrix`: Profiling Depth of Market (DOM) L2 Binance.
  * `GET /api/market/xray`: Dissecting tiket Paus vs Ritel dan Stop Loss Liquidation Clusters.
* **Paper Trading & Orders**:
  * `POST /api/trade/order`, `POST /api/trade/positions`, `POST /api/trade/balance`, `POST /api/trade/set-brackets`.
* **Telegram & Alerts**:
  * `GET /api/telegram/settings`, `POST /api/telegram/settings`, `POST /api/telegram/test`.

#### 4.2 WebSocket Relays (`backend/app/api/websocket.py`)
* `ws://.../ws/tickers/{market}`: Relays `!miniTicker@arr` (hanya digunakan untuk update harga global pada SymbolSelector dan HUD).
* `ws://.../ws/{symbol}/{timeframe}/{market}`: Relays `@kline_{timeframe}` untuk satu pair yang sedang aktif di chart. Dilengkapi REST live fallback (1.0 detik) jika koneksi upstream WS mengalami stalled/drop frame.

---

### 5. Database & State Management Audit

1. **Storage Engine**:
   * Sistem saat ini menggunakan **Atomic File-based JSON Persistence** yang disimpan di dalam direktori volume terisolasi (`data/` dan `backend/data/`).
   * File terdaftar:
     - `paper_trading.json`: Menyimpan posisi paper trade aktif, saldo virtual, dan histori order.
     - `trade_credentials.json`: Menyimpan API Key & Secret Binance yang dienkripsi secara lokal.
     - `user_preferences.json`: Menyimpan setelan kustom user (warna, layout, toggle).
     - `telegram_settings.json`: Menyimpan konfigurasi bot token dan chat ID.
2. **Karakteristik & Integritas**:
   * Sangat ringan (zero memory footprint DB engine), tidak membebani VPS yang memiliki RAM 1GB.
   * Tidak ada kebutuhan migrasi ke PostgreSQL/MongoDB untuk v1 karena operasi berfokus pada analisis *in-memory real-time* pair aktif dan pencatatan rencana trading lokal.
3. **Frontend State**:
   * Menggunakan kombinasi React `useState`, `useCallback`, `useMemo`, dan `localStorage` (misal `cp_right_sidebar_tab`, `cp_xray_collapsed`, `cp_market_session_settings`).

---

### 6. Design System & Chart Overlay Engine Audit

1. **Design System**:
   * Skema warna: `#0b0e14` (Background dasar), `#0d1117` (Surface panel), `#161b22` (Card), `#21262d` / `#30363d` (Borders).
   * Aksen warna finansial:
     - Bullish / Bids: `#10b981` (Emerald), `#00c087` (Binance Green).
     - Bearish / Asks: `#f43f5e` (Rose), `#f6465d` (Binance Red).
     - Gold / Warning: `#f0b90b` (Binance Gold), `#f59e0b` (Amber).
     - Smart Money / Cyan: `#06b6d4`, `#38bdf8` (Institusional).
2. **Canvas Chart Overlay (`LightweightChart.tsx`)**:
   * Engine utama: Canvas 2D overlay yang sinkron secara geometris dengan time scale dan price scale Lightweight Charts.
   * Memiliki fungsi `resolveCoord(time, price)` dan `series.priceToCoordinate(price)` yang presisi untuk memetakan level harga, kotak order block, garis tren, AVWAP bands, dan koridor Stop Loss.
   * Tidak repainting secara liar berkat throttling dengan `requestAnimationFrame` dan caching `redrawCanvasRef`.

---

### 7. Upstream Network & VPS Infrastructure Audit

1. **Sensor & DNS Internet Positif**:
   * VPS berlokasi di Indonesia (`202.134.242.16`). Secara default, ISP di Indonesia memblokir domain `fapi.binance.com` dan `api.binance.com`.
   * **Mitigasi Eksisting Terbukti**:
     - Host level: `/etc/systemd/resolved.conf.d/dns_servers.conf` dan `/etc/resolv.conf` dikonfigurasi ke DNS Cloudflare `1.1.1.1` & Google `8.8.8.8`.
     - Docker daemon: `/etc/docker/daemon.json` dikonfigurasi `dns: ["1.1.1.1", "1.0.0.1", "8.8.8.8"]`.
     - Pengujian langsung membuktikan `https://fapi.binance.com` tembus 100% tanpa limitasi dari dalam kontainer backend.
2. **Keterbatasan Memori (RAM)**:
   * VPS memiliki RAM fisik 1GB.
   * Swapfile 2GB (`/swapfile`) telah terpasang dan aktif (`swapon`), mencegah OOM-killer saat proses build Vite dan compiler TypeScript berjalan.
3. **Rate Limit Binance**:
   * IP Rate Limit Futures: 2400 weight per menit.
   * Single active pair architecture membatasi request REST hanya pada pair yang sedang dilihat, sehingga pemakaian rate limit berada jauh di bawah ambang bahaya (<5% dari kuota limit).

---

### 8. Evaluasi Kepatuhan Terhadap Mandat: "ITI BUKAN SCANNER"

* **Audit Temuan**:
  - Pada sistem lama terdapat sisa konsep scanner latar belakang (seperti background scanner telegram dan watchlist ranking).
* **Koreksi & Pembatasan Wajib untuk ITI**:
  1. ITI dilarang melakukan background polling ke seluruh 300+ pasangan Binance Futures.
  2. ITI hanya memiliki satu variabel global atau sesi: `active_symbol`.
  3. Ketika user mengganti symbol (misal dari `BTCUSDT` ke `ETHUSDT`):
     - Putuskan / unregister stream `BTCUSDT`.
     - Batalkan event/tick queue lama `BTCUSDT`.
     - Bersihkan in-memory buffer live state `BTCUSDT`.
     - Inisialisasi subscription baru untuk `ETHUSDT`.
     - Ambil snapshot orderbook L2 dan history candle baru untuk `ETHUSDT`.
  4. Penyimpanan histori per-symbol tetap dipertahankan agar saat user kembali ke symbol sebelumnya, catatan jurnal dan gambar teknikal tidak hilang.

---

### 9. Kesimpulan Audit & Kesiapan Arsitektur

Arsitektur eksisting terbukti **sangat siap, modular, dan kokoh** untuk menerima integrasi modul **Institutional Trading Intelligence (ITI)**. Tidak ada kebutuhan merombak framework atau mengganti database. Integrasi akan dilakukan secara bersih melalui penambahan layer `backend/app/iti/` dan integrasi workspace ITI pada frontend.
