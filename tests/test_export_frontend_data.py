import csv
import json
import subprocess
import sys
from pathlib import Path


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "export_frontend_data.py"
FIELDS = [
    "issue_time_utc", "run_time_utc", "valid_time_utc", "valid_time_local",
    "turbine_id", "lead_hour", "predicted_power", "model_version",
    "run_id", "weather_sha256",
]


def write_inputs(root: Path) -> tuple[Path, Path, Path]:
    weather = root / "weather"
    weather.mkdir()
    hourly = {
        "time": ["2026-01-31T20:00", "2026-01-31T21:00"],
        "wind_speed_10m": [3.0, 4.0],
        "wind_speed_100m": [7.0, 8.0],
        "wind_direction_100m": [90, 100],
        "temperature_2m": [-4.0, -3.0],
        "surface_pressure": [900.0, 901.0],
    }
    second = {key: [value + 1 for value in values] if key != "time" else values
              for key, values in hourly.items()}
    (weather / "run.json").write_text(json.dumps({"sha256": "hash-a", "payload": [
        {"hourly": hourly}, {"hourly": second},
    ]}), encoding="utf-8")
    rows = []
    for hour in range(2):
        for turbine in ("1", "2"):
            rows.append({
                "issue_time_utc": "2026-01-31 19:00:00+00:00",
                "run_time_utc": "2026-01-31 12:00:00+00:00",
                "valid_time_utc": f"2026-01-31 {20 + hour}:00:00+00:00",
                "valid_time_local": f"2026-02-01 {1 + hour:02}:00:00+05:00",
                "turbine_id": turbine,
                "lead_hour": str(hour + 1),
                "predicted_power": str(0.1 * (hour + 1) * int(turbine)),
                "model_version": "model-a",
                "run_id": "run-a",
                "weather_sha256": "hash-a",
            })
    latest, backtest = root / "latest.csv", root / "backtest.csv"
    for path in (latest, backtest):
        with path.open("w", encoding="utf-8", newline="") as target:
            writer = csv.DictWriter(target, fieldnames=FIELDS)
            writer.writeheader()
            writer.writerows(rows)
    return latest, backtest, weather


def run_export(root: Path, latest: Path, backtest: Path, weather: Path):
    output = root / "result.json"
    command = [
        sys.executable, str(SCRIPT), "--latest", str(latest),
        "--backtest", str(backtest), "--weather-dir", str(weather),
        "--output", str(output), "--expected-hours", "2", "--expected-issues", "1",
    ]
    return subprocess.run(command, capture_output=True, text=True), output


def test_export_aligns_each_turbine_with_its_archived_weather(tmp_path):
    latest, backtest, weather = write_inputs(tmp_path)

    result, output = run_export(tmp_path, latest, backtest, weather)

    assert result.returncode == 0, result.stderr
    data = json.loads(output.read_text(encoding="utf-8"))
    assert len(data["month"]) == 2
    assert data["month"][0]["at"] == "2026-01-31T20:00:00Z"
    assert data["month"][0]["readings"] == [
        {"turbineId": "1", "power": 0.1, "windSpeed10": 3.0, "windSpeed100": 7.0,
         "direction": 90, "temperature": -4.0, "pressure": 900.0},
        {"turbineId": "2", "power": 0.2, "windSpeed10": 4.0, "windSpeed100": 8.0,
         "direction": 91, "temperature": -3.0, "pressure": 901.0},
    ]
    assert len(data["issues"]) == 1
    assert data["issues"][0]["date"] == "2026-02-01"
    assert data["issues"][0]["runTime"] == "2026-01-31T12:00:00Z"


def test_export_fails_when_a_weather_run_is_missing(tmp_path):
    latest, backtest, weather = write_inputs(tmp_path)
    (weather / "run.json").unlink()

    result, output = run_export(tmp_path, latest, backtest, weather)

    assert result.returncode != 0
    assert "hash-a" in result.stderr
    assert not output.exists()
