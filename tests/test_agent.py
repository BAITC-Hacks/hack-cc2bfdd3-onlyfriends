from datetime import datetime, timedelta, timezone
import json

from langchain_core.callbacks import BaseCallbackHandler
import pandas as pd
import pytest

import windpower.agent as agent_module
from windpower.agent import ForecastAgent
from windpower import weather


ISSUE = datetime(2026, 1, 31, 0, tzinfo=timezone.utc)


def weather_frame(issue=ISSUE, run=None):
    run = run or issue - timedelta(hours=12)
    rows = []
    for turbine_id, _, _ in weather.SITES:
        for lead in range(1, 49):
            rows.append({
                "issue_time_utc": issue,
                "run_time_utc": run,
                "valid_time_utc": issue + timedelta(hours=lead),
                "turbine_id": turbine_id,
                "lead_hour": lead,
                "wind_speed_10m": 5.0,
                "wind_speed_100m": 7.0,
                "wind_direction_100m": 180.0,
                "temperature_2m": 4.0,
                "surface_pressure": 1000.0,
            })
    return pd.DataFrame(rows)


def predictor(features):
    output = features[["turbine_id", "lead_hour", "valid_time_utc"]].copy()
    output["predicted_power"] = 0.5
    return output


def make_agent(tmp_path, weather_fetcher=None, model=predictor, version="test-model-v1", web_searcher=None):
    return ForecastAgent(
        model, version, tmp_path / "cache", tmp_path / "out",
        weather_fetcher=weather_fetcher or (lambda _: weather_frame()),
        web_searcher=web_searcher,
    )


def test_graph_runs_tools_in_order_and_saves_48_hours_per_turbine(tmp_path, monkeypatch):
    monkeypatch.delenv("LANGSMITH_TRACING", raising=False)
    calls = []

    def fetch(issue):
        calls.append(("weather", issue))
        return weather_frame()

    def predict(frame):
        calls.append(("model", len(frame)))
        return predictor(frame)

    agent = make_agent(tmp_path, fetch, predict)
    result = agent.run(ISSUE)

    assert result.status == "SUCCESS"
    assert calls == [("weather", ISSUE), ("model", 96)]
    assert [event["step"] for event in result.events] == [step[0] for step in agent.STEPS]
    assert len(result.forecast) == 96
    assert result.forecast.groupby("turbine_id").size().to_dict() == {"1": 48, "2": 48}
    saved = json.loads(result.artifact_path.read_text(encoding="utf-8"))
    assert saved["metadata"]["model_version"] == "test-model-v1"
    assert saved["metadata"]["forecast_count"] == 96
    assert len(saved["forecast"]) == 96
    assert saved["analysis"]["1"]["mean_power_hours_1_24"] == 0.5
    assert saved["analysis"]["2"]["mean_power_hours_25_48"] == 0.5
    assert result.analysis == saved["analysis"]

    repeated = agent.run(ISSUE)
    assert repeated.status == "SUCCESS"
    assert repeated.run_id == result.run_id
    assert repeated.artifact_path == result.artifact_path
    assert len(list((tmp_path / "out").glob("*.json"))) == 1


def test_invalid_weather_stops_before_model_and_storage(tmp_path):
    calls = []

    def predict(frame):
        calls.append("model")
        return predictor(frame)

    late = weather_frame(run=ISSUE - timedelta(hours=6))
    result = make_agent(tmp_path, lambda _: late, predict).run(ISSUE)

    assert result.status == "FAILED"
    assert result.error_code == "INVALID_WEATHER"
    assert result.events[-1]["step"] == "validate_inputs"
    assert calls == []
    assert not (tmp_path / "out").exists()


def test_model_output_must_cover_all_hours(tmp_path):
    result = make_agent(tmp_path, model=lambda frame: predictor(frame).iloc[:-1]).run(ISSUE)

    assert result.status == "FAILED"
    assert result.error_code == "INVALID_FORECAST"
    assert result.events[-1]["step"] == "validate_forecast"
    assert not (tmp_path / "out").exists()


def test_weather_failure_and_invalid_issue_are_classified(tmp_path):
    def broken_fetch(_):
        raise ConnectionError("network unavailable")

    agent = make_agent(tmp_path, broken_fetch)
    bad_issue = agent.run(datetime(2026, 1, 31, 0))
    outage = agent.run(ISSUE)

    assert bad_issue.error_code == "INVALID_REQUEST"
    assert [event["step"] for event in bad_issue.events] == ["validate_request"]
    assert outage.error_code == "WEATHER_ERROR"
    assert [event["step"] for event in outage.events] == ["validate_request", "fetch_weather_run"]


def test_distinct_model_versions_create_distinct_artifacts(tmp_path):
    first = make_agent(tmp_path).run(ISSUE)
    second = make_agent(tmp_path, version="test-model-v2").run(ISSUE)

    assert first.status == second.status == "SUCCESS"
    assert first.run_id != second.run_id
    assert len(list((tmp_path / "out").glob("*.json"))) == 2


def test_langsmith_trace_uses_redacted_client(tmp_path, monkeypatch):
    settings = {}
    traced_runs = []

    def fake_client(**kwargs):
        settings.update(kwargs)
        return object()

    class RecordingTracer(BaseCallbackHandler):
        def __init__(self, client, project_name):
            settings["project_name"] = project_name

        def on_chain_start(self, serialized, inputs, **kwargs):
            traced_runs.append(kwargs["run_id"])

    monkeypatch.setenv("LANGSMITH_TRACING", "true")
    monkeypatch.setenv("LANGSMITH_API_KEY", "test-key")
    monkeypatch.setenv("LANGSMITH_PROJECT", "windpower-test")
    monkeypatch.setattr(agent_module, "Client", fake_client)
    monkeypatch.setattr(agent_module, "LangChainTracer", RecordingTracer)

    result = make_agent(tmp_path).run(ISSUE)

    assert result.status == "SUCCESS"
    assert settings == {
        "api_key": "test-key",
        "hide_inputs": True,
        "hide_outputs": True,
        "hide_metadata": True,
        "project_name": "windpower-test",
    }
    assert traced_runs


def test_web_research_is_available_but_cannot_feed_historical_forecast(tmp_path):
    searches = []

    def search(query):
        searches.append(query)
        return {
            "query": query, "retrieved_at_utc": "2026-09-23T00:00:00+00:00",
            "results": [], "historical_availability_verified": False,
        }

    agent = make_agent(tmp_path, web_searcher=search)
    forecast_result = agent.run(ISSUE)
    research = agent.research_sources("  Open-Meteo   ECMWF  archive ")

    assert forecast_result.status == "SUCCESS"
    assert searches == ["Open-Meteo ECMWF archive"]
    assert research["historical_availability_verified"] is False
    assert "search_web" not in [event["step"] for event in forecast_result.events]


def test_weather_failure_does_not_fall_back_to_current_web_search(tmp_path):
    searches = []

    def broken_fetch(_):
        raise ConnectionError("archive unavailable")

    def search(query):
        searches.append(query)
        return {
            "query": query, "retrieved_at_utc": "2026-09-23T00:00:00+00:00",
            "results": [], "historical_availability_verified": False,
        }

    agent = make_agent(
        tmp_path, weather_fetcher=broken_fetch,
        web_searcher=search,
    )
    result = agent.run(ISSUE)

    assert result.error_code == "WEATHER_ERROR"
    assert searches == []


def test_daily_replay_uses_each_issue_and_stops_on_failure(tmp_path):
    fetched = []

    def fetch(issue):
        fetched.append(issue)
        if issue == ISSUE + timedelta(days=2):
            raise ConnectionError("archive unavailable")
        return weather_frame(issue=issue)

    agent = make_agent(tmp_path, weather_fetcher=fetch)
    results = agent.run_daily(ISSUE, ISSUE + timedelta(days=3))

    assert fetched == [ISSUE + timedelta(days=day) for day in range(3)]
    assert [result.status for result in results] == ["SUCCESS", "SUCCESS", "FAILED"]
    assert results[-1].error_code == "WEATHER_ERROR"
    assert len(list((tmp_path / "out").glob("*.json"))) == 2


def test_daily_replay_covers_january_31_and_all_february_issues(tmp_path):
    agent = make_agent(tmp_path, weather_fetcher=lambda issue: weather_frame(issue=issue))

    results = agent.run_daily(ISSUE, datetime(2026, 2, 28, tzinfo=timezone.utc))

    assert len(results) == 29
    assert all(result.status == "SUCCESS" for result in results)
    assert len({result.run_id for result in results}) == 29
    assert len(list((tmp_path / "out").glob("*.json"))) == 29


def test_daily_replay_rejects_misalignment_and_excessive_range(tmp_path):
    agent = make_agent(tmp_path)

    with pytest.raises(ValueError, match="one UTC hour"):
        agent.run_daily(ISSUE, ISSUE + timedelta(days=1, hours=1))
    with pytest.raises(ValueError, match="29 issues"):
        agent.run_daily(ISSUE, ISSUE + timedelta(days=29))
