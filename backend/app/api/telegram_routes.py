import logging
from typing import Optional
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field
from ..services.telegram_service import telegram_service

logger = logging.getLogger("telegram_routes")

telegram_router = APIRouter(prefix="/api/telegram", tags=["telegram"])

class TelegramSettingsRequest(BaseModel):
    enabled: bool = False
    bot_token: Optional[str] = None
    chat_id: Optional[str] = None
    min_rr: float = Field(1.5, ge=1.0, le=10.0)
    market: str = Field("futures", pattern="^(spot|futures)$")
    timeframe: str = Field("15m")
    scan_interval_seconds: int = Field(60, ge=30, le=600)
    min_confluence_score: float = Field(50.0, ge=0.0, le=100.0)

class TelegramTestRequest(BaseModel):
    bot_token: Optional[str] = None
    chat_id: Optional[str] = None

@telegram_router.get("/settings")
async def get_telegram_settings():
    """Retrieve current Telegram notification configuration (token masked)."""
    return telegram_service.get_public_settings()

@telegram_router.post("/settings")
async def update_telegram_settings(req: TelegramSettingsRequest):
    """Save new Telegram alert settings."""
    try:
        updated = telegram_service.update_settings(req.model_dump(exclude_unset=True))
        return {
            "status": "success",
            "message": "Pengaturan Telegram berhasil disimpan.",
            "data": updated
        }
    except Exception as e:
        logger.error(f"Failed to update telegram settings: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Gagal menyimpan pengaturan: {str(e)}"
        )

@telegram_router.post("/test")
async def test_telegram_connection(req: TelegramTestRequest):
    """Send an immediate test notification message to verify token and chat ID."""
    token = req.bot_token or telegram_service.settings.get("bot_token")
    chat_id = req.chat_id or telegram_service.settings.get("chat_id")

    if not token or not chat_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Bot Token dan Chat ID wajib diisi untuk melakukan pengetesan."
        )

    test_msg = (
        "🚀 <b>Test Notifikasi Telegram Berhasil!</b>\n\n"
        "Koneksi antara <b>Binance Structure Radar</b> dan bot Telegram Anda telah sukses terhubung.\n"
        "Setiap kali ada <i>Setup Entry A+</i> baru yang terdeteksi, bot akan otomatis mengirimkan sinyal ke sini.\n\n"
        "✅ <i>Status: Terhubung & Aktif</i>"
    )

    success, message = await telegram_service.send_message(
        text=test_msg,
        token=token,
        chat_id=chat_id
    )

    if not success:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=message
        )

    return {
        "status": "success",
        "message": message
    }
