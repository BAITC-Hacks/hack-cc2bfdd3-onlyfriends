"""Live watcher reruns the graph only for a changed source or model."""

from datetime import datetime, timedelta, timezone

from tests.test_agent import weather_frame
from tests.test_dashboard_api import write_bundle
from windpower.watch import check_once


def test_watch_skips_identical_weather_and_recomputes_on_change(tmp_path):
    issue = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    model_path = tmp_path / "model" / "model.joblib"
    write_bundle(model_path, "first", 0.4, issue - timedelta(days=1))
    calls = []
    wind = 7.0

    def fetch(now):
        calls.append(now)
        frame = weather_frame(issue=now, run=now)
        frame["wind_speed_100m"] = wind
        return frame

    output = tmp_path / "runs"
    first = check_once(model_path, tmp_path / "cache", output, issue, fetch)
    repeated = check_once(model_path, tmp_path / "cache", output, issue, fetch)
    assert first["status"] == "UPDATED"
    assert repeated == {"status": "UNCHANGED", "run_id": first["run_id"],
                        "issue_time_utc": issue.isoformat(), "model_version": "first"}
    assert len(list(output.glob("*.json"))) == 1
    assert calls == [issue, issue]

    wind = 12.0
    changed = check_once(model_path, tmp_path / "cache", output, issue, fetch)
    assert changed["status"] == "UPDATED"
    assert changed["run_id"] != first["run_id"]
    assert len(list(output.glob("*.json"))) == 2
    assert len(calls) == 3  # the graph used the preloaded weather; no second fetch


def test_watch_reruns_when_model_version_changes(tmp_path):
    issue = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    model_path = tmp_path / "model" / "model.joblib"
    output = tmp_path / "runs"
    fetch = lambda now: weather_frame(issue=now, run=now)
    write_bundle(model_path, "first", 0.4, issue - timedelta(days=1))
    first = check_once(model_path, tmp_path / "cache", output, issue, fetch)
    write_bundle(model_path, "second", 0.5, issue - timedelta(days=1))
    second = check_once(model_path, tmp_path / "cache", output, issue, fetch)
    assert first["status"] == second["status"] == "UPDATED"
    assert first["run_id"] != second["run_id"]
    assert second["model_version"] == "second"
