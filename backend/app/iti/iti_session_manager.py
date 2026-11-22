import asyncio
import time
import logging
from typing import Dict, Any, Optional

logger = logging.getLogger("iti_session_manager")

class ITISessionManager:
    """
    Manages the single active pair session for Institutional Trading Intelligence (ITI).
    Enforces strict rules:
      - ONLY ONE ACTIVE SYMBOL at any given time.
      - NO background scanning across multiple pairs.
      - Incrementing generation_id on every symbol change.
      - Discarding any delayed / stale events from previous symbol sessions.
      - Cleanly saving and retaining per-symbol historical analysis state.
    """
    def __init__(self):
        self._active_symbol: str = "BTCUSDT"
        self._active_market: str = "futures"
        self._generation_id: int = 1
        self._session_start_time: float = time.time()
        self._pair_histories: Dict[str, Dict[str, Any]] = {}
        self._live_state: Dict[str, Any] = {}
        self._lock = asyncio.Lock()
        self._stop_event = asyncio.Event()

    @property
    def active_symbol(self) -> str:
        return self._active_symbol

    @property
    def active_market(self) -> str:
        return self._active_market

    @property
    def generation_id(self) -> int:
        return self._generation_id

    async def set_active_symbol(self, new_symbol: str, market: str = "futures") -> int:
        """
        Switches the active pair session:
          1. Validates input
          2. Preserves the outgoing pair's historical state
          3. Stops outgoing pair streams and flushes queues
          4. Increments generation_id
          5. Sets new active symbol and resets pair-specific live state
        """
        sym_clean = new_symbol.upper().strip()
        market_clean = market.lower().strip()

        async with self._lock:
            if sym_clean == self._active_symbol and market_clean == self._active_market:
                return self._generation_id

            logger.info(
                f"[ITI Session] Switching active pair: {self._active_symbol} -> {sym_clean} "
                f"({market_clean}), incrementing Gen ID: {self._generation_id} -> {self._generation_id + 1}"
            )

            # 1. Archive current live state into history
            if self._active_symbol:
                self._pair_histories[self._active_symbol] = {
                    "last_active_at": time.time(),
                    "state": self._live_state.copy()
                }

            # 2. Trigger stop event for active symbol's workers and reset
            self._stop_event.set()
            self._generation_id += 1
            self._active_symbol = sym_clean
            self._active_market = market_clean
            self._session_start_time = time.time()
            self._live_state = {}
            self._stop_event = asyncio.Event()

            return self._generation_id

    def is_valid_generation(self, gen_id: int, symbol: str) -> bool:
        """
        Validates whether an incoming event or computation matches the CURRENT active symbol
        and session generation ID. If outdated, it must be dropped immediately.
        """
        if gen_id != self._generation_id:
            return False
        if symbol.upper().strip() != self._active_symbol:
            return False
        return True

    def get_stop_event(self) -> asyncio.Event:
        return self._stop_event

    def update_live_state(self, key: str, value: Any, gen_id: int, symbol: str) -> bool:
        if not self.is_valid_generation(gen_id, symbol):
            return False
        self._live_state[key] = value
        return True

    def get_live_state(self) -> Dict[str, Any]:
        return self._live_state.copy()

    def get_pair_history(self, symbol: str) -> Optional[Dict[str, Any]]:
        return self._pair_histories.get(symbol.upper().strip())

session_manager = ITISessionManager()
