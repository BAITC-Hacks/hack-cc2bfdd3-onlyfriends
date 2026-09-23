from datetime import date, datetime, timedelta
from pathlib import Path
import json

import numpy as np
import pandas as pd
import pytest
import joblib

from windpower import cli
from windpower.weather import VARIABLES
from windpower.workflow import raw_digest, raw_paths


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
    return {"candidate": "direct", "model": ConstantPredictor(), "model_version": "test-model"}


def test_backtest_writes_29_issues_and_48_hours_each(tmp_path):
    result = cli.backtest(date(2026, 1, 31), date(2026, 2, 28), bundle(), tmp_path, session=ArchiveSession())

    assert len(result) == 29 * 48 * 2
    assert result["issue_time_utc"].nunique() == 29
    assert result.groupby(["issue_time_utc", "turbine_id"]).size().eq(48).all()
    assert len(list((tmp_path / "forecasts").glob("*.csv"))) == 29
    latest = pd.read_csv(tmp_path / "february_latest_forecast.csv")
    assert len(latest) == 28 * 24 * 2
    assert not latest.duplicated(["valid_time_utc", "turbine_id"]).any()


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
    joblib.dump(stored, artifacts / "model" / "model.joblib")

    result = cli.run_agent(date(2026, 1, 31), raw_dir, artifacts, session=ArchiveSession())

    assert result.exists()
    traces = [json.loads(path.read_text()) for path in (artifacts / "agent_runs").glob("*.json")]
    assert len(traces) == 1
    assert traces[0]["status"] == "SUCCESS"
    assert traces[0]["steps"] == ["history_checked", "model_loaded", "forecast_issued"]
