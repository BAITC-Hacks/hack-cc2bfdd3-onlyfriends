"""Application workflow for training and archived forecast issuance."""

from datetime import date, timedelta
from hashlib import sha256
import json
from pathlib import Path
from uuid import uuid4

import joblib
import pandas as pd

from windpower.agent import ForecastAgent
from windpower.forecast_rules import station_total, verify_forecast
from windpower.model import ALGORITHM_VERSION, EARLY_CUTOFF, predict, predict_features
from windpower.training import (
    ARCHIVE_START, TIMEZONE, TRAINING_END, issue_time, raw_digest, raw_paths,
    train_pipeline, weather_cache_digest,
)
from windpower.weather import PUBLICATION_DELAY_HOURS, URL, fetch_issue


def forecast_issue(day: date, bundle: dict, artifacts_dir: Path, session=None, *,
                   prepared_weather: pd.DataFrame | None = None,
                   prepared_prediction: pd.DataFrame | None = None,
                   agent_events: list[dict[str, str]] | None = None) -> Path:
    """Issue an idempotent 48-hour forecast and structured execution trace."""
    issue = issue_time(day)
    root = Path(artifacts_dir)
    try:
        trained_through = pd.Timestamp(bundle["trained_through_utc"])
        if trained_through >= pd.Timestamp(issue):
            raise ValueError(f"model trained after issue: {trained_through.isoformat()} >= {issue.isoformat()}")
        weather = prepared_weather if prepared_weather is not None else fetch_issue(
            issue, root / "weather", session=session
        )
    except Exception as error:
        failed_id = uuid4().hex[:20]
        failure = {
            "run_id": failed_id, "status": "FAILED", "issue_time_utc": issue.isoformat(),
            "steps": ["weather_requested"], "error_type": type(error).__name__,
            "detail": str(error).split(" for url:")[0],
        }
        failure_dir = root / "runs"
        failure_dir.mkdir(parents=True, exist_ok=True)
        (failure_dir / f"failed_{day.isoformat()}_{failed_id}.json").write_text(
            json.dumps(failure, indent=2), encoding="utf-8"
        )
        raise
    run = weather.run_time_utc.iloc[0]
    weather_digest = weather.attrs["weather_sha256"]
    key = (f"{issue.isoformat()}|{run.isoformat()}|{weather_digest}|"
           f"{bundle['model_version']}|{bundle.get('provenance_sha256', '')}")
    run_id = sha256(key.encode()).hexdigest()[:20]
    output = root / "forecasts" / f"{day.isoformat()}_{run_id}.csv"
    station_output = root / "station_forecasts" / f"{day.isoformat()}_{run_id}.csv"
    trace_path = root / "runs" / f"{run_id}.json"
    if output.exists() and trace_path.exists() and station_output.exists():
        existing = json.loads(trace_path.read_text(encoding="utf-8"))
        if (existing.get("training_raw_sha256") == bundle.get("raw_sha256")
                and existing.get("training_history_sha256") == bundle.get("training_history_sha256")
                and existing.get("training_weather_archive_sha256") == bundle.get("weather_archive_sha256")
                and existing.get("model_provenance_sha256") == bundle.get("provenance_sha256")):
            return output
    trace = {
        "run_id": run_id, "status": "RUNNING", "issue_time_utc": issue.isoformat(),
        "weather_run_utc": run.isoformat(), "weather_sha256": weather_digest,
        "weather_source": URL, "weather_model": "ecmwf_ifs",
        "assumed_available_at_utc": weather.available_at_assumed_utc.iloc[0].isoformat(),
        "availability_rule": f"initialization plus {PUBLICATION_DELAY_HOURS} hours; exact historical publication not returned by API",
        "model_version": bundle["model_version"], "steps": ["weather_fetched", "weather_validated"],
    }
    if agent_events is not None:
        trace["agent_events"] = [*agent_events, {"step": "save_forecast", "status": "SUCCESS"}]
    model_path = root / "model" / "versions" / f"{bundle['model_version']}.joblib"
    trace["model_artifact"] = str(model_path) if model_path.exists() else None
    trace["model_artifact_sha256"] = sha256(model_path.read_bytes()).hexdigest() if model_path.exists() else None
    trace["training_raw_sha256"] = bundle.get("raw_sha256")
    trace["training_history_sha256"] = bundle.get("training_history_sha256")
    trace["training_weather_archive_sha256"] = bundle.get("weather_archive_sha256")
    trace["training_cutoff_utc"] = bundle.get("training_cutoff_utc")
    trace["model_provenance_path"] = bundle.get("provenance_path")
    trace["model_provenance_sha256"] = bundle.get("provenance_sha256")
    trace_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        prediction = prepared_prediction.copy() if prepared_prediction is not None else predict(bundle, weather)
        trace["steps"].extend(["features_prepared", "model_executed"])
        diagnostics = verify_forecast(prediction, weather, issue)
        trace["steps"].append("forecast_validated")
        prediction["model_version"] = bundle["model_version"]
        prediction["run_id"] = run_id
        prediction["weather_sha256"] = weather_digest
        prediction["weather_source"] = URL
        prediction["weather_model"] = "ecmwf_ifs"
        weather_metadata = [
            "turbine_id", "lead_hour", "valid_time_utc", "available_at_assumed_utc",
            "requested_latitude", "requested_longitude", "grid_latitude", "grid_longitude",
        ]
        prediction = prediction.merge(
            weather[weather_metadata], on=["turbine_id", "lead_hour", "valid_time_utc"],
            how="left", validate="one_to_one",
        )
        prediction["valid_time_local"] = prediction.valid_time_utc.dt.tz_convert(TIMEZONE)
        station = station_total(prediction)
        output.parent.mkdir(parents=True, exist_ok=True)
        station_output.parent.mkdir(parents=True, exist_ok=True)
        prediction.to_csv(output, index=False)
        station.to_csv(station_output, index=False)
        trace.update({"status": "SUCCESS", "rows": len(prediction), "station_rows": len(station),
                      "station_forecast_path": str(station_output), "diagnostics": diagnostics})
        trace["steps"].extend(["result_analyzed", "forecast_saved"])
    except Exception as error:
        trace.update({"status": "FAILED", "error_type": type(error).__name__, "detail": str(error)})
        raise
    finally:
        trace_path.write_text(json.dumps(trace, indent=2), encoding="utf-8")
    return output


def backtest(start: date, end: date, bundle: dict, artifacts_dir: Path, session=None,
             early_bundle: dict | None = None) -> pd.DataFrame:
    """Replay each local daily issue and retain every issue-specific forecast."""
    if end < start:
        raise ValueError("backtest end precedes start")
    frames = []
    for offset in range((end - start).days + 1):
        day = start + timedelta(days=offset)
        selected = early_bundle if issue_time(day) <= EARLY_CUTOFF.to_pydatetime() and early_bundle is not None else bundle
        path = forecast_issue(day, selected, artifacts_dir, session=session)
        frames.append(pd.read_csv(path))
    result = pd.concat(frames, ignore_index=True)
    path = Path(artifacts_dir) / f"backtest_{start.isoformat()}_{end.isoformat()}.csv"
    result.to_csv(path, index=False)
    station_frames = [station_total(frame) for frame in frames]
    pd.concat(station_frames, ignore_index=True).to_csv(
        Path(artifacts_dir) / f"backtest_station_{start.isoformat()}_{end.isoformat()}.csv", index=False
    )
    if start <= date(2026, 1, 31) and end >= date(2026, 2, 28):
        valid = pd.to_datetime(result["valid_time_utc"], utc=True)
        february_start = pd.Timestamp("2026-02-01", tz=TIMEZONE).tz_convert("UTC")
        march_start = pd.Timestamp("2026-03-01", tz=TIMEZONE).tz_convert("UTC")
        february = result.loc[(valid >= february_start) & (valid < march_start)]
        latest = february.sort_values(
            ["valid_time_utc", "turbine_id", "issue_time_utc"], ascending=[True, True, False]
        ).drop_duplicates(["valid_time_utc", "turbine_id"])
        latest.to_csv(Path(artifacts_dir) / "february_latest_forecast.csv", index=False)
    return result


def load_bundle_for_issue(day: date, artifacts_dir: Path) -> dict:
    """Load the immutable fitted model available before this issue."""
    root = Path(artifacts_dir) / "model"
    full = joblib.load(root / "model.joblib")
    if issue_time(day) > EARLY_CUTOFF.to_pydatetime():
        return full
    metadata = json.loads((root / "early_model_metadata.json").read_text(encoding="utf-8"))
    early = joblib.load(root / "versions" / f"{metadata['model_version']}.joblib")
    early["raw_sha256"] = None
    early["training_history_sha256"] = metadata["training_history_sha256"]
    early["weather_archive_sha256"] = metadata["weather_archive_sha256"]
    early["provenance_path"] = metadata["provenance_path"]
    early["provenance_sha256"] = metadata["provenance_sha256"]
    return early


def run_agent(day: date, raw_dir: Path, artifacts_dir: Path, session=None) -> Path:
    """Autonomously reuse or train model, issue forecast, and trace the decision."""
    root = Path(artifacts_dir)
    agent_run_id = uuid4().hex[:20]
    trace = {
        "agent_run_id": agent_run_id, "agent": "ForecastAgent",
        "issue_time_utc": issue_time(day).isoformat(), "status": "RUNNING", "steps": [],
    }
    trace_dir = root / "agent_runs"
    trace_dir.mkdir(parents=True, exist_ok=True)
    try:
        source_hash = raw_digest(raw_paths(raw_dir))
        trace["steps"].append("history_checked")
        model_path = root / "model" / "model.joblib"
        bundle = joblib.load(model_path) if model_path.exists() else None
        manifest_path = root / "model" / "training_manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else None
        if manifest:
            trace["weather_retries"] = []
            for missing in manifest.get("weather_issues_failed", []):
                try:
                    fetch_issue(issue_time(date.fromisoformat(missing["issue_date"])), root / "weather", session=session)
                    trace["weather_retries"].append({"issue_date": missing["issue_date"], "status": "RECOVERED"})
                except Exception as error:
                    trace["weather_retries"].append({"issue_date": missing["issue_date"], "status": "STILL_MISSING",
                                                     "error_type": type(error).__name__, "detail": str(error).split(" for url:")[0]})
        archive_hash = weather_cache_digest(root / "weather", date.fromisoformat(manifest["weather_start"]),
                                             date.fromisoformat(manifest["weather_end"])) if manifest else None
        expected_end = min(TRAINING_END, day - timedelta(days=1))
        allowed_cutoff = min(pd.Timestamp(issue_time(day)), pd.Timestamp("2026-02-01", tz=TIMEZONE).tz_convert("UTC"))
        if (bundle is None or bundle.get("raw_sha256") != source_hash
                or bundle.get("weather_archive_sha256") != archive_hash
                or bundle.get("algorithm_version") != ALGORITHM_VERSION
                or manifest is None or manifest.get("weather_end") != expected_end.isoformat()
                or pd.Timestamp(bundle.get("training_cutoff_utc", "2100-01-01T00:00:00Z")) > allowed_cutoff):
            bundle = train_pipeline(raw_dir, root, end=expected_end, as_of_cutoff=allowed_cutoff)
            trace["steps"].append("model_trained")
        else:
            trace["steps"].append("model_loaded")
        if issue_time(day) <= EARLY_CUTOFF.to_pydatetime():
            bundle = load_bundle_for_issue(day, root)
        issue = issue_time(day)
        if pd.Timestamp(bundle["trained_through_utc"]) >= pd.Timestamp(issue):
            raise ValueError("model was trained on data unavailable at issue time")

        def save_graph_result(state):
            path = forecast_issue(
                day, bundle, root, session=session,
                prepared_weather=state["weather"],
                prepared_prediction=state["forecast"],
                agent_events=state["events"],
            )
            return path.stem.split("_")[-1], path

        graph = ForecastAgent(
            predictor=lambda prepared: predict_features(bundle, prepared),
            model_version=bundle["model_version"],
            cache_dir=root / "weather",
            output_dir=root / "forecasts",
            weather_fetcher=lambda at: fetch_issue(at, root / "weather", session=session),
            saver=save_graph_result,
        )
        result = graph.run(issue)
        trace["graph_events"] = list(result.events)
        if result.status != "SUCCESS" or result.artifact_path is None:
            raise ValueError(f"{result.error_code}: {result.error_message}")
        forecast_path = result.artifact_path
        trace["steps"].append("forecast_issued")
        trace.update({"status": "SUCCESS", "model_version": bundle["model_version"],
                      "forecast_run_id": result.run_id, "forecast_path": str(forecast_path)})
        return forecast_path
    except Exception as error:
        trace.update({"status": "FAILED", "error_type": type(error).__name__, "detail": str(error).split(" for url:")[0]})
        raise
    finally:
        (trace_dir / f"{agent_run_id}.json").write_text(json.dumps(trace, indent=2), encoding="utf-8")
