"""Leakage-safe temporal hyperparameter search for wind-power candidates."""

import pandas as pd

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
