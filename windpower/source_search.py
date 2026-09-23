"""Read-only web search for weather-source research outside historical forecasts."""

from datetime import datetime, timezone
from typing import TypedDict
from urllib.parse import urlsplit

from ddgs import DDGS


MAX_QUERY_LENGTH = 200
MAX_RESULTS = 5
SEARCH_TIMEOUT_SECONDS = 10
MAX_SNIPPET_LENGTH = 500


class WebResult(TypedDict):
    title: str
    url: str
    snippet: str


class SearchReport(TypedDict):
    query: str
    retrieved_at_utc: str
    historical_availability_verified: bool
    results: list[WebResult]


def normalize_query(query: str) -> str:
    """Accept a short, single-line research question."""
    if not isinstance(query, str):
        raise ValueError("search query must be text")
    normalized = " ".join(query.split())
    if not normalized or len(normalized) > MAX_QUERY_LENGTH:
        raise ValueError("search query must contain 1 to 200 characters")
    return normalized


def search_web(query: str) -> SearchReport:
    """Return bounded search snippets; results are never historical forecast inputs."""
    query = normalize_query(query)
    with DDGS(timeout=SEARCH_TIMEOUT_SECONDS) as client:
        found = client.text(query, max_results=MAX_RESULTS, safesearch="moderate")
    results = []
    for item in found[:MAX_RESULTS]:
        url = str(item.get("href", ""))
        try:
            parsed = urlsplit(url)
        except ValueError:
            continue
        if parsed.scheme != "https" or not parsed.hostname:
            continue
        results.append({
            "title": str(item.get("title", ""))[:MAX_SNIPPET_LENGTH],
            "url": url,
            "snippet": str(item.get("body", ""))[:MAX_SNIPPET_LENGTH],
        })
    return {
        "query": query,
        "retrieved_at_utc": datetime.now(timezone.utc).isoformat(),
        "historical_availability_verified": False,
        "results": results,
    }
