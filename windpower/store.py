"""Write immutable, versioned forecast artifacts for one logical run."""

from hashlib import sha256
import json
from pathlib import Path
from datetime import datetime, timezone

import pandas as pd

from windpower.weather import SITES


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
    mode: str = "historical",
    target_start_utc: pd.Timestamp | None = None,
) -> tuple[str, Path]:
    """Save one JSON artifact; repeated identical inputs reuse it, conflicts fail."""
    weather_hash = _frame_hash(weather)
    forecast_hash = _frame_hash(forecast)
    run_time = pd.Timestamp(weather["run_time_utc"].iloc[0]).isoformat()
    identity = {
        "schema_version": 2,
        "mode": mode,
        "issue_time_utc": pd.Timestamp(issue_utc).isoformat(),
        "target_start_utc": pd.Timestamp(target_start_utc or issue_utc).isoformat(),
        "run_time_utc": run_time if mode == "historical" else None,
        "retrieved_at_utc": weather.attrs.get("retrieved_at_utc") if mode == "live" else None,
        "model_version": model_version,
        "weather_sha256": weather_hash,
    }
    run_id = sha256(json.dumps(identity, sort_keys=True).encode("utf-8")).hexdigest()[:20]
    metadata = {
        "run_id": run_id,
        **identity,
        "weather_source": "Open-Meteo Single Runs API" if mode == "historical" else "Open-Meteo ECMWF Forecast API",
        "weather_model": "ecmwf_ifs",
        "weather_response_sha256": weather.attrs.get("weather_sha256"),
        "sites": [{"turbine_id": site_id, "latitude": lat, "longitude": lon}
                  for site_id, lat, lon in SITES],
        "availability_rule": "run_time_utc + 7h <= issue_time_utc; estimated, not historical publication proof" if mode == "historical" else None,
        "forecast_sha256": forecast_hash,
        "forecast_count": len(forecast),
        "horizon_hours": 48,
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
    weather_rows = [
        {"turbine_id": str(row.turbine_id), "lead_hour": int(row.lead_hour),
         "valid_time_utc": pd.Timestamp(row.valid_time_utc).isoformat(),
         "wind_speed_10m": float(row.wind_speed_10m),
         "wind_speed_100m": float(row.wind_speed_100m),
         "wind_direction_100m": float(row.wind_direction_100m),
         "temperature_2m": float(row.temperature_2m),
         "surface_pressure": float(row.surface_pressure)}
        for row in weather.itertuples(index=False)
    ]
    artifact = {"metadata": dict(metadata), "weather": weather_rows, "forecast": rows, "analysis": analysis, "events": events}
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    path = output_dir / f"{run_id}.json"
    def matches(existing: dict) -> bool:
        old_metadata = dict(existing.get("metadata", {}))
        old_metadata.pop("created_at_utc", None)
        return (old_metadata == metadata and existing.get("forecast") == rows
                and existing.get("weather") == weather_rows
                and existing.get("analysis") == analysis)
    if path.exists():
        existing = json.loads(path.read_text(encoding="utf-8"))
        if not matches(existing):
            raise ValueError(f"forecast artifact conflicts with existing run: {run_id}")
        return run_id, path
    artifact["metadata"]["created_at_utc"] = datetime.now(timezone.utc).isoformat()
    try:
        with path.open("x", encoding="utf-8") as stream:
            json.dump(artifact, stream, ensure_ascii=False, sort_keys=True, indent=2)
    except FileExistsError:
        existing = json.loads(path.read_text(encoding="utf-8"))
        if not matches(existing):
            raise ValueError(f"forecast artifact conflicts with existing run: {run_id}")
    return run_id, path
