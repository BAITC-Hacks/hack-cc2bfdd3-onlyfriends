"""Deterministic operating signals from validated normalized-power forecasts."""

from datetime import datetime
import json
from pathlib import Path

import pandas as pd


RAMP_WINDOW_HOURS = 3
RAMP_THRESHOLD = 0.25
LOW_OUTPUT_THRESHOLD = 0.15
LOW_OUTPUT_MIN_HOURS = 3


def _station_series(forecast: pd.DataFrame) -> pd.DataFrame:
    """Use the mean of the two normalized turbine outputs at each valid hour."""
    return (forecast.groupby(["lead_hour", "valid_time_utc"], as_index=False)
            .agg(power=("predicted_power", "mean"))
            .sort_values("lead_hour").reset_index(drop=True))


def assess_operations(forecast: pd.DataFrame) -> dict:
    """Flag meaningful changes without claiming MW, outage risk, or model confidence."""
    station = _station_series(forecast)
    if len(station) != 48 or station.groupby("lead_hour").size().ne(1).any():
        raise ValueError("operations require 48 distinct station forecast hours")
    power = station.power.to_numpy()
    signals = []
    candidates = []
    for start in range(len(station) - RAMP_WINDOW_HOURS):
        end = start + RAMP_WINDOW_HOURS
        delta = float(power[end] - power[start])
        if abs(delta) >= RAMP_THRESHOLD:
            candidates.append((abs(delta), start, end, delta))
    occupied = set()
    for _, start, end, delta in sorted(candidates, key=lambda item: (-item[0], item[1])):
        if any(index in occupied for index in range(start, end + 1)):
            continue
        occupied.update(range(start, end + 1))
        signals.append({
            "kind": "ramp_up" if delta > 0 else "ramp_down",
            "start_lead_hour": int(station.iloc[start].lead_hour),
            "end_lead_hour": int(station.iloc[end].lead_hour),
            "start_utc": pd.Timestamp(station.iloc[start].valid_time_utc).isoformat(),
            "end_utc": pd.Timestamp(station.iloc[end].valid_time_utc).isoformat(),
            "delta": round(delta, 4),
            "power_before": round(float(power[start]), 4),
            "power_after": round(float(power[end]), 4),
        })
        if len([item for item in signals if item["kind"].startswith("ramp")]) == 3:
            break
    start = None
    for index in range(len(station) + 1):
        low = index < len(station) and power[index] <= LOW_OUTPUT_THRESHOLD
        if low and start is None:
            start = index
        elif not low and start is not None:
            if index - start >= LOW_OUTPUT_MIN_HOURS:
                signals.append({
                    "kind": "low_output",
                    "start_lead_hour": int(station.iloc[start].lead_hour),
                    "end_lead_hour": int(station.iloc[index - 1].lead_hour),
                    "start_utc": pd.Timestamp(station.iloc[start].valid_time_utc).isoformat(),
                    "end_utc": pd.Timestamp(station.iloc[index - 1].valid_time_utc).isoformat(),
                    "hours": index - start,
                    "mean_power": round(float(power[start:index].mean()), 4),
                })
            start = None
    signals.sort(key=lambda item: (item["start_lead_hour"], item["kind"]))
    peak = station.iloc[int(power.argmax())]
    return {
        "unit": "mean normalized line-side active power of two turbines",
        "thresholds": {
            "ramp_window_hours": RAMP_WINDOW_HOURS,
            "ramp_delta": RAMP_THRESHOLD,
            "low_output_at_or_below": LOW_OUTPUT_THRESHOLD,
            "low_output_min_hours": LOW_OUTPUT_MIN_HOURS,
        },
        "mean_24h": round(float(power[:24].mean()), 4),
        "mean_48h": round(float(power.mean()), 4),
        "peak_power": round(float(peak.power), 4),
        "peak_lead_hour": int(peak.lead_hour),
        "peak_time_utc": pd.Timestamp(peak.valid_time_utc).isoformat(),
        "signals": signals,
    }


def _hourly_mean(document: dict) -> dict[str, float]:
    by_time: dict[str, list[float]] = {}
    for row in document["forecast"]:
        by_time.setdefault(row["valid_time_utc"], []).append(float(row["predicted_power"]))
    return {at: sum(values) / len(values) for at, values in by_time.items() if len(values) == 2}


def compare_runs(current: dict, previous: dict) -> dict | None:
    """Compare overlapping valid hours; provenance identifies changed inputs."""
    now, before = _hourly_mean(current), _hourly_mean(previous)
    overlap = sorted(now.keys() & before.keys())
    if not overlap:
        return None
    differences = [(at, now[at] - before[at]) for at in overlap]
    largest_at, largest_delta = max(differences, key=lambda pair: abs(pair[1]))
    current_meta, previous_meta = current["metadata"], previous["metadata"]
    return {
        "previous_run_id": previous_meta["run_id"],
        "previous_issue_time_utc": previous_meta["issue_time_utc"],
        "overlap_hours": len(overlap),
        "mean_absolute_change": round(sum(abs(delta) for _, delta in differences) / len(differences), 4),
        "largest_change": round(largest_delta, 4),
        "largest_change_time_utc": largest_at,
        "weather_changed": current_meta["weather_sha256"] != previous_meta["weather_sha256"],
        "model_changed": current_meta["model_version"] != previous_meta["model_version"],
    }


def previous_comparable_run(output_dir: Path, current: dict) -> dict | None:
    """Select only a prior issue for replay or a prior retrieval for live mode."""
    current_meta = current["metadata"]
    mode = current_meta.get("mode")
    if mode not in {"historical", "live"} or "created_at_utc" not in current_meta:
        return None
    current_time = datetime.fromisoformat(current_meta["issue_time_utc"])
    current_created = datetime.fromisoformat(current_meta["created_at_utc"])
    current_hours = _hourly_mean(current).keys()
    candidates = []
    for path in Path(output_dir).glob("[0-9a-f]" * 20 + ".json"):
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
            meta = document["metadata"]
            if meta["run_id"] == current_meta["run_id"] or meta["mode"] != mode:
                continue
            issue = datetime.fromisoformat(meta["issue_time_utc"])
            created = datetime.fromisoformat(meta["created_at_utc"])
            if (mode == "historical" and issue >= current_time) or (mode == "live" and created >= current_created):
                continue
            if not (current_hours & _hourly_mean(document).keys()):
                continue
            candidates.append((issue if mode == "historical" else created, meta["run_id"], document))
        except (OSError, KeyError, TypeError, ValueError):
            continue
    return max(candidates, key=lambda item: (item[0], item[1]))[2] if candidates else None
