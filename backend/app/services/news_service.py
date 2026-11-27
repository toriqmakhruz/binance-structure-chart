import asyncio
import html
import logging
import re
import time
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Dict, List, Optional, Tuple

import httpx
from ..config import settings

logger = logging.getLogger("news_service")

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Accept": "application/rss+xml, application/xml, application/json, text/xml, */*",
}

NEWS_RSS_SOURCES: List[Dict[str, str]] = [
    {"name": "CoinTelegraph", "url": "https://cointelegraph.com/rss", "tier": "TIER_1", "category_hint": "CRYPTO"},
    {"name": "CoinDesk", "url": "https://www.coindesk.com/arc/outboundfeeds/rss/", "tier": "TIER_1", "category_hint": "CRYPTO"},
    {"name": "The Block", "url": "https://www.theblock.co/rss.xml", "tier": "TIER_1", "category_hint": "CRYPTO"},
    {"name": "Decrypt", "url": "https://decrypt.co/feed", "tier": "TIER_1", "category_hint": "CRYPTO"},
    {"name": "Blockworks", "url": "https://blockworks.co/feed", "tier": "TIER_1", "category_hint": "MACRO"},
    {"name": "Bitcoin Magazine", "url": "https://bitcoinmagazine.com/feed", "tier": "TIER_1", "category_hint": "CRYPTO"},
    {"name": "Federal Reserve", "url": "https://www.federalreserve.gov/feeds/press_monetary.xml", "tier": "OFFICIAL", "category_hint": "MACRO"},
    {"name": "Daily Hodl", "url": "https://dailyhodl.com/feed/", "tier": "TIER_2", "category_hint": "CRYPTO"},
    {"name": "BeInCrypto", "url": "https://beincrypto.com/feed/", "tier": "TIER_2", "category_hint": "CRYPTO"},
    {"name": "NewsBTC", "url": "https://www.newsbtc.com/feed/", "tier": "TIER_2", "category_hint": "CRYPTO"},
    {"name": "U.Today", "url": "https://u.today/rss", "tier": "TIER_2", "category_hint": "CRYPTO"},
    {"name": "Bitcoinist", "url": "https://bitcoinist.com/feed/", "tier": "TIER_2", "category_hint": "CRYPTO"},
    {"name": "CoinGape", "url": "https://coingape.com/feed/", "tier": "TIER_2", "category_hint": "CRYPTO"},
    {"name": "CryptoNews", "url": "https://cryptonews.com/news/feed/", "tier": "TIER_2", "category_hint": "CRYPTO"},
]

BULLISH_TERMS: Dict[str, float] = {
    "spot etf approved": 3.0, "etf approval": 2.8, "etf inflow": 2.5, "record inflow": 2.5,
    "all-time high": 2.5, "new ath": 2.5, "rate cut": 2.4, "dovish": 2.0,
    "institutional adoption": 2.2, "whale accumulation": 2.2, "accumulates": 1.8, "accumulating": 1.8,
    "surge": 1.8, "surges": 1.8, "rally": 1.8, "rallies": 1.8, "soars": 1.8, "jumps": 1.6,
    "breakout": 1.7, "bullish": 1.8, "approved": 1.7, "approval": 1.6, "partnership": 1.4,
    "launch": 1.2, "launches": 1.2, "upgrade": 1.3, "adoption": 1.5, "treasury reserve": 2.2,
    "buys bitcoin": 2.2, "buys btc": 2.2, "legal victory": 2.3, "lawsuit dismissed": 2.4,
    "short squeeze": 1.6, "inflows": 1.6, "rebound": 1.4, "recovers": 1.4, "record high": 2.2,
}

BEARISH_TERMS: Dict[str, float] = {
    "hacked": 3.0, "hack": 2.6, "exploit": 2.8, "drained": 2.7, "rug pull": 3.0,
    "bankrupt": 3.0, "bankruptcy": 3.0, "insolvent": 2.8, "insolvency": 2.8,
    "sec sues": 2.6, "lawsuit": 2.0, "indicted": 2.5, "arrested": 2.3, "fraud": 2.5,
    "rate hike": 2.5, "hawkish": 2.1, "inflation surges": 2.3, "hotter cpi": 2.4,
    "plunge": 2.0, "plunges": 2.0, "crash": 2.4, "crashes": 2.4, "tumbles": 1.8, "dumps": 1.9,
    "sell-off": 1.9, "outflow": 1.8, "outflows": 1.8, "etf outflow": 2.4, "delist": 2.2,
    "delisting": 2.2, "ban": 2.0, "crackdown": 2.1, "bearish": 1.8, "liquidation": 1.6,
    "liquidated": 1.6, "recession": 2.1, "tariff": 1.7, "tariffs": 1.7, "sanction": 2.0,
}

HIGH_IMPACT_KEYWORDS = [
    "fomc", "federal reserve", "fed ", "powell", "cpi", "inflation", "interest rate", "rate cut", "rate hike",
    "nfp", "payroll", "gdp", "sec ", "etf", "blackrock", "binance", "coinbase", "hack", "exploit",
    "bankrupt", "insolvency", "lawsuit", "trump", "tariff", "war", "sanction", "all-time high", "ath",
    "liquidation", "crash", "emergency", "fiat", "treasury", "microstrategy", "strategy", "tether"
]

MACRO_KEYWORDS = [
    "fomc", "federal reserve", "fed ", "powell", "cpi", "ppi", "inflation", "interest rate",
    "rate cut", "rate hike", "nfp", "payroll", "unemployment", "gdp", "treasury", "bond yield",
    "recession", "tariff", "central bank", "ecb", "boj", "macro", "dollar", "dxy"
]

REGULATION_KEYWORDS = [
    "sec ", "cftc", "doj", "lawsuit", "regulation", "regulatory", "congress", "senate",
    "mica", "irs", "tax", "compliance", "court", "judge", "ban", "crackdown", "license", "etf"
]

WHALE_KEYWORDS = [
    "whale", "liquidation", "liquidated", "inflow", "outflow", "short squeeze", "long squeeze",
    "open interest", "funding rate", "accumulat", "dormant", "exchange reserve", "transfer"
]

COIN_PATTERNS: List[Tuple[str, re.Pattern]] = [
    ("BTC", re.compile(r"\b(btc|bitcoin)\b", re.I)),
    ("ETH", re.compile(r"\b(eth|ethereum|ether)\b", re.I)),
    ("SOL", re.compile(r"\b(sol|solana)\b", re.I)),
    ("XRP", re.compile(r"\b(xrp|ripple)\b", re.I)),
    ("BNB", re.compile(r"\b(bnb|binance coin)\b", re.I)),
    ("DOGE", re.compile(r"\b(doge|dogecoin)\b", re.I)),
    ("ADA", re.compile(r"\b(ada|cardano)\b", re.I)),
    ("AVAX", re.compile(r"\b(avax|avalanche)\b", re.I)),
    ("LINK", re.compile(r"\b(link|chainlink)\b", re.I)),
    ("SUI", re.compile(r"\b(sui)\b", re.I)),
    ("TON", re.compile(r"\b(ton|toncoin)\b", re.I)),
    ("DOT", re.compile(r"\b(dot|polkadot)\b", re.I)),
    ("PEPE", re.compile(r"\b(pepe)\b", re.I)),
    ("SHIB", re.compile(r"\b(shib|shiba inu)\b", re.I)),
    ("USDT", re.compile(r"\b(usdt|tether)\b", re.I)),
    ("USDC", re.compile(r"\b(usdc|circle)\b", re.I)),
]


def _clean_html(raw: str) -> str:
    if not raw:
        return ""
    text = html.unescape(raw)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _parse_rss_datetime(date_str: str) -> int:
    if not date_str:
        return int(time.time())
    s = date_str.strip()
    try:
        dt = parsedate_to_datetime(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp())
    except Exception:
        pass
    try:
        iso = s.replace("Z", "+00:00")
        dt = datetime.fromisoformat(iso)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return int(dt.timestamp())
    except Exception:
        return int(time.time())


def _extract_image_from_item(item_el: ET.Element, raw_desc: str) -> Optional[str]:
    # Check media:content, media:thumbnail, enclosure
    for child in item_el:
        tag = child.tag.lower()
        if tag.endswith("content") or tag.endswith("thumbnail") or tag.endswith("enclosure"):
            url = child.attrib.get("url") or child.attrib.get("href")
            if url and url.startswith("http"):
                return url
    # Fallback: img src in description
    if raw_desc:
        m = re.search(r'<img[^>]+src=["\']([^"\']+)["\']', raw_desc, re.I)
        if m and m.group(1).startswith("http"):
            return m.group(1)
    return None


def _classify_article(title: str, summary: str, source_name: str, category_hint: str) -> Dict[str, Any]:
    text = f"{title} {summary}".lower()

    bull_score = sum(w for kw, w in BULLISH_TERMS.items() if kw in text)
    bear_score = sum(w for kw, w in BEARISH_TERMS.items() if kw in text)
    net = bull_score - bear_score

    if net >= 1.2:
        sentiment = "BULLISH"
        sentiment_score = min(98, int(60 + net * 8))
    elif net <= -1.2:
        sentiment = "BEARISH"
        sentiment_score = max(2, int(40 + net * 8))
    else:
        sentiment = "NEUTRAL"
        sentiment_score = 50

    is_official = source_name == "Federal Reserve"
    high_hits = sum(1 for kw in HIGH_IMPACT_KEYWORDS if kw in text)
    if is_official or high_hits >= 2 or (high_hits >= 1 and abs(net) >= 1.8):
        impact = "HIGH"
    elif high_hits >= 1 or abs(net) >= 1.4:
        impact = "MEDIUM"
    else:
        impact = "LOW"

    if is_official or any(kw in text for kw in MACRO_KEYWORDS):
        category = "MACRO"
    elif any(kw in text for kw in REGULATION_KEYWORDS):
        category = "REGULATION"
    elif any(kw in text for kw in WHALE_KEYWORDS):
        category = "ONCHAIN_WHALE"
    else:
        category = category_hint or "CRYPTO"

    coins: List[str] = []
    for sym, pat in COIN_PATTERNS:
        if pat.search(text):
            coins.append(sym)

    return {
        "sentiment": sentiment,
        "sentiment_score": sentiment_score,
        "impact": impact,
        "category": category,
        "coins": coins[:5],
    }


def _parse_rss_xml(xml_bytes: bytes, source_meta: Dict[str, str]) -> List[Dict[str, Any]]:
    articles: List[Dict[str, Any]] = []
    try:
        root = ET.fromstring(xml_bytes)
    except Exception as e:
        logger.debug(f"XML parse error for {source_meta['name']}: {e}")
        return articles

    # Support RSS 2.0 (<channel>/<item>) and Atom (<entry>)
    items = root.findall(".//item")
    is_atom = False
    if not items:
        items = root.findall(".//{http://www.w3.org/2005/Atom}entry") or root.findall(".//entry")
        is_atom = True

    for item in items[:20]:
        try:
            if not is_atom:
                title = (item.findtext("title") or "").strip()
                link = (item.findtext("link") or "").strip()
                pub_raw = (item.findtext("pubDate") or item.findtext("{http://purl.org/dc/elements/1.1/}date") or "").strip()
                raw_desc = item.findtext("description") or item.findtext("{http://purl.org/rss/1.0/modules/content/}encoded") or ""
            else:
                ns = "{http://www.w3.org/2005/Atom}"
                title = (item.findtext(f"{ns}title") or item.findtext("title") or "").strip()
                link_el = item.find(f"{ns}link") or item.find("link")
                link = (link_el.attrib.get("href") if link_el is not None else "") or ""
                pub_raw = (item.findtext(f"{ns}updated") or item.findtext(f"{ns}published") or item.findtext("updated") or "").strip()
                raw_desc = item.findtext(f"{ns}summary") or item.findtext(f"{ns}content") or item.findtext("summary") or ""

            title_clean = _clean_html(title)
            if not title_clean or not link:
                continue

            summary_clean = _clean_html(raw_desc)
            if len(summary_clean) > 240:
                summary_clean = summary_clean[:237].rstrip() + "..."

            published_at = _parse_rss_datetime(pub_raw)
            image_url = _extract_image_from_item(item, raw_desc)
            cls_info = _classify_article(title_clean, summary_clean, source_meta["name"], source_meta["category_hint"])

            # Stable ID
            norm_key = re.sub(r"[^a-z0-9]", "", title_clean.lower())[:36]
            art_id = f"news_{source_meta['name'].lower().replace(' ', '')}_{published_at}_{norm_key}"

            articles.append({
                "id": art_id,
                "title": title_clean,
                "summary": summary_clean,
                "url": link,
                "source": source_meta["name"],
                "source_tier": source_meta["tier"],
                "image_url": image_url,
                "published_at": published_at,
                "sentiment": cls_info["sentiment"],
                "sentiment_score": cls_info["sentiment_score"],
                "impact": cls_info["impact"],
                "category": cls_info["category"],
                "coins": cls_info["coins"],
            })
        except Exception:
            continue

    return articles


class NewsService:
    def __init__(self):
        self._cache: Optional[Dict[str, Any]] = None
        self._cache_ts: float = 0.0
        self._cache_ttl: float = 75.0  # 75s live multi-source cache
        self._lock = asyncio.Lock()

    async def _fetch_single_rss(self, client: httpx.AsyncClient, source: Dict[str, str]) -> Tuple[str, bool, List[Dict[str, Any]]]:
        try:
            resp = await client.get(source["url"], follow_redirects=True)
            if resp.status_code == 200 and resp.content:
                parsed = _parse_rss_xml(resp.content, source)
                return source["name"], len(parsed) > 0, parsed
            return source["name"], False, []
        except Exception as e:
            logger.debug(f"Failed fetching RSS {source['name']}: {e}")
            return source["name"], False, []

    async def _fetch_fear_greed(self, client: httpx.AsyncClient) -> Dict[str, Any]:
        try:
            r = await client.get("https://api.alternative.me/fng/?limit=7&format=json")
            if r.status_code == 200:
                payload = r.json()
                rows = payload.get("data", [])
                if rows:
                    curr = rows[0]
                    prev = rows[1] if len(rows) > 1 else curr
                    val = int(curr.get("value", 50))
                    prev_val = int(prev.get("value", val))
                    return {
                        "value": val,
                        "classification": curr.get("value_classification", "Neutral"),
                        "yesterday_value": prev_val,
                        "delta": val - prev_val,
                        "timestamp": int(curr.get("timestamp", time.time())),
                        "history": [
                            {"value": int(x.get("value", 50)), "label": x.get("value_classification", "")}
                            for x in rows[:7]
                        ],
                    }
        except Exception as e:
            logger.debug(f"Fear & Greed fetch error: {e}")
        return {"value": 50, "classification": "Neutral", "yesterday_value": 50, "delta": 0, "timestamp": int(time.time()), "history": []}

    async def _fetch_global_market(self, client: httpx.AsyncClient) -> Dict[str, Any]:
        try:
            r = await client.get("https://api.coingecko.com/api/v3/global")
            if r.status_code == 200:
                d = r.json().get("data", {})
                return {
                    "total_market_cap_usd": round(float(d.get("total_market_cap", {}).get("usd", 0.0)), 0),
                    "total_volume_24h_usd": round(float(d.get("total_volume", {}).get("usd", 0.0)), 0),
                    "market_cap_change_24h_pct": round(float(d.get("market_cap_change_percentage_24h_usd", 0.0)), 2),
                    "btc_dominance_pct": round(float(d.get("market_cap_percentage", {}).get("btc", 0.0)), 2),
                    "eth_dominance_pct": round(float(d.get("market_cap_percentage", {}).get("eth", 0.0)), 2),
                    "active_cryptocurrencies": int(d.get("active_cryptocurrencies", 0)),
                }
        except Exception as e:
            logger.debug(f"CoinGecko global fetch error: {e}")
        return {
            "total_market_cap_usd": 0.0,
            "total_volume_24h_usd": 0.0,
            "market_cap_change_24h_pct": 0.0,
            "btc_dominance_pct": 0.0,
            "eth_dominance_pct": 0.0,
            "active_cryptocurrencies": 0,
        }

    async def _fetch_macro_calendar(self, client: httpx.AsyncClient) -> List[Dict[str, Any]]:
        events: List[Dict[str, Any]] = []
        try:
            r = await client.get("https://nfs.faireconomy.media/ff_calendar_thisweek.json")
            if r.status_code == 200:
                raw = r.json()
                if isinstance(raw, list):
                    now_ts = int(time.time())
                    for idx, ev in enumerate(raw):
                        impact = str(ev.get("impact", "Low")).upper()
                        country = str(ev.get("country", "")).upper()
                        # Focus on USD / EUR / High & Medium impact global macro movers
                        if impact not in ("HIGH", "MEDIUM"):
                            continue
                        if country not in ("USD", "EUR", "GBP", "JPY", "CNY") and impact != "HIGH":
                            continue
                        date_str = str(ev.get("date", ""))
                        ts = _parse_rss_datetime(date_str)
                        events.append({
                            "id": f"macro_{country}_{ts}_{idx}",
                            "title": str(ev.get("title", "")).strip(),
                            "country": country,
                            "impact": impact,
                            "timestamp": ts,
                            "date_iso": date_str,
                            "forecast": str(ev.get("forecast", "") or "-"),
                            "previous": str(ev.get("previous", "") or "-"),
                            "actual": str(ev.get("actual", "") or ""),
                            "is_released": ts <= now_ts or bool(ev.get("actual")),
                            "seconds_until": ts - now_ts,
                        })
                    events.sort(key=lambda x: x["timestamp"])
        except Exception as e:
            logger.debug(f"Macro calendar fetch error: {e}")
        return events

    async def get_news_hub(self, force_refresh: bool = False) -> Dict[str, Any]:
        now = time.time()
        if not force_refresh and self._cache and (now - self._cache_ts < self._cache_ttl):
            return self._cache

        async with self._lock:
            now = time.time()
            if not force_refresh and self._cache and (now - self._cache_ts < self._cache_ttl):
                return self._cache

            timeout = httpx.Timeout(8.0, connect=4.0)
            async with httpx.AsyncClient(headers=HEADERS, timeout=timeout, verify=settings.TLS_VERIFY) as client:
                rss_tasks = [self._fetch_single_rss(client, src) for src in NEWS_RSS_SOURCES]
                rss_results, fear_greed, global_market, macro_calendar = await asyncio.gather(
                    asyncio.gather(*rss_tasks, return_exceptions=True),
                    self._fetch_fear_greed(client),
                    self._fetch_global_market(client),
                    self._fetch_macro_calendar(client),
                )

            all_articles: List[Dict[str, Any]] = []
            sources_status: List[Dict[str, Any]] = []

            for src, res in zip(NEWS_RSS_SOURCES, rss_results):
                if isinstance(res, Exception):
                    sources_status.append({"name": src["name"], "ok": False, "count": 0, "tier": src["tier"]})
                else:
                    s_name, ok, items = res
                    sources_status.append({"name": s_name, "ok": ok, "count": len(items), "tier": src["tier"]})
                    all_articles.extend(items)

            # Deduplicate by normalized headline prefix & URL
            seen_urls = set()
            seen_titles = set()
            deduped: List[Dict[str, Any]] = []
            all_articles.sort(key=lambda x: x["published_at"], reverse=True)

            for art in all_articles:
                url_norm = art["url"].split("?")[0].rstrip("/").lower()
                title_norm = re.sub(r"[^a-z0-9]", "", art["title"].lower())[:48]
                if url_norm in seen_urls or title_norm in seen_titles:
                    continue
                seen_urls.add(url_norm)
                seen_titles.add(title_norm)
                deduped.append(art)

            # Aggregate News Sentiment & Trending Coins over newest 100 articles
            recent_slice = deduped[:100]
            bull_cnt = sum(1 for a in recent_slice if a["sentiment"] == "BULLISH")
            bear_cnt = sum(1 for a in recent_slice if a["sentiment"] == "BEARISH")
            neut_cnt = len(recent_slice) - bull_cnt - bear_cnt
            total_dir = max(1, bull_cnt + bear_cnt)
            news_sentiment_score = round((bull_cnt / total_dir) * 100.0, 1) if (bull_cnt + bear_cnt) > 0 else 50.0

            coin_counts: Dict[str, int] = {}
            for a in recent_slice:
                for c in a["coins"]:
                    coin_counts[c] = coin_counts.get(c, 0) + 1
            trending_coins = [
                {"coin": k, "mentions": v}
                for k, v in sorted(coin_counts.items(), key=lambda kv: kv[1], reverse=True)[:10]
            ]

            next_macro = next((m for m in macro_calendar if not m["is_released"] and m["impact"] == "HIGH"), None)
            if not next_macro:
                next_macro = next((m for m in macro_calendar if not m["is_released"]), None)

            payload = {
                "updated_at": int(time.time()),
                "total_articles": len(deduped),
                "active_sources_count": sum(1 for s in sources_status if s["ok"]),
                "total_sources_count": len(sources_status),
                "sources_status": sources_status,
                "fear_greed": fear_greed,
                "global_market": global_market,
                "news_sentiment": {
                    "score": news_sentiment_score,
                    "bullish_count": bull_cnt,
                    "bearish_count": bear_cnt,
                    "neutral_count": neut_cnt,
                    "bias": "BULLISH" if news_sentiment_score >= 58 else ("BEARISH" if news_sentiment_score <= 42 else "NEUTRAL"),
                },
                "trending_coins": trending_coins,
                "next_high_impact_macro": next_macro,
                "macro_calendar": macro_calendar,
                "articles": deduped[:150],
            }

            self._cache = payload
            self._cache_ts = time.time()
            return payload


news_service = NewsService()
