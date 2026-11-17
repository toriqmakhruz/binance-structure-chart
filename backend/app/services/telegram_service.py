import os
import json
import time
import asyncio
import logging
from pathlib import Path
from typing import Dict, Any, Optional, Set, List, Tuple
import httpx
from ..config import settings
from .binance_service import binance_service

logger = logging.getLogger("telegram_service")

DATA_DIR = Path("data")
SETTINGS_FILE = DATA_DIR / "telegram_settings.json"
HISTORY_FILE = DATA_DIR / "telegram_notified_setups.json"

DEFAULT_SETTINGS: Dict[str, Any] = {
    "enabled": False,
    "bot_token": "",
    "chat_id": "",
    "min_rr": 1.5,
    "market": "futures",
    "timeframe": "15m",
    "scan_interval_seconds": 60,
    "min_confluence_score": 50.0
}

class TelegramService:
    def __init__(self):
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        self.settings: Dict[str, Any] = self._load_settings()
        self._notified_ids: Dict[str, float] = self._load_history()
        self._scanner_task: Optional[asyncio.Task] = None
        self._is_running = False

    def _load_settings(self) -> Dict[str, Any]:
        """Load Telegram settings from JSON file, or fallback to default."""
        if SETTINGS_FILE.exists():
            try:
                with open(SETTINGS_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    res = DEFAULT_SETTINGS.copy()
                    res.update(data)
                    return res
            except Exception as e:
                logger.error(f"Failed to read {SETTINGS_FILE}: {e}")
        return DEFAULT_SETTINGS.copy()

    def _save_settings(self) -> None:
        """Persist settings to disk atomically."""
        try:
            with open(SETTINGS_FILE, "w", encoding="utf-8") as f:
                json.dump(self.settings, f, indent=2)
        except Exception as e:
            logger.error(f"Failed to save {SETTINGS_FILE}: {e}")

    def _load_history(self) -> Dict[str, float]:
        """Load notified setup IDs from disk to prevent duplicate notifications after server restart."""
        if HISTORY_FILE.exists():
            try:
                with open(HISTORY_FILE, "r", encoding="utf-8") as f:
                    history = json.load(f)
                    # Clean up entries older than 24 hours
                    now = time.time()
                    return {k: v for k, v in history.items() if now - v < 86400}
            except Exception as e:
                logger.error(f"Failed to load {HISTORY_FILE}: {e}")
        return {}

    def _save_history(self) -> None:
        """Save notified history to disk, pruning old records."""
        try:
            now = time.time()
            pruned = {k: v for k, v in self._notified_ids.items() if now - v < 86400}
            self._notified_ids = pruned
            with open(HISTORY_FILE, "w", encoding="utf-8") as f:
                json.dump(self._notified_ids, f)
        except Exception as e:
            logger.error(f"Failed to save {HISTORY_FILE}: {e}")

    def get_public_settings(self) -> Dict[str, Any]:
        """Return settings with token masked for UI security."""
        raw_token = self.settings.get("bot_token", "")
        masked_token = ""
        if raw_token and len(raw_token) > 8:
            masked_token = raw_token[:4] + "..." + raw_token[-4:]
        elif raw_token:
            masked_token = "***"

        return {
            "enabled": bool(self.settings.get("enabled", False)),
            "bot_token_masked": masked_token,
            "has_token": bool(raw_token),
            "chat_id": self.settings.get("chat_id", ""),
            "min_rr": float(self.settings.get("min_rr", 1.5)),
            "market": self.settings.get("market", "futures"),
            "timeframe": self.settings.get("timeframe", "15m"),
            "scan_interval_seconds": int(self.settings.get("scan_interval_seconds", 60)),
            "min_confluence_score": float(self.settings.get("min_confluence_score", 50.0)),
            "is_running": self._is_running
        }

    def update_settings(self, new_settings: Dict[str, Any]) -> Dict[str, Any]:
        """Update and persist Telegram configuration."""
        if "enabled" in new_settings:
            self.settings["enabled"] = bool(new_settings["enabled"])
        if "bot_token" in new_settings and new_settings["bot_token"]:
            # If user sent masked token, don't overwrite real token
            if not ("..." in new_settings["bot_token"] or new_settings["bot_token"] == "***"):
                self.settings["bot_token"] = str(new_settings["bot_token"]).strip()
        if "chat_id" in new_settings:
            self.settings["chat_id"] = str(new_settings["chat_id"]).strip()
        if "min_rr" in new_settings:
            try:
                self.settings["min_rr"] = max(1.0, float(new_settings["min_rr"]))
            except (ValueError, TypeError):
                pass
        if "market" in new_settings and new_settings["market"] in ("spot", "futures"):
            self.settings["market"] = new_settings["market"]
        if "timeframe" in new_settings and new_settings["timeframe"] in settings.TIMEFRAMES:
            self.settings["timeframe"] = new_settings["timeframe"]
        if "scan_interval_seconds" in new_settings:
            try:
                self.settings["scan_interval_seconds"] = max(30, min(600, int(new_settings["scan_interval_seconds"])))
            except (ValueError, TypeError):
                pass

        self._save_settings()
        return self.get_public_settings()

    async def send_message(self, text: str, token: Optional[str] = None, chat_id: Optional[str] = None) -> Tuple[bool, str]:
        """Send a message via Telegram Bot API with Markdown formatting."""
        use_token = token or self.settings.get("bot_token", "")
        use_chat_id = chat_id or self.settings.get("chat_id", "")

        if not use_token or not use_chat_id:
            return False, "Bot token dan Chat ID belum dikonfigurasi."

        url = f"https://api.telegram.org/bot{use_token}/sendMessage"
        payload = {
            "chat_id": use_chat_id,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": True
        }

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(url, json=payload)
                if resp.status_code == 200:
                    return True, "Pesan notifikasi berhasil terkirim."
                else:
                    err_json = resp.json() if "application/json" in resp.headers.get("Content-Type", "") else {}
                    desc = err_json.get("description", resp.text)
                    logger.error(f"Telegram API Error ({resp.status_code}): {desc}")
                    return False, f"Telegram API Error: {desc}"
        except httpx.TimeoutException:
            logger.error("Telegram API connection timeout")
            return False, "Koneksi ke Telegram API timeout (periksa jaringan internet server)."
        except Exception as e:
            logger.error(f"Telegram send exception: {e}")
            return False, f"Gagal mengirim pesan: {str(e)}"

    def format_setup_message(self, setup: Dict[str, Any]) -> str:
        """Format setup details into a clean HTML message for Telegram."""
        symbol = setup.get("symbol", "UNKNOWN")
        market = str(setup.get("market", "futures")).upper()
        timeframe = setup.get("timeframe", "15m")
        direction = setup.get("direction", "NEUTRAL").upper()
        pattern_name = setup.get("name", "Valid Setup")

        dir_emoji = "🟢 LONG" if direction == "LONG" else "🔴 SHORT"
        entry_price = setup.get("entry_price", 0.0)
        sl_price = setup.get("invalidation_price", 0.0)
        tp_price = setup.get("target_price", 0.0)
        rr = setup.get("risk_reward_ratio", 0.0)
        score = setup.get("confluence_score", 0.0)
        curr_price = setup.get("current_price", entry_price)

        # Precise price formatting
        def fmt_p(p: float) -> str:
            if p >= 1000:
                return f"{p:,.2f}"
            elif p >= 1:
                return f"{p:.4f}"
            else:
                return f"{p:.6f}"

        timestamp_str = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())

        mode_badge = "🛡️ <b>Protection:</b> Pro Shield (Anti-Stop Hunt)\n" if setup.get("setup_mode") == "pro_shield" else ""

        msg = (
            f"🎯 <b>NEW SETUP RADAR DETECTED!</b>\n\n"
            f"💎 <b>Pair:</b> <code>{symbol}</code> ({market})\n"
            f"📊 <b>Timeframe:</b> <code>{timeframe}</code>\n"
            f"🧭 <b>Signal:</b> <b>{dir_emoji}</b>\n"
            f"{mode_badge}"
            f"📋 <b>Setup:</b> {pattern_name}\n\n"
            f"💵 <b>Entry Price:</b> <code>${fmt_p(entry_price)}</code>\n"
            f"🛡️ <b>Stop Loss:</b> <code>${fmt_p(sl_price)}</code>\n"
            f"🏁 <b>Take Profit:</b> <code>${fmt_p(tp_price)}</code>\n"
            f"⚖️ <b>Risk / Reward:</b> <code>1 : {rr:.2f}</code>\n"
            f"⚡ <b>Confluence Score:</b> <code>{score:.1f}%</code>\n"
            f"📈 <b>Harga Saat Ini:</b> <code>${fmt_p(curr_price)}</code>\n\n"
            f"⏰ <i>Waktu Deteksi: {timestamp_str}</i>\n"
            f"🤖 <i>Binance Structure Radar</i>"
        )
        return msg

    async def notify_new_setups_from_radar(self, setups: List[Dict[str, Any]]) -> int:
        """Notify any newly detected setups directly from Setup Radar."""
        if not self.settings.get("enabled"):
            return 0
        if not self.settings.get("bot_token") or not self.settings.get("chat_id"):
            return 0

        notified_count = 0
        now = time.time()
        for r in setups:
            if not isinstance(r, dict):
                continue
            sym = r.get("symbol")
            direction = r.get("direction")
            entry_p = r.get("entry_price")
            entry_t = r.get("entry_time")
            setup_id = f"{sym}_{direction}_{entry_p}_{entry_t}"

            if setup_id in self._notified_ids:
                continue

            msg = self.format_setup_message(r)
            ok, resp_msg = await self.send_message(msg)
            if ok:
                self._notified_ids[setup_id] = now
                notified_count += 1
                logger.info(f"Telegram alert sent from Setup Radar: {setup_id}")
                await asyncio.sleep(0.5)

        if notified_count > 0:
            self._save_history()
        return notified_count

    async def scan_and_notify_new_setups(self) -> int:
        """
        Scan market for new valid setups and dispatch notifications.
        Returns count of new setups notified.
        """
        if not self.settings.get("enabled"):
            return 0
        if not self.settings.get("bot_token") or not self.settings.get("chat_id"):
            return 0

        # Import here to avoid circular dependencies
        from ..api.routes import _scan_symbol_valid_setup

        market = self.settings.get("market", "futures")
        timeframe = self.settings.get("timeframe", "15m")
        min_rr = float(self.settings.get("min_rr", 1.5))
        min_score = float(self.settings.get("min_confluence_score", 50.0))

        try:
            top_symbols = await binance_service.get_symbols(market=market, demo_mode=False)
            candidates = top_symbols[:16]
            sem = asyncio.Semaphore(3)

            results = await asyncio.gather(*[
                _scan_symbol_valid_setup(
                    sem=sem,
                    sym_info=sym_info,
                    market=market,
                    timeframe=timeframe,
                    swing_length=5,
                    fvg_min_pct=0.05,
                    forecast_horizon=20
                )
                for sym_info in candidates
            ], return_exceptions=True)

            notified_count = 0
            now = time.time()

            for r in results:
                if isinstance(r, Exception) or not r:
                    continue

                # Filter by user settings
                rr = float(r.get("risk_reward_ratio", 0.0))
                score = float(r.get("confluence_score", 0.0))
                if rr < min_rr or score < min_score:
                    continue

                # Unique setup key to avoid spamming the same setup
                sym = r.get("symbol")
                direction = r.get("direction")
                entry_p = r.get("entry_price")
                entry_t = r.get("entry_time")
                setup_id = f"{sym}_{market}_{timeframe}_{direction}_{entry_p}_{entry_t}"

                # Check if already notified
                if setup_id in self._notified_ids:
                    continue

                # Send Telegram notification
                msg = self.format_setup_message(r)
                ok, resp_msg = await self.send_message(msg)

                if ok:
                    self._notified_ids[setup_id] = now
                    notified_count += 1
                    logger.info(f"Telegram notification sent for new setup: {setup_id}")
                    # Brief pause between messages to comply with Telegram rate limits
                    await asyncio.sleep(1.0)
                else:
                    logger.warning(f"Failed to dispatch Telegram alert for {setup_id}: {resp_msg}")

            if notified_count > 0:
                self._save_history()

            return notified_count
        except Exception as e:
            logger.error(f"Error during Telegram setup scan: {e}")
            return 0

    async def start_background_scanner(self) -> None:
        """Long-running background task that periodically scans for setups."""
        self._is_running = True
        logger.info("Telegram Setup Scanner background worker started.")

        # Give application 10s to fully initialize before first scan
        await asyncio.sleep(10.0)

        while self._is_running:
            try:
                interval = int(self.settings.get("scan_interval_seconds", 60))
                if self.settings.get("enabled") and self.settings.get("bot_token") and self.settings.get("chat_id"):
                    await self.scan_and_notify_new_setups()
                await asyncio.sleep(max(30, interval))
            except asyncio.CancelledError:
                logger.info("Telegram background scanner received cancel signal.")
                break
            except Exception as e:
                logger.error(f"Unexpected error in Telegram background loop: {e}")
                await asyncio.sleep(30.0)

        self._is_running = False
        logger.info("Telegram Setup Scanner background worker stopped.")

    def stop_background_scanner(self) -> None:
        self._is_running = False
        if self._scanner_task and not self._scanner_task.done():
            self._scanner_task.cancel()

telegram_service = TelegramService()
