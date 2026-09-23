"""Load 10-minute turbine telemetry and calculate reliable hourly targets."""

from pathlib import Path

import numpy as np
import pandas as pd


TIME = "Статистическое время"
WIND = "Средняя скорость ветра(m/s)"
POWER = "Нормализованная активная мощность"
TEMP = "Средняя температура окружающей среды(°C)"
OUTPUT_COLUMNS = [
    "valid_time_utc", "turbine_id", "power", "measured_wind", "measured_temp", "sample_count"
]


def load_history(paths: dict[str, Path], timezone: str = "Asia/Almaty") -> pd.DataFrame:
    """Average valid 10-minute samples; keep hours with at least four samples."""
    if not paths:
        raise ValueError("at least one turbine CSV is required")
    frames = []
    quality = {"raw_rows": 0, "invalid_rows": 0, "ambiguous_time_rows": 0, "hours_below_coverage": 0}
    for turbine_id, path in paths.items():
        raw = pd.read_csv(path, encoding="utf-8-sig", low_memory=False)
        missing = {TIME, WIND, POWER, TEMP} - set(raw.columns)
        if missing:
            raise ValueError(f"missing columns in {path}: {sorted(missing)}")
        quality["raw_rows"] += len(raw)
        try:
            local = pd.to_datetime(raw[TIME], format="%Y-%m-%d %H:%M:%S", errors="raise")
        except (TypeError, ValueError) as error:
            raise ValueError(f"invalid time in {path}: {error}") from error
        if local.duplicated().any():
            raise ValueError(f"duplicate timestamp in {path}")
        local = local.dt.tz_localize(timezone, ambiguous="NaT", nonexistent="NaT")
        quality["ambiguous_time_rows"] += int(local.isna().sum())
        numeric = raw[[WIND, POWER, TEMP]].apply(pd.to_numeric, errors="coerce")
        valid = (
            local.notna()
            & np.isfinite(numeric).all(axis=1)
            & numeric[WIND].ge(0)
            & numeric[POWER].between(0, 1)
        )
        quality["invalid_rows"] += int((~valid).sum())
        clean = pd.DataFrame(
            {
                "time_local": local[valid],
                "power": numeric.loc[valid, POWER],
                "measured_wind": numeric.loc[valid, WIND],
                "measured_temp": numeric.loc[valid, TEMP],
            }
        )
        if clean.empty:
            continue
        hourly = clean.set_index("time_local").resample("h").agg(
            power=("power", "mean"),
            measured_wind=("measured_wind", "mean"),
            measured_temp=("measured_temp", "mean"),
            sample_count=("power", "count"),
        )
        quality["hours_below_coverage"] += int(hourly["sample_count"].between(1, 3).sum())
        hourly = hourly.loc[hourly["sample_count"] >= 4].reset_index()
        hourly["valid_time_utc"] = hourly["time_local"].dt.tz_convert("UTC")
        hourly["turbine_id"] = str(turbine_id)
        frames.append(hourly[OUTPUT_COLUMNS])
    result = pd.concat(frames, ignore_index=True) if frames else pd.DataFrame(columns=OUTPUT_COLUMNS)
    result = result.sort_values(["valid_time_utc", "turbine_id"]).reset_index(drop=True)
    result.attrs["quality"] = quality
    return result
