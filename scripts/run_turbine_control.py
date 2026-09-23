"""Recompute separate turbine CatBoost control against the pooled model."""

import argparse
import json
from pathlib import Path

from windpower.turbine_control import run_turbine_control


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--raw-dir", type=Path, default=Path("raw"))
    parser.add_argument("--artifacts-dir", type=Path, default=Path("artifacts"))
    args = parser.parse_args()
    print(json.dumps(run_turbine_control(args.raw_dir, args.artifacts_dir), indent=2))


if __name__ == "__main__":
    main()
