import numpy as np
import pandas as pd

from windpower.model_search import inner_cv_indices, search_examples
from windpower.search_estimators import IsotonicWindRegressor, SeasonalMeanRegressor


def test_search_excludes_targets_after_october_cutoff_and_keeps_issue_folds():
    examples = pd.DataFrame({
        "issue_time_utc": pd.to_datetime([
            "2025-06-15T19:00Z", "2025-07-15T19:00Z",
            "2025-08-15T19:00Z", "2025-09-15T19:00Z", "2025-09-30T19:00Z",
        ]),
        "valid_time_utc": pd.to_datetime([
            "2025-06-16T00:00Z", "2025-07-16T00:00Z",
            "2025-08-16T00:00Z", "2025-09-16T00:00Z", "2025-10-01T00:00Z",
        ]),
    })

    safe = search_examples(examples)
    folds = inner_cv_indices(safe, minimum_coverage=0)

    assert len(safe) == 4
    assert len(folds) == 3
    assert safe.iloc[folds[0][0]].valid_time_utc.max() < safe.iloc[folds[0][1]].issue_time_utc.min()
    assert safe.iloc[folds[2][1]].issue_time_utc.dt.tz_convert("Asia/Almaty").dt.month.eq(9).all()


def test_naive_prediction_uses_only_fitted_history():
    past = pd.DataFrame({
        "turbine_id": ["1", "1", "2"],
        "valid_time_utc": pd.to_datetime(["2025-01-01", "2025-09-01", "2025-09-01"], utc=True),
    })
    model = SeasonalMeanRegressor(window_days=30).fit(past, np.array([1.0, 0.2, 0.6]))
    future = pd.DataFrame({"turbine_id": ["1", "2"],
                           "valid_time_utc": pd.to_datetime(["2026-02-01", "2026-03-01"], utc=True)})

    np.testing.assert_allclose(model.predict(future), [0.2, 0.6])
    future["valid_time_utc"] += pd.Timedelta(days=365)
    np.testing.assert_allclose(model.predict(future), [0.2, 0.6])


def test_isotonic_curve_supports_both_turbines_and_wind_columns():
    frame = pd.DataFrame({"turbine_id": ["1", "1", "2", "2"],
                          "wind_speed_10m": [2., 10., 2., 10.],
                          "wind_speed_100m": [3., 11., 3., 11.]})
    fit = IsotonicWindRegressor(wind_column="wind_speed_100m").fit(frame, [0.1, 0.8, 0.2, 0.9])

    np.testing.assert_allclose(fit.predict(frame), [0.1, 0.8, 0.2, 0.9])
