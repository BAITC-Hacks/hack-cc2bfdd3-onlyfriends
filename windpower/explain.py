"""CatBoost SHAP attribution for archived wind-power forecasts."""

import numpy as np
import pandas as pd
from catboost import CatBoostRegressor, Pool


def explain_predictions(bundle: dict, features: pd.DataFrame, saved_power: np.ndarray) -> list[dict]:
    """Explain raw model output and verify it reproduces the saved, clipped forecast."""
    model = bundle["model"]
    if not isinstance(model, CatBoostRegressor):
        raise ValueError("SHAP requires a direct CatBoost regression model")
    columns = bundle["feature_columns"]
    inputs = features[columns]
    pool = Pool(inputs, cat_features=["turbine_id"])
    shap = np.asarray(model.get_feature_importance(pool, type="ShapValues"), dtype=float)
    raw = np.asarray(model.predict(inputs), dtype=float)
    saved = np.asarray(saved_power, dtype=float)
    if shap.shape != (len(inputs), len(columns) + 1) or saved.shape != raw.shape:
        raise ValueError("SHAP or saved forecast shape does not match model inputs")
    if not np.allclose(shap[:, :-1].sum(axis=1) + shap[:, -1], raw, atol=1e-8):
        raise ValueError("SHAP values do not sum to raw model predictions")
    if not np.allclose(np.clip(raw, 0, 1), saved, atol=1e-8):
        raise ValueError("Saved forecast does not match the SHAP model")
    return [
        {"baseValue": float(row[-1]), "rawPrediction": float(value),
         "contributions": [float(part) for part in row[:-1]]}
        for row, value in zip(shap, raw)
    ]
