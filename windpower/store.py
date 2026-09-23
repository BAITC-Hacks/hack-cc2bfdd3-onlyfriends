"""Write immutable, versioned forecast artifacts for one logical run."""

from hashlib import sha256
import json
from pathlib import Path

import pandas as pd


def _frame_hash(frame: pd.DataFrame) -> str:
    canonical = frame.reindex(sorted(frame.columns), axis=1).to_csv(index=False)
    return sha256(canonical.encode("utf-8")).hexdigest()


def save_run(
    issue_utc: pd.Timestamp,
    weather: pd.DataFrame,
    forecast: pd.DataFrame,
    model_version: str,
    analysis: dict[str, dict[str, float | int]],
    events: list[dict[str, str]],
    output_dir: Path,
) -> tuple[str, Path]:
    """Save one JSON artifact; repeated identical inputs reuse it, conflicts fail."""
    weather_hash = _frame_hash(weather)
    forecast_hash = _frame_hash(forecast)
    run_time = pd.Timestamp(weather["run_time_utc"].iloc[0]).isoformat()
    identity = {
        "issue_time_utc": pd.Timestamp(issue_utc).isoformat(),
        "run_time_utc": run_time,
        "model_version": model_version,
        "weather_sha256": weather_hash,
    }
    run_id = sha256(json.dumps(identity, sort_keys=True).encode("utf-8")).hexdigest()[:20]
    metadata = {
        "run_id": run_id,
        **identity,
        "weather_source": "Open-Meteo Single Runs API",
        "weather_model": "ecmwf_ifs",
        "availability_rule": "run_time_utc + 7h <= issue_time_utc; estimated, not historical publication proof",
        "forecast_sha256": forecast_hash,
        "forecast_count": len(forecast),
        "status": "SUCCESS",
    }
    rows = [
        {
            "turbine_id": str(row.turbine_id),
            "lead_hour": int(row.lead_hour),
            "valid_time_utc": pd.Timestamp(row.valid_time_utc).isoformat(),
            "predicted_power": float(row.predicted_power),
        }
        for row in forecast.itertuples(index=False)
    ]
    artifact = {"metadata": metadata, "forecast": rows, "analysis": analysis, "events": events}
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / f"{run_id}.json"
    if path.exists():
        existing = json.loads(path.read_text(encoding="utf-8"))
        if existing.get("metadata") != metadata or existing.get("forecast") != rows or existing.get("analysis") != analysis:
            raise ValueError(f"forecast artifact conflicts with existing run: {run_id}")
        return run_id, path
    try:
        with path.open("x", encoding="utf-8") as stream:
            json.dump(artifact, stream, ensure_ascii=False, sort_keys=True, indent=2)
    except FileExistsError:
        existing = json.loads(path.read_text(encoding="utf-8"))
        if existing.get("metadata") != metadata or existing.get("forecast") != rows or existing.get("analysis") != analysis:
            raise ValueError(f"forecast artifact conflicts with existing run: {run_id}")
    return run_id, path
