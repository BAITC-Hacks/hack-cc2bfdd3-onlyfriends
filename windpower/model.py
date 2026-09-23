"""Fit and select power models with one shared candidate definition.

Fitting and rolling validation stay together so the evaluated candidate is
exactly the candidate refitted for issuance; splitting them would duplicate
the feature and prediction contract.
"""

from hashlib import sha256
import json
import calendar
from pathlib import Path

from catboost import CatBoostRegressor
import joblib
import numpy as np
import pandas as pd
from sklearn.isotonic import IsotonicRegression

from windpower.features import FEATURE_COLUMNS, make_features


VALIDATION_MONTHS = ["2025-10", "2025-11", "2025-12", "2026-01"]
CUTOFF = pd.Timestamp("2026-02-01", tz="Asia/Almaty").tz_convert("UTC")
ALGORITHM_VERSION = "windpower-blend-v1"
EARLY_CUTOFF = pd.Timestamp("2026-01-31", tz="Asia/Almaty").tz_convert("UTC")
CANDIDATES = {
    "baseline": None,
    "direct_d4_l3": {"depth": 4, "l2_leaf_reg": 3},
    "direct_d4_l10": {"depth": 4, "l2_leaf_reg": 10},
    "direct_d6_l3": {"depth": 6, "l2_leaf_reg": 3},
    "direct_d6_l10": {"depth": 6, "l2_leaf_reg": 10},
    "two_stage": None,
    "blend_50": None,
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


class BlendModel:
    """Fixed equal-weight blend of the strongest direct model and wind correction."""

    def __init__(self, direct, two_stage):
        self.direct = direct
        self.two_stage = two_stage

    def predict(self, frame: pd.DataFrame) -> np.ndarray:
        direct = np.clip(np.asarray(self.direct.predict(frame[FEATURE_COLUMNS]), dtype=float), 0, 1)
        corrected = np.clip(np.asarray(self.two_stage.predict(frame), dtype=float), 0, 1)
        return 0.5 * direct + 0.5 * corrected


def rolling_folds(examples: pd.DataFrame, months: list[str] = VALIDATION_MONTHS,
                  minimum_coverage: float = 0.0):
    """Expanding training periods with a clean monthly holdout before February."""
    times = pd.to_datetime(examples["valid_time_utc"], utc=True)
    issues = pd.to_datetime(examples["issue_time_utc"], utc=True) if "issue_time_utc" in examples else times
    for month in months:
        start = pd.Timestamp(f"{month}-01", tz="Asia/Almaty").tz_convert("UTC")
        end = (pd.Timestamp(f"{month}-01", tz="Asia/Almaty") + pd.DateOffset(months=1)).tz_convert("UTC")
        train = examples.loc[(times < start) & (issues < start)].copy()
        valid_mask = (issues >= start) & (issues < end) & (times < CUTOFF)
        valid = examples.loc[valid_mask].copy()
        if train.empty or valid.empty:
            raise ValueError(f"missing training or validation rows for {month}")
        days = calendar.monthrange(int(month[:4]), int(month[5:]))[1]
        issue_days = pd.to_datetime(valid.issue_time_utc, utc=True).dt.tz_convert("Asia/Almaty").dt.date.nunique() if "issue_time_utc" in valid else days
        coverage = issue_days / days
        if coverage < minimum_coverage:
            raise ValueError(f"validation archive coverage for {month} is {coverage:.1%}; minimum {minimum_coverage:.1%}")
        valid.attrs["issue_day_coverage"] = coverage
        valid.attrs["issue_days"] = issue_days
        valid.attrs["expected_issue_days"] = days
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
    if name == "blend_50":
        return BlendModel(
            _fit_candidate("direct_d6_l10", examples, history),
            _fit_candidate("two_stage", examples, history),
        )
    settings = CANDIDATES[name]
    regressor = CatBoostRegressor(
        loss_function="MAE", iterations=500, learning_rate=0.04,
        random_seed=42, thread_count=4, verbose=False, allow_writing_files=False,
        **settings,
    )
    regressor.fit(examples[FEATURE_COLUMNS], examples["power"], cat_features=["turbine_id"])
    return regressor


def _predict_candidate(name: str, fitted, features: pd.DataFrame) -> np.ndarray:
    source = features if name in ("two_stage", "baseline", "blend_50") else features[FEATURE_COLUMNS]
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


def training_fingerprint(examples: pd.DataFrame, history: pd.DataFrame, candidate: str) -> str:
    """Version all fitting inputs and chosen algorithm, including wind labels."""
    digest = sha256(json.dumps(
        {"algorithm": ALGORITHM_VERSION, "candidate": candidate, "grid": CANDIDATES}, sort_keys=True
    ).encode())
    for frame, columns in (
        (examples, ["issue_time_utc", "valid_time_utc", *FEATURE_COLUMNS, "power", "measured_wind", "measured_temp"]),
        (history, ["valid_time_utc", "turbine_id", "power", "measured_wind", "measured_temp"]),
    ):
        digest.update(pd.util.hash_pandas_object(frame[columns], index=False).values.tobytes())
    return digest.hexdigest()[:16]


def fit_at_cutoff(candidate: str, examples: pd.DataFrame, history: pd.DataFrame,
                  cutoff: pd.Timestamp, output_dir: Path) -> dict:
    """Fit a model with labels strictly before cutoff and preserve its binary by version."""
    safe_examples = examples.loc[pd.to_datetime(examples.valid_time_utc, utc=True) < cutoff].copy()
    safe_history = history.loc[pd.to_datetime(history.valid_time_utc, utc=True) < cutoff].copy()
    if safe_examples.empty or safe_history.empty:
        raise ValueError("no training rows before issue cutoff")
    bundle = {
        "candidate": candidate,
        "model": _fit_candidate(candidate, safe_examples, safe_history),
        "model_version": training_fingerprint(safe_examples, safe_history, candidate),
        "trained_rows": len(safe_examples),
        "trained_through_utc": safe_examples.valid_time_utc.max().isoformat(),
        "training_cutoff_utc": cutoff.isoformat(),
        "algorithm_version": ALGORITHM_VERSION,
    }
    version_dir = output_dir / "versions"
    version_dir.mkdir(parents=True, exist_ok=True)
    version_path = version_dir / f"{bundle['model_version']}.joblib"
    if not version_path.exists():
        joblib.dump(bundle, version_path)
    return bundle


def select_and_train(examples: pd.DataFrame, history: pd.DataFrame, output_dir: Path,
                     as_of_cutoff: pd.Timestamp = CUTOFF) -> dict:
    """Compare candidates on historic months, refit winner, persist evidence."""
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    cutoff = min(as_of_cutoff, CUTOFF)
    safe_examples = examples.loc[pd.to_datetime(examples.valid_time_utc, utc=True) < cutoff].copy()
    safe_history = history.loc[pd.to_datetime(history.valid_time_utc, utc=True) < cutoff].copy()
    scores = []
    turbine_scores = []
    for month, (train, valid) in zip(VALIDATION_MONTHS, rolling_folds(safe_examples, minimum_coverage=0.8)):
        start = pd.Timestamp(f"{month}-01", tz="Asia/Almaty").tz_convert("UTC")
        past_history = safe_history.loc[safe_history.valid_time_utc < start]
        forecasts = {}
        for name in CANDIDATES:
            if name == "blend_50":
                continue
            fitted = _fit_candidate(name, train, past_history)
            forecast = _predict_candidate(name, fitted, valid)
            forecasts[name] = forecast
            scores.append({"month": month, "candidate": name, "issue_days": valid.attrs["issue_days"],
                           "expected_issue_days": valid.attrs["expected_issue_days"],
                           "issue_day_coverage": valid.attrs["issue_day_coverage"],
                           **_score(valid.power, forecast, valid.lead_hour)})
            for turbine_id, positions in valid.groupby("turbine_id").indices.items():
                group = valid.iloc[positions]
                turbine_scores.append({"month": month, "candidate": name, "turbine_id": turbine_id, **_score(group.power, forecast[positions], group.lead_hour)})
        blended = 0.5 * forecasts["direct_d6_l10"] + 0.5 * forecasts["two_stage"]
        scores.append({"month": month, "candidate": "blend_50", "issue_days": valid.attrs["issue_days"],
                       "expected_issue_days": valid.attrs["expected_issue_days"],
                       "issue_day_coverage": valid.attrs["issue_day_coverage"],
                       **_score(valid.power, blended, valid.lead_hour)})
        for turbine_id, positions in valid.groupby("turbine_id").indices.items():
            group = valid.iloc[positions]
            turbine_scores.append({"month": month, "candidate": "blend_50", "turbine_id": turbine_id, **_score(group.power, blended[positions], group.lead_hour)})
    metrics = pd.DataFrame(scores)
    metrics.to_csv(output_dir / "validation_metrics.csv", index=False)
    pd.DataFrame(turbine_scores).to_csv(output_dir / "validation_metrics_by_turbine.csv", index=False)
    winner = choose_candidate(metrics)
    bundle = fit_at_cutoff(winner, examples, history, cutoff, output_dir)
    early_scores = metrics.loc[metrics.month < "2026-01"].copy()
    early_winner = choose_candidate(early_scores)
    early = fit_at_cutoff(early_winner, examples, history, EARLY_CUTOFF, output_dir)
    early["selected_on_months"] = sorted(early_scores.month.unique().tolist())
    (output_dir / "early_model_metadata.json").write_text(
        json.dumps({key: value for key, value in early.items() if key != "model"}, indent=2), encoding="utf-8"
    )
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
