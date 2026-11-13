import asyncio
import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

from .binance_service import binance_service
from .trade_service import trade_service

logger = logging.getLogger("autobot_service")


class BotConfig(BaseModel):
    enabled: bool = False  # Always False by default on startup
    mode: str = Field("demo", pattern="^(demo|live)$")
    risk_per_trade_usd: float = Field(4.0, ge=1.0, le=500.0)
    max_daily_loss_usd: float = Field(16.0, ge=2.0, le=2000.0)
    max_concurrent_positions: int = Field(4, ge=1, le=10)
    leverage: int = Field(10, ge=1, le=50)
    timeframe: str = Field("15m", pattern="^(1m|3m|5m|15m|30m|1h|2h|4h|1d)$")
    market: str = Field("futures", pattern="^(spot|futures)$")
    api_key: Optional[str] = ""
    api_secret: Optional[str] = ""


class BotLogEntry(BaseModel):
    timestamp: int
    time_str: str
    level: str  # 'INFO', 'SUCCESS', 'WARN', 'ERROR'
    message: str


class AutoBotService:
    def __init__(self, data_file: Optional[str] = None):
        self.config = BotConfig(enabled=False)
        self.today_utc = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        self.daily_realized_pnl: float = 0.0
        self.circuit_breaker_triggered: bool = False
        self.active_positions: List[Dict[str, Any]] = []
        self.pending_orders: List[Dict[str, Any]] = []
        self.recent_logs: List[BotLogEntry] = []
        self.last_scan_time: int = 0
        self.running_task: Optional[asyncio.Task] = None
        self._is_evaluating: bool = False

        if data_file is not None:
            self._data_file = data_file
        else:
            self._data_file = os.path.join(
                os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
                "data",
                "autobot_state.json"
            )
        if self._data_file:
            self._load_state()

    def _add_log(self, level: str, message: str) -> None:
        now = int(time.time())
        time_str = datetime.now(timezone.utc).strftime("%H:%M:%S UTC")
        entry = BotLogEntry(timestamp=now, time_str=time_str, level=level, message=message)
        self.recent_logs.insert(0, entry)
        if len(self.recent_logs) > 60:
            self.recent_logs = self.recent_logs[:60]
        logger.info(f"[{level}] {message}")

    def _load_state(self) -> None:
        try:
            if os.path.exists(self._data_file):
                with open(self._data_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    cfg_data = data.get("config", {})
                    # Ensure bot always boots in disabled state unless explicitly enabled
                    cfg_data["enabled"] = False
                    self.config = BotConfig(**cfg_data)
                    self.today_utc = data.get("today_utc", self.today_utc)
                    self.daily_realized_pnl = float(data.get("daily_realized_pnl", 0.0))
                    self.circuit_breaker_triggered = bool(data.get("circuit_breaker_triggered", False))
        except Exception as exc:
            logger.warning(f"Could not load autobot state: {exc}")

    def _save_state(self) -> None:
        try:
            os.makedirs(os.path.dirname(self._data_file), exist_ok=True)
            data = {
                "config": self.config.model_dump(),
                "today_utc": self.today_utc,
                "daily_realized_pnl": self.daily_realized_pnl,
                "circuit_breaker_triggered": self.circuit_breaker_triggered,
                "updated_at": int(time.time())
            }
            with open(self._data_file, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
        except Exception as exc:
            logger.warning(f"Could not save autobot state: {exc}")

    def get_status(self) -> Dict[str, Any]:
        return {
            "config": self.config.model_dump(),
            "state": {
                "enabled": self.config.enabled,
                "today_utc": self.today_utc,
                "daily_realized_pnl": round(self.daily_realized_pnl, 2),
                "circuit_breaker_triggered": self.circuit_breaker_triggered,
                "active_positions_count": len(self.active_positions),
                "pending_orders_count": len(self.pending_orders),
                "last_scan_time": self.last_scan_time,
                "active_positions": self.active_positions,
                "pending_orders": self.pending_orders
            },
            "recent_logs": [l.model_dump() for l in self.recent_logs]
        }

    def update_config(self, new_cfg: Dict[str, Any]) -> Dict[str, Any]:
        # Merge credentials if empty
        if not new_cfg.get("api_key") and self.config.api_key:
            new_cfg["api_key"] = self.config.api_key
        if not new_cfg.get("api_secret") and self.config.api_secret:
            new_cfg["api_secret"] = self.config.api_secret

        # Validate with pydantic
        updated = BotConfig(**new_cfg)
        self.config = updated
        self._save_state()
        self._add_log("INFO", f"Konfigurasi bot diperbarui: Risk=${updated.risk_per_trade_usd}, MaxLoss=${updated.max_daily_loss_usd}, MaxPos={updated.max_concurrent_positions}, Mode={updated.mode.upper()}")
        return self.get_status()

    async def start(self) -> Dict[str, Any]:
        # Pre-flight check for live mode
        if self.config.mode == "live":
            if not self.config.api_key or not self.config.api_secret:
                self._add_log("ERROR", "Gagal menyalakan bot: Kredensial API Key & Secret Binance Live diperlukan.")
                return {"success": False, "message": "API Key dan Secret Binance Live diperlukan sebelum mengaktifkan mode Live."}
            
            test_res = await trade_service.test_connection(
                market=self.config.market,
                mode="live",
                api_key=self.config.api_key,
                api_secret=self.config.api_secret
            )
            if not test_res.get("success"):
                msg = test_res.get("message", "Koneksi API Binance Live gagal.")
                self._add_log("ERROR", f"Koneksi Live gagal: {msg}")
                return {"success": False, "message": f"Koneksi Live gagal: {msg}"}

        self.config.enabled = True
        self._save_state()
        self._add_log("SUCCESS", f"🟢 Bot Otomatis DINYALAKAN (Mode: {self.config.mode.upper()}, Kuota: {self.config.max_concurrent_positions} Posisi, Risk/Posisi: ${self.config.risk_per_trade_usd})")
        return {"success": True, "message": "Bot otomatis berhasil diaktifkan.", "status": self.get_status()}

    def stop(self) -> Dict[str, Any]:
        self.config.enabled = False
        self._save_state()
        self._add_log("WARN", "🟡 Bot Otomatis DIMATIKAN oleh pengguna (Kondisi Hibernasi).")
        return {"success": True, "message": "Bot otomatis berhasil dimatikan.", "status": self.get_status()}

    def reset_circuit_breaker(self) -> Dict[str, Any]:
        self.daily_realized_pnl = 0.0
        self.circuit_breaker_triggered = False
        self._save_state()
        self._add_log("SUCCESS", "Batas rugi harian berhasil direset ke $0. Bot siap memproses peluang baru.")
        return {"success": True, "message": "Batas rugi harian berhasil direset.", "status": self.get_status()}

    async def panic_close_all(self) -> Dict[str, Any]:
        self._add_log("WARN", "⚠️ PANIC BUTTON DITEKAN: Membatalkan semua antrean dan menutup semua posisi...")
        
        # 1. Cancel all pending orders
        open_orders_res = await trade_service.get_open_orders(
            market=self.config.market,
            mode=self.config.mode,
            api_key=self.config.api_key or "",
            api_secret=self.config.api_secret or ""
        )
        orders = open_orders_res.get("orders", [])
        for o in orders:
            try:
                await trade_service.cancel_order(
                    symbol=o["symbol"],
                    order_id=int(o["orderId"]),
                    market=self.config.market,
                    mode=self.config.mode,
                    api_key=self.config.api_key or "",
                    api_secret=self.config.api_secret or ""
                )
            except Exception as e:
                logger.warning(f"Error cancelling order {o.get('orderId')}: {e}")

        # 2. Close all active positions
        pos_res = await trade_service.get_positions(
            market=self.config.market,
            mode=self.config.mode,
            api_key=self.config.api_key or "",
            api_secret=self.config.api_secret or ""
        )
        positions = pos_res.get("positions", [])
        closed_count = 0
        for p in positions:
            if abs(float(p.get("contracts", 0))) > 0:
                try:
                    await trade_service.close_position(
                        symbol=p["symbol"],
                        market=self.config.market,
                        mode=self.config.mode,
                        api_key=self.config.api_key or "",
                        api_secret=self.config.api_secret or ""
                    )
                    closed_count += 1
                except Exception as e:
                    logger.warning(f"Error closing position {p.get('symbol')}: {e}")

        self._add_log("SUCCESS", f"✅ Panic Close selesai: {closed_count} posisi ditutup & antrean dibatalkan.")
        return {"success": True, "message": f"Selesai: {closed_count} posisi ditutup.", "status": self.get_status()}

    async def run_cycle(self) -> None:
        """Single evaluation cycle of the auto bot daemon."""
        if self._is_evaluating:
            return
        self._is_evaluating = True
        try:
            # 1. Check if bot is enabled
            if not self.config.enabled:
                return

            # 2. Check UTC Day Rollover (Reset Daily Loss at 00:00 UTC)
            current_utc = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            if current_utc != self.today_utc:
                self.today_utc = current_utc
                self.daily_realized_pnl = 0.0
                self.circuit_breaker_triggered = False
                self._save_state()
                self._add_log("INFO", f"🔄 Hari baru UTC ({current_utc}): Counter kerugian harian direset ke $0.")

            # 3. Synchronize Live Positions & Pending Orders from Binance
            api_key = self.config.api_key or ""
            api_secret = self.config.api_secret or ""
            pos_res = await trade_service.get_positions(
                market=self.config.market,
                mode=self.config.mode,
                api_key=api_key,
                api_secret=api_secret
            )
            all_positions = pos_res.get("positions", [])
            active_pos = []
            for p in all_positions:
                amt = abs(float(p.get("positionAmt") or p.get("contracts") or p.get("size") or 0))
                if amt > 0:
                    p["contracts"] = amt
                    active_pos.append(p)
            self.active_positions = active_pos

            open_orders_res = await trade_service.get_open_orders(
                market=self.config.market,
                mode=self.config.mode,
                api_key=api_key,
                api_secret=api_secret
            )
            all_open_orders = open_orders_res.get("orders", [])
            # Filter standard entry limit orders (exclude algo TP/SL brackets)
            pending_entries = [
                o for o in all_open_orders
                if o.get("type") in ("LIMIT",) and not o.get("reduceOnly", False)
            ]
            self.pending_orders = pending_entries

            # 4. Check Circuit Breaker Status
            if self.circuit_breaker_triggered or self.daily_realized_pnl <= -self.config.max_daily_loss_usd:
                if not self.circuit_breaker_triggered:
                    self.circuit_breaker_triggered = True
                    self._save_state()
                    self._add_log("ERROR", f"🔴 CIRCUIT BREAKER HIT: Kerugian harian (-${abs(self.daily_realized_pnl):.2f}) mencapai batas maks (${self.config.max_daily_loss_usd:.2f}). Trading dijeda sampai besok!")
                return

            # 5. Check Invalidation for Pending Limit Orders
            # If price breaches SL or runs near TP before fill, cancel order immediately!
            for po in pending_entries:
                sym = po["symbol"]
                order_id = int(po["orderId"])
                direction = "LONG" if po.get("side") == "BUY" else "SHORT"
                limit_price = float(po.get("price", 0))

                # Fetch live price
                try:
                    ticker = await binance_service.get_ticker_24h(symbol=sym, market=self.config.market)
                    live_price = float(ticker.get("lastPrice", 0)) if ticker else limit_price
                except Exception:
                    live_price = limit_price

                # Check linked SL/TP in state if stored, or approximate with conservative buffer
                # If market moved >= 2.5% away in favor of TP or crossed SL
                if direction == "LONG":
                    if live_price < limit_price * 0.985:  # Price broke below structure
                        self._add_log("WARN", f"Batalkan Limit {sym} BUY #{order_id}: Harga pasar (${live_price}) merusak level SL sebelum terisi.")
                        await trade_service.cancel_order(symbol=sym, order_id=order_id, market=self.config.market, mode=self.config.mode, api_key=api_key, api_secret=api_secret)
                    elif live_price > limit_price * 1.03:  # Price already moved toward target
                        self._add_log("WARN", f"Batalkan Limit {sym} BUY #{order_id}: Harga pasar (${live_price}) sudah lari mendekati TP tanpa retest.")
                        await trade_service.cancel_order(symbol=sym, order_id=order_id, market=self.config.market, mode=self.config.mode, api_key=api_key, api_secret=api_secret)
                else:
                    if live_price > limit_price * 1.015:  # Price broke above structure
                        self._add_log("WARN", f"Batalkan Limit {sym} SELL #{order_id}: Harga pasar (${live_price}) merusak level SL sebelum terisi.")
                        await trade_service.cancel_order(symbol=sym, order_id=order_id, market=self.config.market, mode=self.config.mode, api_key=api_key, api_secret=api_secret)
                    elif live_price < limit_price * 0.97:  # Price already moved toward target
                        self._add_log("WARN", f"Batalkan Limit {sym} SELL #{order_id}: Harga pasar (${live_price}) sudah lari mendekati TP tanpa retest.")
                        await trade_service.cancel_order(symbol=sym, order_id=order_id, market=self.config.market, mode=self.config.mode, api_key=api_key, api_secret=api_secret)

            # 6. Check Capacity (Max 4 concurrent positions/pending)
            occupied_slots = len(self.active_positions) + len(self.pending_orders)
            if occupied_slots >= self.config.max_concurrent_positions:
                return  # All 4 slots occupied, wait for position to hit TP/SL!

            available_slots = self.config.max_concurrent_positions - occupied_slots

            # 7. Ambil Setup Valid Teratas dari Tab Setup
            # Import dynamically to prevent circular dependencies
            from ..api.routes import get_valid_setups
            scan_res = await get_valid_setups(
                market=self.config.market,
                timeframe=self.config.timeframe,
                swing_length=5,
                fvg_min_pct=0.05,
                forecast_horizon=20,
                scan_limit=30,
                force_refresh=False
            )
            valid_setups = scan_res.get("setups", [])
            self.last_scan_time = int(time.time())

            # Urutkan persis seperti tampilan Tab Setup (Terbaru & Bobot Konfluensi Tertinggi)
            valid_setups.sort(
                key=lambda x: (x.get("entry_time", 0), x.get("confluence_weight", 0)),
                reverse=True
            )

            # Filter setups: Hanya pair yang belum memiliki posisi aktif atau order pending
            existing_symbols = {p["symbol"].upper() for p in self.active_positions} | {o["symbol"].upper() for o in self.pending_orders}
            fresh_candidates = [
                s for s in valid_setups
                if s["symbol"].upper() not in existing_symbols
            ]

            if not fresh_candidates:
                return

            # Check Available Margin in account
            balance_res = await trade_service.get_balance(
                market=self.config.market,
                mode=self.config.mode,
                api_key=api_key,
                api_secret=api_secret
            )
            available_balance = float(balance_res.get("availableBalance", 0.0))

            # 8. Eksekusi Setup Teratas Tab Pengganti Klik Manusia
            for setup in fresh_candidates[:available_slots]:
                sym = setup["symbol"].upper()
                direction = setup["direction"].upper()
                entry_p = float(setup["entry_price"])
                sl_p = float(setup["invalidation_price"])
                tp_p = float(setup["target_price"])
                live_p = float(setup.get("current_price", entry_p))
                sl_dist = abs(entry_p - sl_p)

                if sl_dist <= 0:
                    continue

                # Position Sizing: Qty = Risk USD / SL Distance
                raw_qty = self.config.risk_per_trade_usd / sl_dist

                # Rules validation: minNotional ($5), stepSize
                rules = await trade_service.get_symbol_rules(symbol=sym, market=self.config.market, mode=self.config.mode)
                step_size = rules.get("stepSize", 0.001)
                min_notional = rules.get("minNotional", 5.0)
                qty_precision = rules.get("qtyPrecision", 3)

                formatted_qty = trade_service.format_quantity(raw_qty, step_size, qty_precision)
                notional = formatted_qty * live_p

                # Ensure minNotional $5
                if notional < min_notional:
                    # Bump up to minNotional if risk deviation is within 25%
                    min_qty = min_notional / live_p
                    formatted_qty = trade_service.format_quantity(min_qty, step_size, qty_precision)
                    notional = formatted_qty * live_p

                required_margin = notional / self.config.leverage
                if required_margin > available_balance or available_balance < 3.0:
                    self._add_log("WARN", f"Saldo margin tidak cukup untuk {sym}: Perlu ${required_margin:.2f}, Tersedia ${available_balance:.2f}.")
                    continue

                mode_label = "BINANCE LIVE" if self.config.mode == "live" else "DEMO/TESTNET"

                if self.config.mode == "live" and (not api_key or not api_secret):
                    self._add_log("ERROR", "❌ [BINANCE LIVE] Gagal eksekusi: API Key & Secret Binance Live belum diisi! Masukkan kunci di pengaturan.")
                    return

                # Eksekusi Langsung Market Order
                self._add_log("INFO", f"⚡ [{mode_label}] Mengirim order {sym} ({direction}) di harga ${live_p} (SL: ${sl_p}, TP: ${tp_p})...")
                exec_res = await trade_service.execute_order(
                    symbol=sym,
                    market=self.config.market,
                    mode=self.config.mode,
                    api_key=api_key,
                    api_secret=api_secret,
                    side="BUY" if direction == "LONG" else "SELL",
                    order_type="MARKET",
                    price=live_p,
                    quantity=formatted_qty,
                    leverage=self.config.leverage,
                    take_profit=tp_p,
                    stop_loss=sl_p,
                    reduce_only=False
                )
                if exec_res.get("success"):
                    available_balance -= required_margin
                    order_id_str = f" #{exec_res.get('order_id')}" if exec_res.get('order_id') else ""
                    self._add_log("SUCCESS", f"🚀 [{mode_label}] POSISI AKTIF{order_id_str}: {sym} {direction} di harga ${live_p} (SL: ${sl_p}, TP: ${tp_p}, Risk: ${self.config.risk_per_trade_usd})")
                else:
                    self._add_log("ERROR", f"❌ [{mode_label}] Ditolak: {sym} - {exec_res.get('message')}")

        except Exception as exc:
            logger.error(f"Error in autobot cycle: {exc}", exc_info=True)
        finally:
            self._is_evaluating = False


# Global Singleton Instance
autobot_service = AutoBotService()
