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
