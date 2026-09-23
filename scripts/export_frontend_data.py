"""Export archived February forecasts and matching weather for the frontend."""

import argparse
import csv
import json
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path


WEATHER_FIELDS = {
    "windSpeed10": "wind_speed_10m",
    "windSpeed100": "wind_speed_100m",
    "direction": "wind_direction_100m",
    "temperature": "temperature_2m",
    "pressure": "surface_pressure",
}


def utc(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def iso(value: str) -> str:
    return utc(value).isoformat(timespec="seconds").replace("+00:00", "Z")


def read_rows(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as source:
        return list(csv.DictReader(source))


def load_weather(directory: Path, hashes: set[str]) -> dict[str, list[dict]]:
    found = {}
    for path in directory.glob("*.json"):
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("sha256") in hashes:
            found[data["sha256"]] = data["payload"]
    missing = hashes - found.keys()
    if missing:
        raise ValueError(f"Missing archived weather: {', '.join(sorted(missing))}")
    return found


def build_hours(rows: list[dict[str, str]], weather: dict[str, list[dict]]) -> list[dict]:
    grouped = defaultdict(list)
    for row in rows:
        grouped[iso(row["valid_time_utc"])].append(row)
    hours = []
    for at, paired in sorted(grouped.items()):
        if sorted(row["turbine_id"] for row in paired) != ["1", "2"]:
            raise ValueError(f"Expected two turbine readings at {at}")
        readings = []
        for row in sorted(paired, key=lambda item: item["turbine_id"]):
            index = int(row["turbine_id"]) - 1
            hourly = weather[row["weather_sha256"]][index]["hourly"]
            times = {iso(value): position for position, value in enumerate(hourly["time"])}
            if at not in times:
                raise ValueError(f"Weather time {at} missing for turbine {row['turbine_id']}")
            position = times[at]
            reading = {"turbineId": row["turbine_id"], "power": float(row["predicted_power"])}
            for name, field in WEATHER_FIELDS.items():
                reading[name] = float(hourly[field][position])
            readings.append(reading)
        hours.append({"at": at, "readings": readings})
    return hours


def export(latest: Path, backtest: Path, weather_dir: Path, expected_hours: int, expected_issues: int) -> dict:
    month_rows = read_rows(latest)
    issue_rows = read_rows(backtest)
    hashes = {row["weather_sha256"] for row in month_rows + issue_rows}
    weather = load_weather(weather_dir, hashes)
    month = build_hours(month_rows, weather)
    if len(month) != expected_hours:
        raise ValueError(f"Expected {expected_hours} month hours; found {len(month)}")
    grouped = defaultdict(list)
    for row in issue_rows:
        grouped[iso(row["issue_time_utc"])].append(row)
    issues = []
    for _, rows in sorted(grouped.items()):
        date = rows[0]["valid_time_local"][:10]
        run_times = {iso(row["run_time_utc"]) for row in rows}
        if len(run_times) != 1:
            raise ValueError(f"Expected one weather run for issue {date}")
        # The issue is midnight local; its first lead is 01:00 on the same date.
        hours = build_hours(rows, weather)
        expected_issue_hours = 48 if expected_hours >= 48 else expected_hours
        if len(hours) != expected_issue_hours:
            raise ValueError(f"Expected {expected_issue_hours} hours for issue {date}; found {len(hours)}")
        issues.append({"date": date, "runTime": run_times.pop(), "hours": hours})
    if len(issues) != expected_issues:
        raise ValueError(f"Expected {expected_issues} issues; found {len(issues)}")
    return {"month": month, "issues": issues}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--latest", type=Path, required=True)
    parser.add_argument("--backtest", type=Path, required=True)
    parser.add_argument("--weather-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--expected-hours", type=int, default=672)
    parser.add_argument("--expected-issues", type=int, default=29)
    args = parser.parse_args()
    data = export(args.latest, args.backtest, args.weather_dir, args.expected_hours, args.expected_issues)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    main()
