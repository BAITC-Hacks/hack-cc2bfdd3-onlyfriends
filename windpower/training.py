"""Prepare source data and archived forecasts for fitted model versions."""

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from hashlib import sha256
import json
from pathlib import Path
from zoneinfo import ZoneInfo

import joblib
import pandas as pd

from windpower.data import load_history
from windpower.features import build_examples
from windpower.model import ALGORITHM_VERSION, CUTOFF, EARLY_CUTOFF, select_and_train
from windpower.weather import PUBLICATION_DELAY_HOURS, URL, fetch_issue


TIMEZONE = "Asia/Almaty"
ARCHIVE_START = date(2024, 3, 15)
TRAINING_END = date(2026, 1, 31)


def issue_time(day: date, timezone_name: str = TIMEZONE) -> datetime:
    """Daily issue at local midnight, represented as UTC."""
    return datetime(day.year, day.month, day.day, tzinfo=ZoneInfo(timezone_name)).astimezone(timezone.utc)


def raw_paths(raw_dir: Path) -> dict[str, Path]:
    """Locate the two organizer CSV files without committing their contents."""
    result = {}
    for turbine_id in ("1", "2"):
        matches = list(Path(raw_dir).glob(f"*turbine {turbine_id}.csv"))
        if len(matches) != 1:
            raise FileNotFoundError(f"expected exactly one raw CSV for turbine {turbine_id} in {raw_dir}")
        result[turbine_id] = matches[0]
    return result


def raw_digest(paths: dict[str, Path]) -> str:
    """Fingerprint source bytes and turbine assignment for model freshness."""
    digest = sha256()
    for turbine_id, path in sorted(paths.items()):
        digest.update(turbine_id.encode())
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
    return digest.hexdigest()


def history_digest(history: pd.DataFrame) -> str:
    """Fingerprint only the hourly SCADA fields available to model fitting."""
    columns = ["valid_time_utc", "turbine_id", "power", "measured_wind", "measured_temp"]
    values = pd.util.hash_pandas_object(history[columns], index=False).values.tobytes()
    return sha256(values).hexdigest()


def save_provenance(output_dir: Path, metadata: dict) -> dict:
    """Keep each model/source combination as an immutable provenance record."""
    fields = ("model_version", "candidate", "feature_columns", "trained_rows", "trained_through_utc",
              "training_cutoff_utc", "algorithm_version", "raw_sha256",
              "training_history_sha256", "weather_archive_sha256", "weather_start", "weather_end")
    record = {key: metadata[key] for key in fields if key in metadata}
    content = json.dumps(record, indent=2, sort_keys=True).encode()
    digest = sha256(content).hexdigest()
    path = output_dir / "provenance" / f"{metadata['model_version']}_{digest[:12]}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        path.write_bytes(content)
    elif path.read_bytes() != content:
        raise ValueError(f"model provenance hash collision: {path}")
    metadata["provenance_path"] = str(path)
    metadata["provenance_sha256"] = digest
    return metadata


def weather_cache_digest(cache_dir: Path, start: date, end: date) -> str:
    """Fingerprint exactly the issue archives used in training, including missing dates."""
    digest = sha256()
    for offset in range((end - start).days + 1):
        day = start + timedelta(days=offset)
        prefix = issue_time(day).strftime("%Y%m%dT%H%MZ")
        matches = sorted(Path(cache_dir).glob(f"{prefix}_*.json"))
        digest.update(day.isoformat().encode())
        for path in matches:
            digest.update(path.name.encode())
            digest.update(sha256(path.read_bytes()).digest())
    return digest.hexdigest()


def collect_weather(start: date, end: date, cache_dir: Path) -> tuple[pd.DataFrame, list[dict]]:
    """Fetch independent archived daily issues with bounded concurrency."""
    dates = [start + timedelta(days=offset) for offset in range((end - start).days + 1)]
    if not dates:
        raise ValueError("weather date range is empty")
    frames, errors = [], []
    with ThreadPoolExecutor(max_workers=4) as pool:
        futures = {pool.submit(fetch_issue, issue_time(day), cache_dir): day for day in dates}
        for future in as_completed(futures):
            day = futures[future]
            try:
                frames.append(future.result())
            except Exception as error:
                errors.append({"issue_date": day.isoformat(), "error_type": type(error).__name__, "detail": str(error)})
    if not frames:
        raise RuntimeError(f"no valid archived weather issues; first errors: {errors[:3]}")
    return pd.concat(frames, ignore_index=True), sorted(errors, key=lambda row: row["issue_date"])


def train_pipeline(raw_dir: Path, artifacts_dir: Path, start: date = ARCHIVE_START,
                   end: date = TRAINING_END, as_of_cutoff: pd.Timestamp = CUTOFF) -> dict:
    """Read SCADA, fetch matching past runs, select model and persist metrics."""
    paths = raw_paths(raw_dir)
    source_digest = raw_digest(paths)
    history = load_history(paths)
    history = history.loc[history.valid_time_utc < as_of_cutoff].copy()
    weather, errors = collect_weather(start, end, Path(artifacts_dir) / "weather")
    examples = build_examples(history, weather)
    if examples.empty:
        raise ValueError("no hourly targets joined to archived forecasts")
    output_dir = Path(artifacts_dir) / "model"
    bundle = select_and_train(examples, history, output_dir, as_of_cutoff=as_of_cutoff)
    early_metadata_path = output_dir / "early_model_metadata.json"
    early_metadata = json.loads(early_metadata_path.read_text(encoding="utf-8"))
    early_history = history.loc[history.valid_time_utc < EARLY_CUTOFF]
    early_metadata["training_history_sha256"] = history_digest(early_history)
    early_metadata["weather_archive_sha256"] = weather_cache_digest(
        Path(artifacts_dir) / "weather", start, min(end, date(2026, 1, 30))
    )
    early_metadata["weather_start"] = start.isoformat()
    early_metadata["weather_end"] = min(end, date(2026, 1, 30)).isoformat()
    save_provenance(output_dir, early_metadata)
    early_metadata_path.write_text(json.dumps(early_metadata, indent=2), encoding="utf-8")
    bundle["raw_sha256"] = source_digest
    bundle["weather_archive_sha256"] = weather_cache_digest(Path(artifacts_dir) / "weather", start, end)
    bundle["weather_start"] = start.isoformat()
    bundle["weather_end"] = end.isoformat()
    save_provenance(output_dir, bundle)
    joblib.dump(bundle, output_dir / "model.joblib")
    metadata = {key: value for key, value in bundle.items() if key != "model"}
    (output_dir / "model_metadata.json").write_text(json.dumps(metadata, indent=2), encoding="utf-8")
    manifest = {
        "raw_sha256": source_digest,
        "weather_archive_sha256": bundle["weather_archive_sha256"],
        "algorithm_version": ALGORITHM_VERSION,
        "weather_start": start.isoformat(), "weather_end": end.isoformat(),
        "history_rows": len(history),
        "training_examples": len(examples),
        "weather_issues_requested": (end - start).days + 1,
        "weather_issues_failed": errors,
        "data_quality": history.attrs["quality"],
        "target_cutoff_local": as_of_cutoff.tz_convert(TIMEZONE).isoformat(),
        "weather_source": URL,
        "availability_assumption_hours_after_initialization": PUBLICATION_DELAY_HOURS,
    }
    (output_dir / "training_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return bundle
