"""Read regional pressure from the archived or current ECMWF forecast for Q&A."""

from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

import requests

from windpower.weather import LIVE_FORECAST_DAYS, LIVE_URL, URL, SITES


LATITUDE = sum(site[1] for site in SITES) / len(SITES)
LONGITUDE = sum(site[2] for site in SITES) / len(SITES)
POINTS = (
    ("center", LATITUDE, LONGITUDE),
    ("north", LATITUDE + 1, LONGITUDE),
    ("south", LATITUDE - 1, LONGITUDE),
    ("west", LATITUDE, LONGITUDE - 1),
    ("east", LATITUDE, LONGITUDE + 1),
)
VARIABLES = ("pressure_msl", "wind_speed_100m", "wind_direction_100m")


def _request_settings(metadata: dict) -> tuple[str, dict]:
    params = {
        "latitude": ",".join(str(point[1]) for point in POINTS),
        "longitude": ",".join(str(point[2]) for point in POINTS),
        "hourly": ",".join(VARIABLES), "wind_speed_unit": "ms", "timezone": "UTC",
    }
    if metadata["mode"] == "historical":
        run = datetime.fromisoformat(metadata["run_time_utc"].replace("Z", "+00:00"))
        issue = datetime.fromisoformat(metadata["issue_time_utc"].replace("Z", "+00:00"))
        if run.tzinfo is None or issue.tzinfo is None or run > issue:
            raise ValueError("historical weather run is not eligible")
        params.update(run=run.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M"),
                      models="ecmwf_ifs", forecast_hours=96)
        return URL, params
    if metadata["mode"] == "live":
        params["forecast_days"] = LIVE_FORECAST_DAYS
        return LIVE_URL, params
    raise ValueError("unknown forecast mode")


def _read_response(metadata: dict, cache_dir: Path, client) -> tuple[list[dict], str]:
    url, params = _request_settings(metadata)
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / f"{metadata['run_id']}.json"
    if path.exists():
        envelope = json.loads(path.read_text(encoding="utf-8"))
        payload = envelope["payload"]
        digest = sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
        if (envelope.get("request") != {"url": url, "params": params}
                or envelope.get("sha256") != digest):
            raise ValueError("regional forecast cache is invalid")
        return payload, envelope["retrieved_at_utc"]
    response = client.get(url, params=params, timeout=25)
    response.raise_for_status()
    payload = response.json()
    if not isinstance(payload, list) or len(payload) != len(POINTS):
        raise ValueError("regional weather must contain five points")
    for site in payload:
        hourly = site.get("hourly", {})
        if not all(variable in hourly for variable in ("time", *VARIABLES)):
            raise ValueError("regional weather is incomplete")
    retrieved = datetime.now(timezone.utc).isoformat()
    digest = sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    envelope = {"request": {"url": url, "params": params}, "sha256": digest,
                "retrieved_at_utc": retrieved, "payload": payload}
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(envelope), encoding="utf-8")
    temporary.replace(path)
    return payload, retrieved


def _snapshot(payload: list[dict], local_time: str) -> dict:
    utc_hour = datetime.fromisoformat(local_time).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M")
    samples = {}
    for (name, _, _), site in zip(POINTS, payload, strict=True):
        hourly = site["hourly"]
        units = site["hourly_units"]
        if (units.get("pressure_msl") != "hPa" or units.get("wind_speed_100m") != "m/s"
                or units.get("wind_direction_100m") != "°"):
            raise ValueError("regional weather units are invalid")
        index = hourly["time"].index(utc_hour)
        values = {variable: hourly[variable][index] for variable in VARIABLES}
        if any(value is None or not isinstance(value, (int, float)) for value in values.values()):
            raise ValueError("regional weather has missing values")
        samples[name] = {
            "grid_latitude": site["latitude"], "grid_longitude": site["longitude"],
            "pressure_msl_hpa": round(values["pressure_msl"], 2),
            "wind_100m_ms": round(values["wind_speed_100m"], 2),
            "wind_direction_100m_degrees": round(values["wind_direction_100m"], 1),
        }
    pressures = [point["pressure_msl_hpa"] for point in samples.values()]
    return {"time_local": local_time, "points": samples,
            "pressure_spread_hpa": round(max(pressures) - min(pressures), 2)}


def fetch_regional_context(document: dict, context: dict, cache_dir: Path,
                           session=None) -> dict:
    """Summarize regional pressure at selected and peak hours with explicit provenance.

    Historical requests use the saved initialization time. Current forecasts have no
    verified initialization ID, so their later regional retrieval is marked separate.
    """
    metadata = document["metadata"]
    try:
        payload, retrieved = _read_response(metadata, Path(cache_dir), session or requests.Session())
        if not isinstance(payload, list) or len(payload) != len(POINTS):
            raise ValueError("regional weather must contain five points")
        times = {context["selected_valid_time_local"]}
        times.update(summary["strongest_wind_time_local"]
                     for summary in context["selected_date_summary"].values())
        snapshots = [_snapshot(payload, time) for time in sorted(times)]
    except (OSError, ValueError, KeyError, TypeError, requests.RequestException):
        return {"status": "unavailable", "reason": "regional ECMWF pressure context could not be verified"}
    return {
        "status": "available", "source": URL if metadata["mode"] == "historical" else LIVE_URL,
        "same_run_verified": metadata["mode"] == "historical",
        "run_time_utc": metadata.get("run_time_utc"), "retrieved_at_utc": retrieved,
        "sampling": "five forecast grid points near the wind farm, roughly one degree north/south/east/west",
        "snapshots": snapshots,
    }
