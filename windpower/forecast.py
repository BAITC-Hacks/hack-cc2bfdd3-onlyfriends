"""Validate one historical weather issue and its hourly power predictions."""

from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd

from windpower.weather import SITES, VARIABLES


KEY_COLUMNS = ["turbine_id", "lead_hour", "valid_time_utc"]
WEATHER_META = ["issue_time_utc", "run_time_utc", *KEY_COLUMNS]
PREDICTION_COLUMNS = [*KEY_COLUMNS, "predicted_power"]
TURBINE_IDS = {site[0] for site in SITES}


def normalize_issue(issue_utc: datetime) -> datetime:
    """Return an exact UTC hour; naive or fractional-hour issue times are invalid."""
    if not isinstance(issue_utc, datetime) or issue_utc.tzinfo is None:
        raise ValueError("issue time must be timezone-aware")
    issue = issue_utc.astimezone(timezone.utc)
    if issue.minute or issue.second or issue.microsecond:
        raise ValueError("issue time must be an exact hour")
    return issue


def validate_weather(weather: pd.DataFrame, issue_utc: datetime) -> pd.DataFrame:
    """Require both turbines, 48 aligned hours, and a cycle at least seven hours old."""
    issue = pd.Timestamp(normalize_issue(issue_utc))
    required = set(WEATHER_META) | set(VARIABLES)
    if not isinstance(weather, pd.DataFrame) or not required.issubset(weather.columns):
        raise ValueError(f"weather requires columns: {sorted(required)}")
    frame = weather[list(WEATHER_META) + list(VARIABLES)].copy()
    frame["turbine_id"] = frame["turbine_id"].astype(str)
    for name in ("issue_time_utc", "run_time_utc", "valid_time_utc"):
        frame[name] = pd.to_datetime(frame[name], utc=True, errors="raise")
    lead = pd.to_numeric(frame["lead_hour"], errors="coerce")
    if lead.isna().any() or not lead.between(1, 48).all() or not (lead % 1 == 0).all():
        raise ValueError("weather lead hours must be integers from 1 to 48")
    frame["lead_hour"] = lead.astype(int)
    if not frame["issue_time_utc"].eq(issue).all():
        raise ValueError("weather issue time does not match request")
    runs = frame["run_time_utc"].drop_duplicates()
    if len(runs) != 1 or pd.isna(runs.iloc[0]):
        raise ValueError("weather must use one known model run")
    if runs.iloc[0] + timedelta(hours=7) > issue:
        raise ValueError("weather run may not have been available at issue time")
    if len(frame) != len(TURBINE_IDS) * 48 or set(frame["turbine_id"]) != TURBINE_IDS:
        raise ValueError("weather must contain 48 hours for both turbines")
    if frame.duplicated(KEY_COLUMNS).any():
        raise ValueError("duplicate weather forecast hour")
    if not frame["valid_time_utc"].eq(issue + pd.to_timedelta(frame["lead_hour"], unit="h")).all():
        raise ValueError("weather forecast hours do not align with issue time")
    if any(set(group["lead_hour"]) != set(range(1, 49)) for _, group in frame.groupby("turbine_id")):
        raise ValueError("weather must contain every lead hour for both turbines")
    try:
        numeric = frame[list(VARIABLES)].apply(pd.to_numeric, errors="raise")
    except (TypeError, ValueError) as error:
        raise ValueError("weather variables must be numeric") from error
    if not np.isfinite(numeric.to_numpy(dtype=float)).all():
        raise ValueError("weather variables must be finite")
    if numeric[["wind_speed_10m", "wind_speed_100m"]].lt(0).any().any():
        raise ValueError("weather wind speed cannot be negative")
    frame[list(VARIABLES)] = numeric
    return frame.sort_values(["lead_hour", "turbine_id"]).reset_index(drop=True)


def validate_prediction(prediction: pd.DataFrame, weather: pd.DataFrame) -> pd.DataFrame:
    """Return aligned normalized-power forecasts; reject missing, extra, or invalid rows."""
    if not isinstance(prediction, pd.DataFrame) or not set(PREDICTION_COLUMNS).issubset(prediction.columns):
        raise ValueError(f"model output requires columns: {PREDICTION_COLUMNS}")
    frame = prediction[PREDICTION_COLUMNS].copy()
    frame["turbine_id"] = frame["turbine_id"].astype(str)
    frame["valid_time_utc"] = pd.to_datetime(frame["valid_time_utc"], utc=True, errors="raise")
    lead = pd.to_numeric(frame["lead_hour"], errors="coerce")
    if lead.isna().any() or not (lead % 1 == 0).all():
        raise ValueError("model lead hours must be integers")
    frame["lead_hour"] = lead.astype(int)
    try:
        power = pd.to_numeric(frame["predicted_power"], errors="raise")
    except (TypeError, ValueError) as error:
        raise ValueError("predicted power must be numeric") from error
    if not np.isfinite(power.to_numpy(dtype=float)).all() or not power.between(0, 1).all():
        raise ValueError("predicted power must be finite and within [0, 1]")
    frame["predicted_power"] = power.astype(float)
    expected = weather[WEATHER_META].merge(frame, on=KEY_COLUMNS, how="outer", indicator=True, validate="one_to_one")
    if len(expected) != len(weather) or not expected["_merge"].eq("both").all():
        raise ValueError("model output must match every weather forecast hour")
    return expected.drop(columns="_merge").sort_values(["lead_hour", "turbine_id"]).reset_index(drop=True)


def analyze_prediction(prediction: pd.DataFrame) -> dict[str, dict[str, float | int]]:
    """Summarize checked normalized power for each turbine and both 24-hour windows."""
    summary = {}
    for turbine_id, group in prediction.groupby("turbine_id"):
        power = group["predicted_power"]
        summary[str(turbine_id)] = {
            "mean_power_hours_1_24": float(group.loc[group["lead_hour"] <= 24, "predicted_power"].mean()),
            "mean_power_hours_25_48": float(group.loc[group["lead_hour"] > 24, "predicted_power"].mean()),
            "minimum_power": float(power.min()),
            "maximum_power": float(power.max()),
            "zero_power_hours": int(power.eq(0).sum()),
            "full_power_hours": int(power.eq(1).sum()),
        }
    return summary
