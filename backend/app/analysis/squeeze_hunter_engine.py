import asyncio
import time
import logging
from typing import List, Dict, Any, Optional
import httpx
from ..config import settings
from ..services.binance_service import HEADERS

logger = logging.getLogger("squeeze_hunter")

_SQUEEZE_CACHE: Dict[str, Any] = {"data": [], "updated_at": 0.0}
_SQUEEZE_CACHE_TTL = 30.0  # 30s cache


async def scan_market_squeeze_candidates(
    min_funding_abs_pct: float = 0.03,  # Minimum absolute funding rate (0.03%)
    limit: int = 30
) -> List[Dict[str, Any]]:
    """
    Scans all Binance Futures pairs in a single request to detect
    Whale Short Squeeze (trapped shorts) and Long Squeeze (trapped longs) setups.
    """
    now = time.time()
    if _SQUEEZE_CACHE["data"] and (now - _SQUEEZE_CACHE["updated_at"] < _SQUEEZE_CACHE_TTL):
        return _SQUEEZE_CACHE["data"]

    url = "https://fapi.binance.com/fapi/v1/premiumIndex"
    timeout = httpx.Timeout(10.0, connect=5.0)

    try:
        async with httpx.AsyncClient(headers=HEADERS, timeout=timeout, verify=settings.TLS_VERIFY) as client:
            resp = await client.get(url)
            if resp.status_code != 200:
                logger.warning(f"Failed fetching premiumIndex for Squeeze Hunter: HTTP {resp.status_code}")
                return _SQUEEZE_CACHE["data"]

            raw_data = resp.json()
            if not isinstance(raw_data, list):
                return []

            results = []
            for item in raw_data:
                sym = item.get("symbol", "")
                if not sym.endswith("USDT"):
                    continue

                try:
                    last_rate = float(item.get("lastFundingRate", 0.0))
                    rate_pct = last_rate * 100.0  # e.g. -1.45% or +0.25%
                    abs_rate = abs(rate_pct)

                    if abs_rate < min_funding_abs_pct:
                        continue

                    mark_price = float(item.get("markPrice", 0.0))
                    index_price = float(item.get("indexPrice", mark_price))
                    next_funding_time_ms = int(item.get("nextFundingTime", 0))

                    # Time left until next funding settlement
                    time_left_sec = max(0, int((next_funding_time_ms - int(now * 1000)) / 1000))
                    hrs = time_left_sec // 3600
                    mins = (time_left_sec % 3600) // 60
                    time_left_str = f"{hrs:02d}h {mins:02d}m"

                    # Annualized APR (Funding paid 3x a day for 365 days)
                    annualized_apr = round(rate_pct * 3 * 365, 1)

                    # Determine squeeze direction & score
                    if rate_pct < 0:
                        squeeze_type = "SHORT_SQUEEZE"
                        bias_label = "PUMP BIAS (Trapped Shorts)"
                        # Squeeze probability score (0-100)
                        if abs_rate >= 0.5:
                            grade = "GRADE A+ (EXTREME)"
                            score = min(100, 90 + int(abs_rate * 8))
                            target_multiplier = 1.05 + min(0.15, abs_rate * 0.05)
                        elif abs_rate >= 0.1:
                            grade = "GRADE A (HIGH)"
                            score = 75 + int(abs_rate * 30)
                            target_multiplier = 1.03 + (abs_rate * 0.03)
                        else:
                            grade = "GRADE B (MODERATE)"
                            score = 60 + int(abs_rate * 50)
                            target_multiplier = 1.02

                        est_target = round(mark_price * target_multiplier, 6 if mark_price < 1 else 4 if mark_price < 100 else 2)
                        rationale = f"Shorts membayar fee {abs_rate:.3f}% ({annualized_apr:,.0f}% APR). Potensi forced covering / pump mendadak."
                    else:
                        squeeze_type = "LONG_SQUEEZE"
                        bias_label = "DUMP BIAS (Trapped Longs)"
                        if abs_rate >= 0.25:
                            grade = "GRADE A+ (EXTREME)"
                            score = min(100, 90 + int(abs_rate * 15))
                            target_multiplier = 0.95 - min(0.15, abs_rate * 0.05)
                        elif abs_rate >= 0.08:
                            grade = "GRADE A (HIGH)"
                            score = 75 + int(abs_rate * 30)
                            target_multiplier = 0.97 - (abs_rate * 0.02)
                        else:
                            grade = "GRADE B (MODERATE)"
                            score = 60 + int(abs_rate * 50)
                            target_multiplier = 0.98

                        est_target = round(mark_price * target_multiplier, 6 if mark_price < 1 else 4 if mark_price < 100 else 2)
                        rationale = f"Longs membayar fee {abs_rate:.3f}% ({annualized_apr:,.0f}% APR). Potensi long liquidation / dump flush."

                    results.append({
                        "symbol": sym,
                        "baseAsset": sym.replace("USDT", ""),
                        "mark_price": mark_price,
                        "index_price": index_price,
                        "funding_rate_pct": round(rate_pct, 4),
                        "funding_rate_abs": round(abs_rate, 4),
                        "annualized_apr": annualized_apr,
                        "next_funding_time": next_funding_time_ms,
                        "time_left_str": time_left_str,
                        "squeeze_type": squeeze_type,
                        "bias_label": bias_label,
                        "grade": grade,
                        "score": score,
                        "est_liquidation_target": est_target,
                        "rationale": rationale
                    })
                except Exception as parse_err:
                    logger.debug(f"Error parsing squeeze item for {sym}: {parse_err}")

            # Sort by absolute funding rate descending (most extreme squeeze first)
            results.sort(key=lambda x: x["funding_rate_abs"], reverse=True)
            top_results = results[:limit]

            _SQUEEZE_CACHE["data"] = top_results
            _SQUEEZE_CACHE["updated_at"] = now
            return top_results

    except Exception as exc:
        logger.error(f"Squeeze Hunter scan exception: {exc}")
        return _SQUEEZE_CACHE["data"]
