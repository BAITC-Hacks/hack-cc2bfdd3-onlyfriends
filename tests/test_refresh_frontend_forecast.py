"""Regression checks for updating the February dashboard after a new issue."""

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from scripts.refresh_frontend_forecast import replace_issue


def _hours(day: date, power: float) -> list[dict]:
    start = datetime(day.year, day.month, day.day, tzinfo=ZoneInfo("Asia/Almaty"))
    return [
        {"at": (start + timedelta(hours=lead)).astimezone(timezone.utc).isoformat().replace("+00:00", "Z"),
         "readings": [{"turbineId": "1", "power": power}, {"turbineId": "2", "power": power}]}
        for lead in range(1, 49)
    ]


def test_replacing_issue_updates_month_latest_without_duplicate() -> None:
    first = date(2026, 1, 31)
    issues = [
        {"date": (first + timedelta(days=index)).isoformat(), "runTime": "2026-01-30T12:00:00Z",
         "hours": _hours(first + timedelta(days=index), 0.1)}
        for index in range(29)
    ]
    original = {"issues": issues, "month": []}
    day = date(2026, 2, 1)
    changed = replace_issue(original, day, "2026-01-31T12:00:00Z", _hours(day, 0.9))
    month = {hour["at"]: hour for hour in changed["month"]}
    february_start = datetime(2026, 2, 1, tzinfo=ZoneInfo("Asia/Almaty"))

    def power_at(lead: int) -> float:
        at = (february_start + timedelta(hours=lead)).astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
        return month[at]["readings"][0]["power"]

    assert len(changed["issues"]) == 29
    assert len(changed["month"]) == 672
    assert power_at(0) == 0.1
    assert power_at(1) == 0.9
    assert power_at(24) == 0.9
    assert power_at(25) == 0.1
    assert replace_issue(changed, day, "2026-01-31T12:00:00Z", _hours(day, 0.9)) == changed
    assert replace_issue(changed, day, "2026-01-31T12:00:00Z", _hours(day, 0.9 + 1e-14)) == changed
