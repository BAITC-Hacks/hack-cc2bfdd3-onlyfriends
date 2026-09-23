"""Operating signals and revisions must use only saved, comparable forecasts."""

from datetime import datetime, timedelta, timezone
import json

import pandas as pd

from windpower.operations import assess_operations, compare_runs, previous_comparable_run


ORIGIN = datetime(2026, 2, 1, tzinfo=timezone.utc)


def forecast_frame(values):
    return pd.DataFrame([
        {"lead_hour": hour, "valid_time_utc": ORIGIN + timedelta(hours=hour),
         "turbine_id": site, "predicted_power": values[hour - 1]}
        for hour in range(1, 49) for site in ("1", "2")
    ])


def document(run_id, issue, created, start, power=0.4, mode="historical", weather_hash="weather-a"):
    return {"metadata": {"run_id": run_id, "mode": mode, "issue_time_utc": issue.isoformat(),
                         "created_at_utc": created.isoformat(), "weather_sha256": weather_hash,
                         "model_version": "model-a"},
            "forecast": [{"turbine_id": site, "valid_time_utc": (start + timedelta(hours=hour)).isoformat(),
                          "predicted_power": power}
                         for hour in range(1, 49) for site in ("1", "2")]}


def test_assessment_flags_ramps_and_low_output_using_station_mean():
    values = [0.05] * 5 + [0.2] * 5 + [0.2, 0.35, 0.55, 0.7] + [0.7] * 34
    assessment = assess_operations(forecast_frame(values))
    assert assessment["mean_24h"] == round(sum(values[:24]) / 24, 4)
    assert assessment["peak_power"] == 0.7
    assert any(item["kind"] == "low_output" and item["hours"] == 5 for item in assessment["signals"])
    assert any(item["kind"] == "ramp_up" and item["delta"] >= 0.25 for item in assessment["signals"])
    assert all(1 <= item["start_lead_hour"] <= item["end_lead_hour"] <= 48 for item in assessment["signals"])


def test_revision_uses_only_overlapping_valid_hours_and_identifies_input_change():
    before = document("a" * 20, ORIGIN, ORIGIN, ORIGIN, power=0.3)
    current = document("b" * 20, ORIGIN + timedelta(days=1), ORIGIN + timedelta(minutes=1),
                       ORIGIN + timedelta(days=1), power=0.4, weather_hash="weather-b")
    change = compare_runs(current, before)
    assert change["overlap_hours"] == 24
    assert change["mean_absolute_change"] == 0.1
    assert change["largest_change"] == 0.1
    assert change["weather_changed"] is True
    assert change["model_changed"] is False
    assert compare_runs(current, document("c" * 20, ORIGIN, ORIGIN, ORIGIN - timedelta(days=4))) is None


def test_historical_revision_cannot_read_later_issue_even_if_saved_first(tmp_path):
    prior = document("a" * 20, ORIGIN, ORIGIN + timedelta(days=10), ORIGIN)
    current = document("b" * 20, ORIGIN + timedelta(days=1), ORIGIN + timedelta(days=11), ORIGIN + timedelta(days=1))
    future = document("c" * 20, ORIGIN + timedelta(days=2), ORIGIN + timedelta(days=3), ORIGIN + timedelta(days=2))
    for item in (prior, future):
        (tmp_path / f"{item['metadata']['run_id']}.json").write_text(json.dumps(item), encoding="utf-8")
    selected = previous_comparable_run(tmp_path, current)
    assert selected["metadata"]["run_id"] == prior["metadata"]["run_id"]


def test_live_revision_uses_previous_retrieval_and_overlap(tmp_path):
    prior = document("a" * 20, ORIGIN, ORIGIN, ORIGIN, mode="live")
    current = document("b" * 20, ORIGIN, ORIGIN + timedelta(minutes=15), ORIGIN, mode="live")
    future = document("c" * 20, ORIGIN, ORIGIN + timedelta(minutes=30), ORIGIN, mode="live")
    for item in (prior, future):
        (tmp_path / f"{item['metadata']['run_id']}.json").write_text(json.dumps(item), encoding="utf-8")
    assert previous_comparable_run(tmp_path, current)["metadata"]["run_id"] == prior["metadata"]["run_id"]
