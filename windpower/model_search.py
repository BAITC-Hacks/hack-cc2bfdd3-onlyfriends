"""Leakage-safe temporal hyperparameter search for wind-power candidates."""

import json
from datetime import timedelta
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.metrics import mean_absolute_error
from sklearn.model_selection import GridSearchCV

from windpower.data import load_history
from windpower.features import build_examples
from windpower.model import _fit_candidate, _predict_candidate
from windpower.reporting import paired_day_deltas, paired_day_uncertainty
from windpower.search_estimators import candidate_grids
from windpower.training import ARCHIVE_START, TRAINING_END, issue_time, raw_digest, raw_paths, weather_cache_digest
from windpower.validation import VALIDATION_MONTHS, daily_scores, rolling_folds, score
from windpower.weather import fetch_issue, select_run


INNER_MONTHS = ["2025-07", "2025-08", "2025-09"]
SEARCH_CUTOFF = pd.Timestamp("2025-10-01", tz="Asia/Almaty").tz_convert("UTC")


def search_examples(examples: pd.DataFrame) -> pd.DataFrame:
    """Keep only labels known before the first external validation issue."""
    times = pd.to_datetime(examples.valid_time_utc, utc=True)
    issues = pd.to_datetime(examples.issue_time_utc, utc=True)
    return examples.loc[(times < SEARCH_CUTOFF) & (issues < SEARCH_CUTOFF)].reset_index(drop=True)


def inner_cv_indices(examples: pd.DataFrame, minimum_coverage: float = 0.8):
    """Expanding issue-month folds as positional indices for GridSearchCV."""
    if not examples.index.equals(pd.RangeIndex(len(examples))):
        raise ValueError("search examples must have a contiguous index")
    if pd.to_datetime(examples.valid_time_utc, utc=True).ge(SEARCH_CUTOFF).any():
        raise ValueError("inner search includes labels unavailable by October")
    return [(train.index.to_numpy(), valid.index.to_numpy())
            for train, valid in rolling_folds(examples, INNER_MONTHS, minimum_coverage)]


def clipped_neg_mae(estimator, X: pd.DataFrame, y) -> float:
    """Match inference clipping in every GridSearchCV fold."""
    return -float(mean_absolute_error(y, np.clip(estimator.predict(X), 0, 1)))


def search_one(name: str, estimator, grid: dict, X: pd.DataFrame, y,
               folds: list[tuple[np.ndarray, np.ndarray]]) -> tuple[dict, pd.DataFrame]:
    """Tune one family on fixed past-only folds, returning all trial scores."""
    search = GridSearchCV(estimator, grid, scoring=clipped_neg_mae, cv=folds,
                          refit=False, n_jobs=1, error_score="raise", return_train_score=False)
    search.fit(X, y)
    results = pd.DataFrame(search.cv_results_)
    columns = ["params", "mean_test_score", "std_test_score", "rank_test_score",
               *[f"split{i}_test_score" for i in range(len(folds))]]
    results = results[columns].copy()
    results.insert(0, "family", name)
    return search.best_params_, results


def choose_search_winner(monthly: pd.DataFrame) -> str:
    """Require consistent paired monthly improvement over the incumbent."""
    reference = monthly.loc[monthly.family == "incumbent", ["month", "mae"]].set_index("month").mae
    if reference.empty or reference.index.has_duplicates:
        raise ValueError("one incumbent score per month is required")
    eligible = ["incumbent"]
    for family, group in monthly.groupby("family"):
        if family == "incumbent":
            continue
        challenger = group.set_index("month").mae
        if set(challenger.index) != set(reference.index) or challenger.index.has_duplicates:
            raise ValueError(f"missing monthly scores for {family}")
        wins = int((challenger.reindex(reference.index) < reference).sum())
        if wins >= max(2, len(reference) // 2 + 1) and challenger.mean() < reference.mean():
            eligible.append(family)
    means = monthly.loc[monthly.family.isin(eligible)].groupby("family").mae.mean()
    return str(means.idxmin())


def load_search_inputs(raw_dir: Path, artifacts_dir: Path) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    """Read SCADA and cached, fixed-run NWP without fetching missing archives."""
    paths = raw_paths(raw_dir)
    history = load_history(paths)
    cache = Path(artifacts_dir) / "weather"
    frames = []
    missing = []
    for offset in range((TRAINING_END - ARCHIVE_START).days + 1):
        day = ARCHIVE_START + timedelta(days=offset)
        issue = issue_time(day)
        run = select_run(issue)
        path = cache / f"{issue:%Y%m%dT%H%MZ}_{run:%Y%m%dT%H%MZ}.json"
        if path.exists():
            frames.append(fetch_issue(issue, cache))
        else:
            missing.append(day.isoformat())
    if not frames:
        raise ValueError("no cached issued weather forecasts for model search")
    examples = build_examples(history, pd.concat(frames, ignore_index=True))
    provenance = {
        "raw_sha256": raw_digest(paths),
        "weather_archive_sha256": weather_cache_digest(cache, ARCHIVE_START, TRAINING_END),
        "weather_issues_loaded": len(frames), "weather_issues_missing": missing,
        "examples": len(examples), "history_rows": len(history),
    }
    return history, examples, provenance


def run_search(raw_dir: Path, artifacts_dir: Path, progress=print) -> dict:
    """Tune nine families before October, then evaluate on four later months."""
    history, examples, provenance = load_search_inputs(raw_dir, artifacts_dir)
    output = Path(artifacts_dir) / "model_search"
    output.mkdir(parents=True, exist_ok=True)
    inner = search_examples(examples)
    inner_folds = inner_cv_indices(inner)
    choices = candidate_grids()
    best_params = {}
    inner_results = []
    for name, (estimator, grid) in choices.items():
        progress(f"search {name}: {len(inner_folds)} temporal folds", flush=True)
        params, results = search_one(name, estimator, grid, inner, inner.power, inner_folds)
        best_params[name] = params
        inner_results.append(results)
        progress(f"best {name}: {params}", flush=True)
    grid_table = pd.concat(inner_results, ignore_index=True)
    grid_table["params"] = grid_table.params.map(lambda value: json.dumps(value, sort_keys=True))
    grid_table["mean_mae"] = -grid_table.mean_test_score
    grid_table.to_csv(output / "inner_grid.csv", index=False)
    (output / "best_params.json").write_text(json.dumps(best_params, indent=2), encoding="utf-8")

    monthly, turbine_rows, daily = [], [], []
    for month, (train, valid) in zip(VALIDATION_MONTHS, rolling_folds(examples, minimum_coverage=0.8)):
        for family in [*choices, "incumbent"]:
            progress(f"validate {month} {family}", flush=True)
            if family == "incumbent":
                fitted = _fit_candidate("weather_d6_l10", train, history)
                forecast = _predict_candidate("weather_d6_l10", fitted, valid)
            else:
                fitted = clone(choices[family][0]).set_params(**best_params[family]).fit(train, train.power)
                forecast = np.clip(np.asarray(fitted.predict(valid), dtype=float), 0, 1)
            monthly.append({"month": month, "family": family,
                            "issue_days": valid.attrs["issue_days"],
                            "issue_day_coverage": valid.attrs["issue_day_coverage"],
                            **score(valid.power, forecast, valid.lead_hour)})
            daily.extend(daily_scores(valid, forecast, month, family))
            for turbine, positions in valid.groupby("turbine_id").indices.items():
                group = valid.iloc[positions]
                turbine_rows.append({"month": month, "family": family, "turbine_id": turbine,
                                     **score(group.power, forecast[positions], group.lead_hour)})
    monthly = pd.DataFrame(monthly)
    by_turbine = pd.DataFrame(turbine_rows)
    by_day = pd.DataFrame(daily)
    monthly.to_csv(output / "outer_monthly.csv", index=False)
    by_turbine.to_csv(output / "outer_by_turbine.csv", index=False)
    by_day.to_csv(output / "outer_by_issue_day.csv", index=False)

    incumbent = monthly.loc[monthly.family == "incumbent"].set_index("month").mae
    published = pd.read_csv(Path(artifacts_dir) / "model" / "validation_metrics.csv")
    previous = published.loc[published.candidate == "weather_d6_l10"].set_index("month").mae
    if not np.allclose(incumbent.reindex(previous.index), previous, atol=1e-10):
        raise ValueError("incumbent scores differ from published validation on the same archive")
    pair_rows = []
    uncertainty = []
    for family in choices:
        paired = paired_day_deltas(by_day, family, "incumbent")
        pair_rows.append(paired)
        uncertainty.append(paired_day_uncertainty(paired))
    pd.concat(pair_rows, ignore_index=True).to_csv(output / "paired_day_deltas.csv", index=False)
    (output / "paired_day_uncertainty.json").write_text(json.dumps(uncertainty, indent=2), encoding="utf-8")
    winners = {"full": choose_search_winner(monthly),
               "early": choose_search_winner(monthly.loc[monthly.month < "2026-01"])}
    mean_mae = monthly.groupby("family").mae.mean().sort_values().to_dict()
    result = {**provenance, "inner_months": INNER_MONTHS,
              "outer_months": VALIDATION_MONTHS, "winners": winners,
              "mean_monthly_mae": mean_mae, "best_params": best_params,
              "rule": "lower average MAE and wins >=3/4 months vs incumbent (early >=2/3)"}
    (output / "selection.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    return result
