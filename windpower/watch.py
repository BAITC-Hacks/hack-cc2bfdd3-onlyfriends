"""Unattended live weather checks for the existing forecast agent."""

import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import time
from typing import Callable

import pandas as pd

from windpower import forecast, store, weather
from windpower.api import forecast_document
from windpower.model_loader import ModelUnavailable, load_predictor


def _saved_for_same_input(output_dir: Path, issue: datetime, version: str,
                          values: list[dict]) -> dict | None:
    """Find a completed live run for this exact issue, model, and weather values."""
    for path in Path(output_dir).glob("[0-9a-f]" * 20 + ".json"):
        try:
            document = json.loads(path.read_text(encoding="utf-8"))
            meta = document["metadata"]
            if (meta.get("mode") == "live" and meta.get("model_version") == version
                    and datetime.fromisoformat(meta["issue_time_utc"]) == issue
                    and datetime.fromisoformat(meta["target_start_utc"]) == issue
                    and "operations" in document and document.get("weather") == values):
                return document
        except (OSError, KeyError, TypeError, ValueError):
            continue
    return None


def check_once(model_path: Path, cache_dir: Path, output_dir: Path,
               now: datetime | None = None,
               fetcher: Callable[[datetime], pd.DataFrame] = weather.fetch_live) -> dict:
    """Fetch live weather once; recalculate only when an input or model changed."""
    instant = now or datetime.now(timezone.utc)
    if instant.tzinfo is None:
        raise ValueError("watch clock must have a timezone")
    issue = instant.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
    try:
        _, version = load_predictor(model_path, issue, "live")
    except ModelUnavailable:
        return {"status": "FAILED", "error_code": "MODEL_UNAVAILABLE", "issue_time_utc": issue.isoformat()}
    try:
        snapshot = fetcher(issue)
        checked = forecast.validate_weather(snapshot, issue, "live")
    except Exception:
        return {"status": "FAILED", "error_code": "WEATHER_UNAVAILABLE", "issue_time_utc": issue.isoformat()}
    existing = _saved_for_same_input(output_dir, issue, version, store.weather_rows(checked))
    if existing is not None:
        return {"status": "UNCHANGED", "run_id": existing["metadata"]["run_id"],
                "issue_time_utc": issue.isoformat(), "model_version": version}
    status, document = forecast_document("live", issue, model_path, cache_dir, output_dir,
                                         weather_snapshot=snapshot)
    if status != 200:
        return {"status": "FAILED", "error_code": document.get("error_code", "FORECAST_ERROR"),
                "issue_time_utc": issue.isoformat()}
    return {"status": "UPDATED", "run_id": document["metadata"]["run_id"],
            "issue_time_utc": issue.isoformat(), "model_version": document["metadata"]["model_version"],
            "signals": len(document["operations"]["signals"])}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check live weather and rerun the wind forecast when it changes")
    parser.add_argument("--interval-minutes", type=int, default=15)
    parser.add_argument("--once", action="store_true", help="perform one check and exit")
    args = parser.parse_args(argv)
    if args.interval_minutes < 1:
        parser.error("interval-minutes must be at least 1")
    model_path = Path(os.getenv("WINDPOWER_MODEL_PATH", "artifacts/model/model.joblib"))
    cache_dir = Path(os.getenv("WINDPOWER_CACHE_DIR", "artifacts/weather"))
    output_dir = Path(os.getenv("WINDPOWER_OUTPUT_DIR", "artifacts/dashboard_runs"))
    try:
        while True:
            report = check_once(model_path, cache_dir, output_dir)
            print(json.dumps(report, sort_keys=True), flush=True)
            if args.once:
                return 0 if report["status"] != "FAILED" else 1
            time.sleep(args.interval_minutes * 60)
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
