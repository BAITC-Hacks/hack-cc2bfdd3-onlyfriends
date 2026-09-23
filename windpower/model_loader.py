"""Load the trained project bundle eligible for a forecast origin."""

from datetime import datetime
import json
from pathlib import Path

import joblib
import pandas as pd

from windpower import model


class ModelUnavailable(ValueError):
    """A fitted model is missing, incompatible, or unavailable at the origin."""


def load_predictor(path: Path, issue_utc: datetime, mode: str):
    """Choose an eligible immutable bundle and return the existing model predictor."""
    path = Path(path)
    if not path.is_file():
        raise ModelUnavailable(f"Trained power model is missing: {path}")
    try:
        bundle = joblib.load(path)
        if not isinstance(bundle, dict) or not all(key in bundle for key in
                                                     ("model", "candidate", "model_version", "trained_through_utc", "training_cutoff_utc")):
            raise ModelUnavailable("Power model must be a trained windpower bundle.")
        if mode == "historical" and pd.Timestamp(bundle["training_cutoff_utc"]) > pd.Timestamp(issue_utc):
            metadata = json.loads((path.parent / "early_model_metadata.json").read_text(encoding="utf-8"))
            early_path = path.parent / "versions" / f"{metadata['model_version']}.joblib"
            bundle = joblib.load(early_path)
        if mode == "historical" and (
            pd.Timestamp(bundle["training_cutoff_utc"]) > pd.Timestamp(issue_utc)
            or pd.Timestamp(bundle["trained_through_utc"]) >= pd.Timestamp(issue_utc)
        ):
            raise ModelUnavailable("No trained model was available before this historical issue.")
    except ModelUnavailable:
        raise
    except Exception as error:
        raise ModelUnavailable(f"Cannot load eligible power model: {type(error).__name__}") from error

    def predict(features: pd.DataFrame) -> pd.DataFrame:
        return model.predict(bundle, features)

    return predict, str(bundle["model_version"])
