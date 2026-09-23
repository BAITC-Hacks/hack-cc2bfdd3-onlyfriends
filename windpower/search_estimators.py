"""Simple sklearn-compatible wind-power baselines for temporal model search."""

import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, RegressorMixin
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import ExtraTreesRegressor, HistGradientBoostingRegressor, RandomForestRegressor
from sklearn.isotonic import IsotonicRegression
from sklearn.impute import SimpleImputer
from sklearn.linear_model import ElasticNet, Ridge
from sklearn.neural_network import MLPRegressor
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, SplineTransformer, StandardScaler
from catboost import CatBoostRegressor

from windpower.features import WEATHER_FEATURE_COLUMNS


class SeasonalMeanRegressor(RegressorMixin, BaseEstimator):
    """Past-window mean power by turbine, with no future telemetry dependency."""

    def __init__(self, window_days: int = 90):
        self.window_days = window_days

    def fit(self, X: pd.DataFrame, y):
        times = pd.to_datetime(X["valid_time_utc"], utc=True)
        recent = times >= times.max() - pd.Timedelta(days=self.window_days)
        target = pd.Series(np.asarray(y, dtype=float), index=X.index)
        self.global_mean_ = float(target.loc[recent].mean())
        self.turbine_means_ = target.loc[recent].groupby(X.loc[recent, "turbine_id"].astype(str)).mean().to_dict()
        return self

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        return X["turbine_id"].astype(str).map(self.turbine_means_).fillna(self.global_mean_).to_numpy()


class IsotonicWindRegressor(RegressorMixin, BaseEstimator):
    """Separate monotone forecast-wind power curve for each turbine."""

    def __init__(self, wind_column: str = "wind_speed_100m"):
        self.wind_column = wind_column

    def fit(self, X: pd.DataFrame, y):
        frame = X[["turbine_id", self.wind_column]].copy()
        frame["target"] = np.asarray(y, dtype=float)
        self.curves_ = {}
        for turbine, group in frame.groupby("turbine_id"):
            curve = IsotonicRegression(y_min=0, y_max=1, out_of_bounds="clip")
            curve.fit(group[self.wind_column], group.target)
            self.curves_[str(turbine)] = curve
        return self

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        result = np.empty(len(X), dtype=float)
        for turbine, positions in X.groupby("turbine_id", sort=False).indices.items():
            result[positions] = self.curves_[str(turbine)].predict(X.iloc[positions][self.wind_column])
        return result


class DataFrameSelector(BaseEstimator):
    """Keep CatBoost's categorical column as a named pandas column."""

    def __init__(self, columns: tuple[str, ...]):
        self.columns = columns

    def fit(self, X, y=None):
        return self

    def transform(self, X):
        return X[list(self.columns)]


def _preprocessor(linear: bool = False, scale: bool = False) -> ColumnTransformer:
    numeric = [column for column in WEATHER_FEATURE_COLUMNS if column != "turbine_id"]
    numeric_steps = [("impute", SimpleImputer(strategy="median"))]
    if scale:
        numeric_steps.append(("scale", StandardScaler()))
    branches = []
    if linear:
        branches.append(("wind", Pipeline([
            ("impute", SimpleImputer(strategy="median")),
            ("spline", SplineTransformer(n_knots=6, degree=3, include_bias=False)),
            ("scale", StandardScaler()),
        ]), ["wind_speed_100m"]))
        numeric.remove("wind_speed_100m")
    branches.extend([
        ("numeric", Pipeline(numeric_steps), numeric),
        ("turbine", OneHotEncoder(handle_unknown="ignore", sparse_output=False), ["turbine_id"]),
    ])
    return ColumnTransformer(branches, sparse_threshold=0.0)


def candidate_grids() -> dict[str, tuple[BaseEstimator, dict]]:
    """Return nine fixed search spaces; all stochastic estimators use seed 42."""
    def pipeline(model, *, linear=False, scale=False):
        return Pipeline([("prep", _preprocessor(linear=linear, scale=scale)), ("model", model)])

    catboost = CatBoostRegressor(
        loss_function="MAE", iterations=500, learning_rate=0.04, random_seed=42,
        thread_count=4, verbose=False, allow_writing_files=False,
        cat_features=("turbine_id",),
    )
    return {
        "naive": (SeasonalMeanRegressor(), {"window_days": [30, 90, 365]}),
        "isotonic": (IsotonicWindRegressor(), {"wind_column": ["wind_speed_10m", "wind_speed_100m"]}),
        "ridge": (pipeline(Ridge(), linear=True, scale=True), {"model__alpha": [0.1, 10.0, 100.0]}),
        "elastic_net": (pipeline(ElasticNet(max_iter=2000, tol=1e-3), linear=True, scale=True),
                        {"model__alpha": [0.001, 0.01], "model__l1_ratio": [0.2, 0.7]}),
        "random_forest": (pipeline(RandomForestRegressor(n_estimators=100, n_jobs=4, random_state=42)),
                          {"model__max_depth": [10, None], "model__min_samples_leaf": [10, 30]}),
        "extra_trees": (pipeline(ExtraTreesRegressor(n_estimators=100, n_jobs=4, random_state=42)),
                        {"model__max_depth": [10, None], "model__min_samples_leaf": [10, 30]}),
        "hist_gradient_boosting": (
            pipeline(HistGradientBoostingRegressor(max_iter=200, learning_rate=0.05,
                                                   early_stopping=False, random_state=42)),
            {"model__max_leaf_nodes": [15, 31], "model__l2_regularization": [1.0, 10.0]}),
        "catboost": (Pipeline([("features", DataFrameSelector(tuple(WEATHER_FEATURE_COLUMNS))),
                               ("model", catboost)]),
                     {"model__depth": [4, 6], "model__l2_leaf_reg": [10, 30]}),
        "mlp": (pipeline(MLPRegressor(max_iter=120, batch_size=512, early_stopping=True,
                                       n_iter_no_change=10, random_state=42), scale=True),
                {"model__hidden_layer_sizes": [(32,), (64, 32)], "model__alpha": [0.001, 0.01]}),
    }
