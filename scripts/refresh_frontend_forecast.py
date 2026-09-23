"""Recalculate one February issue and refresh the bundled frontend forecast."""

import argparse
from datetime import date, datetime
import json
import math
import os
from pathlib import Path
import tempfile
import time
from zoneinfo import ZoneInfo

from scripts.export_frontend_data import build_hours, iso, load_weather, read_rows
from windpower.workflow import run_agent


FIRST_ISSUE = date(2026, 1, 31)
LAST_ISSUE = date(2026, 2, 28)
FEBRUARY_HOURS = 672
LOCAL_TIMEZONE = ZoneInfo("Asia/Almaty")


def _equivalent(left, right) -> bool:
    if isinstance(left, float) and isinstance(right, float):
        return math.isclose(left, right, rel_tol=0, abs_tol=1e-12)
    if isinstance(left, list) and isinstance(right, list):
        return len(left) == len(right) and all(_equivalent(a, b) for a, b in zip(left, right))
    if isinstance(left, dict) and isinstance(right, dict):
        return left.keys() == right.keys() and all(_equivalent(left[key], right[key]) for key in left)
    return left == right


def replace_issue(data: dict, day: date, run_time: str, hours: list[dict],
                  expected_hours: int = FEBRUARY_HOURS) -> dict:
    """Replace one issue and select the latest available forecast for each month hour."""
    if not FIRST_ISSUE <= day <= LAST_ISSUE or len(hours) != 48:
        raise ValueError("refresh requires a February replay issue with 48 hours")
    current_issue = next((issue for issue in data["issues"] if issue["date"] == day.isoformat()), None)
    if current_issue and current_issue["runTime"] == run_time and _equivalent(current_issue["hours"], hours):
        replacement = current_issue
    else:
        replacement = {"date": day.isoformat(), "runTime": run_time, "hours": hours}
    issues = [issue for issue in data["issues"] if issue["date"] != day.isoformat()]
    issues.append(replacement)
    issues.sort(key=lambda issue: issue["date"])
    if len(issues) != 29 or len({issue["date"] for issue in issues}) != 29:
        raise ValueError("February archive must contain 29 distinct issues")
    latest: dict[str, dict] = {}
    for issue in issues:
        for hour in issue["hours"]:
            local = datetime.fromisoformat(hour["at"].replace("Z", "+00:00")).astimezone(LOCAL_TIMEZONE)
            if local.year == 2026 and local.month == 2:
                latest[hour["at"]] = hour
    if len(latest) != expected_hours:
        raise ValueError(f"February archive has {len(latest)} hours, expected {expected_hours}")
    return {**data, "month": [latest[at] for at in sorted(latest)], "issues": issues}


def refresh_once(day: date, raw_dir: Path, artifacts_dir: Path, output: Path) -> dict:
    """Run the trained agent; atomically update frontend data only if values changed."""
    if not FIRST_ISSUE <= day <= LAST_ISSUE:
        raise ValueError("issue must be between 2026-01-31 and 2026-02-28")
    forecast_path = run_agent(day, raw_dir, artifacts_dir)
    rows = read_rows(forecast_path)
    run_times = {iso(row["run_time_utc"]) for row in rows}
    if len(run_times) != 1:
        raise ValueError("forecast issue must use one weather run")
    hashes = {row["weather_sha256"] for row in rows}
    hours = build_hours(rows, load_weather(artifacts_dir / "weather", hashes))
    current = json.loads(output.read_text(encoding="utf-8"))
    updated = replace_issue(current, day, run_times.pop(), hours)
    if updated == current:
        return {"status": "UNCHANGED", "issue": day.isoformat(), "forecast": str(forecast_path)}
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=output.parent,
                                     prefix=f".{output.name}.", suffix=".tmp", delete=False) as stream:
        temporary = Path(stream.name)
        json.dump(updated, stream, ensure_ascii=False, separators=(",", ":"))
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, output)
    return {"status": "UPDATED", "issue": day.isoformat(), "forecast": str(forecast_path)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--issue", type=date.fromisoformat, required=True)
    parser.add_argument("--raw-dir", type=Path, default=Path("raw"))
    parser.add_argument("--artifacts-dir", type=Path, default=Path("artifacts"))
    parser.add_argument("--output", type=Path, default=Path("frontend/src/data/february2026.json"))
    parser.add_argument("--interval-minutes", type=int, default=15)
    parser.add_argument("--watch", action="store_true", help="repeat until stopped")
    args = parser.parse_args()
    if args.interval_minutes < 1:
        parser.error("interval-minutes must be at least 1")
    while True:
        print(json.dumps(refresh_once(args.issue, args.raw_dir, args.artifacts_dir, args.output)), flush=True)
        if not args.watch:
            return 0
        time.sleep(args.interval_minutes * 60)


if __name__ == "__main__":
    raise SystemExit(main())
