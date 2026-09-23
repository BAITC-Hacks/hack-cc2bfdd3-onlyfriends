"""Construct forecast-only predictors and join historical hourly targets."""

import numpy as np
import pandas as pd


WEATHER_COLUMNS = [
    "wind_speed_10m", "wind_speed_100m", "wind_direction_100m",
    "temperature_2m", "surface_pressure",
]
META_COLUMNS = ["issue_time_utc", "run_time_utc", "valid_time_utc", "turbine_id", "lead_hour"]
BASE_FEATURE_COLUMNS = [
    "turbine_id", "lead_hour", "wind_speed_10m", "wind_speed_100m",
    "temperature_2m", "surface_pressure", "direction_sin", "direction_cos",
    "wind_shear", "hour_sin", "hour_cos", "doy_sin", "doy_cos",
]
WEATHER_FEATURE_COLUMNS = BASE_FEATURE_COLUMNS + [
    "wind_u100", "wind_v100", "wind_shear_delta", "run_age_hours", "run_lead_hours",
    "wind_100m_lag_3h", "wind_100m_lag_1h", "wind_100m_lead_1h", "wind_100m_lead_3h",
    "wind_100m_slope_2h", "air_density_proxy", "density_adjusted_wind",
]
FEATURE_COLUMNS = BASE_FEATURE_COLUMNS


def make_features(weather: pd.DataFrame, timezone: str = "Asia/Almaty") -> pd.DataFrame:
    """Keep only forecast-time information; add cyclic location-time features."""
    missing = set(META_COLUMNS + WEATHER_COLUMNS) - set(weather.columns)
    if missing:
        raise ValueError(f"missing forecast columns: {sorted(missing)}")
    result = weather[META_COLUMNS + WEATHER_COLUMNS].copy()
    for column in ("issue_time_utc", "run_time_utc", "valid_time_utc"):
        result[column] = pd.to_datetime(result[column], utc=True)
    result["turbine_id"] = result["turbine_id"].astype(str)
    if (result.run_time_utc > result.issue_time_utc).any():
        raise ValueError("weather run initialization is after issue")
    if "available_at_assumed_utc" in weather:
        available = pd.to_datetime(weather["available_at_assumed_utc"], utc=True)
        if ((available < result.run_time_utc) | (available > result.issue_time_utc)).any():
            raise ValueError("weather availability is after issue or before run")
    keys = ["issue_time_utc", "run_time_utc", "valid_time_utc", "turbine_id"]
    if result.duplicated(keys).any():
        raise ValueError("duplicate weather hour within a forecast run")
    local = result["valid_time_utc"].dt.tz_convert(timezone)
    direction = np.deg2rad(result["wind_direction_100m"].astype(float))
    result["direction_sin"] = np.sin(direction)
    result["direction_cos"] = np.cos(direction)
    result["wind_u100"] = -result["wind_speed_100m"] * result["direction_sin"]
    result["wind_v100"] = -result["wind_speed_100m"] * result["direction_cos"]
    result["wind_shear"] = result["wind_speed_100m"] / (result["wind_speed_10m"] + 0.5)
    result["wind_shear_delta"] = result["wind_speed_100m"] - result["wind_speed_10m"]
    result["run_age_hours"] = (result.issue_time_utc - result.run_time_utc).dt.total_seconds() / 3600
    result["run_lead_hours"] = (result.valid_time_utc - result.run_time_utc).dt.total_seconds() / 3600
    for offset, name in ((-3, "lag_3h"), (-1, "lag_1h"), (1, "lead_1h"), (3, "lead_3h")):
        neighbor = result[keys + ["wind_speed_100m"]].copy()
        neighbor["valid_time_utc"] -= pd.Timedelta(hours=offset)
        result = result.merge(neighbor.rename(columns={"wind_speed_100m": f"wind_100m_{name}"}),
                              on=keys, how="left", sort=False, validate="one_to_one")
    result["wind_100m_slope_2h"] = (result.wind_100m_lead_1h - result.wind_100m_lag_1h) / 2
    temperature_kelvin = result.temperature_2m + 273.15
    result["air_density_proxy"] = np.where(
        (temperature_kelvin > 0) & (result.surface_pressure > 0),
        100 * result.surface_pressure / (287.05 * temperature_kelvin), np.nan,
    )
    result["density_adjusted_wind"] = result.wind_speed_100m * np.cbrt(result.air_density_proxy / 1.225)
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
