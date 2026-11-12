import pytest
import math
from unittest.mock import patch, AsyncMock
from app.services.binance_service import (
    BinanceService, DataUnavailableException, DataMalformedException
)
from app.config import settings
from app.models.schemas import Candle, AnalysisMetadata

@pytest.fixture
def service():
    return BinanceService()

def test_market_endpoint_isolation(service):
    """
    Kriteria P0-A: Endpoint Spot dan Futures harus terpisah secara mutlak.
    Futures dilarang keras fallback ke Spot.
    """
    spot_urls = service._get_candidate_urls("/api/v3/klines", "spot")
    futures_urls = service._get_candidate_urls("/fapi/v1/klines", "futures")

    # Pastikan tidak ada crossover
    for url in spot_urls:
        assert "fapi" not in url, f"Spot URL should not contain futures gateway: {url}"
    for url in futures_urls:
        assert "api/v3" not in url, f"Futures URL should not contain spot gateway: {url}"
        assert "data-api.binance.vision" not in url, f"Futures URL should not contain spot vision mirror: {url}"

def test_ohlcv_validation_bounds(service):
    """
    Kriteria P0-A: Validasi OHLC - high harus >= open, close, low; low <= open, close.
    Candle yang melanggar harus ditolak.
    """
    raw_data = [
        # Valid candle
        [1700000000000, "100.0", "110.0", "95.0", "105.0", "1000", 1700000059999, "0", 0, "500"],
        # Invalid candle: High < Open
        [1700000060000, "105.0", "100.0", "95.0", "102.0", "1000", 1700000119999, "0", 0, "500"],
        # Invalid candle: Low > Close
        [1700000120000, "100.0", "110.0", "106.0", "102.0", "1000", 1700000179999, "0", 0, "500"],
        # Valid candle
        [1700000180000, "102.0", "108.0", "98.0", "106.0", "1500", 1700000239999, "0", 0, "700"],
    ]

    cleaned = service.validate_and_clean_candles(raw_data)
    assert len(cleaned) == 2
    assert cleaned[0].time == 1700000000
    assert cleaned[1].time == 1700000180

def test_non_finite_and_negative_volume(service):
    """
    Kriteria P0-A: Nilai non-finite (NaN/Inf) dan volume negatif harus ditolak.
    """
    raw_data = [
        # NaN in close
        [1700000000000, "100.0", "110.0", "95.0", "nan", "1000", 1700000059999, "0", 0, "500"],
        # Negative volume
        [1700000060000, "100.0", "110.0", "95.0", "105.0", "-50", 1700000119999, "0", 0, "0"],
        # Negative price
        [1700000120000, "-100.0", "110.0", "95.0", "105.0", "100", 1700000179999, "0", 0, "50"],
        # Valid
        [1700000180000, "100.0", "110.0", "95.0", "105.0", "500", 1700000239999, "0", 0, "250"],
    ]

    cleaned = service.validate_and_clean_candles(raw_data)
    assert len(cleaned) == 1
    assert cleaned[0].close == 105.0
    assert cleaned[0].volume == 500.0

def test_deduplication_and_sorting(service):
    """
    Kriteria P0-A: Timestamp duplikat atau acak harus diurutkan secara kronologis dan tidak menduplikasi.
    """
    raw_data = [
        [1700000120000, "102.0", "105.0", "100.0", "103.0", "100", 1700000179999], # t=120
        [1700000000000, "100.0", "103.0", "99.0", "102.0", "100", 1700000059999],  # t=000
        [1700000000000, "100.0", "104.0", "99.0", "102.0", "100", 1700000059999],  # duplicate t=000
        [1700000060000, "102.0", "104.0", "101.0", "102.0", "100", 1700000119999], # t=060
    ]

    cleaned = service.validate_and_clean_candles(raw_data)
    assert len(cleaned) == 3
    times = [c.time for c in cleaned]
    assert times == [1700000000, 1700000060, 1700000120]

def test_candle_open_closed_state(service):
    """
    Kriteria P0-A: Bedakan candle yang sedang terbuka dengan candle yang sudah ditutup.
    """
    current_time_ms = 1700000100000
    raw_data = [
        # Closed candle: close_time_ms (1700000059999) < current_time_ms
        [1700000000000, "100.0", "105.0", "99.0", "102.0", "100", 1700000059999],
        # In-progress open candle: close_time_ms (1700000119999) > current_time_ms
        [1700000060000, "102.0", "106.0", "101.0", "104.0", "100", 1700000119999],
    ]

    cleaned = service.validate_and_clean_candles(raw_data, server_time_ms=current_time_ms)
    assert len(cleaned) == 2
    assert cleaned[0].is_closed is True
    assert cleaned[1].is_closed is False

@pytest.mark.asyncio
async def test_no_synthetic_prices_on_failure(service):
    """
    Kriteria P0-A: Hapus harga sintetis dari jalur produksi.
    Jika API gagal, harus melempar DataUnavailableException dan BUKAN mengembalikan harga dummy BTC 88500.
    """
    with patch("httpx.AsyncClient.get", side_effect=Exception("Connection timed out")):
        # Mode produksi (default) -> DataUnavailableException
        with pytest.raises(DataUnavailableException):
            await service.get_symbols(market="futures", demo_mode=False)

        # Mode demo eksplisit -> is_demo == True
        demo_symbols = await service.get_symbols(market="futures", demo_mode=True)
        assert len(demo_symbols) > 0
        assert all(s.get("is_demo") is True for s in demo_symbols)

@pytest.mark.asyncio
async def test_metadata_attachment(service):
    """
    Kriteria P0-A: Data yang diteruskan membawa metadata symbol, market_type, interval, source, timestamp.
    """
    dummy_raw = [
        [1700000000000, "100.0", "105.0", "99.0", "102.0", "100", 1700000059999, "0", 0, "50"]
    ]
    with patch.object(service, "_fetch_raw_batch", return_value=(dummy_raw, "BINANCE_FUTURES")):
        candles, metadata = await service.get_klines(symbol="ETHUSDT", interval="15m", market="futures")
        assert metadata.symbol == "ETHUSDT"
        assert metadata.market_type == "futures"
        assert metadata.interval == "15m"
        assert metadata.source == "BINANCE_FUTURES"
        assert metadata.total_candles == 1
        assert metadata.received_at > 0


def test_api_route_validation():
    """
    Kriteria P0-A: Validasi input symbol dan timeframe pada router FastAPI.
    """
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)

    # Timeframe tidak valid
    res_tf = client.get("/api/analysis?symbol=BTCUSDT&timeframe=99m")
    assert res_tf.status_code == 400
    assert res_tf.json()["detail"]["code"] == "INVALID_TIMEFRAME"

    # Symbol karakter ilegal
    res_sym = client.get("/api/analysis?symbol=INVALID$$$&&timeframe=15m")
    assert res_sym.status_code == 422 # Pydantic regex pattern validation error

def test_api_symbols_failure_response():
    """
    Kriteria P0-A: Jika upstream Binance mati, API melempar status 503 DATA_UNAVAILABLE (bukan harga statis).
    """
    from fastapi.testclient import TestClient
    from app.main import app

    client = TestClient(app)
    with patch("httpx.AsyncClient.get", side_effect=Exception("Binance timeout")):
        res = client.get("/api/symbols?market=futures")
        assert res.status_code == 503
        data = res.json()
        assert data["detail"]["code"] == "DATA_UNAVAILABLE"
