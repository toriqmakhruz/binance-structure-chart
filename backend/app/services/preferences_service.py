import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Dict

logger = logging.getLogger("preferences_service")

# Data directory inside root/data or /app/data
BASE_DIR = Path(__file__).resolve().parent.parent.parent
DATA_DIR = BASE_DIR / "data"
PREFERENCES_FILE = DATA_DIR / "user_preferences.json"


class PreferencesService:
    def __init__(self):
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        self._memory_cache: Dict[str, Any] = self._load()

    def _load(self) -> Dict[str, Any]:
        """Load user layout and indicator preferences from disk."""
        if PREFERENCES_FILE.exists():
            try:
                with open(PREFERENCES_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, dict):
                        return data
            except Exception as e:
                logger.error(f"Failed to load user preferences from {PREFERENCES_FILE}: {e}")
        return {}

    def get_preferences(self) -> Dict[str, Any]:
        """Return cached user preferences."""
        if not self._memory_cache and PREFERENCES_FILE.exists():
            self._memory_cache = self._load()
        return self._memory_cache.copy()

    def save_preferences(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        """Merge and persist user preferences to disk atomically."""
        try:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            current = self.get_preferences()
            current.update(payload)
            current["updated_at"] = int(time.time() * 1000)

            # Atomic write via temporary file
            temp_file = DATA_DIR / f"user_preferences_{int(time.time()*1000)}.tmp"
            with open(temp_file, "w", encoding="utf-8") as f:
                json.dump(current, f, indent=2)
            temp_file.replace(PREFERENCES_FILE)

            self._memory_cache = current
            logger.info("User layout and preferences successfully synced to server.")
            return {"success": True, "updated_at": current["updated_at"], "preferences": current}
        except Exception as e:
            logger.error(f"Failed to save user preferences: {e}")
            return {"success": False, "message": str(e)}


preferences_service = PreferencesService()
