import numpy as np
import pandas as pd
from sklearn.base import clone
from sklearn.pipeline import Pipeline

from windpower.features import WEATHER_FEATURE_COLUMNS
from windpower.model_search import (choose_search_winner, clipped_neg_mae,
                                    inner_cv_indices, search_examples)
from windpower.search_estimators import IsotonicWindRegressor, SeasonalMeanRegressor, candidate_grids


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


def test_search_has_nine_cloneable_bounded_model_families():
    choices = candidate_grids()

    assert set(choices) == {"naive", "isotonic", "ridge", "elastic_net", "random_forest",
                            "extra_trees", "hist_gradient_boosting", "catboost", "mlp"}
    for estimator, grid in choices.values():
        clone(estimator)
        assert grid and all(1 <= len(values) <= 4 for values in grid.values())
        if isinstance(estimator, Pipeline) and estimator.steps[0][0] == "prep":
            assert estimator.steps[0][1].transformers


def test_search_clips_predictions_before_mae():
    class WildPredictor:
        def predict(self, features):
            return np.array([1.5, -0.5])

    assert clipped_neg_mae(WildPredictor(), pd.DataFrame(index=[0, 1]),
                           np.array([1.0, 0.0])) == 0.0


def test_each_family_fits_small_forecast_frame():
    n = 40
    frame = pd.DataFrame({column: np.linspace(0.1, 1.0, n)
                          for column in WEATHER_FEATURE_COLUMNS if column != "turbine_id"})
    frame["turbine_id"] = ["1", "2"] * (n // 2)
    frame["wind_speed_100m"] = np.linspace(2, 12, n)
    frame["wind_speed_10m"] = np.linspace(1, 10, n)
    frame.loc[::4, "wind_100m_lag_1h"] = np.nan
    frame["valid_time_utc"] = pd.date_range("2025-06-01", periods=n, freq="h", tz="UTC")
    target = np.linspace(0.1, 0.9, n)

    for name, (estimator, grid) in candidate_grids().items():
        params = {key: values[0] for key, values in grid.items()}
        if name == "catboost":
            params["model__iterations"] = 5
        if name in ("random_forest", "extra_trees"):
            params["model__n_estimators"] = 5
        if name in ("hist_gradient_boosting", "mlp"):
            params["model__max_iter"] = 5
        if name == "mlp":
            params["model__batch_size"] = 20
        fitted = clone(estimator).set_params(**params).fit(frame, target)
        assert np.isfinite(fitted.predict(frame)).all(), name


def test_search_requires_three_monthly_wins_over_incumbent():
    months = ["2025-10", "2025-11", "2025-12", "2026-01"]
    frame = pd.DataFrame([
        {"month": month, "family": family, "mae": error}
        for family, errors in {
            "incumbent": [0.2] * 4,
            "lucky": [0.01, 0.21, 0.21, 0.01],
            "stable": [0.19, 0.18, 0.19, 0.21],
        }.items()
        for month, error in zip(months, errors)
    ])

    assert choose_search_winner(frame) == "stable"
    assert choose_search_winner(frame[frame.month < "2026-01"]) == "stable"
