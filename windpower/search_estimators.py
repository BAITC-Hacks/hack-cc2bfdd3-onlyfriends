"""Simple sklearn-compatible wind-power baselines for temporal model search."""

import numpy as np
import pandas as pd
from sklearn.base import BaseEstimator, RegressorMixin
from sklearn.isotonic import IsotonicRegression


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
