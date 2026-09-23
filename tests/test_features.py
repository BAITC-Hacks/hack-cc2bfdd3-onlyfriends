from datetime import datetime, timezone

import pandas as pd

from windpower import features


HOUR = pd.Timestamp("2026-01-31 12:00:00+00:00")


def weather_rows(times, turbines=("1",)):
    return pd.DataFrame([
        {
            "issue_time_utc": pd.Timestamp("2026-01-30 19:00:00+00:00"),
            "run_time_utc": pd.Timestamp("2026-01-30 12:00:00+00:00"),
            "valid_time_utc": time,
            "turbine_id": turbine,
            "lead_hour": i + 1,
            "wind_speed_10m": 5.0,
            "wind_speed_100m": 7.0,
            "wind_direction_100m": 180.0,
            "temperature_2m": 2.0,
            "surface_pressure": 950.0,
        }
        for i, time in enumerate(times) for turbine in turbines
    ])


def test_no_february_target_joins():
    times = [HOUR, pd.Timestamp("2026-02-01 00:00:00+00:00")]
    history = pd.DataFrame({
        "valid_time_utc": times, "turbine_id": ["1", "1"],
        "power": [0.4, 0.9], "measured_wind": [7.0, 10.0], "measured_temp": [2.0, 3.0],
    })

    examples = features.build_examples(history, weather_rows(times))

    assert len(examples) == 1
    assert examples.iloc[0]["power"] == 0.4


def test_features_use_only_forecast_columns():
    weather = weather_rows([HOUR])
    weather["measured_wind"] = 1000.0
    weather["power"] = 1.0

    result = features.make_features(weather)

    assert "measured_wind" not in result
    assert "power" not in result
    assert "direction_sin" in result
    assert set(features.FEATURE_COLUMNS).issubset(result.columns)


def test_join_preserves_turbine_and_hour():
    history = pd.DataFrame({
        "valid_time_utc": [HOUR, HOUR], "turbine_id": ["1", "2"],
        "power": [0.2, 0.7], "measured_wind": [5.0, 8.0], "measured_temp": [2.0, 2.0],
    })

    examples = features.build_examples(history, weather_rows([HOUR], ("1", "2")))

    assert examples.set_index("turbine_id")["power"].to_dict() == {"1": 0.2, "2": 0.7}
