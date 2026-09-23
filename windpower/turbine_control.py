"""Reproduce the pooled versus separate CatBoost turbine experiment."""

import json
from pathlib import Path

import numpy as np
import pandas as pd

from windpower.model import _fit_candidate, _predict_candidate
from windpower.model_search import load_search_inputs
from windpower.validation import VALIDATION_MONTHS, rolling_folds, score


def run_turbine_control(raw_dir: Path, artifacts_dir: Path) -> dict:
    """Fit each turbine on past labels and score identical outer issue-month rows."""
    history, examples, provenance = load_search_inputs(raw_dir, artifacts_dir)
    output = Path(artifacts_dir) / "model_search"
    reference = pd.read_csv(output / "outer_monthly.csv")
    reference = reference.loc[reference.family == "incumbent"].set_index("month")
    if set(reference.index) != set(VALIDATION_MONTHS) or reference.index.has_duplicates:
        raise ValueError("the pooled reference must contain all outer months")
    rows = []
    by_turbine = []
    for month, (train, valid) in zip(VALIDATION_MONTHS, rolling_folds(examples, minimum_coverage=0.8)):
        if int(reference.loc[month, "n"]) != len(valid):
            raise ValueError(f"pooled and separate validation rows differ for {month}")
        prediction = np.empty(len(valid), dtype=float)
        for turbine, positions in valid.groupby("turbine_id").indices.items():
            past = train.loc[train.turbine_id == turbine]
            fitted = _fit_candidate("weather_d6_l10", past, history)
            part = valid.iloc[positions]
            prediction[positions] = _predict_candidate("weather_d6_l10", fitted, part)
            by_turbine.append({"month": month, "turbine_id": turbine,
                               **score(part.power, prediction[positions], part.lead_hour)})
        metrics = score(valid.power, prediction, valid.lead_hour)
        rows.append({"month": month, "separate_mae": metrics["mae"],
                     "pooled_mae": float(reference.loc[month, "mae"]),
                     "delta_mae": metrics["mae"] - float(reference.loc[month, "mae"]),
                     "separate_rmse": metrics["rmse"], "n": metrics["n"]})
    monthly = pd.DataFrame(rows)
    monthly.to_csv(output / "turbine_control_monthly.csv", index=False)
    pd.DataFrame(by_turbine).to_csv(output / "turbine_control_by_turbine.csv", index=False)
    result = {"candidate": "weather_d6_l10", "months": VALIDATION_MONTHS,
              "pooled_mean_monthly_mae": float(monthly.pooled_mae.mean()),
              "separate_mean_monthly_mae": float(monthly.separate_mae.mean()),
              "separate_winning_months": int((monthly.delta_mae < 0).sum()),
              "raw_sha256": provenance["raw_sha256"],
              "weather_archive_sha256": provenance["weather_archive_sha256"]}
    (output / "turbine_control_summary.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result
