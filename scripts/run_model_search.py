"""Run causal hyperparameter search and compare all candidate families."""

import argparse
import json
from pathlib import Path

from windpower.model_search import run_search


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=Path, default=Path("raw"))
    parser.add_argument("--artifacts-dir", type=Path, default=Path("artifacts"))
    args = parser.parse_args()
    result = run_search(args.raw_dir, args.artifacts_dir)
    print(json.dumps({"winners": result["winners"],
                      "mean_monthly_mae": result["mean_monthly_mae"]}, indent=2))


if __name__ == "__main__":
    main()
