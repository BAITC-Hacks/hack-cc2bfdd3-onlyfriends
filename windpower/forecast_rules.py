"""Validate forecast invariants and aggregate normalized turbine power."""

from datetime import datetime

import pandas as pd


def verify_forecast(frame: pd.DataFrame, weather: pd.DataFrame, issue: datetime) -> dict:
    """Check 48 hourly leads per turbine and summarize large power ramps."""
    if weather["available_at_assumed_utc"].max() > issue:
        raise ValueError("weather run was unavailable at issue time under publication assumption")
    for _, group in frame.groupby("turbine_id"):
        if len(group) != 48 or sorted(group.lead_hour.tolist()) != list(range(1, 49)):
            raise ValueError("forecast must contain 48 unique hourly leads per turbine")
        if group.valid_time_utc.nunique() != 48 or not group.predicted_power.between(0, 1).all():
            raise ValueError("forecast has missing hours or power outside [0, 1]")
    if set(frame.turbine_id.astype(str)) != {"1", "2"}:
        raise ValueError("forecast must contain both turbines")
    ramps = frame.sort_values("lead_hour").groupby("turbine_id").predicted_power.diff().abs()
    return {"max_hourly_ramp": float(ramps.max()), "warnings": ["large hourly ramp"] if ramps.max() > 0.7 else []}


def station_total(frame: pd.DataFrame) -> pd.DataFrame:
    """Sum two normalized turbine powers in units of one turbine nameplate equivalent."""
    keys = ["issue_time_utc", "run_time_utc", "valid_time_utc", "lead_hour", "model_version", "run_id", "weather_sha256"]
    grouped = frame.groupby(keys, as_index=False).agg(predicted_power=("predicted_power", "sum"),
                                                       turbines=("turbine_id", "nunique"))
    if len(grouped) != 48 or not grouped.turbines.eq(2).all():
        raise ValueError("station total requires both turbines for all 48 hours")
    grouped = grouped.drop(columns="turbines")
    grouped["unit"] = "one_turbine_nameplate_equivalent"
    return grouped
