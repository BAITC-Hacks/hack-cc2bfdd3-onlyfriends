from datetime import datetime, timedelta, timezone

import pytest

from windpower import weather


RUN = datetime(2026, 1, 30, 12, tzinfo=timezone.utc)
ISSUE = datetime(2026, 1, 30, 19, tzinfo=timezone.utc)
VARS = ("wind_speed_10m", "wind_speed_100m", "wind_direction_100m", "temperature_2m", "surface_pressure")


class FakeResponse:
    status_code = 200

    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self.payload


class FakeSession:
    def __init__(self, payload):
        self.payload = payload
        self.calls = []

    def get(self, url, params, timeout):
        self.calls.append((url, params, timeout))
        return FakeResponse(self.payload)


def payload(hours=56):
    times = [(RUN + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M") for h in range(hours)]
    site = {
        "hourly_units": {"time": "iso8601", "wind_speed_10m": "m/s", "wind_speed_100m": "m/s"},
        "hourly": {"time": times, **{name: [5.0] * hours for name in VARS}},
    }
    return [site, site]


def test_select_run_prior_to_publication():
    assert weather.select_run(ISSUE) == RUN
    assert weather.select_run(datetime(2026, 1, 31, 0, tzinfo=timezone.utc)) == RUN


def test_exact_48_hour_alignment_and_cache(tmp_path):
    session = FakeSession(payload())

    frame = weather.fetch_issue(ISSUE, tmp_path, session=session)
    cached = weather.fetch_issue(ISSUE, tmp_path, session=session)

    assert len(frame) == 96
    assert frame.groupby("turbine_id").size().to_dict() == {"1": 48, "2": 48}
    assert frame["lead_hour"].min() == 1
    assert frame["lead_hour"].max() == 48
    assert frame["valid_time_utc"].min() == ISSUE + timedelta(hours=1)
    assert frame["run_time_utc"].eq(RUN).all()
    assert len(session.calls) == 1
    assert len(cached) == len(frame)
    assert session.calls[0][1]["models"] == "ecmwf_ifs"


def test_missing_hour_raises(tmp_path):
    malformed = payload(hours=55)
    session = FakeSession(malformed)

    with pytest.raises(ValueError, match="48 hourly"):
        weather.fetch_issue(ISSUE, tmp_path, session=session)
