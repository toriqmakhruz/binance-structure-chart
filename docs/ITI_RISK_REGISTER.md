# INSTITUTIONAL TRADING INTELLIGENCE (ITI)
## DOCUMENT 4: RISK REGISTER & MITIGATION PROTOCOLS (`docs/ITI_RISK_REGISTER.md`)

---

### 1. Risk Governance & Severity Matrix

Manajemen risiko sistem **Institutional Trading Intelligence (ITI)** dirancang untuk melindungi modal trading dan memastikan stabilitas server VPS yang memiliki spesifikasi ramah biaya (1GB RAM).

| Level Keparahan | Definisi & Tindakan |
| :--- | :--- |
| **CRITICAL** | Potensi kerugian modal, OOM Crash pada VPS, atau kegagalan koneksi data fatal. Operasi dihentikan seketika (*fail-safe halt*). |
| **HIGH** | Data terlambat, sequence ID orderbook melompat, atau sinyal palsu pada kondisi likuiditas tipis. Sinyal dikunci pada status `STALE` / `PREPARE`. |
| **MEDIUM** | Latensi upstream meningkat, WebSocket reconnecting sementara. Fallback ke REST polling cepat (1.0s). |
| **LOW** | Minor UI rendering lag pada mobile atau dev tools terbuka. Throttling dengan `requestAnimationFrame`. |

---

### 2. Risk Matrix & Action Plans

| ID | Kategori Risiko | Deskripsi Risiko | Dampak | Probabilitas | Mitigasi Preventif & Penanganan Kontinjensi |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **RSK-01** | **Network / Censorship** | Pemblokiran domain `fapi.binance.com` oleh ISP Indonesia (Internet Positif). | **CRITICAL** | Rendah (Terkendali) | **Mitigasi**: Konfigurasi DNS DoH/Bypass permanen di `/etc/systemd/resolved.conf.d/` dan `/etc/docker/daemon.json` (Cloudflare `1.1.1.1` & Google `8.8.8.8`). Tambahan fallback otomatis ke Spot API `data-api.binance.vision` jika jalur derivatif terhambat. |
| **RSK-02** | **Infrastructure (VPS)** | Out of Memory (OOM Crash) akibat akumulasi objek di RAM 1GB. | **CRITICAL** | Sedang | **Mitigasi**: Alokasi Swapfile 2GB (`/swapfile`). Pembatasan ketat panjang buffer (*bounded deque* $\le 500$ trades, orderbook $\le 50$ baris). Pembersihan memori eksplisit saat user mengganti pair aktif. |
| **RSK-03** | **Data Integrity** | Sequence ID pada Local Order Book terputus (*sequence gap* / frame drop). | **HIGH** | Sedang | **Mitigasi**: Algoritma validasi $pu == \text{prev\_}u$. Jika terdeteksi gap, status langsung diubah menjadi `STALE_SYNCING`, buffer lokal dibuang, dan snapshot REST 1000 kedalaman diambil ulang seketika. Tidak ada sinyal yang diizinkan selama sinkronisasi. |
| **RSK-04** | **Rate Limiting** | Terkena HTTP 429 / 418 IP Ban dari Binance akibat request berlebihan. | **HIGH** | Sangat Rendah | **Mitigasi**: Arsitektur **SINGLE ACTIVE PAIR**. Backend hanya meminta data untuk 1 pair yang dipilih. Pemakaian rate limit $<5\%$ dari kuota 2400 weight/menit. Exponential backoff dengan jitter acak jika terjadi retry. |
| **RSK-05** | **Microstructure** | Slippage tinggi dan pelebaran spread saat berita berdampak tinggi (*news release*). | **HIGH** | Sedang | **Mitigasi**: **Hard Gate Spread Filter** (Maksimal spread $0.05\%$) dan **Hard Gate Volatilitas ATR**. Jika spread melebar, sistem mengunci status pada `GATE_REJECTED: SPREAD_TOO_WIDE` dan membatalkan status `CONFIRMED`. |
| **RSK-06** | **Session Leakage** | Event data dari pair lama masuk ke grafik pair baru saat user berganti pair. | **HIGH** | Rendah | **Mitigasi**: Penerapan **Generation ID / Session Token**. Setiap pergantian pair menaikkan ID sesi. Semua paket data upstream yang memiliki ID sesi usang langsung dibuang di pintu masuk ingestion sebelum menyentuh engine. |
| **RSK-07** | **Signal Quality** | False Breakout / Fake Sweep yang menjebak trader retail. | **MEDIUM** | Tinggi | **Mitigasi**: Konfirmasi ganda via **CVD Absorption** dan **Market Structure Shift (MSS)**. Sinyal hanya berstatus `CONFIRMED` jika terjadi reclaim struktur dan lonjakan volume delta yang berlawanan dengan arah sapuan. |
| **RSK-08** | **Execution Safety** | Pengiriman order otomatis yang salah atau tidak disengaja. | **CRITICAL** | Nol (Bebas Risiko) | **Mitigasi**: Sesuai spesifikasi proyek, **v1 STRICTLY MANUAL EXECUTION**. Sistem hanya memproduksi Trade Plan (Entry, SL, TP1, TP2, Sizing) untuk dieksekusi secara sadar oleh user. Tidak ada pengiriman order otomatis ke API exchange. |

---

### 3. Protokol Penanganan Kegagalan Hard Gate

Setiap kali sinyal mencoba bertransisi dari `PREPARE` menuju `CONFIRMED`, sistem mengevaluasi tabel gerbang wajib:

```
[Kandidat Setup Terdeteksi]
           │
           ▼
    ┌──────────────┐      GAGAL (Spread > 0.05%)
    │ Spread Gate  ├──────────────────────────────────┐
    └──────┬───────┘                                  │
           │ LOLOS                                    │
           ▼                                          │
    ┌──────────────┐      GAGAL (Data > 1.5s / Gap)   │
    │ Freshness    ├──────────────────────────────────┤
    └──────┬───────┘                                  │
           │ LOLOS                                    ▼
           ▼                                  ┌───────────────────────────┐
    ┌──────────────┐      GAGAL (Lawan Whale) │  STATUS: PREPARE / LOCK   │
    │ Whale Wall   ├─────────────────────────►│  Alasan Kegagalan Tampil  │
    └──────┬───────┘                          │  pada UI (Badge Oranye)   │
           │ LOLOS                            └───────────────────────────┘
           ▼
┌─────────────────────────────┐
│  STATUS: CONFIRMED (Hijau)  │
│  Trade Plan Siap Eksekusi   │
└─────────────────────────────┘
```

1. **Transparansi Diagnostik**: Jika gerbang gagal, UI menampilkan badge kegagalan spesifik (misal: `GATE FAIL: SPREAD 0.08%`, `GATE FAIL: WHALE WALL AT $59.2K`).
2. **Anti-Repaint**: Begitu level Invalidation tertembus oleh harga pasar, status seketika terkunci menjadi `INVALIDATED` dan tidak dapat berubah kembali pada candle yang sama.

---

### 4. Prosedur Uji Mutu & Verifikasi (QA Checklist)

Sebelum setiap rilis fitur ITI ke server produksi:
- [x] **Lint & Type Check**: `npm run build` (TypeScript) dan `python -m py_compile` harus 0 error.
- [x] **Memory Stability**: Monitoring penggunaan RAM via `docker stats` $\le 650$ MB selama pengujian 30 menit.
- [x] **Pair Switching Test**: Berganti dari `BTCUSDT` $\rightarrow$ `ETHUSDT` $\rightarrow$ `SOLUSDT` $\rightarrow$ `BTCUSDT` memastikan stream lama berhenti dan data baru sinkron seketika.
- [x] **DNS & Upstream Ping**: Verifikasi koneksi REST dan WebSocket Binance dari dalam kontainer Docker VPS dengan latensi $<150$ ms.
