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
    "min_confluence_score": 50.0,
    "notify_smart_div": True,
    "notify_squeeze": True
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
            "notify_smart_div": bool(self.settings.get("notify_smart_div", True)),
            "notify_squeeze": bool(self.settings.get("notify_squeeze", True)),
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
        if "notify_smart_div" in new_settings:
            self.settings["notify_smart_div"] = bool(new_settings["notify_smart_div"])
        if "notify_squeeze" in new_settings:
            self.settings["notify_squeeze"] = bool(new_settings["notify_squeeze"])

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

        smode = setup.get("setup_mode")
        if smode == "smart_risk":
            mode_badge = "🏛️ <b>Engine:</b> Smart Risk Institutional (SMC + Inducement Trap Protection)\n"
        elif smode == "apex_quant":
            mode_badge = "💎 <b>Engine:</b> Apex Quant A++ (Hybrid SMC + Fib OTE)\n"
        elif smode == "craig_10x":
            mode_badge = "🎯 <b>Engine:</b> Craig 10x Asymmetric (Min 3R-8R)\n"
        elif smode == "pro_shield":
            mode_badge = "🛡️ <b>Protection:</b> Pro Shield (Anti-Stop Hunt)\n"
        else:
            mode_badge = ""

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

    def format_smart_divergence_message(self, sig: Dict[str, Any]) -> str:
        symbol = sig.get("symbol", "UNKNOWN")
        timeframe = sig.get("timeframe", "15m")
        direction = sig.get("direction", "BULLISH").upper()
        grade = sig.get("grade", "A")
        grade_label = "⭐ GRADE A+ (High Confluence)" if grade == "A" else "GRADE B"
        dir_emoji = "🟢 BULLISH DIVERGENCE" if direction == "BULLISH" else "🔴 BEARISH DIVERGENCE"

        entry = float(sig.get("entry", 0.0))
        sl = float(sig.get("stop_loss", 0.0))
        tp = float(sig.get("take_profit", 0.0))
        rr = float(sig.get("risk_reward", 2.0))
        reasons = ", ".join(sig.get("reasons", []))
        confs = []
        if sig.get("confirmations", {}).get("rsi"): confs.append("RSI (14)")
        if sig.get("confirmations", {}).get("macd"): confs.append("MACD")
        if sig.get("confirmations", {}).get("cvd"): confs.append("CVD/Volume")
        conf_str = " + ".join(confs) if confs else "Wilder's RSI"

        def fmt_p(p: float) -> str:
            if p >= 1000: return f"{p:,.2f}"
            elif p >= 1: return f"{p:.4f}"
            else: return f"{p:.6f}"

        timestamp_str = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())

        return (
            f"🎯 <b>SMART DIVERGENCE (GRADE A+) ALERT!</b>\n\n"
            f"💎 <b>Pair:</b> <code>{symbol}</code> (FUTURES)\n"
            f"📊 <b>Timeframe:</b> <code>{timeframe}</code>\n"
            f"🧭 <b>Signal:</b> <b>{dir_emoji}</b>\n"
            f"⭐ <b>Quality:</b> <b>{grade_label}</b>\n\n"
            f"🔍 <b>Konsensus:</b> <code>{conf_str}</code>\n"
            f"✅ <b>Karakteristik:</b> {reasons}\n\n"
            f"💵 <b>Planned Entry:</b> <code>${fmt_p(entry)}</code>\n"
            f"🛡️ <b>Stop Loss:</b> <code>${fmt_p(sl)}</code>\n"
            f"🎯 <b>Take Profit:</b> <code>${fmt_p(tp)}</code>\n"
            f"⚖️ <b>Risk / Reward:</b> <code>1 : {rr:.2f}</code>\n\n"
            f"⏰ <i>Waktu Deteksi: {timestamp_str}</i>\n"
            f"🤖 <i>Binance Smart Divergence Radar</i>"
        )

    def format_squeeze_message(self, cand: Dict[str, Any]) -> str:
        symbol = cand.get("symbol", "UNKNOWN")
        stype = cand.get("squeeze_type", "SHORT_SQUEEZE")
        bias = cand.get("bias_label", "PUMP BIAS")
        rate_pct = float(cand.get("funding_rate_pct", 0.0))
        mark_p = float(cand.get("mark_price", 0.0))
        target = float(cand.get("est_liquidation_target", 0.0))
        apr = float(cand.get("annualized_apr", 0.0))
        grade = cand.get("grade", "GRADE A")
        time_left = cand.get("time_left_str", "N/A")
        rationale = cand.get("rationale", "")

        def fmt_p(p: float) -> str:
            if p >= 1000: return f"{p:,.2f}"
            elif p >= 1: return f"{p:.4f}"
            else: return f"{p:.6f}"

        timestamp_str = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime())
        icon = "🔥 WHALE SHORT SQUEEZE (PUMP ALERT)" if stype == "SHORT_SQUEEZE" else "💧 LONG SQUEEZE (DUMP ALERT)"

        return (
            f"<b>{icon}</b>\n\n"
            f"💎 <b>Pair:</b> <code>{symbol}</code> (Binance Futures)\n"
            f"⚡ <b>Funding Rate:</b> <code>{rate_pct:+.4f}%</code> ({apr:+,.0f}% APR)\n"
            f"⭐ <b>Intensitas:</b> <b>{grade}</b>\n"
            f"🧭 <b>Squeeze Bias:</b> <b>{bias}</b>\n\n"
            f"💵 <b>Mark Price:</b> <code>${fmt_p(mark_p)}</code>\n"
            f"🧲 <b>Target Likuidasi:</b> <code>${fmt_p(target)}</code>\n"
            f"⏰ <b>Settlement Berikutnya:</b> <code>{time_left}</code>\n\n"
            f"💡 <b>Analisa:</b> {rationale}\n\n"
            f"⏰ <i>Waktu Deteksi: {timestamp_str}</i>\n"
            f"🤖 <i>Binance Squeeze Hunter Radar</i>"
        )

    async def scan_and_notify_smart_divergences(self) -> int:
        """Scan top pairs for Grade A+ Smart Divergences and notify via Telegram."""
        if not self.settings.get("enabled") or not self.settings.get("notify_smart_div", True):
            return 0
        if not self.settings.get("bot_token") or not self.settings.get("chat_id"):
            return 0

        from ..analysis.smart_divergence_engine import scan_market_smart_divergence

        tf = self.settings.get("timeframe", "15m")
        market = self.settings.get("market", "futures")

        try:
            signals = await scan_market_smart_divergence(
                market=market,
                timeframe=tf,
                scan_limit=24
            )

            # Filter for Grade A+ only
            grade_a_signals = [s for s in signals if s.get("grade") == "A"]
            notified_count = 0
            now = time.time()

            for sig in grade_a_signals:
                sym = sig.get("symbol")
                dir_str = sig.get("direction")
                c_time = sig.get("confirm_time")
                sig_id = f"smartdiv_{sym}_{tf}_{dir_str}_{c_time}"

                # Avoid duplicate alerts within 3 hours
                if sig_id in self._notified_ids and (now - self._notified_ids[sig_id] < 10800):
                    continue

                msg = self.format_smart_divergence_message(sig)
                ok, _ = await self.send_message(msg)
                if ok:
                    self._notified_ids[sig_id] = now
                    notified_count += 1
                    logger.info(f"Telegram alert sent for Smart Divergence Grade A+: {sig_id}")
                    await asyncio.sleep(1.0)

            if notified_count > 0:
                self._save_history()
            return notified_count

        except Exception as e:
            logger.error(f"Error scanning Smart Divergence for Telegram: {e}")
            return 0

    async def scan_and_notify_squeeze_candidates(self) -> int:
        """Scan Binance Futures for extreme Short/Long Squeezes and notify via Telegram."""
        if not self.settings.get("enabled") or not self.settings.get("notify_squeeze", True):
            return 0
        if not self.settings.get("bot_token") or not self.settings.get("chat_id"):
            return 0

        from ..analysis.squeeze_hunter_engine import scan_market_squeeze_candidates

        try:
            # Look for extreme funding rate >= 0.15% (or <= -0.15%)
            candidates = await scan_market_squeeze_candidates(min_funding_abs_pct=0.15, limit=10)
            notified_count = 0
            now = time.time()

            for cand in candidates:
                sym = cand.get("symbol")
                stype = cand.get("squeeze_type")
                rate = cand.get("funding_rate_pct")
                sq_id = f"squeeze_{sym}_{stype}_{round(rate, 2)}"

                # Avoid duplicate alert for same coin within 4 hours
                if sq_id in self._notified_ids and (now - self._notified_ids[sq_id] < 14400):
                    continue

                msg = self.format_squeeze_message(cand)
                ok, _ = await self.send_message(msg)
                if ok:
                    self._notified_ids[sq_id] = now
                    notified_count += 1
                    logger.info(f"Telegram alert sent for Squeeze Candidate: {sq_id}")
                    await asyncio.sleep(1.0)

            if notified_count > 0:
                self._save_history()
            return notified_count

        except Exception as e:
            logger.error(f"Error scanning Squeeze Candidates for Telegram: {e}")
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
                    # 1. Standard chart pattern setups
                    await self.scan_and_notify_new_setups()
                    # 2. Smart Divergence Grade A+ setups
                    if self.settings.get("notify_smart_div", True):
                        await self.scan_and_notify_smart_divergences()
                    # 3. Whale Short/Long Squeeze setups
                    if self.settings.get("notify_squeeze", True):
                        await self.scan_and_notify_squeeze_candidates()

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
