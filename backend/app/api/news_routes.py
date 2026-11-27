import logging
from typing import Optional
from fastapi import APIRouter, Query, HTTPException, status
from ..services.news_service import news_service

logger = logging.getLogger("news_routes")

news_router = APIRouter(prefix="/api/news", tags=["news"])


@news_router.get("/feed")
async def get_news_feed(
    symbol: Optional[str] = Query(None, description="Filter by active trading pair e.g. BTCUSDT"),
    category: str = Query("all", description="all | MACRO | REGULATION | ONCHAIN_WHALE | CRYPTO"),
    impact: str = Query("all", description="all | HIGH | MEDIUM | LOW"),
    sentiment: str = Query("all", description="all | BULLISH | BEARISH | NEUTRAL"),
    source: str = Query("all", description="Filter by media source name"),
    q: Optional[str] = Query(None, description="Search keyword"),
    limit: int = Query(100, ge=1, le=150),
    refresh: bool = Query(False)
):
    """
    Aggregated Real-Time Crypto News, Macro Economic Calendar, Fear & Greed Index,
    and Global Crypto Market Sentiment.
    """
    try:
        hub = await news_service.get_news_hub(force_refresh=refresh)
        articles = hub.get("articles", [])

        # Apply optional filters
        if symbol:
            sym_clean = symbol.upper().replace("USDT", "").replace("USDC", "").replace("BUSD", "").strip()
            if sym_clean:
                articles = [
                    a for a in articles
                    if sym_clean in a.get("coins", []) or sym_clean.lower() in a.get("title", "").lower()
                ]

        if category and category.lower() != "all":
            cat_up = category.upper().strip()
            articles = [a for a in articles if a.get("category") == cat_up]

        if impact and impact.lower() != "all":
            imp_up = impact.upper().strip()
            articles = [a for a in articles if a.get("impact") == imp_up]

        if sentiment and sentiment.lower() != "all":
            sent_up = sentiment.upper().strip()
            articles = [a for a in articles if a.get("sentiment") == sent_up]

        if source and source.lower() != "all":
            src_low = source.lower().strip()
            articles = [a for a in articles if a.get("source", "").lower() == src_low]

        if q and q.strip():
            kw = q.strip().lower()
            articles = [
                a for a in articles
                if kw in a.get("title", "").lower()
                or kw in a.get("summary", "").lower()
                or kw in a.get("source", "").lower()
            ]

        return {
            "updated_at": hub["updated_at"],
            "active_sources_count": hub["active_sources_count"],
            "total_sources_count": hub["total_sources_count"],
            "sources_status": hub["sources_status"],
            "fear_greed": hub["fear_greed"],
            "global_market": hub["global_market"],
            "news_sentiment": hub["news_sentiment"],
            "trending_coins": hub["trending_coins"],
            "next_high_impact_macro": hub["next_high_impact_macro"],
            "macro_calendar": hub["macro_calendar"],
            "total_filtered": len(articles),
            "articles": articles[:limit],
        }
    except Exception as e:
        logger.error(f"Error serving news feed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"code": "NEWS_FEED_ERROR", "message": str(e)}
        )
