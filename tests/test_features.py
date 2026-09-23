from datetime import datetime, timezone

import pandas as pd
import numpy as np
import pytest

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


def test_weather_physics_and_run_age_are_forecast_only():
    weather = weather_rows([HOUR])
    weather["wind_direction_100m"] = 90.0
    result = features.make_features(weather)

    assert result.wind_u100.iloc[0] == pytest.approx(-7.0)
    assert result.wind_v100.iloc[0] == pytest.approx(0.0, abs=1e-12)
    assert result.run_age_hours.iloc[0] == 7
    assert result.run_lead_hours.iloc[0] == 24
    assert result.air_density_proxy.iloc[0] == pytest.approx(95000 / (287.05 * 275.15))
    assert result.density_adjusted_wind.iloc[0] > 0
    assert set(features.BASE_FEATURE_COLUMNS).issubset(features.WEATHER_FEATURE_COLUMNS)
    assert "power" not in features.WEATHER_FEATURE_COLUMNS
    assert "measured_wind" not in features.WEATHER_FEATURE_COLUMNS


def test_context_uses_exact_hour_within_same_issue_and_turbine():
    hours = pd.to_datetime(["2026-01-31 09:00Z", "2026-01-31 10:00Z", "2026-01-31 11:00Z"])
    first = weather_rows(hours, ("1",))
    first["issue_time_utc"] = pd.Timestamp("2026-01-29 19:00Z")
    first["run_time_utc"] = pd.Timestamp("2026-01-29 12:00Z")
    first["wind_speed_100m"] = [4.0, 7.0, 10.0]
    second = weather_rows(hours, ("1",))
    second["wind_speed_100m"] = [40.0, 70.0, 100.0]
    other_turbine = weather_rows(hours, ("2",))
    other_turbine["wind_speed_100m"] = [400.0, 700.0, 1000.0]
    combined = pd.concat([first, second, other_turbine], ignore_index=True)

    result = features.make_features(combined)
    row = result.loc[(result.turbine_id == "1") &
                     (result.issue_time_utc == pd.Timestamp("2026-01-29 19:00Z")) &
                     (result.valid_time_utc == hours[1])].iloc[0]
    assert row.wind_100m_lag_1h == 4.0
    assert row.wind_100m_lead_1h == 10.0
    assert row.wind_100m_slope_2h == 3.0
    assert np.isnan(row.wind_100m_lag_3h)
    missing = features.make_features(combined.loc[combined.valid_time_utc != hours[0]])
    missing_row = missing.loc[(missing.turbine_id == "1") &
                              (missing.issue_time_utc == pd.Timestamp("2026-01-29 19:00Z")) &
                              (missing.valid_time_utc == hours[1])].iloc[0]
    assert np.isnan(missing_row.wind_100m_lag_1h)


def test_join_keeps_trajectory_when_only_middle_hour_has_label():
    hours = pd.to_datetime(["2026-01-31 09:00Z", "2026-01-31 10:00Z", "2026-01-31 11:00Z"])
    weather = weather_rows(hours)
    weather["wind_speed_100m"] = [4.0, 7.0, 10.0]
    history = pd.DataFrame({
        "valid_time_utc": [hours[1]], "turbine_id": ["1"], "power": [0.4],
        "measured_wind": [7.0], "measured_temp": [2.0],
    })

    result = features.build_examples(history, weather)

    assert len(result) == 1
    assert result.wind_100m_lag_1h.iloc[0] == 4.0
    assert result.wind_100m_lead_1h.iloc[0] == 10.0


def test_weather_run_must_be_available_by_issue():
    weather = weather_rows([HOUR])
    weather["available_at_assumed_utc"] = pd.Timestamp("2026-01-30 20:00Z")
    with pytest.raises(ValueError, match="availability"):
        features.make_features(weather)
