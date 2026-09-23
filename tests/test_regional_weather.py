"""Regional evidence uses a bounded source and the saved historical run."""

from datetime import datetime, timedelta, timezone

from tests.test_forecast_qa import forecast_document
from windpower.forecast_qa import build_question_context
from windpower.regional_weather import POINTS, fetch_regional_context


class FakeResponse:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        return None

    def json(self):
        return self.payload


class FakeSession:
    def __init__(self, payload):
        self.payload = payload
        self.calls = []

    def get(self, url, params, timeout):
        self.calls.append((url, params, timeout))
        return FakeResponse(self.payload)


def regional_payload():
    start = datetime(2026, 2, 22, 12, tzinfo=timezone.utc)
    hours = [(start + timedelta(hours=hour)).strftime("%Y-%m-%dT%H:%M") for hour in range(96)]
    return [{
        "latitude": latitude, "longitude": longitude,
        "hourly_units": {"pressure_msl": "hPa", "wind_speed_100m": "m/s", "wind_direction_100m": "°"},
        "hourly": {"time": hours,
                   "pressure_msl": [1010 + index + hour / 24 for hour in range(96)],
                   "wind_speed_100m": [6 + hour / 48 for hour in range(96)],
                   "wind_direction_100m": [240 for _ in hours]},
    } for index, (_, latitude, longitude) in enumerate(POINTS)]


def test_historical_regional_context_reuses_exact_saved_run(tmp_path):
    document = forecast_document()
    document["metadata"]["mode"] = "historical"
    context = build_question_context(document, 4, "2", 48)
    session = FakeSession(regional_payload())
    first = fetch_regional_context(document, context, tmp_path, session)
    second = fetch_regional_context(document, context, tmp_path, session)
    assert first == second
    assert first["status"] == "available"
    assert first["same_run_verified"] is True
    assert len(first["snapshots"]) == 2
    assert first["snapshots"][0]["pressure_spread_hpa"] == 4.0
    assert len(session.calls) == 1
    assert session.calls[0][1]["run"] == "2026-02-22T19:00"


def test_live_regional_context_is_marked_as_separate_retrieval(tmp_path):
    document = forecast_document()
    document["metadata"].update(mode="live", run_time_utc=None)
    context = build_question_context(document, 4, None, 48)
    result = fetch_regional_context(document, context, tmp_path, FakeSession(regional_payload()))
    assert result["status"] == "available"
    assert result["same_run_verified"] is False


def test_missing_regional_hour_does_not_invent_a_cause(tmp_path):
    document = forecast_document()
    document["metadata"]["mode"] = "historical"
    context = build_question_context(document, 4, None, 48)
    payload = regional_payload()
    for site in payload:
        site["hourly"]["time"] = ["2026-01-01T00:00"] * 96
    result = fetch_regional_context(document, context, tmp_path, FakeSession(payload))
    assert result["status"] == "unavailable"
