"""Command-line entry points for training and historical forecast replay."""

import argparse
from datetime import date
from pathlib import Path

import joblib

from windpower.workflow import (
    ARCHIVE_START, TRAINING_END, backtest, forecast_issue, load_bundle_for_issue, run_agent, train_pipeline,
)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Leakage-safe wind-power forecast workflow")
    parser.add_argument("--artifacts-dir", type=Path, default=Path("artifacts"))
    commands = parser.add_subparsers(dest="command", required=True)
    training = commands.add_parser("train", help="fetch archived weather and train the model")
    training.add_argument("--raw-dir", type=Path, default=Path("raw"))
    training.add_argument("--weather-start", type=date.fromisoformat, default=ARCHIVE_START)
    training.add_argument("--weather-end", type=date.fromisoformat, default=TRAINING_END)
    forecast = commands.add_parser("forecast", help="issue one daily 48-hour forecast")
    forecast.add_argument("--issue", type=date.fromisoformat, required=True)
    replay = commands.add_parser("backtest", help="replay daily issues")
    replay.add_argument("--from", dest="start", type=date.fromisoformat, required=True)
    replay.add_argument("--to", dest="end", type=date.fromisoformat, required=True)
    agent = commands.add_parser("run", help="train if source changed, then issue forecast")
    agent.add_argument("--issue", type=date.fromisoformat, required=True)
    agent.add_argument("--raw-dir", type=Path, default=Path("raw"))
    arguments = parser.parse_args(argv)
    artifacts = arguments.artifacts_dir
    model_path = artifacts / "model" / "model.joblib"
    if arguments.command == "train":
        bundle = train_pipeline(arguments.raw_dir, artifacts, arguments.weather_start, arguments.weather_end)
        print(f"trained {bundle['candidate']} on {bundle['trained_rows']} examples; model {bundle['model_version']}")
        return 0
    if arguments.command == "run":
        path = run_agent(arguments.issue, arguments.raw_dir, artifacts)
        print(path)
        return 0
    if not model_path.exists():
        parser.error(f"model missing: {model_path}; run train first")
    if arguments.command == "forecast":
        bundle = load_bundle_for_issue(arguments.issue, artifacts)
        print(forecast_issue(arguments.issue, bundle, artifacts))
    else:
        bundle = joblib.load(model_path)
        early = load_bundle_for_issue(arguments.start, artifacts) if arguments.start <= date(2026, 1, 31) else None
        result = backtest(arguments.start, arguments.end, bundle, artifacts, early_bundle=early)
        print(f"{len(result)} turbine-hour forecasts saved in {artifacts}")
    return 0
