import numpy as np
import pandas as pd
import pytest
import joblib

from windpower import model
from windpower.features import FEATURE_COLUMNS
from tests.test_features import weather_rows


class ConstantFramePredictor:
    def __init__(self, value, columns=None):
        self.value = value
        self.columns = columns

    def predict(self, frame):
        if self.columns is not None:
            assert list(frame.columns) == self.columns
        return np.full(len(frame), self.value)


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


def test_sparse_validation_month_is_rejected():
    examples = pd.DataFrame({
        "valid_time_utc": pd.to_datetime(["2025-09-15", "2025-10-02"], utc=True),
        "issue_time_utc": pd.to_datetime(["2025-09-14", "2025-10-01"], utc=True),
    })
    with pytest.raises(ValueError, match="archive coverage"):
        list(model.rolling_folds(examples, ["2025-10"], minimum_coverage=0.8))


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


def test_fixed_blend_averages_direct_and_wind_corrected_models():
    weather = weather_rows([pd.Timestamp("2026-01-31 12:00:00+00:00")], ("1", "2"))

    class PairPredictor:
        def __init__(self, values):
            self.values = np.array(values)

        def predict(self, frame):
            return self.values

    blend = model.BlendModel(PairPredictor([0.2, 0.8]), PairPredictor([0.4, 0.6]))
    bundle = {"candidate": "blend_50", "model": blend, "model_version": "blend-test"}

    np.testing.assert_allclose(model.predict(bundle, weather)["predicted_power"], [0.3, 0.7])


def test_blend_clips_each_component_before_averaging():
    weather = weather_rows([pd.Timestamp("2026-01-31 12:00:00+00:00")])

    class Constant:
        def __init__(self, value):
            self.value = value

        def predict(self, frame):
            return np.full(len(frame), self.value)

    blend = model.BlendModel(Constant(1.3), Constant(0.5))
    bundle = {"candidate": "blend_50", "model": blend, "model_version": "clip-test"}
    assert model.predict(bundle, weather).predicted_power.iloc[0] == pytest.approx(0.75)


def test_issue_month_fold_retains_next_month_target_hour():
    examples = pd.DataFrame({
        "issue_time_utc": pd.to_datetime(["2025-09-14 19:00Z", "2025-10-30 19:00Z"]),
        "valid_time_utc": pd.to_datetime(["2025-09-15 00:00Z", "2025-10-31 20:00Z"]),
    })

    train, valid = next(model.rolling_folds(examples, ["2025-10"]))

    assert len(train) == 1
    assert valid.valid_time_utc.tolist() == [pd.Timestamp("2025-10-31 20:00Z")]


def test_model_version_tracks_wind_calibration_labels():
    frame = weather_rows([pd.Timestamp("2026-01-31 12:00:00+00:00")])
    examples = model.make_features(frame)
    examples["power"] = 0.4
    examples["measured_wind"] = 7.0
    examples["measured_temp"] = 2.0
    history = examples[["valid_time_utc", "turbine_id", "power", "measured_wind", "measured_temp"]].copy()

    first = model.training_fingerprint(examples, history, "blend_50")
    changed = examples.copy()
    changed["measured_wind"] = 8.0
    second = model.training_fingerprint(changed, history, "blend_50")

    assert first != second


def test_legacy_blend_bundle_replays_original_feature_schema_and_math(tmp_path):
    weather = weather_rows([pd.Timestamp("2026-01-31 12:00:00+00:00")])
    old = model.BlendModel(ConstantFramePredictor(1.3, list(model.BASE_FEATURE_COLUMNS)),
                           ConstantFramePredictor(0.5))
    old.__dict__.pop("clip_components", None)
    old.__dict__.pop("direct_features", None)
    path = tmp_path / "old.joblib"
    joblib.dump({"candidate": "blend_50", "model": old, "model_version": "old"}, path)

    output = model.predict(joblib.load(path), weather)

    assert output.predicted_power.iloc[0] == pytest.approx(0.9)


def test_weather_feature_schema_changes_model_fingerprint(monkeypatch):
    frame = weather_rows([pd.Timestamp("2026-01-31 12:00:00+00:00")])
    examples = model.make_features(frame)
    examples["power"] = 0.4
    examples["measured_wind"] = 7.0
    examples["measured_temp"] = 2.0
    history = examples[["valid_time_utc", "turbine_id", "power", "measured_wind", "measured_temp"]].copy()
    first = model.training_fingerprint(examples, history, "weather_d6_l10")
    monkeypatch.setattr(model, "WEATHER_FEATURE_COLUMNS", model.WEATHER_FEATURE_COLUMNS + ["hour_sin"])

    assert model.training_fingerprint(examples, history, "weather_d6_l10") != first


def test_blend_needs_consistent_gain_over_direct_model():
    scores = pd.DataFrame([
        {"candidate": candidate, "month": month, "mae": error, "rmse": error + 0.02}
        for candidate, errors in {
            "baseline": [0.20] * 4,
            "direct_d6_l10": [0.15] * 4,
            "blend_50": [0.10, 0.10, 0.151, 0.151],
        }.items()
        for month, error in zip(model.VALIDATION_MONTHS, errors)
    ])

    assert model.choose_candidate(scores) == "direct_d6_l10"


def test_weather_model_needs_consistent_gain_over_base_direct():
    scores = pd.DataFrame([
        {"candidate": candidate, "month": month, "mae": error, "rmse": error + 0.02}
        for candidate, errors in {
            "baseline": [0.20] * 4,
            "direct_d6_l10": [0.15] * 4,
            "weather_d6_l10": [0.08, 0.08, 0.16, 0.16],
        }.items()
        for month, error in zip(model.VALIDATION_MONTHS, errors)
    ])

    assert model.choose_candidate(scores) == "direct_d6_l10"
