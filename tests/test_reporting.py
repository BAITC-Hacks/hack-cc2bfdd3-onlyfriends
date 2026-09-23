import numpy as np
import pandas as pd
import pytest

from windpower.reporting import paired_day_deltas, paired_day_uncertainty, metric_deltas


def test_paired_day_uncertainty_preserves_month_weights_and_day_pairs():
    daily = pd.DataFrame([
        {"month": month, "issue_date": day, "candidate": name, "mae": error, "n": n}
        for month, day, n, weather, control in [
            ("2025-10", "2025-10-01", 100, 0.1, 0.2),
            ("2025-10", "2025-10-02", 1, 0.3, 0.2),
            ("2025-11", "2025-11-01", 2, 0.1, 0.2),
        ]
        for name, error in [("weather", weather), ("control", control)]
    ])

    paired = paired_day_deltas(daily, "weather", "control")
    summary = paired_day_uncertainty(paired, samples=500, seed=42)

    expected = ((-0.1 * 100 + 0.1) / 101 - 0.1) / 2
    assert len(paired) == 3
    assert summary["mean_delta_mae"] == pytest.approx(expected)
    assert summary["lower_95"] <= summary["mean_delta_mae"] <= summary["upper_95"]
    assert summary["winning_days"] == 2


def test_metric_deltas_include_month_turbine_and_horizon():
    metrics = pd.DataFrame([
        {"month": "2025-10", "turbine_id": turbine, "candidate": name,
         "mae": error, "rmse": error, "mae_h1_24": error, "mae_h25_48": error}
        for turbine in ("1", "2")
        for name, error in [("weather", 0.1), ("control", 0.2)]
    ])

    comparison = metric_deltas(metrics, "weather", "control")

    assert len(comparison) == 8
    assert set(comparison.turbine_id) == {"1", "2"}
    assert set(comparison.metric) == {"mae", "rmse", "mae_h1_24", "mae_h25_48"}
    np.testing.assert_allclose(comparison.delta, -0.1)
