"""Paired validation comparisons with issue-day uncertainty estimates."""

import json
from pathlib import Path

import numpy as np
import pandas as pd


METRICS = ("mae", "rmse", "mae_h1_24", "mae_h25_48")


def metric_deltas(metrics: pd.DataFrame, candidate: str, reference: str) -> pd.DataFrame:
    """Compare candidates on identical month/turbine/horizon slices."""
    frame = metrics.copy()
    if "turbine_id" not in frame:
        frame["turbine_id"] = "all"
    keys = ["month", "turbine_id"]
    selected = frame.loc[frame.candidate == candidate, keys + list(METRICS)]
    control = frame.loc[frame.candidate == reference, keys + list(METRICS)]
    joined = selected.merge(control, on=keys, suffixes=("_selected", "_reference"),
                            validate="one_to_one")
    if len(joined) != len(selected) or len(joined) != len(control):
        raise ValueError("candidate and reference validation slices differ")
    rows = []
    for metric in METRICS:
        for _, row in joined.iterrows():
            rows.append({**{key: row[key] for key in keys}, "candidate": candidate,
                         "reference": reference, "metric": metric,
                         "selected": row[f"{metric}_selected"],
                         "control": row[f"{metric}_reference"],
                         "delta": row[f"{metric}_selected"] - row[f"{metric}_reference"]})
    return pd.DataFrame(rows)


def paired_day_deltas(daily: pd.DataFrame, candidate: str, reference: str) -> pd.DataFrame:
    """Pair errors by exact local issue date and reject mismatched label coverage."""
    keys = ["month", "issue_date"]
    selected = daily.loc[daily.candidate == candidate, keys + ["mae", "n"]]
    control = daily.loc[daily.candidate == reference, keys + ["mae", "n"]]
    joined = selected.merge(control, on=keys, suffixes=("_selected", "_reference"),
                            validate="one_to_one")
    if len(joined) != len(selected) or len(joined) != len(control):
        raise ValueError("candidate and reference issue days differ")
    if not joined.n_selected.eq(joined.n_reference).all():
        raise ValueError("candidate and reference label counts differ")
    return joined.assign(candidate=candidate, reference=reference,
                         n=joined.n_selected, delta_mae=joined.mae_selected - joined.mae_reference)


def paired_day_uncertainty(paired: pd.DataFrame, samples: int = 10000,
                           seed: int = 42) -> dict:
    """Bootstrap paired issue days within months, preserving monthly MAE weights."""
    if paired.empty:
        raise ValueError("no paired issue days")
    generator = np.random.default_rng(seed)
    monthly = []
    observed = []
    for _, group in paired.groupby("month", sort=True):
        delta = group.delta_mae.to_numpy(dtype=float)
        weight = group.n.to_numpy(dtype=float)
        if (weight <= 0).any():
            raise ValueError("nonpositive issue-day label count")
        observed.append(np.average(delta, weights=weight))
        picks = generator.integers(0, len(group), size=(samples, len(group)))
        monthly.append((delta[picks] * weight[picks]).sum(axis=1) / weight[picks].sum(axis=1))
    lower, upper = np.quantile(np.mean(monthly, axis=0), [0.025, 0.975])
    return {"candidate": paired.candidate.iloc[0], "reference": paired.reference.iloc[0],
            "mean_delta_mae": float(np.mean(observed)), "lower_95": float(lower),
            "upper_95": float(upper), "winning_days": int((paired.delta_mae < 0).sum()),
            "issue_days": len(paired), "bootstrap_samples": samples,
            "bootstrap_unit": "paired_issue_day_within_month",
            "interpretation": "exploratory: these months were used for model selection"}


def write_validation_report(output_dir: Path, metrics: pd.DataFrame,
                            turbine: pd.DataFrame, daily: pd.DataFrame,
                            candidate: str) -> None:
    """Save explicit paired deltas, label coverage and exploratory uncertainty."""
    output_dir = Path(output_dir)
    direct = metrics.loc[metrics.candidate.str.startswith("direct_")].groupby("candidate").mae.mean()
    references = [str(direct.idxmin()), "blend_50"]
    comparison, paired_days, summaries = [], [], []
    for reference in dict.fromkeys(references):
        if reference == candidate:
            continue
        comparison.extend([metric_deltas(metrics, candidate, reference),
                           metric_deltas(turbine, candidate, reference)])
        paired = paired_day_deltas(daily, candidate, reference)
        paired_days.append(paired)
        summaries.append(paired_day_uncertainty(paired))
    pd.concat(comparison, ignore_index=True).to_csv(output_dir / "validation_comparison.csv", index=False)
    pd.concat(paired_days, ignore_index=True).to_csv(output_dir / "validation_paired_day_deltas.csv", index=False)
    (output_dir / "validation_paired_day_summary.json").write_text(
        json.dumps(summaries, indent=2), encoding="utf-8")
    coverage = daily.loc[daily.candidate == candidate].groupby("month").n.agg(
        issue_days="size", full_label_issues=lambda values: int((values == 96).sum()),
        partial_label_issues=lambda values: int((values < 96).sum()),
        labelled_turbine_hours="sum",
    )
    if daily.loc[daily.candidate == candidate, "n"].gt(96).any():
        raise ValueError("more than 96 turbine hours for one issue")
    coverage.to_csv(output_dir / "validation_issue_coverage.csv")
