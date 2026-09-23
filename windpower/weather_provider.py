"""Weather source boundary for current and archived forecast runs."""

from datetime import datetime
from pathlib import Path
from typing import Protocol

import pandas as pd

from windpower import weather


class WeatherProvider(Protocol):
    def get_historical_forecast(self, issue_utc: datetime) -> pd.DataFrame: ...
    def get_forecast(self, issue_utc: datetime,
                     target_start_utc: datetime | None = None) -> pd.DataFrame: ...


class OpenMeteoWeatherProvider:
    def __init__(self, cache_dir: Path) -> None:
        self.cache_dir = Path(cache_dir)

    def get_historical_forecast(self, issue_utc: datetime) -> pd.DataFrame:
        return weather.fetch_issue(issue_utc, self.cache_dir)

    def get_forecast(self, issue_utc: datetime,
                     target_start_utc: datetime | None = None) -> pd.DataFrame:
        return weather.fetch_live(issue_utc, target_start_utc=target_start_utc)
