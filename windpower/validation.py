"""Temporal validation splits, metrics and robust candidate selection."""

import calendar

import numpy as np
import pandas as pd


VALIDATION_MONTHS = ["2025-10", "2025-11", "2025-12", "2026-01"]
CUTOFF = pd.Timestamp("2026-02-01", tz="Asia/Almaty").tz_convert("UTC")
BLENDS = {"blend_50": "direct_d6_l10", "weather_blend_50": "weather_d6_l10"}


def rolling_folds(examples: pd.DataFrame, months: list[str] = VALIDATION_MONTHS,
                  minimum_coverage: float = 0.0):
    """Train on past labels; validate all labelled hours of issues in each month."""
    times = pd.to_datetime(examples["valid_time_utc"], utc=True)
    issues = pd.to_datetime(examples["issue_time_utc"], utc=True) if "issue_time_utc" in examples else times
    for month in months:
        start = pd.Timestamp(f"{month}-01", tz="Asia/Almaty").tz_convert("UTC")
        end = (pd.Timestamp(f"{month}-01", tz="Asia/Almaty") + pd.DateOffset(months=1)).tz_convert("UTC")
        train = examples.loc[(times < start) & (issues < start)].copy()
        valid = examples.loc[(issues >= start) & (issues < end) & (times < CUTOFF)].copy()
        if train.empty or valid.empty:
            raise ValueError(f"missing training or validation rows for {month}")
        days = calendar.monthrange(int(month[:4]), int(month[5:]))[1]
        issue_days = (pd.to_datetime(valid.issue_time_utc, utc=True).dt.tz_convert("Asia/Almaty")
                      .dt.date.nunique()) if "issue_time_utc" in valid else days
        coverage = issue_days / days
        if coverage < minimum_coverage:
            raise ValueError(f"validation archive coverage for {month} is {coverage:.1%}; minimum {minimum_coverage:.1%}")
        valid.attrs["issue_day_coverage"] = coverage
        valid.attrs["issue_days"] = issue_days
        valid.attrs["expected_issue_days"] = days
        yield train, valid


def choose_candidate(scores: pd.DataFrame) -> str:
    """Choose lowest mean MAE after paired monthly stability checks."""
    average = scores.groupby("candidate").agg(
        mean_mae=("mae", "mean"), worst_mae=("mae", "max"), mean_rmse=("rmse", "mean"),
    )
    if "baseline" not in average.index:
        raise ValueError("baseline scores required")

    def wins(candidate: str, reference: str) -> bool:
        paired = (scores.loc[scores.candidate == candidate, ["month", "mae"]].set_index("month")["mae"]
                  .to_frame("candidate")
                  .join(scores.loc[scores.candidate == reference, ["month", "mae"]]
                        .set_index("month")["mae"].rename("reference"), how="inner"))
        expected = scores.loc[scores.candidate == reference, "month"].nunique()
        return len(paired) == expected and (paired.candidate < paired.reference).sum() >= max(2, expected // 2 + 1)

    eligible = ["baseline"]
    for candidate in average.index.drop("baseline"):
        if wins(candidate, "baseline"):
            eligible.append(candidate)
    base_direct = [name for name in eligible if name.startswith("direct_")]
    control = str(average.loc[base_direct].sort_values("mean_mae").index[0]) if base_direct else None
    if control:
        eligible = [name for name in eligible if not name.startswith("weather_")
                    or name in BLENDS or wins(name, control)]
    direct = [name for name in eligible if name.startswith(("direct_", "weather_")) and name not in BLENDS]
    strongest_direct = str(average.loc[direct].sort_values("mean_mae").index[0]) if direct else None
    if strongest_direct:
        eligible = [name for name in eligible if name not in BLENDS or wins(name, strongest_direct)]
    return str(average.loc[eligible].sort_values(["mean_mae", "worst_mae", "mean_rmse"]).index[0])


def score(actual: pd.Series, forecast: np.ndarray, lead: pd.Series) -> dict:
    """Return overall and 24-hour-block point errors for one candidate."""
    error = forecast - actual.to_numpy()
    first = lead.to_numpy() <= 24
    second = ~first
    return {
        "mae": float(np.mean(np.abs(error))),
        "rmse": float(np.sqrt(np.mean(error ** 2))),
        "bias": float(np.mean(error)),
        "mae_h1_24": float(np.mean(np.abs(error[first]))) if first.any() else float("nan"),
        "mae_h25_48": float(np.mean(np.abs(error[second]))) if second.any() else float("nan"),
        "n": len(error),
    }


def daily_scores(valid: pd.DataFrame, forecast: np.ndarray, month: str,
                 candidate: str) -> list[dict]:
    """Persist paired validation errors by local issue day for uncertainty checks."""
    dates = pd.to_datetime(valid.issue_time_utc, utc=True).dt.tz_convert("Asia/Almaty").dt.date
    rows = []
    for day, positions in valid.groupby(dates).indices.items():
        group = valid.iloc[positions]
        rows.append({"month": month, "issue_date": day.isoformat(), "candidate": candidate,
                     **score(group.power, forecast[positions], group.lead_hour)})
    return rows
