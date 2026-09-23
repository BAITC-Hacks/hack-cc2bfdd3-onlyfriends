"""Select generalising power models with rolling, leakage-free validation."""

from hashlib import sha256
import json
from pathlib import Path

from catboost import CatBoostRegressor
import joblib
import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression

from windpower.features import FEATURE_COLUMNS, make_features


VALIDATION_MONTHS = ["2025-10", "2025-11", "2025-12", "2026-01"]
CUTOFF = pd.Timestamp("2026-02-01", tz="Asia/Almaty").tz_convert("UTC")
CANDIDATES = {
    "baseline": None,
    "direct_d4_l3": {"depth": 4, "l2_leaf_reg": 3},
    "direct_d4_l10": {"depth": 4, "l2_leaf_reg": 10},
    "direct_d6_l3": {"depth": 6, "l2_leaf_reg": 3},
    "direct_d6_l10": {"depth": 6, "l2_leaf_reg": 10},
    "two_stage": None,
}


class PowerCurve:
    """Monotone conditional mean power by wind speed, separate for each turbine."""

    def fit(self, frame: pd.DataFrame, wind_column: str) -> "PowerCurve":
        self.curves = {}
        self.wind_column = wind_column
        for turbine_id, group in frame.groupby("turbine_id"):
            curve = IsotonicRegression(y_min=0, y_max=1, out_of_bounds="clip")
            curve.fit(group[wind_column].to_numpy(), group["power"].to_numpy())
            self.curves[str(turbine_id)] = curve
        return self

    def predict(self, frame: pd.DataFrame) -> np.ndarray:
        result = np.empty(len(frame), dtype=float)
        for turbine_id, indices in frame.groupby("turbine_id", sort=False).indices.items():
            result[indices] = self.curves[str(turbine_id)].predict(frame.iloc[indices][self.wind_column].to_numpy())
        return result


class TwoStage:
    """Correct NWP wind to nacelle wind, then apply measured-wind power curve."""

    def fit(self, examples: pd.DataFrame, history: pd.DataFrame) -> "TwoStage":
        self.wind_model = CatBoostRegressor(
            loss_function="RMSE", iterations=400, depth=4, learning_rate=0.04,
            l2_leaf_reg=10, random_seed=42, thread_count=4, verbose=False,
            allow_writing_files=False,
        )
        self.wind_model.fit(examples[FEATURE_COLUMNS], examples["measured_wind"], cat_features=["turbine_id"])
        self.power_curve = PowerCurve().fit(history, "measured_wind")
        return self

    def predict(self, frame: pd.DataFrame) -> np.ndarray:
        corrected = frame[["turbine_id"]].copy()
        corrected["measured_wind"] = np.maximum(0, self.wind_model.predict(frame[FEATURE_COLUMNS]))
        return self.power_curve.predict(corrected)


def rolling_folds(examples: pd.DataFrame, months: list[str] = VALIDATION_MONTHS):
    """Expanding training periods with a clean monthly holdout before February."""
    times = pd.to_datetime(examples["valid_time_utc"], utc=True)
    for month in months:
        start = pd.Timestamp(f"{month}-01", tz="Asia/Almaty").tz_convert("UTC")
        end = (pd.Timestamp(f"{month}-01", tz="Asia/Almaty") + pd.DateOffset(months=1)).tz_convert("UTC")
        train = examples.loc[times < min(start, CUTOFF)].copy()
        valid_mask = (times >= start) & (times < min(end, CUTOFF))
        if "issue_time_utc" in examples:
            valid_mask &= pd.to_datetime(examples["issue_time_utc"], utc=True) >= start
        valid = examples.loc[valid_mask].copy()
        if train.empty or valid.empty:
            raise ValueError(f"missing training or validation rows for {month}")
        yield train, valid


def choose_candidate(scores: pd.DataFrame) -> str:
    """Use average monthly MAE; require repeatable improvement over baseline."""
    average = scores.groupby("candidate").agg(
        mean_mae=("mae", "mean"), worst_mae=("mae", "max"), mean_rmse=("rmse", "mean"),
    )
    if "baseline" not in average.index:
        raise ValueError("baseline scores required")
    baseline = scores.loc[scores.candidate == "baseline", ["month", "mae"]].set_index("month")["mae"]
    eligible = ["baseline"]
    for candidate in average.index.drop("baseline"):
        monthly = scores.loc[scores.candidate == candidate, ["month", "mae"]].set_index("month")["mae"]
        paired = baseline.to_frame("baseline").join(monthly.rename("candidate"), how="inner")
        if len(paired) == len(baseline) and (paired.candidate < paired.baseline).sum() >= max(2, len(paired) // 2 + 1):
            eligible.append(candidate)
    return str(average.loc[eligible].sort_values(["mean_mae", "worst_mae", "mean_rmse"]).index[0])


def _fit_candidate(name: str, examples: pd.DataFrame, history: pd.DataFrame):
    if name == "baseline":
        return PowerCurve().fit(examples, "wind_speed_100m")
    if name == "two_stage":
        return TwoStage().fit(examples, history)
    settings = CANDIDATES[name]
    regressor = CatBoostRegressor(
        loss_function="MAE", iterations=500, learning_rate=0.04,
        random_seed=42, thread_count=4, verbose=False, allow_writing_files=False,
        **settings,
    )
    regressor.fit(examples[FEATURE_COLUMNS], examples["power"], cat_features=["turbine_id"])
    return regressor


def _predict_candidate(name: str, fitted, features: pd.DataFrame) -> np.ndarray:
    source = features if name == "two_stage" or name == "baseline" else features[FEATURE_COLUMNS]
    return np.clip(np.asarray(fitted.predict(source), dtype=float), 0, 1)


def _score(actual: pd.Series, forecast: np.ndarray, lead: pd.Series) -> dict:
    error = forecast - actual.to_numpy()
    first = lead.to_numpy() <= 24
    second = ~first
    return {
        "mae": float(np.mean(np.abs(error))),
        "rmse": float(np.sqrt(np.mean(error ** 2))),
        "bias": float(np.mean(error)),
        "mae_h1_24": float(np.mean(np.abs(error[first]))) if first.any() else float("nan"),
        "mae_h25_48": float(np.mean(np.abs(error[second]))) if second.any() else float("nan"),
        "n": len(error),
    }


def select_and_train(examples: pd.DataFrame, history: pd.DataFrame, output_dir: Path) -> dict:
    """Compare candidates on historic months, refit winner, persist evidence."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    safe_examples = examples.loc[pd.to_datetime(examples.valid_time_utc, utc=True) < CUTOFF].copy()
    safe_history = history.loc[pd.to_datetime(history.valid_time_utc, utc=True) < CUTOFF].copy()
    scores = []
    for month, (train, valid) in zip(VALIDATION_MONTHS, rolling_folds(safe_examples)):
        start = pd.Timestamp(f"{month}-01", tz="Asia/Almaty").tz_convert("UTC")
        past_history = safe_history.loc[safe_history.valid_time_utc < start]
        for name in CANDIDATES:
            fitted = _fit_candidate(name, train, past_history)
            forecast = _predict_candidate(name, fitted, valid)
            scores.append({"month": month, "candidate": name, **_score(valid.power, forecast, valid.lead_hour)})
    metrics = pd.DataFrame(scores)
    metrics.to_csv(output_dir / "validation_metrics.csv", index=False)
    winner = choose_candidate(metrics)
    fitted = _fit_candidate(winner, safe_examples, safe_history)
    fingerprint = pd.util.hash_pandas_object(
        safe_examples[["valid_time_utc", "turbine_id", "power", "wind_speed_100m"]], index=False
    ).values.tobytes()
    model_version = sha256(winner.encode() + fingerprint).hexdigest()[:16]
    bundle = {
        "candidate": winner,
        "model": fitted,
        "model_version": model_version,
        "trained_rows": len(safe_examples),
        "trained_through_utc": safe_examples.valid_time_utc.max().isoformat(),
    }
    joblib.dump(bundle, output_dir / "model.joblib")
    (output_dir / "model_metadata.json").write_text(
        json.dumps({key: value for key, value in bundle.items() if key != "model"}, indent=2), encoding="utf-8"
    )
    return bundle


def predict(bundle: dict, weather: pd.DataFrame) -> pd.DataFrame:
    """Forecast normalized power for each provided turbine and valid hour."""
    inputs = make_features(weather)
    values = _predict_candidate(bundle["candidate"], bundle["model"], inputs)
    result = inputs[["issue_time_utc", "run_time_utc", "valid_time_utc", "turbine_id", "lead_hour"]].copy()
    result["predicted_power"] = values
    result["model_version"] = bundle["model_version"]
    return result
