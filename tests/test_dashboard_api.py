"""The browser bridge must use the eligible real model contract and no fallback power."""

from datetime import datetime, timedelta, timezone
import json

import joblib
import numpy as np

from tests.test_agent import weather_frame
from windpower import weather
from windpower.api import forecast_document


ISSUE = datetime(2026, 1, 30, 19, tzinfo=timezone.utc)


class FixedEstimator:
    def __init__(self, value):
        self.value = value

    def predict(self, frame):
        return np.full(len(frame), self.value)


def write_bundle(path, version, value, cutoff):
    path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({
        "candidate": "direct_d4_l3", "model": FixedEstimator(value),
        "model_version": version, "trained_through_utc": (cutoff - timedelta(hours=1)).isoformat(),
        "training_cutoff_utc": cutoff.isoformat(),
    }, path)


def test_historical_api_selects_model_available_at_issue(tmp_path, monkeypatch):
    main = tmp_path / "model" / "model.joblib"
    write_bundle(main, "late", 0.8, ISSUE + timedelta(days=1))
    write_bundle(main.parent / "versions" / "early.joblib", "early", 0.4, ISSUE)
    (main.parent / "early_model_metadata.json").write_text(json.dumps({"model_version": "early"}))
    monkeypatch.setattr(weather, "fetch_issue", lambda issue, cache: weather_frame(issue=issue, run=issue - timedelta(hours=12)))

    status, document = forecast_document("historical", ISSUE, main, tmp_path / "cache", tmp_path / "out")

    assert status == 200
    assert document["metadata"]["model_version"] == "early"
    assert document["metadata"]["mode"] == "historical"
    assert document["metadata"]["sites"][0]["latitude"] == weather.SITES[0][1]
    assert len(document["weather"]) == len(document["forecast"]) == 96
    assert {row["predicted_power"] for row in document["forecast"]} == {0.4}
    assert document["metadata"]["warnings"]


def test_missing_model_is_explicit_and_does_not_request_weather(tmp_path, monkeypatch):
    monkeypatch.setattr(weather, "fetch_issue", lambda *_: (_ for _ in ()).throw(AssertionError("weather called")))
    status, document = forecast_document("historical", ISSUE, tmp_path / "missing.joblib",
                                         tmp_path / "cache", tmp_path / "out")
    assert status == 503
    assert document["error_code"] == "MODEL_UNAVAILABLE"
    assert not (tmp_path / "out").exists()


def test_historical_api_reads_complete_february_csv_without_model(tmp_path, monkeypatch):
    rows = []
    for lead_hour in range(1, 49):
        for turbine_id in ("1", "2"):
            rows.append({
                "valid_time_utc": ISSUE + timedelta(hours=lead_hour),
                "turbine_id": turbine_id,
                "predicted_power": 0.2 + lead_hour / 1000,
            })
    csv_path = tmp_path / "february_latest_forecast.csv"
    import pandas as pd
    pd.DataFrame(rows).to_csv(csv_path, index=False)
    monkeypatch.setattr(weather, "fetch_issue", lambda issue, cache: weather_frame(issue=issue, run=issue - timedelta(hours=12)))

    status, document = forecast_document(
        "historical", ISSUE, tmp_path / "missing.joblib", tmp_path / "cache", tmp_path / "out",
        february_forecast_path=csv_path,
    )

    assert status == 200
    assert document["metadata"]["model_version"].startswith("february-csv-")
    assert document["metadata"]["power_source"] == str(csv_path)
    assert len(document["forecast"]) == 96
    assert document["forecast"][0]["predicted_power"] == 0.201


def test_live_api_keeps_retrieval_and_future_target_separate(tmp_path, monkeypatch):
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    target = now + timedelta(hours=24)
    main = tmp_path / "model" / "model.joblib"
    write_bundle(main, "latest", 0.6, ISSUE + timedelta(days=1))

    def current_forecast(issue, target_start_utc=None):
        frame = weather_frame(issue=issue, run=issue)
        frame["valid_time_utc"] = frame["valid_time_utc"] + (target_start_utc - issue)
        frame.attrs["retrieved_at_utc"] = now.isoformat()
        return frame

    monkeypatch.setattr(weather, "fetch_live", current_forecast)
    status, document = forecast_document("live", now, main, tmp_path / "cache", tmp_path / "out", target)
    assert status == 200
    assert document["metadata"]["run_time_utc"] is None
    assert document["metadata"]["retrieved_at_utc"] == now.isoformat()
    assert document["forecast"][0]["valid_time_utc"] == (target + timedelta(hours=1)).isoformat()


def test_api_saves_operating_signals_and_compares_only_previous_issue(tmp_path, monkeypatch):
    main = tmp_path / "model" / "model.joblib"
    write_bundle(main, "fixed", 0.4, ISSUE - timedelta(hours=1))
    monkeypatch.setattr(weather, "fetch_issue", lambda issue, cache: weather_frame(issue=issue, run=issue - timedelta(hours=12)))
    output = tmp_path / "out"
    first_status, first = forecast_document("historical", ISSUE, main, tmp_path / "cache", output)
    second_status, second = forecast_document("historical", ISSUE + timedelta(days=1), main, tmp_path / "cache", output)
    assert first_status == second_status == 200
    assert first["revision"] is None
    assert second["revision"]["previous_run_id"] == first["metadata"]["run_id"]
    assert second["revision"]["overlap_hours"] == 24
    assert second["revision"]["mean_absolute_change"] == 0
    assert second["operations"]["mean_24h"] == 0.4
    assert "assess_operations" in [event["step"] for event in second["events"]]
