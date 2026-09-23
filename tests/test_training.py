from datetime import date
import json

import pandas as pd

from windpower import training


def test_training_pipeline_excludes_labels_after_historical_issue(tmp_path, monkeypatch):
    raw_dir = tmp_path / "raw"
    raw_dir.mkdir()
    for turbine in (1, 2):
        (raw_dir / f"sample turbine {turbine}.csv").write_text("sample")
    history = pd.DataFrame({
        "valid_time_utc": pd.to_datetime(["2026-01-30T18:00Z", "2026-01-30T19:00Z", "2026-01-31T18:00Z"]),
        "turbine_id": ["1", "1", "1"], "power": [0.1, 0.2, 0.3],
        "measured_wind": [5.0, 6.0, 7.0], "measured_temp": [1.0, 1.0, 1.0],
    })
    history.attrs["quality"] = {"dropped": 0}
    observed = {}
    monkeypatch.setattr(training, "load_history", lambda paths: history)
    monkeypatch.setattr(training, "collect_weather", lambda start, end, cache: (pd.DataFrame({"dummy": [1]}), []))
    def fake_examples(past, weather):
        observed["history"] = past
        return pd.DataFrame({"power": [0.1]})
    monkeypatch.setattr(training, "build_examples", fake_examples)
    def fake_select(examples, past, output_dir, as_of_cutoff):
        output_dir.mkdir(parents=True)
        (output_dir / "early_model_metadata.json").write_text(json.dumps({"model_version": "early-test"}))
        observed["cutoff"] = as_of_cutoff
        return {"model": None, "model_version": "test", "training_cutoff_utc": as_of_cutoff.isoformat()}
    monkeypatch.setattr(training, "select_and_train", fake_select)
    issue = pd.Timestamp("2026-01-30T19:00Z")

    training.train_pipeline(raw_dir, tmp_path / "artifacts", end=date(2026, 1, 30), as_of_cutoff=issue)

    assert observed["history"].valid_time_utc.tolist() == [pd.Timestamp("2026-01-30T18:00Z")]
    assert observed["cutoff"] == issue
    early = json.loads((tmp_path / "artifacts" / "model" / "early_model_metadata.json").read_text())
    assert early["training_history_sha256"] == training.history_digest(observed["history"])
    assert early["weather_end"] == "2026-01-30"
