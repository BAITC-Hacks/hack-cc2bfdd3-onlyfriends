"""Verify submitted forecast artifacts without using future power measurements."""

from hashlib import sha256
import json
from pathlib import Path

import numpy as np
import pandas as pd


def verify(root: Path) -> dict:
    backtest = pd.read_csv(root / "backtest_2026-01-31_2026-02-28.csv")
    station = pd.read_csv(root / "backtest_station_2026-01-31_2026-02-28.csv")
    latest = pd.read_csv(root / "february_latest_forecast.csv")
    metrics = pd.read_csv(root / "model" / "validation_metrics.csv")
    daily = pd.read_csv(root / "model" / "validation_metrics_by_issue_day.csv")
    comparison = pd.read_csv(root / "model" / "validation_comparison.csv")
    coverage = pd.read_csv(root / "model" / "validation_issue_coverage.csv")
    paired = pd.read_csv(root / "model" / "validation_paired_day_deltas.csv")
    uncertainty = json.loads((root / "model" / "validation_paired_day_summary.json").read_text())
    metadata = [json.loads((root / "model" / name).read_text())
                for name in ("early_model_metadata.json", "model_metadata.json")]
    trained_through = {item["model_version"]: pd.Timestamp(item["trained_through_utc"])
                       for item in metadata}
    assert metadata[0]["selected_on_months"] == ["2025-10", "2025-11", "2025-12"]
    assert pd.Timestamp(metadata[0]["training_cutoff_utc"]) == pd.Timestamp("2026-01-30T19:00Z")
    assert pd.Timestamp(metadata[1]["training_cutoff_utc"]) == pd.Timestamp("2026-01-31T19:00Z")
    issue = pd.to_datetime(backtest.issue_time_utc, utc=True)
    valid = pd.to_datetime(backtest.valid_time_utc, utc=True)
    available = pd.to_datetime(backtest.assumed_available_at_utc, utc=True)
    assert len(backtest) == 29 * 48 * 2
    assert issue.nunique() == 29
    expected_issues = pd.date_range("2026-01-31", "2026-02-28", freq="D", tz="Asia/Almaty").tz_convert("UTC")
    assert set(issue.unique()) == set(expected_issues)
    assert backtest.groupby(["issue_time_utc", "turbine_id"]).size().eq(48).all()
    assert backtest.groupby(["issue_time_utc", "turbine_id"]).lead_hour.apply(
        lambda values: sorted(values.tolist()) == list(range(1, 49))
    ).all()
    assert (valid - issue == pd.to_timedelta(backtest.lead_hour, unit="h")).all()
    assert (available <= issue).all()
    assert backtest.predicted_power.between(0, 1).all()
    assert set(backtest.model_version) == set(trained_through)
    first_issue = expected_issues[0]
    assert backtest.loc[issue == first_issue, "model_version"].eq(metadata[0]["model_version"]).all()
    assert backtest.loc[issue > first_issue, "model_version"].eq(metadata[1]["model_version"]).all()
    assert all((issue.loc[backtest.model_version == version] > cutoff).all()
               for version, cutoff in trained_through.items())
    assert set(latest.run_id).issubset(set(backtest.run_id))
    assert len(latest) == 28 * 24 * 2
    assert not latest.duplicated(["valid_time_utc", "turbine_id"]).any()
    latest_time = pd.to_datetime(latest.valid_time_utc, utc=True).dt.tz_convert("Asia/Almaty")
    assert latest_time.min() == pd.Timestamp("2026-02-01T00:00:00", tz="Asia/Almaty")
    assert latest_time.max() == pd.Timestamp("2026-02-28T23:00:00", tz="Asia/Almaty")
    february = backtest.loc[(valid.dt.tz_convert("Asia/Almaty").dt.month == 2)].copy()
    expected_latest = february.sort_values("issue_time_utc", ascending=False).drop_duplicates(
        ["valid_time_utc", "turbine_id"]
    )[["valid_time_utc", "turbine_id", "run_id"]]
    latest_comparison = latest.merge(expected_latest, on=["valid_time_utc", "turbine_id"], suffixes=("", "_expected"), validate="one_to_one")
    assert len(latest_comparison) == len(latest) and latest_comparison.run_id.eq(latest_comparison.run_id_expected).all()
    assert len(station) == 29 * 48
    assert station.unit.eq("one_turbine_nameplate_equivalent").all()
    expected_station = backtest.groupby(["run_id", "lead_hour"]).predicted_power.sum().sort_index()
    observed_station = station.set_index(["run_id", "lead_hour"]).predicted_power.sort_index()
    np.testing.assert_allclose(observed_station.to_numpy(), expected_station.to_numpy())
    assert observed_station.index.equals(expected_station.index)
    assert metrics.issue_day_coverage.ge(0.8).all()
    assert not daily.duplicated(["issue_date", "candidate"]).any()
    assert set(daily.candidate) == set(metrics.candidate)
    assert coverage.issue_days.sum() == 123
    assert coverage.labelled_turbine_hours.sum() == metrics.loc[
        metrics.candidate == metadata[1]["candidate"], "n"].sum()
    assert (coverage.full_label_issues + coverage.partial_label_issues).eq(coverage.issue_days).all()
    assert set(comparison.candidate) == {metadata[1]["candidate"]}
    assert set(paired.reference) == {item["reference"] for item in uncertainty}
    assert all(item["lower_95"] <= item["mean_delta_mae"] <= item["upper_95"]
               for item in uncertainty)
    for run_id in backtest.run_id.unique():
        trace = json.loads((root / "runs" / f"{run_id}.json").read_text())
        artifact = Path(trace["model_artifact"])
        if not artifact.is_absolute():
            artifact = artifact if artifact.exists() else root.parent / artifact
        assert trace["status"] == "SUCCESS"
        assert artifact.exists()
        assert sha256(artifact.read_bytes()).hexdigest() == trace["model_artifact_sha256"]
        provenance = Path(trace["model_provenance_path"])
        if not provenance.is_absolute():
            provenance = provenance if provenance.exists() else root.parent / provenance
        assert provenance.exists()
        assert sha256(provenance.read_bytes()).hexdigest() == trace["model_provenance_sha256"]
        source = metadata[0] if trace["model_version"] == metadata[0]["model_version"] else metadata[1]
        assert trace["training_weather_archive_sha256"] == source["weather_archive_sha256"]
        assert source["feature_columns"]
        if source is metadata[0]:
            assert trace["training_raw_sha256"] is None
            assert trace["training_history_sha256"] == source["training_history_sha256"]
    selected = metrics[metrics.candidate == metadata[1]["candidate"]].mae.mean()
    baseline = metrics[metrics.candidate == "baseline"].mae.mean()
    return {"issues": issue.nunique(), "turbine_hour_predictions": len(backtest),
            "station_hour_predictions": len(station), "february_hour_predictions": len(latest),
            "selected_candidate": metadata[1]["candidate"],
            "selection_mae": round(float(selected), 6), "baseline_mae": round(float(baseline), 6)}


if __name__ == "__main__":
    print(json.dumps(verify(Path("artifacts")), indent=2))
