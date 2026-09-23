import numpy as np
import pandas as pd

from windpower import model
from windpower.features import FEATURE_COLUMNS
from tests.test_features import weather_rows


def test_folds_never_train_on_validation_or_february():
    times = pd.to_datetime(["2025-09-15", "2025-10-15", "2025-11-15", "2026-01-15", "2026-02-01"], utc=True)
    examples = pd.DataFrame({"valid_time_utc": times, "power": [0.2] * 5})

    folds = list(model.rolling_folds(examples, ["2025-10", "2026-01"]))

    assert len(folds) == 2
    assert folds[0][0]["valid_time_utc"].max() < folds[0][1]["valid_time_utc"].min()
    assert folds[1][0]["valid_time_utc"].max() < folds[1][1]["valid_time_utc"].min()
    assert all(not frame["valid_time_utc"].dt.tz_convert("Asia/Almaty").dt.month.eq(2).any() for _, frame in folds)


def test_validation_excludes_issues_before_fold_start():
    examples = pd.DataFrame({
        "valid_time_utc": pd.to_datetime(["2025-12-15", "2026-01-02", "2026-01-03"], utc=True),
        "issue_time_utc": pd.to_datetime(["2025-12-14 00:00", "2025-12-31 18:00", "2026-01-01 19:00"], utc=True),
    })

    _, valid = next(model.rolling_folds(examples, ["2026-01"]))

    assert valid["valid_time_utc"].tolist() == [pd.Timestamp("2026-01-03 00:00:00+00:00")]


def test_predictions_clipped_and_ordered():
    weather = weather_rows([pd.Timestamp("2026-01-31 12:00:00+00:00")], ("1", "2"))

    class WildPredictor:
        def predict(self, features):
            return np.array([-0.2, 1.5])

    bundle = {"candidate": "direct", "model": WildPredictor(), "model_version": "v-test"}
    output = model.predict(bundle, weather)

    assert output["predicted_power"].tolist() == [0.0, 1.0]
    assert output["turbine_id"].tolist() == ["1", "2"]
    assert output["model_version"].eq("v-test").all()


def test_selection_uses_average_mae_not_best_single_month():
    scores = pd.DataFrame([
        {"candidate": candidate, "month": month, "mae": error, "rmse": error + 0.02}
        for candidate, errors in {
            "baseline": [0.20, 0.20, 0.20],
            "spiky": [0.01, 0.30, 0.30],
            "stable": [0.12, 0.12, 0.12],
        }.items()
        for month, error in zip(["2025-10", "2025-11", "2025-12"], errors)
    ])

    assert model.choose_candidate(scores) == "stable"
