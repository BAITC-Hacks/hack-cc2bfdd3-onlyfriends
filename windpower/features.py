"""Construct forecast-only predictors and join historical hourly targets."""

import numpy as np
import pandas as pd


WEATHER_COLUMNS = [
    "wind_speed_10m", "wind_speed_100m", "wind_direction_100m",
    "temperature_2m", "surface_pressure",
]
META_COLUMNS = ["issue_time_utc", "run_time_utc", "valid_time_utc", "turbine_id", "lead_hour"]
FEATURE_COLUMNS = [
    "turbine_id", "lead_hour", "wind_speed_10m", "wind_speed_100m",
    "temperature_2m", "surface_pressure", "direction_sin", "direction_cos",
    "wind_shear", "hour_sin", "hour_cos", "doy_sin", "doy_cos",
]


def make_features(weather: pd.DataFrame, timezone: str = "Asia/Almaty") -> pd.DataFrame:
    """Keep only forecast-time information; add cyclic location-time features."""
    missing = set(META_COLUMNS + WEATHER_COLUMNS) - set(weather.columns)
    if missing:
        raise ValueError(f"missing forecast columns: {sorted(missing)}")
    result = weather[META_COLUMNS + WEATHER_COLUMNS].copy()
    local = pd.to_datetime(result["valid_time_utc"], utc=True).dt.tz_convert(timezone)
    direction = np.deg2rad(result["wind_direction_100m"].astype(float))
    result["direction_sin"] = np.sin(direction)
    result["direction_cos"] = np.cos(direction)
    result["wind_shear"] = result["wind_speed_100m"] / (result["wind_speed_10m"] + 0.5)
    result["hour_sin"] = np.sin(2 * np.pi * local.dt.hour / 24)
    result["hour_cos"] = np.cos(2 * np.pi * local.dt.hour / 24)
    result["doy_sin"] = np.sin(2 * np.pi * local.dt.dayofyear / 365.25)
    result["doy_cos"] = np.cos(2 * np.pi * local.dt.dayofyear / 365.25)
    return result


def build_examples(
    history: pd.DataFrame,
    weather: pd.DataFrame,
    cutoff_local: str = "2026-02-01",
    timezone: str = "Asia/Almaty",
) -> pd.DataFrame:
    """Join forecasts to labels available before the holdout cutoff."""
    cutoff = pd.Timestamp(cutoff_local, tz=timezone).tz_convert("UTC")
    labelled = history.loc[pd.to_datetime(history["valid_time_utc"], utc=True) < cutoff].copy()
    labelled["turbine_id"] = labelled["turbine_id"].astype(str)
    predictors = make_features(weather, timezone)
    predictors["turbine_id"] = predictors["turbine_id"].astype(str)
    predictors = predictors.loc[pd.to_datetime(predictors["issue_time_utc"], utc=True) < cutoff]
    result = predictors.merge(
        labelled[["valid_time_utc", "turbine_id", "power", "measured_wind", "measured_temp"]],
        on=["valid_time_utc", "turbine_id"], how="inner", validate="many_to_one",
    )
    return result.sort_values(["issue_time_utc", "lead_hour", "turbine_id"]).reset_index(drop=True)
