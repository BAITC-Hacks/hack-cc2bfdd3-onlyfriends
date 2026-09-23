"""Leakage-safe temporal hyperparameter search for wind-power candidates."""

import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error
from sklearn.model_selection import GridSearchCV

from windpower.validation import rolling_folds


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
