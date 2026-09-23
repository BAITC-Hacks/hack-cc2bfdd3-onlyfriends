"""Export CatBoost SHAP values for the February issue forecasts shown in the UI."""

import argparse
import json
from pathlib import Path

import joblib
import pandas as pd

from windpower.explain import explain_predictions
from windpower.features import make_features
from windpower.weather import fetch_issue


def export(backtest: Path, weather_dir: Path, model_dir: Path) -> dict:
    forecasts = pd.read_csv(backtest, dtype={"turbine_id": str})
    forecasts["valid_time_utc"] = pd.to_datetime(forecasts["valid_time_utc"], utc=True)
    issues = []
    feature_names = None
    for issue_time, rows in forecasts.groupby("issue_time_utc", sort=True):
        issue = pd.Timestamp(issue_time)
        run = pd.Timestamp(rows["run_time_utc"].unique().item())
        if len(rows) != 96 or rows.model_version.nunique() != 1 or rows.weather_sha256.nunique() != 1:
            raise ValueError(f"Incomplete or mixed forecast issue: {issue_time}")
        cache = weather_dir / f"{issue:%Y%m%dT%H%MZ}_{run:%Y%m%dT%H%MZ}.json"
        if not cache.exists():
            raise FileNotFoundError(f"Archived weather required for SHAP: {cache}")
        weather = fetch_issue(issue.to_pydatetime(), weather_dir)
        if weather.attrs["weather_sha256"] != rows.weather_sha256.iloc[0]:
            raise ValueError(f"Weather hash does not match saved forecast: {issue_time}")
        version = rows.model_version.iloc[0]
        bundle = joblib.load(model_dir / f"{version}.joblib")
        if bundle["model_version"] != version:
            raise ValueError(f"Model version mismatch: {version}")
        columns = bundle["feature_columns"]
        if feature_names is None:
            feature_names = columns
        elif feature_names != columns:
            raise ValueError("February models use different feature schemas")
        joined = make_features(weather).merge(
            rows[["valid_time_utc", "turbine_id", "predicted_power"]],
            on=["valid_time_utc", "turbine_id"], how="inner", validate="one_to_one",
        ).sort_values(["valid_time_utc", "turbine_id"]).reset_index(drop=True)
        if len(joined) != len(rows):
            raise ValueError(f"Weather rows missing for forecast issue: {issue_time}")
        explanations = explain_predictions(bundle, joined, joined.predicted_power.to_numpy())
        hours = []
        for at, group in joined.groupby("valid_time_utc", sort=True):
            readings = []
            for index in group.index:
                explanation = explanations[index]
                readings.append({"turbineId": joined.at[index, "turbine_id"],
                                 "baseValue": round(explanation["baseValue"], 9),
                                 "rawPrediction": round(explanation["rawPrediction"], 9),
                                 "contributions": [round(value, 9) for value in explanation["contributions"]]})
            hours.append({"at": at.isoformat().replace("+00:00", "Z"), "readings": readings})
        issues.append({"date": rows.valid_time_local.iloc[0][:10], "modelVersion": version, "hours": hours})
    return {"featureNames": feature_names, "issues": issues}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backtest", type=Path, required=True)
    parser.add_argument("--weather-dir", type=Path, required=True)
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    result = export(args.backtest, args.weather_dir, args.model_dir)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    main()
