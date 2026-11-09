"""Generate synthetic English data and train the local support-priority classification prototype."""
import argparse
import json
from pathlib import Path

from distress.synthetic import GENERATOR_VERSION, write_synthetic_dataset
from train import train


BASE = Path(__file__).resolve().parent


def prepare(output: Path = BASE / "artifacts/prototype", data: Path = BASE / "data/synthetic-english.csv", seed: int = 42):
    write_synthetic_dataset(data, seed)
    result = train(data, output, prototype=True)
    if not result["prototype_usable"]:
        raise ValueError(f"Prototype validation failed: {', '.join(result['prototype_gate_failures'])}")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=BASE / "artifacts/prototype")
    parser.add_argument("--data", type=Path, default=BASE / "data/synthetic-english.csv")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    try:
        result = prepare(args.output, args.data, args.seed)
    except (ValueError, KeyError) as error:
        parser.exit(2, f"Prototype preparation failed: {error}\n")
    print(json.dumps({"generator_version": GENERATOR_VERSION, "seed": args.seed,
                      **{key: result[key] for key in ("model_version", "model_mode", "synthetic_data", "language", "prototype_usable", "split_sizes", "release_approved", "thresholds")}}, indent=2))
