import csv
from pathlib import Path

import pandas as pd
import pytest

from windpower import data


COLUMNS = [
    "ID",
    "Статистическое время",
    "Средняя скорость ветра(m/s)",
    "Нормализованная активная мощность",
    "Средняя температура окружающей среды(°C)",
]


def write_rows(path: Path, rows: list[tuple[str, str, str, str]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as stream:
        writer = csv.writer(stream)
        writer.writerow(COLUMNS)
        for index, (time, wind, power, temp) in enumerate(rows, 1):
            writer.writerow([index, time, wind, power, temp])


def test_parses_single_digit_hours_and_aggregates_six_samples(tmp_path):
    path = tmp_path / "turbine.csv"
    write_rows(path, [(f"2023-03-11 0:{minute:02d}:00", "6", str(i / 10), "12") for i, minute in enumerate(range(0, 60, 10))])

    frame = data.load_history({"1": path})

    assert len(frame) == 1
    assert frame.iloc[0]["valid_time_utc"] == pd.Timestamp("2023-03-10 18:00:00+00:00")
    assert frame.iloc[0]["sample_count"] == 6
    assert frame.iloc[0]["power"] == pytest.approx(0.25)
    assert frame.iloc[0]["measured_wind"] == pytest.approx(6)


def test_rejects_duplicate_timestamp(tmp_path):
    path = tmp_path / "turbine.csv"
    write_rows(path, [("2026-01-01 0:00:00", "6", "0.3", "12")] * 2)

    with pytest.raises(ValueError, match="duplicate"):
        data.load_history({"1": path})


def test_drops_hours_with_fewer_than_four_valid_samples(tmp_path):
    path = tmp_path / "turbine.csv"
    rows = [(f"2026-01-01 0:{minute:02d}:00", "6", "0.3" if minute < 30 else "", "12") for minute in range(0, 60, 10)]
    write_rows(path, rows)

    frame = data.load_history({"1": path})

    assert frame.empty
    assert frame.attrs["quality"]["hours_below_coverage"] == 1


def test_drops_ambiguous_kazakhstan_clock_change_hour(tmp_path):
    path = tmp_path / "turbine.csv"
    rows = [(f"2024-02-29 23:{minute:02d}:00", "6", "0.3", "12") for minute in range(0, 60, 10)]
    rows += [(f"2024-03-01 0:{minute:02d}:00", "6", "0.3", "12") for minute in range(0, 60, 10)]
    write_rows(path, rows)

    frame = data.load_history({"1": path})

    assert len(frame) == 1
    assert frame.attrs["quality"]["ambiguous_time_rows"] == 6
