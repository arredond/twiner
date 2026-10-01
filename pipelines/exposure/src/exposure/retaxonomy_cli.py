"""CLI: uv run python -m exposure.retaxonomy_cli <parts_dir> <exposure.parquet> [--force]

Applies the current vulnerability-class rules (taxonomy.assign_taxonomy) to
every already-crawled part whose `taxonomy_source` is out of date, then
recombines exposure.parquet. See retaxonomy.py. Run after changing the
rules (and bumping TAXONOMY_SOURCE); then re-upload exposure.parquet and
bump DATA_VERSION (README, "Cloud deployment").
"""

from __future__ import annotations

import sys
import time

from .retaxonomy import retaxonomy


def main() -> None:
    args = [a for a in sys.argv[1:] if a != "--force"]
    if len(args) != 2:
        print(f"usage: {sys.argv[0]} <parts_dir> <exposure.parquet> [--force]")
        raise SystemExit(1)
    t0 = time.monotonic()
    n_parts, n_buildings = retaxonomy(args[0], args[1], force="--force" in sys.argv)
    print(
        f"re-derived {n_parts} parts ({n_buildings} buildings), recombined {args[1]} "
        f"in {time.monotonic() - t0:.0f}s"
    )


if __name__ == "__main__":
    main()
