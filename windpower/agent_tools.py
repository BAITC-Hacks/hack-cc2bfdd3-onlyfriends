"""Thin LangChain tool adapters for the forecast agent."""

from datetime import datetime
from typing import Callable

from langchain.tools import tool
import pandas as pd

from windpower import forecast, source_search


def make_weather_tool(fetcher: Callable[[datetime], pd.DataFrame]):
    """Expose the configured archive adapter without arbitrary URLs or coordinates."""

    @tool("fetch_weather_run")
    def fetch_weather_run(issue_time_utc: str) -> pd.DataFrame:
        """Fetch a historical weather run for both configured turbine sites."""
        issue = forecast.normalize_issue(datetime.fromisoformat(issue_time_utc))
        return fetcher(issue)

    return fetch_weather_run


def make_search_tool(
    searcher: Callable[[str], source_search.SearchReport] = source_search.search_web,
):
    """Expose bounded, read-only internet search for source research."""

    @tool("search_web")
    def search_web(query: str) -> source_search.SearchReport:
        """Search public pages; snippets must never enter historical forecast features."""
        return searcher(source_search.normalize_query(query))

    return search_web
