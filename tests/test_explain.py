"""Model SHAP values must reconcile with saved normalized forecasts."""

import numpy as np
import pandas as pd
import pytest
from catboost import CatBoostRegressor

from windpower.explain import explain_predictions


def trained_example():
    frame = pd.DataFrame({
        "turbine_id": ["1", "2"] * 12,
        "wind_speed_100m": [float(index % 12) for index in range(24)],
    })
    model = CatBoostRegressor(iterations=20, depth=2, verbose=False, allow_writing_files=False)
    model.fit(frame, np.linspace(0.1, 0.8, len(frame)), cat_features=["turbine_id"])
    return {"model": model, "candidate": "weather_d6_l10", "model_version": "test-model",
            "feature_columns": list(frame.columns)}, frame


def test_explanations_sum_to_raw_model_output_and_match_saved_forecast():
    bundle, features = trained_example()
    forecast = np.clip(bundle["model"].predict(features), 0, 1)

    values = explain_predictions(bundle, features, forecast)

    assert len(values) == len(features)
    for index, explanation in enumerate(values):
        assert explanation["baseValue"] + sum(explanation["contributions"]) == pytest.approx(
            explanation["rawPrediction"], abs=1e-10)
        assert np.clip(explanation["rawPrediction"], 0, 1) == pytest.approx(forecast[index], abs=1e-10)


def test_explanations_reject_a_forecast_from_another_model():
    bundle, features = trained_example()
    with pytest.raises(ValueError, match="does not match"):
        explain_predictions(bundle, features, np.zeros(len(features)))
