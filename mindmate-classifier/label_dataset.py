"""Prepare blind review packets without loading a model or revealing old labels."""

import sys

from review_dataset import main


if __name__ == "__main__":
    try:
        main(["prepare", *sys.argv[1:]])
    except (ValueError, OSError) as error:
        raise SystemExit(f"Review stopped: {error}")
