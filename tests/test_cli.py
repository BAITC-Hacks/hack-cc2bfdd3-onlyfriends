from datetime import date, datetime, timedelta
from pathlib import Path
import json

import numpy as np
import pandas as pd
import pytest
import joblib

from windpower import cli, workflow
from windpower.weather import VARIABLES
from windpower.workflow import raw_digest, raw_paths, weather_cache_digest, station_total
from windpower.model import ALGORITHM_VERSION


class ConstantPredictor:
    def predict(self, frame):
        return np.full(len(frame), 0.42)


class ArchiveSession:
    def __init__(self):
        self.calls = []

    def get(self, url, params, timeout):
        self.calls.append(params)
        run = datetime.fromisoformat(params["run"])
        hours = int(params["forecast_hours"])
        times = [(run + timedelta(hours=i)).strftime("%Y-%m-%dT%H:%M") for i in range(hours)]
        site = {
            "latitude": 43.620384,
            "longitude": 78.47891,
            "hourly_units": {"wind_speed_10m": "m/s", "wind_speed_100m": "m/s", "wind_direction_100m": "°", "temperature_2m": "°C", "surface_pressure": "hPa"},
            "hourly": {"time": times, **{variable: [7.0] * hours for variable in VARIABLES}},
        }

        class Response:
            status_code = 200

            def raise_for_status(self):
                pass

            def json(self):
                return [site, site]

        return Response()


def bundle():
    return {"candidate": "direct", "model": ConstantPredictor(), "model_version": "test-model",
            "trained_through_utc": "2026-01-30T18:00:00+00:00",
            "training_cutoff_utc": "2026-01-30T19:00:00+00:00"}


def test_rejects_model_with_future_training_labels(tmp_path):
    future = bundle() | {"trained_through_utc": "2026-01-31T18:00:00+00:00"}
    with pytest.raises(ValueError, match="trained after issue"):
        cli.forecast_issue(date(2026, 1, 31), future, tmp_path, session=ArchiveSession())


def test_backtest_uses_early_bundle_for_first_issue(tmp_path):
    full = bundle() | {"trained_through_utc": "2026-01-31T18:00:00+00:00", "model_version": "full"}
    early = bundle() | {"model_version": "early"}
    result = cli.backtest(date(2026, 1, 31), date(2026, 2, 1), full, tmp_path,
                          session=ArchiveSession(), early_bundle=early)
    versions = result.groupby("issue_time_utc").model_version.first().tolist()
    assert versions == ["early", "full"]


def test_backtest_writes_29_issues_and_48_hours_each(tmp_path):
    result = cli.backtest(date(2026, 1, 31), date(2026, 2, 28), bundle(), tmp_path, session=ArchiveSession())

    assert len(result) == 29 * 48 * 2
    assert result["issue_time_utc"].nunique() == 29
    assert result.groupby(["issue_time_utc", "turbine_id"]).size().eq(48).all()
    assert len(list((tmp_path / "forecasts").glob("*.csv"))) == 29
    latest = pd.read_csv(tmp_path / "february_latest_forecast.csv")
    assert len(latest) == 28 * 24 * 2
    assert not latest.duplicated(["valid_time_utc", "turbine_id"]).any()
    station = pd.read_csv(tmp_path / "backtest_station_2026-01-31_2026-02-28.csv")
    assert len(station) == 29 * 48
    assert station.unit.eq("one_turbine_nameplate_equivalent").all()
    first = result.loc[result.issue_time_utc == result.issue_time_utc.iloc[0]]
    np.testing.assert_allclose(station.predicted_power.iloc[:48], station_total(first).predicted_power)


def test_repeated_issue_is_idempotent(tmp_path):
    session = ArchiveSession()
    first = cli.forecast_issue(date(2026, 1, 31), bundle(), tmp_path, session=session)
    modified = first.stat().st_mtime_ns
    second = cli.forecast_issue(date(2026, 1, 31), bundle(), tmp_path, session=session)

    assert first == second
    assert second.stat().st_mtime_ns == modified
    assert len(session.calls) == 1


def test_new_weather_run_keeps_old_forecast(tmp_path):
    session = ArchiveSession()
    first = cli.forecast_issue(date(2026, 1, 31), bundle(), tmp_path, session=session)
    second = cli.forecast_issue(date(2026, 2, 1), bundle(), tmp_path, session=session)

    assert first != second
    assert first.exists() and second.exists()
    assert len(list((tmp_path / "runs").glob("*.json"))) == 2


def test_new_training_provenance_preserves_old_run(tmp_path):
    initial = bundle() | {"provenance_sha256": "source-a"}
    refreshed = bundle() | {"provenance_sha256": "source-b"}

    first = cli.forecast_issue(date(2026, 2, 1), initial, tmp_path, session=ArchiveSession())
    second = cli.forecast_issue(date(2026, 2, 1), refreshed, tmp_path, session=ArchiveSession())

    assert first != second
    assert first.exists() and second.exists()
    assert len(list((tmp_path / "runs").glob("*.json"))) == 2


def test_weather_failure_records_failed_run(tmp_path):
    class BrokenSession:
        def get(self, url, params, timeout):
            class Response:
                status_code = 200

                def raise_for_status(self):
                    pass

                def json(self):
                    return []

            return Response()

    with pytest.raises(ValueError, match="both turbine locations"):
        cli.forecast_issue(date(2026, 1, 31), bundle(), tmp_path, session=BrokenSession())

    traces = [json.loads(path.read_text()) for path in (tmp_path / "runs").glob("*.json")]
    assert len(traces) == 1
    assert traces[0]["status"] == "FAILED"
    assert traces[0]["issue_time_utc"].startswith("2026-01-30T19:00:00")


def test_agent_run_reuses_fresh_model_and_records_workflow(tmp_path):
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    for turbine in (1, 2):
        (raw_dir / f"sample turbine {turbine}.csv").write_text("source data")
    artifacts = tmp_path / "artifacts"
    (artifacts / "model").mkdir(parents=True)
    stored = bundle()
    stored["raw_sha256"] = raw_digest(raw_paths(raw_dir))
    stored["algorithm_version"] = ALGORITHM_VERSION
    stored["weather_archive_sha256"] = weather_cache_digest(artifacts / "weather", date(2025, 1, 1), date(2026, 1, 30))
    joblib.dump(stored, artifacts / "model" / "model.joblib")
    version_dir = artifacts / "model" / "versions"
    version_dir.mkdir()
    joblib.dump(stored, version_dir / "test-model.joblib")
    (artifacts / "model" / "early_model_metadata.json").write_text(json.dumps({
        "model_version": "test-model", "training_history_sha256": "past-only",
        "weather_archive_sha256": stored["weather_archive_sha256"],
        "provenance_path": "test-provenance.json", "provenance_sha256": "test-provenance-hash",
    }))
    (artifacts / "model" / "training_manifest.json").write_text(json.dumps({
        "weather_start": "2025-01-01", "weather_end": "2026-01-30", "weather_issues_failed": [],
    }))

    result = cli.run_agent(date(2026, 1, 31), raw_dir, artifacts, session=ArchiveSession())

    assert result.exists()
    traces = [json.loads(path.read_text()) for path in (artifacts / "agent_runs").glob("*.json")]
    assert len(traces) == 1
    assert traces[0]["status"] == "SUCCESS"
    assert traces[0]["steps"] == ["history_checked", "model_loaded", "forecast_issued"]
    forecast_trace = json.loads(next((artifacts / "runs").glob("*.json")).read_text())
    assert forecast_trace["training_raw_sha256"] is None
    assert forecast_trace["training_history_sha256"] == "past-only"


def test_agent_retrains_when_training_weather_archive_changes(tmp_path, monkeypatch):
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    for turbine in (1, 2):
        (raw_dir / f"sample turbine {turbine}.csv").write_text("source data")
    artifacts = tmp_path / "artifacts"
    (artifacts / "model").mkdir(parents=True)
    stored = bundle() | {
        "raw_sha256": raw_digest(raw_paths(raw_dir)),
        "algorithm_version": ALGORITHM_VERSION,
        "weather_archive_sha256": weather_cache_digest(artifacts / "weather", date(2025, 1, 1), date(2026, 1, 31)),
    }
    joblib.dump(stored, artifacts / "model" / "model.joblib")
    (artifacts / "model" / "training_manifest.json").write_text(json.dumps({
        "weather_start": "2025-01-01", "weather_end": "2026-01-31", "weather_issues_failed": [],
    }))
    (artifacts / "weather").mkdir()
    (artifacts / "weather" / "20241231T1900Z_20241231T1200Z.json").write_text("changed archive")
    retrained = []
    def fake_train(raw, root, **kwargs):
        retrained.append(True)
        return stored
    monkeypatch.setattr(workflow, "train_pipeline", fake_train)
    monkeypatch.setattr(workflow, "forecast_issue", lambda day, model, root, session=None: root / "forecast.csv")

    workflow.run_agent(date(2026, 2, 1), raw_dir, artifacts)

    assert retrained == [True]
    trace = json.loads(next((artifacts / "agent_runs").glob("*.json")).read_text())
    assert "model_trained" in trace["steps"]


def test_first_agent_run_trains_only_on_information_before_issue(tmp_path, monkeypatch):
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    for turbine in (1, 2):
        (raw_dir / f"sample turbine {turbine}.csv").write_text("source data")
    calls = []
    def fake_train(raw, root, **kwargs):
        calls.append(kwargs)
        return bundle()
    monkeypatch.setattr(workflow, "train_pipeline", fake_train)
    monkeypatch.setattr(workflow, "load_bundle_for_issue", lambda day, root: bundle())
    monkeypatch.setattr(workflow, "forecast_issue", lambda day, model, root, session=None: root / "forecast.csv")

    workflow.run_agent(date(2026, 1, 31), raw_dir, tmp_path / "artifacts")

    assert calls[0]["end"] == date(2026, 1, 30)
    assert calls[0]["as_of_cutoff"] == pd.Timestamp("2026-01-30T19:00:00Z")
