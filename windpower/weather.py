"""Fetch and verify ECMWF forecasts as they were available at issue time."""

from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from hashlib import sha256
import json
from pathlib import Path
import time

import pandas as pd
import requests


URL = "https://single-runs-api.open-meteo.com/v1/forecast"
PUBLICATION_DELAY_HOURS = 7
LIVE_URL = "https://api.open-meteo.com/v1/ecmwf"
LIVE_FORECAST_DAYS = 10
SITES = (("1", 43.645150, 78.535604), ("2", 43.643198, 78.538828))
VARIABLES = (
    "wind_speed_10m", "wind_speed_100m", "wind_direction_100m",
    "temperature_2m", "surface_pressure",
)
EXPECTED_UNITS = {
    "wind_speed_10m": "m/s", "wind_speed_100m": "m/s",
    "wind_direction_100m": "°", "temperature_2m": "°C", "surface_pressure": "hPa",
}
AVAILABILITY_ASSUMED = "assumed_run_plus_7h"
AVAILABILITY_OBSERVED = "observed_before_issue"


def select_run(issue_utc: datetime, delay_hours: int = PUBLICATION_DELAY_HOURS) -> datetime:
    """Select latest six-hour ECMWF cycle old enough to have been published."""
    if issue_utc.tzinfo is None or issue_utc.utcoffset() is None:
        raise ValueError("issue time must have timezone")
    eligible = issue_utc.astimezone(timezone.utc) - timedelta(hours=delay_hours)
    return eligible.replace(hour=eligible.hour // 6 * 6, minute=0, second=0, microsecond=0)


def live_last_valid_time(issue_utc: datetime) -> datetime:
    """Last UTC hour in a forecast_days window anchored to the current day."""
    issue = issue_utc.astimezone(timezone.utc)
    return issue.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=LIVE_FORECAST_DAYS, hours=-1)


def _parse_payload(payload: list[dict], issue: datetime, run: datetime,
                   target_start: datetime | None = None) -> pd.DataFrame:
    if not isinstance(payload, list) or len(payload) != len(SITES):
        raise ValueError("weather response must contain both turbine locations")
    expected = pd.date_range((target_start or issue) + timedelta(hours=1), periods=48, freq="h", tz="UTC")
    frames = []
    for (turbine_id, requested_latitude, requested_longitude), site in zip(SITES, payload):
        hourly = site.get("hourly", {})
        units = site.get("hourly_units", {})
        if any(units.get(name) != unit for name, unit in EXPECTED_UNITS.items()):
            raise ValueError("unexpected weather unit")
        if not all(name in hourly for name in ("time", *VARIABLES)):
            raise ValueError("missing weather variables")
        values = hourly["time"]
        if any(len(hourly[name]) != len(values) for name in VARIABLES):
            raise ValueError("weather columns have different lengths")
        frame = pd.DataFrame({"valid_time_utc": pd.to_datetime(values, utc=True), **{name: hourly[name] for name in VARIABLES}})
        frame = frame.set_index("valid_time_utc")
        if frame.index.has_duplicates or not expected.isin(frame.index).all():
            raise ValueError("expected 48 hourly weather points after issue")
        frame = frame.loc[expected].rename_axis("valid_time_utc").reset_index()
        if frame[list(VARIABLES)].isna().any().any():
            raise ValueError("expected 48 hourly weather points after issue; found null")
        frame["turbine_id"] = turbine_id
        frame["requested_latitude"] = requested_latitude
        frame["requested_longitude"] = requested_longitude
        frame["grid_latitude"] = float(site["latitude"])
        frame["grid_longitude"] = float(site["longitude"])
        frame["issue_time_utc"] = pd.Timestamp(issue)
        frame["run_time_utc"] = pd.Timestamp(run)
        frame["available_at_assumed_utc"] = pd.Timestamp(run + timedelta(hours=PUBLICATION_DELAY_HOURS))
        frame["lead_hour"] = range(1, 49)
        frames.append(frame)
    return pd.concat(frames, ignore_index=True)


def _utc_timestamp(value: str | None) -> datetime | None:
    if value is None:
        return None
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError("weather provenance timestamp must have timezone")
    return parsed.astimezone(timezone.utc)


def _availability_evidence(envelope: dict, issue: datetime, run: datetime) -> str:
    """Distinguish a pre-issue capture from the seven-hour publication assumption."""
    observed = _utc_timestamp(envelope.get("observed_at_utc"))
    server_date = _utc_timestamp(envelope.get("server_date_utc"))
    if (observed is not None and server_date is not None
            and run <= observed <= issue and run <= server_date <= issue
            and abs((observed - server_date).total_seconds()) <= 600):
        return AVAILABILITY_OBSERVED
    return AVAILABILITY_ASSUMED


def fetch_issue(issue_utc: datetime, cache_dir: Path, session: requests.Session | None = None) -> pd.DataFrame:
    """Return exact 48-hour weather run for both turbines, cached by issue and run."""
    if issue_utc.tzinfo is None or issue_utc.utcoffset() is None:
        raise ValueError("issue time must have timezone")
    issue = issue_utc.astimezone(timezone.utc)
    if issue.minute or issue.second or issue.microsecond:
        raise ValueError("issue time must be at an exact hour")
    run = select_run(issue)
    cache_dir = Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    key = f"{issue:%Y%m%dT%H%MZ}_{run:%Y%m%dT%H%MZ}"
    path = cache_dir / f"{key}.json"
    offset_hours = int((issue - run).total_seconds() / 3600)
    params = {
        "latitude": ",".join(str(site[1]) for site in SITES),
        "longitude": ",".join(str(site[2]) for site in SITES),
        "run": run.strftime("%Y-%m-%dT%H:%M"),
        "models": "ecmwf_ifs",
        "hourly": ",".join(VARIABLES),
        "wind_speed_unit": "ms",
        "timezone": "UTC",
        "forecast_hours": offset_hours + 49,
    }
    if path.exists():
        envelope = json.loads(path.read_text(encoding="utf-8"))
        payload = envelope["payload"]
        digest = sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
        if envelope["sha256"] != digest or envelope["params"] != params:
            raise ValueError(f"weather cache integrity check failed: {path}")
    else:
        client = session or requests.Session()
        for attempt in range(5):
            try:
                response = client.get(URL, params=params, timeout=60)
            except (requests.Timeout, requests.ConnectionError):
                if attempt == 4:
                    raise
                time.sleep(min(2 ** (attempt + 1), 30))
                continue
            if response.status_code == 429 or response.status_code >= 500:
                if attempt == 4:
                    response.raise_for_status()
                retry_after = getattr(response, "headers", {}).get("Retry-After", "")
                try:
                    delay = float(retry_after)
                except ValueError:
                    delay = 2 ** (attempt + 1)
                time.sleep(min(max(delay, 0), 30))
                continue
            response.raise_for_status()
            payload = response.json()
            observed_at = datetime.now(timezone.utc)
            date_header = getattr(response, "headers", {}).get("Date")
            try:
                server_date = parsedate_to_datetime(date_header).astimezone(timezone.utc) if date_header else None
            except (TypeError, ValueError, OverflowError):
                server_date = None
            break
        _parse_payload(payload, issue, run)
        digest = sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
        temporary = path.with_suffix(".tmp")
        envelope = {
            "params": params, "sha256": digest, "payload": payload,
            "observed_at_utc": observed_at.isoformat(),
            "server_date_utc": server_date.isoformat() if server_date else None,
        }
        temporary.write_text(json.dumps(envelope), encoding="utf-8")
        temporary.replace(path)
    result = _parse_payload(payload, issue, run)
    result.attrs["weather_sha256"] = digest
    result.attrs["weather_source"] = URL
    result.attrs["availability_evidence"] = _availability_evidence(envelope, issue, run)
    result.attrs["weather_observed_at_utc"] = envelope.get("observed_at_utc")
    result.attrs["weather_server_date_utc"] = envelope.get("server_date_utc")
    return result


def fetch_live(issue_utc: datetime, session: requests.Session | None = None,
               target_start_utc: datetime | None = None) -> pd.DataFrame:
    """Fetch the current ECMWF forecast for the next 48 hours; no archive claims."""
    if issue_utc.tzinfo is None or issue_utc.utcoffset() is None:
        raise ValueError("issue time must have timezone")
    issue = issue_utc.astimezone(timezone.utc)
    if issue.minute or issue.second or issue.microsecond:
        raise ValueError("issue time must be at an exact hour")
    if abs((datetime.now(timezone.utc) - issue).total_seconds()) > 3600:
        raise ValueError("live issue must be within one hour of current UTC time")
    target = (target_start_utc or issue).astimezone(timezone.utc)
    if target.minute or target.second or target.microsecond:
        raise ValueError("live target start must be an exact UTC hour")
    if target < issue or target + timedelta(hours=48) > live_last_valid_time(issue):
        raise ValueError("live target must fit the current ten-day forecast window")
    params = {
        "latitude": ",".join(str(site[1]) for site in SITES),
        "longitude": ",".join(str(site[2]) for site in SITES),
        "hourly": ",".join(VARIABLES),
        "wind_speed_unit": "ms", "timezone": "UTC", "forecast_days": LIVE_FORECAST_DAYS,
    }
    response = (session or requests.Session()).get(LIVE_URL, params=params, timeout=60)
    response.raise_for_status()
    payload = response.json()
    # The live endpoint does not identify an individual model initialization.
    # This timestamp records retrieval, not a weather model run.
    result = _parse_payload(payload, issue, issue, target)
    result.attrs["retrieved_at_utc"] = datetime.now(timezone.utc).isoformat()
    result.attrs["weather_source"] = LIVE_URL
    result.attrs["weather_sha256"] = sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()
    return result
